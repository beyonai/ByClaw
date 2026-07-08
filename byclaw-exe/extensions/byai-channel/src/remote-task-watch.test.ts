import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/session-store-runtime", () => ({
  getSessionEntry: () => undefined,
}));

// session-context.ts → remote-followup.ts → diagnostics.ts imports this external
// subpath, absent in the plugin test env; stub it as a passthrough so the module
// graph loads. The state-projection internals under test never invoke it.
vi.mock("openclaw/plugin-sdk/diagnostic-runtime", () => ({
  createDiagnosticTraceContext: (init: unknown) => init ?? {},
  freezeDiagnosticTraceContext: (trace: unknown) => trace,
  emitTrustedDiagnosticEvent: () => {},
  isValidDiagnosticTraceId: () => true,
}));

// session-context.ts imports routing helpers from this external subpath (absent
// in the plugin test env). The state-projection internals under test never call
// them, so trivial stubs keep the module graph loadable.
vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: (sessionKey: string) => sessionKey,
  isSubagentSessionKey: () => false,
}));

vi.mock("./utils.js", () => ({
  createRedisInstance: () => null,
}));

import { __remoteTaskWatchTestInternals } from "./remote-task-watch.js";

const started = {
  schemaVersion: 1 as const,
  type: "task_started" as const,
  eventId: "event-1",
  eventAt: 1_000,
  taskId: "msg-1",
  messageId: "msg-1",
  sessionId: "doc-session",
  traceId: "trace-1",
  toolCallId: "call-1",
  requesterSessionKey: "agent:main:subagent:work",
  createdAt: 1_100,
};

describe("remote-task-watch state projection", () => {
  it("merges started events idempotently by tool call and message id", () => {
    const state = { schemaVersion: 1 as const, tasks: {} };

    expect(__remoteTaskWatchTestInternals.mergeStartedEvents(state, [started])).toBe(true);
    expect(Object.keys(state.tasks)).toEqual(["call-1:msg-1"]);
    expect(state.tasks["call-1:msg-1"]?.status).toBe("pending");
    expect(state.tasks["call-1:msg-1"]?.pollCursor).toBe("1099-0");

    expect(__remoteTaskWatchTestInternals.mergeStartedEvents(state, [started])).toBe(false);
    expect(Object.keys(state.tasks)).toHaveLength(1);
  });

  it("normalizes persisted unknown status values back to pending", () => {
    const record = __remoteTaskWatchTestInternals.normalizeTaskRecord({
      ...started,
      status: "surprise",
      updatedAt: 2_000,
      deliveryAttempts: 2,
      resultStatus: "not-real",
    });

    expect(record?.status).toBe("pending");
    expect(record?.deliveryAttempts).toBe(2);
    expect(record?.resultStatus).toBeUndefined();
  });
});
