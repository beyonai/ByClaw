import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPromptInjectionSnapshot,
  clearPromptInjectionSnapshot,
  resetPromptInjectionSnapshotsForTest,
  setPromptInjectionSnapshot,
  takePromptInjectionSnapshot,
} from "./prompt-injection-snapshot.js";
import {
  recordByclawChatContextMessage,
  resetByclawChatContextForTest,
} from "./chat-context-store.js";
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
  beforeEach(() => {
    resetPromptInjectionSnapshotsForTest();
    resetByclawChatContextForTest();
  });

  it("stores and returns appendSystemContext for before_prompt_build", () => {
    const request = mockRequest();
    const snapshot = buildPromptInjectionSnapshot({ request });
    setPromptInjectionSnapshot(request.sessionKey, snapshot);

    const taken = takePromptInjectionSnapshot(request.sessionKey);
    expect(taken?.appendSystemContext).toContain("Session Root");
    expect(taken?.appendSystemContext).toContain("channelType");
    expect(taken?.appendSystemContext).toContain("渠道语言");
    expect(taken?.appendSystemContext).toContain("ByClaw ACP 下游语言元数据");
    expect(taken?.appendSystemContext).toContain("replyLanguage: \"zh_CN\"");

    clearPromptInjectionSnapshot(request.sessionKey);
    expect(takePromptInjectionSnapshot(request.sessionKey)).toBeUndefined();
  });

  it("injects a stronger chat context tool hint for cross-agent handoff tasks", () => {
    recordByclawChatContextMessage({
      id: "agent-alpha-message",
      role: "assistant",
      sessionId: "100",
      sessionKey: "agent:alpha:direct:100:lane:alpha",
      text: "handoff bundle",
      laneMetadata: {
        laneId: "lane-alpha",
        agentName: "Agent Alpha",
      },
    });
    const request = mockRequest({
      laneMetadata: {
        laneId: "lane-beta",
        agentName: "Agent Beta",
      },
    });
    const snapshot = buildPromptInjectionSnapshot({
      request,
      currentUserText: "请承接 Agent Alpha 的交接单，并给出结论",
    });

    expect(snapshot.appendSystemContext).toContain("本轮任务很可能需要跨 agent 聊天室上下文");
    expect(snapshot.appendSystemContext).toContain("current_lane_only=false");
    expect(snapshot.appendSystemContext).toContain("agent_names");
    expect(snapshot.appendSystemContext).toContain("Agent Alpha");
    expect(snapshot.appendSystemContext).not.toContain("优先用过滤参数查询这些 agent/角色相关的历史：Agent Beta");
  });

  it("adds chat-room lane metadata to channelExtension for implicit cross-agent follow-up", () => {
    recordByclawChatContextMessage({
      id: "issue-triage-message",
      role: "assistant",
      sessionId: "100",
      sessionKey: "agent:baiying-agent-10002962:direct:100",
      text: "报告 HTML：byclaw_issue_fix_plan.html",
      laneMetadata: {
        agentId: "10002962",
        agentName: "ByClaw issue-triage",
      },
    });
    recordByclawChatContextMessage({
      id: "assistant-message",
      role: "assistant",
      sessionId: "100",
      sessionKey: "agent:baiying-agent-10006192:direct:100",
      text: "个人助理已就绪",
      laneMetadata: {
        agentId: "10006192",
        agentName: "陈舵主的个人助理",
      },
    });
    const request = mockRequest({
      sessionKey: "agent:baiying-agent-10006192:direct:100",
      laneMetadata: {
        agentId: "10006192",
        agentName: "陈舵主的个人助理",
      },
    });
    const snapshot = buildPromptInjectionSnapshot({
      request,
      currentUserText: "issue修复计划帮我发送到我的会话空间下",
    });

    expect(snapshot.appendSystemContext).toContain("byclawChatRoom");
    expect(snapshot.appendSystemContext).toContain("visibleAgentLanes");
    expect(snapshot.appendSystemContext).toContain("ByClaw issue-triage");
    expect(snapshot.appendSystemContext).toContain("报告 HTML：byclaw_issue_fix_plan.html");
    expect(snapshot.appendSystemContext).toContain('"hasOtherAgentLanes":true');
    expect(snapshot.appendSystemContext).toContain("byclaw_chat_context");
    expect(snapshot.appendSystemContext).not.toContain("本轮任务很可能需要跨 agent 聊天室上下文");
  });

  it("keeps the base chat context hint for independent lane tasks", () => {
    const request = mockRequest({
      laneMetadata: {
        laneId: "lane-current",
        agentName: "Current Agent",
      },
    });
    const snapshot = buildPromptInjectionSnapshot({
      request,
      currentUserText: "处理当前 lane 的独立任务",
    });

    expect(snapshot.appendSystemContext).toContain("ByClaw 聊天室接力上下文需要通过");
    expect(snapshot.appendSystemContext).toContain("默认只返回当前调用工具的 agent/lane 的聊天室记录");
    expect(snapshot.appendSystemContext).not.toContain("本轮任务很可能需要跨 agent 聊天室上下文");
    expect(snapshot.appendSystemContext).not.toContain("优先用过滤参数查询这些 agent/角色相关的历史");
  });
});
