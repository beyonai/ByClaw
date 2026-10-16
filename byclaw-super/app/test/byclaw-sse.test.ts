import type { RunEvent } from "@byclaw/by-conductor";
import { describe, expect, it } from "vitest";
import { createByClawSseSerializer } from "../server/byclaw-sse.js";

describe("createByClawSseSerializer", () => {
  it("serializes Leader reasoning separately from the visible answer", () => {
    const serialize = createByClawSseSerializer();

    const reasoning = serialize(event(1, "leader.reasoning.delta", { text: "分析中" }));
    const answer = serialize(event(2, "leader.delta", { text: "正文" }));

    expect(reasoning).toContain("event: reasoningLogStart");
    expect(reasoning).toContain("event: reasoningLogDelta");
    expect(reasoning).toContain("分析中");
    expect(reasoning).not.toContain("answerDelta");
    expect(answer).toContain("event: reasoningLogEnd");
    expect(answer).toContain("event: answerStart");
    expect(answer).toContain("event: answerDelta");
    expect(answer).toContain("正文");
  });

  it("returns the provider error when a downstream model call fails in the user language", () => {
    const serialize = createByClawSseSerializer("en-US");
    const output = serialize(
      event(1, "run.failed", {
        status: "FAILED",
        error: "Leader model call failed: 403: sensitive provider response",
        userMessage: "403: sensitive provider response",
      }),
    );

    expect(output).toContain("event: answerStart");
    expect(output).toContain("event: answerDelta");
    expect(output).toContain("403: sensitive provider response");
    expect(output).toContain("event: answerEnd");
    expect(output).toContain("event: appStreamResponse");
    expect(output).not.toContain("event: error");
  });

  it("localizes technical run failures for Chinese and English sessions", () => {
    const failure = event(1, "run.failed", {
      status: "FAILED",
      error: "Connection refused: internal service",
    });
    const zh = createByClawSseSerializer("zh-CN")(failure);
    const en = createByClawSseSerializer("en-US")(failure);
    expect(zh).toContain("任务执行失败，请稍后重试");
    expect(zh).not.toContain("Connection refused");
    expect(en).toContain("The task failed. Please try again later");
    expect(en).not.toContain("Connection refused");
  });

  it("does not expose an English provider failure to a Chinese session", () => {
    const output = createByClawSseSerializer("zh-CN")(
      event(1, "run.failed", {
        status: "FAILED",
        error: "Leader model call failed: 403",
        userMessage: "403: sensitive provider response",
      }),
    );
    expect(output).toContain("任务执行失败，请稍后重试");
    expect(output).not.toContain("sensitive provider response");
  });

  it("serializes child tool events without emitting child lifecycle as outer lifecycle", () => {
    const serialize = createByClawSseSerializer();
    const start = serialize(
      event(1, "delegation.tool.started", {
        delegationId: "delegation-1",
        agentId: "agent-1",
        agentName: "需求侦探",
        callId: "call-1",
        toolName: "read",
      }),
    );
    const detail = serialize(
      event(2, "delegation.tool.detail", {
        delegationId: "delegation-1",
        callId: "call-1",
        toolName: "read",
        phase: "input",
        value: { path: "/tmp/data" },
      }),
    );
    const end = serialize(
      event(3, "delegation.tool.completed", {
        delegationId: "delegation-1",
        callId: "call-1",
        toolName: "read",
      }),
    );

    expect(start).toContain("event: subAgentToolStart");
    expect(start).toContain('"status":"_START_"');
    expect(detail).toContain("event: subAgentToolDetail");
    expect(detail).toContain('"phase":"input"');
    expect(end).toContain("event: subAgentToolEnd");
    expect(end).toContain('"status":"_DONE_"');
    expect(`${start}${detail}${end}`).not.toContain("reasoningLogEnd");
    expect(`${start}${detail}${end}`).not.toContain("appStreamResponse");
  });

  it("serializes Super Assistant clarification with the 3014 protocol", () => {
    const serialize = createByClawSseSerializer();
    const questions = [
      {
        header: "目标平台",
        question: "这个小游戏想跑在什么平台上？",
        options: [
          { label: "Web", description: "在浏览器运行" },
          { label: "小程序", description: "在微信内运行" },
        ],
        multiSelect: false,
      },
    ];

    const output = serialize(
      event(1, "interaction.requested", {
        interactionId: "run-1:tool-1",
        source: "leader",
        request: { questions },
      }),
    );

    expect(output).toContain('"contentType":"3014"');
    expect(output).toContain('"tool_name":"AskUserQuestion"');
    expect(output).toContain('"role":"assistant"');
    expect(output).toContain(JSON.stringify({ questions }).replaceAll('"', '\\"'));
  });

  it("keeps legacy child-agent forms on the 3013 protocol", () => {
    const serialize = createByClawSseSerializer();
    const uiPayload = {
      formStatus: 0,
      pluginMachineFields: [{ fieldCode: "answer_1", formType: "select" }],
    };

    const output = serialize(
      event(1, "interaction.requested", {
        interactionId: "child-form-1",
        source: "by-framework",
        delegationId: "delegation-1",
        request: { uiPayload },
      }),
    );

    expect(output).toContain('"contentType":"3013"');
    expect(output).toContain(JSON.stringify(uiPayload).replaceAll('"', '\\"'));
    expect(output).not.toContain('"tool_name":"AskUserQuestion"');
  });
});

function event(eventId: number, type: RunEvent["type"], data: RunEvent["data"]): RunEvent {
  return {
    eventId,
    timestamp: eventId,
    runId: "run-1",
    type,
    data,
  };
}
