import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/media-runtime", () => ({
  detectMime: vi.fn(async () => "application/octet-stream"),
  fetchRemoteMedia: vi.fn(),
  resolveChannelMediaMaxBytes: vi.fn(() => 10_000_000),
  saveMediaBuffer: vi.fn(),
}));

vi.mock("./utils.js", () => ({
  generateRandomId: vi.fn(() => "generated-id"),
  getAgentNameById: vi.fn(() => undefined),
}));

vi.mock("./diagnostics.js", () => ({
  createByaiSdkDiagnosticTrace: vi.fn(() => ({
    trace: {
      traceId: "00000000000000000000000000000001",
      spanId: "0000000000000001",
      traceFlags: "01",
    },
  })),
  emitByaiSdkDispatchCompleted: vi.fn(),
  emitByaiSdkDispatchStarted: vi.fn(() => Date.now()),
  emitByaiSdkMessageReceived: vi.fn(() => Date.now()),
  runWithByaiSdkDiagnosticTrace: vi.fn(
    (_trace: unknown, callback: () => unknown) => callback(),
  ),
}));
// 头部原有SDK会话溢出媒体处理导入
import type { GatewayDataEmitter } from "@byclaw/by-framework";
import {
  deliverReplyToAgentViaSdk,
  resolveConnectorSkillFilterForDispatch,
} from "./sdk-message-processor.js";
import {
  clearActiveSdkRequestByTarget,
  getAgentRunEndPromiseResolver,
  markActiveSdkOverflowContinuePending,
  markActiveSdkOverflowLength,
  markActiveSdkRootLifecycleFinished,
  registerSdkEmitter,
} from "./session-context.js";
import { setByaiRuntime } from "./runtime.js";
import type { ResolvedByaiAccount } from "./types.js";
// 新版本新增导入（冲突右侧）
import { isOpenClawContextOverflowDispatchError } from "./dispatch-error.js";
import { setConnectorSkillFilterResolver } from "../../shared/src/connector-skill-filter-runtime.js";
import { normalizeConnectorAuthorization } from "./connector-authorization.js";

afterEach(() => {
  setConnectorSkillFilterResolver(undefined);
});

// 冲突HEAD：SDK自动续答不携带原始媒体的测试套件
describe("deliverReplyToAgentViaSdk overflow continuation media handling", () => {
  it("does not attach the original inbound media to the auto-continue dispatch", async () => {
    const account: ResolvedByaiAccount = {
      accountId: "acct-media",
      name: "acct-media",
      enabled: true,
      configured: true,
      config: {
        sessionKeyPerSessionId: false,
        forceReasoningStream: false,
      },
    } as ResolvedByaiAccount;
    const cfg = {
      channels: {},
      session: {},
    } as never;
    const contexts: Array<Record<string, unknown>> = [];
    const skillFilters: Array<string[] | undefined> = [];
    let dispatchCount = 0;
    setConnectorSkillFilterResolver(async () => ["dws", "ordinary-skill"]);

    setByaiRuntime({
      agent: {
        resolveAgentWorkspaceDir: () => "/tmp/byai-channel-test-workspace",
      },
      channel: {
        inbound: {
          runPreparedReply: async ({
            runDispatch,
          }: {
            runDispatch: () => Promise<unknown>;
          }) => ({ dispatchResult: await runDispatch() }),
        },
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "agent:test-agent:direct:acct-media:user-media",
            agentId: "test-agent",
            channel: "byai-channel",
            accountId: account.accountId,
          }),
        },
        reply: {
          formatAgentEnvelope: ({ body }: { body: string }) => body,
          resolveEnvelopeFormatOptions: () => ({}),
          createReplyDispatcherWithTyping: () => ({
            dispatcher: {},
            replyOptions: {},
          }),
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          withReplyDispatcher: async ({ run }: { run: () => Promise<unknown> }) => await run(),
          dispatchReplyFromConfig: async ({
            ctx,
            replyOptions,
          }: {
            ctx: Record<string, unknown>;
            replyOptions: {
              onAgentRunStart?: (runId: string) => Promise<void>;
              skillFilter?: string[];
            };
          }) => {
            contexts.push(ctx);
            skillFilters.push(replyOptions.skillFilter);
            dispatchCount += 1;
            const runId = `run-media-${dispatchCount}`;
            await replyOptions.onAgentRunStart?.(runId);
            getAgentRunEndPromiseResolver(runId)?.({ success: true });
            if (dispatchCount === 1) {
              markActiveSdkOverflowLength(String(ctx.SessionKey), true, {
                stopReason: "length",
                usage: { totalTokens: 49_500 },
                contextWindow: 50_000,
              });
              markActiveSdkOverflowContinuePending(String(ctx.SessionKey), true);
            }
            markActiveSdkRootLifecycleFinished(String(ctx.SessionKey), "end");
            return { queuedFinal: false, counts: {} };
          },
        },
        session: {
          recordInboundSession: vi.fn(),
          resolveStorePath: vi.fn(() => "/tmp/byai-channel-test-sessions.json"),
        },
      },
    } as never);

    const emittedStates: Array<{ state?: string }> = [];
    registerSdkEmitter(account.accountId, {
      emitChunk: async () => {},
      emitState: async (
        _sessionId: string,
        _traceId: string,
        event: { state?: string },
      ) => {
        emittedStates.push(event);
      },
    } as unknown as GatewayDataEmitter);

    await deliverReplyToAgentViaSdk({
      account,
      cfg,
      message: {
        messageId: "msg-media",
        sessionId: "user-media",
        userId: "user-media",
        text: "please inspect this file",
        timestamp: Date.now(),
        traceId: "trace-media",
        files: [{ filePath: "report.png", contentType: "image/png" }],
        extraPayload: {},
        accountId: account.accountId,
        language: "zh_CN",
        languageProvided: true,
        authConnectorList: { dws: true, fws: false },
      },
      onReply: async () => {},
    });

    expect(contexts).toHaveLength(2);
    expect(contexts[0]?.MediaPath).toBe("/by/.sessions/user-media/report.png");
    expect(contexts[0]?.MediaPaths).toEqual(["/by/.sessions/user-media/report.png"]);
    expect(contexts[1]?.RawBody).toContain("上一轮回答因对话达到上下文窗口上限而被截断");
    expect(contexts[1]).not.toHaveProperty("MediaPath");
    expect(contexts[1]).not.toHaveProperty("MediaPaths");
    expect(skillFilters).toEqual([
      ["dws", "ordinary-skill"],
      ["dws", "ordinary-skill"],
    ]);
    expect(emittedStates).toContainEqual(expect.objectContaining({ state: "" }));

    clearActiveSdkRequestByTarget(account.accountId, "test-agent:user-media");
  });
});

// 冲突新版本D0.2.0：上下文溢出错误识别工具测试套件
describe("isOpenClawContextOverflowDispatchError", () => {
  it("recognizes OpenClaw recoverable context overflow dispatch errors", () => {
    expect(
      isOpenClawContextOverflowDispatchError(
        new Error(
          "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.",
        ),
      ),
    ).toBe(true);
    expect(
      isOpenClawContextOverflowDispatchError(
        "Context overflow: prompt too large for the model (precheck).",
      ),
    ).toBe(true);
    expect(
      isOpenClawContextOverflowDispatchError(
        "Context overflow: estimated context size exceeds safe threshold during tool loop.",
      ),
    ).toBe(true);
  });

  it("does not classify unrelated dispatch errors as recoverable overflow", () => {
    expect(isOpenClawContextOverflowDispatchError(new Error("Redis connection failed"))).toBe(
      false,
    );
    expect(isOpenClawContextOverflowDispatchError("provider returned HTTP 401")).toBe(false);
  });
});

describe("resolveConnectorSkillFilterForDispatch", () => {
  it("does not resolve a filter for legacy messages without connector authorization", async () => {
    const resolveFilter = vi.fn(async () => ["dws"]);

    await expect(
      resolveConnectorSkillFilterForDispatch({
        agentId: "test-agent",
        authConnectorList: undefined,
        resolveFilter,
      }),
    ).resolves.toBeUndefined();
    expect(resolveFilter).not.toHaveBeenCalled();
  });

  it("fails closed when the connector skill filter provider is unavailable", async () => {
    const warn = vi.fn();

    await expect(
      resolveConnectorSkillFilterForDispatch({
        agentId: "test-agent",
        authConnectorList: { dws: true, fws: false },
        log: { warn },
        resolveFilter: async () => undefined,
      }),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("provider unavailable"));
  });

  it("fails closed when the connector skill filter provider throws", async () => {
    const warn = vi.fn();

    await expect(
      resolveConnectorSkillFilterForDispatch({
        agentId: "test-agent",
        authConnectorList: { fws: false },
        log: { warn },
        resolveFilter: async () => {
          throw new Error("provider failed");
        },
      }),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("provider failed"));
  });

  it("fails closed when the connector skill filter provider returns an invalid value", async () => {
    const warn = vi.fn();

    await expect(
      resolveConnectorSkillFilterForDispatch({
        agentId: "test-agent",
        authConnectorList: { fws: false },
        log: { warn },
        resolveFilter: async () => "dws" as unknown as string[],
      }),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid result"));
  });

  it("fails closed without calling the provider for oversized disabled policies", async () => {
    const resolveFilter = vi.fn(async () => ["ordinary-skill"]);
    const authorization = normalizeConnectorAuthorization(
      Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`disabled-${index}`, false]),
      ),
    );

    await expect(
      resolveConnectorSkillFilterForDispatch({
        agentId: "test-agent",
        authConnectorList: authorization,
        resolveFilter,
      }),
    ).resolves.toEqual([]);
    expect(resolveFilter).not.toHaveBeenCalled();
  });
});
