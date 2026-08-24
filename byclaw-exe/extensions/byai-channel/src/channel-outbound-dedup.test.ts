import { describe, expect, it, vi } from "vitest";

vi.mock("./utils.js", async () => {
  const actual = await vi.importActual<typeof import("./utils.js")>("./utils.js");
  return { ...actual, generateRandomId: () => "mock-message-id" };
});

vi.mock("./diagnostics.js", () => ({
  emitByaiSdkFirstResponse: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: () => "test",
  // 与 src/sessions/session-key-utils.ts 的判定一致：rest 段以 subagent: 开头即子会话。
  isSubagentSessionKey: (sessionKey?: string) =>
    typeof sessionKey === "string" && sessionKey.includes(":subagent:"),
}));

import { EventType } from "@byclaw/by-framework";
import handleAgentEvent from "./agent-event.js";
import { byaiChannelPlugin } from "./channel.js";
import {
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestRecord,
  registerActiveSdkRequest,
  registerSdkEmitter,
  type ActiveSdkRequest,
} from "./session-context.js";

type EmittedChunk = { text: string; eventType?: string };

const api = { logger: { info: () => {} } } as never;

/**
 * 装一个 in-band 场景：注册 emitter + active request，返回 sendText 的实参与已 emit 列表。
 * 走真实 outbound.sendText，不绕过 channel 层，去重判定才是被真正验证的那条路径。
 */
function setupInbandChannel(suffix: string) {
  const emitted: EmittedChunk[] = [];
  const accountId = `acct-${suffix}`;
  const to = `test:${suffix}`;
  const emitChunk = async (
    _sessionId: string,
    _traceId: string,
    event: string | { content: string },
    options?: { eventType?: string },
  ): Promise<void> => {
    emitted.push({
      text: typeof event === "string" ? event : event.content,
      eventType: options?.eventType,
    });
  };
  registerSdkEmitter(accountId, { emitChunk } as never);
  const request = registerActiveSdkRequest({
    accountId,
    sessionKey: `agent:test:direct:${suffix}`,
    to,
    sessionId: suffix,
    traceId: `trace-${suffix}`,
    language: "zh_CN",
    languageProvided: true,
  });
  return { accountId, emitted, request, to };
}

/**
 * 走真实 onAgentEvent 入口投喂 assistant 快照。走全链路才能覆盖「子会话文本落思考通道、
 * 不进账本」这条分支——记账点就在那条分支的另一侧。
 */
async function streamAssistant(params: {
  request: ActiveSdkRequest;
  runId: string;
  seq: number;
  text: string;
  childSessionKey?: string;
}) {
  const sessionKey = params.childSessionKey ?? params.request.sessionKey;
  if (params.childSessionKey) {
    bindActiveSdkRequestRunId(params.request.sessionKey, params.runId);
  }
  await handleAgentEvent(api, {
    runId: params.runId,
    seq: params.seq,
    stream: "assistant",
    sessionKey,
    data: { text: params.text },
  } as never);
}

async function sendText(params: { to: string; accountId: string; text: string }) {
  return await byaiChannelPlugin.outbound?.sendText?.({
    to: params.to,
    accountId: params.accountId,
    text: params.text,
  } as never);
}

describe("byai-channel outbound.sendText dedupe", () => {
  it("suppresses the deliver echo of an answer already streamed, and reports it honestly", async () => {
    const { accountId, emitted, request, to } = setupInbandChannel("echo");
    try {
      await streamAssistant({ request, runId: "run-echo", seq: 1, text: "上海今天晴，" });
      await streamAssistant({ request, runId: "run-echo", seq: 2, text: "上海今天晴，24-31℃。" });
      emitted.length = 0;

      const result = await sendText({ to, accountId, text: "上海今天晴，24-31℃。" });

      expect(emitted).toEqual([]);
      // 抑制时不能伪造平台 id：core 会据此写投递镜像并记为已送达。
      expect(result?.messageId).toBe("suppressed");
    } finally {
      clearActiveSdkRequestRecord(request);
    }
  });

  it("suppresses only the last segment when a run emitted several segments", async () => {
    const { accountId, emitted, request, to } = setupInbandChannel("segments");
    try {
      await streamAssistant({ request, runId: "run-seg", seq: 1, text: "我先查一下天气。" });
      // 工具调用后新起一段，流式缓冲被替换；core 最终只投最后一段。
      await streamAssistant({ request, runId: "run-seg", seq: 2, text: "查询完成：上海 24-31℃。" });
      emitted.length = 0;

      const last = await sendText({ to, accountId, text: "查询完成：上海 24-31℃。" });
      expect(last?.messageId).toBe("suppressed");

      const earlier = await sendText({ to, accountId, text: "我先查一下天气。" });
      expect(earlier?.messageId).not.toBe("suppressed");
    } finally {
      clearActiveSdkRequestRecord(request);
    }
  });

  it("suppresses core's text-direct report that a child run already streamed", async () => {
    const { accountId, emitted, request, to } = setupInbandChannel("direct");
    try {
      // 子会话 assistant 文本经 REASONING_LOG_DELTA 推给前端后照样记账（按 child 的 runId
      // 独立成组）。core 随后 text-direct 重投同一份原文即重复。
      await streamAssistant({
        request,
        runId: "run-child",
        seq: 1,
        text: "广州今天多云，26-33℃。",
        childSessionKey: "agent:weather:subagent:child-1",
      });
      await streamAssistant({
        request,
        runId: "run-parent",
        seq: 2,
        text: "两份天气报告都回来后，我会一并整合给你。",
      });
      emitted.length = 0;

      const result = await sendText({ to, accountId, text: "广州今天多云，26-33℃。" });

      expect(emitted).toEqual([]);
      expect(result?.messageId).toBe("suppressed");
    } finally {
      clearActiveSdkRequestRecord(request);
    }
  });

  it("pushes a child report to the answer channel when nothing was streamed", async () => {
    const { accountId, emitted, request, to } = setupInbandChannel("nostream");
    try {
      // 没有流式输出 → 账本为空 → sendText 是这份内容唯一的到达路径，必须投答案区。
      const result = await sendText({ to, accountId, text: "广州今天多云，26-33℃。" });

      expect(emitted).toEqual([
        { text: "广州今天多云，26-33℃。", eventType: EventType.ANSWER_DELTA },
      ]);
      expect(result?.messageId).not.toBe("suppressed");
    } finally {
      clearActiveSdkRequestRecord(request);
    }
  });

  it("suppresses a repeat of text this same path already pushed", async () => {
    const { accountId, emitted, request, to } = setupInbandChannel("repeat");
    try {
      await sendText({ to, accountId, text: "北京今天阴，22-28℃。" });
      // 推送时自成一组记账，core 的投递重试不会再穿透一遍。
      const retry = await sendText({ to, accountId, text: "北京今天阴，22-28℃。" });

      expect(emitted).toHaveLength(1);
      expect(retry?.messageId).toBe("suppressed");
    } finally {
      clearActiveSdkRequestRecord(request);
    }
  });

  it("drops the ledger with the request so a later session starts clean", async () => {
    const first = setupInbandChannel("teardown");
    await streamAssistant({ request: first.request, runId: "run-t1", seq: 1, text: "同一句话" });
    clearActiveSdkRequestRecord(first.request);

    const second = setupInbandChannel("teardown");
    try {
      second.emitted.length = 0;
      const result = await sendText({
        to: second.to,
        accountId: second.accountId,
        text: "同一句话",
      });

      expect(second.emitted).toHaveLength(1);
      expect(result?.messageId).not.toBe("suppressed");
    } finally {
      clearActiveSdkRequestRecord(second.request);
    }
  });
});
