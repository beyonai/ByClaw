import { describe, expect, it } from "vitest";
import {
  buildPromptInjectionSnapshot,
  clearPromptInjectionSnapshot,
  resetPromptInjectionSnapshotsForTest,
  setPromptInjectionSnapshot,
  takePromptInjectionSnapshot,
} from "./prompt-injection-snapshot.js";
import type { ActiveSdkRequest } from "./session-context.js";

function mockRequest(overrides: Partial<ActiveSdkRequest> = {}): ActiveSdkRequest {
  return {
    accountId: "default",
    sessionKey: "agent:main:direct:100",
    to: "user:100",
    sessionId: "100",
    traceId: "trace-1",
    createdAt: Date.now(),
    boundRunIds: new Set(),
    pendingChildSessionKeys: new Set(),
    pendingOutboundCount: 0,
    awaitingFollowup: false,
    deferredForFollowup: false,
    followupRunStarted: false,
    lastReasoningText: "",
    lastReasoningMessageId: "",
    language: "zh-CN",
    languageProvided: true,
    channelExtension: { channelType: "web" },
    ...overrides,
  };
}

describe("prompt-injection-snapshot", () => {
  it("stores and returns appendSystemContext for before_prompt_build", () => {
    resetPromptInjectionSnapshotsForTest();
    const request = mockRequest();
    const snapshot = buildPromptInjectionSnapshot({ request });
    setPromptInjectionSnapshot(request.sessionKey, snapshot);

    const taken = takePromptInjectionSnapshot(request.sessionKey);
    expect(taken?.appendSystemContext).toContain("Session Root");
    expect(taken?.appendSystemContext).toContain("channelType");
    expect(taken?.appendSystemContext).toContain("渠道语言");

    clearPromptInjectionSnapshot(request.sessionKey);
    expect(takePromptInjectionSnapshot(request.sessionKey)).toBeUndefined();
  });

  it("injects a stronger chat context tool hint for cross-agent handoff tasks", () => {
    const request = mockRequest({
      laneMetadata: {
        laneId: "reviewer",
        agentName: "ByClaw reviewer",
      },
    });
    const snapshot = buildPromptInjectionSnapshot({
      request,
      currentUserText: "请承接上条 coder 交接单，并给出 reviewer 结论",
    });

    expect(snapshot.appendSystemContext).toContain("本轮任务很可能需要跨 agent 聊天室上下文");
    expect(snapshot.appendSystemContext).toContain("current_lane_only=false");
    expect(snapshot.appendSystemContext).toContain("agent_names");
    expect(snapshot.appendSystemContext).toContain("coder");
    expect(snapshot.appendSystemContext).not.toContain("优先用过滤参数查询这些 agent/角色相关的历史：reviewer");
  });

  it("keeps the base chat context hint for independent lane tasks", () => {
    const request = mockRequest({
      laneMetadata: {
        laneId: "assistant",
        agentName: "陈舵主的个人助理",
      },
    });
    const snapshot = buildPromptInjectionSnapshot({
      request,
      currentUserText: "帮我查询钉钉通讯录",
    });

    expect(snapshot.appendSystemContext).toContain("ByClaw 聊天室接力上下文需要通过");
    expect(snapshot.appendSystemContext).toContain("默认只返回当前调用工具的 agent/lane 的聊天室记录");
    expect(snapshot.appendSystemContext).not.toContain("本轮任务很可能需要跨 agent 聊天室上下文");
    expect(snapshot.appendSystemContext).not.toContain("优先用过滤参数查询这些 agent/角色相关的历史");
  });
});
