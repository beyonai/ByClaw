import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/routing", () => ({
  buildAgentSessionKey: (params: {
    agentId: string;
    channel: string;
    peer: { kind: string; id: string };
  }) => `agent:${params.agentId}:${params.channel}:${params.peer.kind}:${params.peer.id}`,
  resolveAgentIdFromSessionKey: (sessionKey: string) => sessionKey.split(":")[1] ?? "",
}));

import {
  normalizeByaiAgentId,
  resolveByaiSessionKey,
  resolveSdkTargetAgentId,
} from "./session-key.js";

describe("normalizeByaiAgentId", () => {
  it("normalizes numeric Baiying agent ids from strings and numbers", () => {
    expect(normalizeByaiAgentId("10003355")).toBe("baiying-agent-10003355");
    expect(normalizeByaiAgentId(10003355)).toBe("baiying-agent-10003355");
  });

  it("keeps non-numeric agent ids trimmed and ignores unsupported values", () => {
    expect(normalizeByaiAgentId(" custom-agent ")).toBe("custom-agent");
    expect(normalizeByaiAgentId(null)).toBe("");
    expect(normalizeByaiAgentId({ id: "10003355" })).toBe("");
  });
});

describe("resolveSdkTargetAgentId", () => {
  it("accepts numeric agent_id values from gateway extra payload", () => {
    expect(resolveSdkTargetAgentId("main", { agent_id: 10003355 })).toBe(
      "baiying-agent-10003355",
    );
  });

  it("falls back to agent_code or routing agent id", () => {
    expect(resolveSdkTargetAgentId("main", { agent_code: " custom-agent " })).toBe(
      "custom-agent",
    );
    expect(resolveSdkTargetAgentId("main", {})).toBe("main");
  });
});

describe("resolveByaiSessionKey", () => {
  it("keeps the channel session key unchanged for same-agent routing", () => {
    const sessionKey = resolveByaiSessionKey({
      routing: {
        sessionKey: "agent:baiying-agent-10002971:byai-channel:direct:10007058",
        agentId: "baiying-agent-10002971",
        channel: "byai-channel",
        accountId: "default",
      },
      targetAgentId: "baiying-agent-10002971",
      sessionId: "10007058",
      perSessionId: false,
    });

    expect(sessionKey).toBe(
      "agent:baiying-agent-10002971:byai-channel:direct:10007058",
    );
    expect(sessionKey).not.toContain(":lane:");
  });
});
