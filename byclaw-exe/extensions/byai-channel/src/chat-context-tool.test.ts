import { describe, expect, it, beforeEach } from "vitest";
import { createByclawChatContextTool } from "./chat-context-tool.js";
import {
  recordByclawChatContextMessage,
  resetByclawChatContextForTest,
  resolveByclawChatContext,
} from "./chat-context-store.js";
import {
  upsertChannelRequestContextBySessionKey,
} from "./channel-request-context.js";

describe("byclaw_chat_context tool", () => {
  beforeEach(() => {
    resetByclawChatContextForTest();
  });

  it("returns visible messages across agents when explicitly requested", async () => {
    recordByclawChatContextMessage({
      id: "q1",
      role: "user",
      sessionId: "s-1",
      sessionKey: "agent:baiying-agent-10002971:direct:s-1",
      text: "请 coder 输出交接单",
      laneMetadata: {
        agentId: "10002971",
        agentName: "ByClaw coder",
      },
    });
    recordByclawChatContextMessage({
      id: "a1",
      role: "assistant",
      sessionId: "s-1",
      sessionKey: "agent:baiying-agent-10002971:direct:s-1",
      text: "HANDOFF_BUNDLE H-1\nREQ=修复接力上下文",
      laneMetadata: {
        agentId: "10002971",
        agentName: "ByClaw coder",
      },
    });
    upsertChannelRequestContextBySessionKey({
      sessionKey: "agent:baiying-agent-10002974:direct:s-1",
      accountId: "default",
      fields: {
        sessionId: "s-1",
      },
    });

    const tool = createByclawChatContextTool({
      sessionKey: "agent:baiying-agent-10002974:direct:s-1",
    });
    const result = await tool.execute("call-1", { current_lane_only: false });

    expect(result.details.sessionId).toBe("s-1");
    expect(result.details.messages).toHaveLength(2);
    expect(result.content[0].text).toContain("HANDOFF_BUNDLE H-1");
    expect(result.content[0].text).toContain("ByClaw coder");
  });

  it("defaults tool context to the current lane only", async () => {
    recordByclawChatContextMessage({
      id: "coder",
      role: "user",
      sessionId: "s-1",
      sessionKey: "agent:baiying-agent-10002971:direct:s-1:lane:coder",
      text: "coder 私有任务",
      laneMetadata: {
        laneId: "coder",
        agentId: "10002971",
      },
    });
    recordByclawChatContextMessage({
      id: "reviewer",
      role: "user",
      sessionId: "s-1",
      sessionKey: "agent:baiying-agent-10002974:direct:s-1:lane:reviewer",
      text: "reviewer 私有任务",
      laneMetadata: {
        laneId: "reviewer",
        agentId: "10002974",
      },
    });
    upsertChannelRequestContextBySessionKey({
      sessionKey: "agent:baiying-agent-10002974:direct:s-1:lane:reviewer",
      accountId: "default",
      fields: {
        sessionId: "s-1",
      },
    });

    const tool = createByclawChatContextTool({
      sessionKey: "agent:baiying-agent-10002974:direct:s-1:lane:reviewer",
    });
    const result = await tool.execute("call-1", {});

    expect(result.details.messages.map((message) => message.text)).toEqual(["reviewer 私有任务"]);
    expect(result.content[0].text).not.toContain("coder 私有任务");
  });

  it("filters cross-agent context to requested agents", async () => {
    recordByclawChatContextMessage({
      id: "coder",
      role: "assistant",
      sessionId: "s-1",
      sessionKey: "agent:baiying-agent-10002971:direct:s-1:lane:coder",
      text: "coder 交接单",
      laneMetadata: {
        laneId: "coder",
        agentId: "10002971",
        agentName: "ByClaw coder",
      },
    });
    recordByclawChatContextMessage({
      id: "tester",
      role: "assistant",
      sessionId: "s-1",
      sessionKey: "agent:baiying-agent-10002977:direct:s-1:lane:tester",
      text: "tester 验证记录",
      laneMetadata: {
        laneId: "tester",
        agentId: "10002977",
        agentName: "ByClaw tester",
      },
    });
    upsertChannelRequestContextBySessionKey({
      sessionKey: "agent:baiying-agent-10002974:direct:s-1:lane:reviewer",
      accountId: "default",
      fields: {
        sessionId: "s-1",
      },
    });

    const tool = createByclawChatContextTool({
      sessionKey: "agent:baiying-agent-10002974:direct:s-1:lane:reviewer",
    });
    const result = await tool.execute("call-1", {
      current_lane_only: false,
      agent_names: ["coder"],
    });

    expect(result.details.messages.map((message) => message.text)).toEqual(["coder 交接单"]);
    expect(result.content[0].text).not.toContain("tester 验证记录");
  });

  it("can scope context to only the current lane", () => {
    recordByclawChatContextMessage({
      id: "coder",
      role: "assistant",
      sessionId: "s-2",
      sessionKey: "agent:baiying-agent-10002971:direct:s-2:lane:coder",
      text: "coder lane",
      laneMetadata: {
        laneId: "coder",
        agentId: "10002971",
      },
    });
    recordByclawChatContextMessage({
      id: "reviewer",
      role: "assistant",
      sessionId: "s-2",
      sessionKey: "agent:baiying-agent-10002974:direct:s-2:lane:reviewer",
      text: "reviewer lane",
      laneMetadata: {
        laneId: "reviewer",
        agentId: "10002974",
      },
    });

    const snapshot = resolveByclawChatContext({
      sessionId: "s-2",
      includeCurrentLaneOnly: true,
      requesterSessionKey: "agent:baiying-agent-10002974:direct:s-2:lane:reviewer",
    });

    expect(snapshot.messages.map((message) => message.text)).toEqual(["reviewer lane"]);
  });
});
