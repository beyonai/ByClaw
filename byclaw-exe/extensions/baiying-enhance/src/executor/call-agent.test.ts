import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/routing", () => ({
  isSubagentSessionKey: (sessionKey: string) => sessionKey.includes(":subagent:"),
}));

import { __callAgentTestInternals, executeViaCallAgent } from "./call-agent.js";

describe("call-agent remote task tracking", () => {
  it("tracks async calls and sync calls outside subagent sessions", () => {
    expect(
      __callAgentTestInternals.shouldTrackCallAgentRemoteTask("async", {
        session_key: "agent:main:subagent:worker",
      }),
    ).toBe(true);
    expect(
      __callAgentTestInternals.shouldTrackCallAgentRemoteTask("sync", {
        session_key: "agent:main:root",
      }),
    ).toBe(true);
    expect(
      __callAgentTestInternals.shouldTrackCallAgentRemoteTask("sync", {
        session_key: "agent:main:subagent:worker",
      }),
    ).toBe(false);
  });

  it("defaults tracked sync polling to thirty minutes", () => {
    expect(
      __callAgentTestInternals.resolveCallAgentSyncTimeoutSec({
        callMode: "sync",
        shouldTrackRemoteTask: true,
      }),
    ).toBe(30 * 60);
    expect(
      __callAgentTestInternals.resolveCallAgentSyncTimeoutSec({
        callMode: "sync",
        shouldTrackRemoteTask: true,
        syncTimeoutSec: 45,
      }),
    ).toBe(45);
    expect(
      __callAgentTestInternals.resolveCallAgentSyncTimeoutSec({
        callMode: "sync",
        shouldTrackRemoteTask: false,
      }),
    ).toBeUndefined();
  });

  it("preserves the caller-provided abort reason", () => {
    const controller = new AbortController();
    controller.abort(new Error("用户停止了调用"));

    expect(__callAgentTestInternals.getCallAgentAbortReason(controller.signal)).toBe(
      "用户停止了调用",
    );
  });

  it("returns a dedicated failure when cancelled before dispatch", async () => {
    const controller = new AbortController();
    controller.abort(new Error("用户取消调用"));

    const result = await executeViaCallAgent({
      capability: { metadata: {}, resource_type: "OBJECT" } as never,
      content: "query",
      payload: {},
      sessionId: "session-1",
      traceId: "trace-1",
      targetAgentType: "BYCLAW_DATA",
      responseType: "object_call_agent",
      target: { resource_id: "object-1" },
      parentMessageId: "tool-call-1",
      resourceContext: {},
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      success: false,
      error_code: "CALL_AGENT_ABORTED",
      error: "用户取消调用",
    });
  });
});
