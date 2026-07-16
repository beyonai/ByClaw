import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/routing", () => ({
  isSubagentSessionKey: (sessionKey: string) => sessionKey.includes(":subagent:"),
}));

import { __callAgentTestInternals } from "./call-agent.js";

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
});
