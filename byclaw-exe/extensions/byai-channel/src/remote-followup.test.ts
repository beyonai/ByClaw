import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

// `openclaw` is an external package absent in the plugin test env; stub the
// subpath so the module under test can import getSessionEntry. Every test
// injects `sessionExists`, so this stub is never actually invoked.
vi.mock("openclaw/plugin-sdk/session-store-runtime", () => ({
  getSessionEntry: () => undefined,
}));

// diagnostics.ts (pulled in for traceId-scoped follow-up runs) imports this
// external subpath; stub it so the trace-scope wrapper is a passthrough in tests.
vi.mock("openclaw/plugin-sdk/diagnostic-runtime", () => ({
  createDiagnosticTraceContext: (init: unknown) => init ?? {},
  freezeDiagnosticTraceContext: (trace: unknown) => trace,
  emitTrustedDiagnosticEvent: () => {},
  isValidDiagnosticTraceId: () => true,
}));

import {
  buildRemoteTaskFollowupIdempotencyKey,
  buildRemoteTaskResultMessage,
  classifyRemoteTaskFollowupError,
  dispatchRemoteTaskFollowup,
  RemoteTaskFollowupSessionMissingError,
} from "./remote-followup.js";

const WORK_SESSION_KEY = "agent:main:subagent:work";

describe("remote-followup", () => {
  it("formats ok RemoteTask results as follow-up messages", () => {
    const message = buildRemoteTaskResultMessage({
      requesterSessionKey: WORK_SESSION_KEY,
      toolCallId: "call_1",
      status: "ok",
      result: { answer: "done", count: 2 },
    });

    expect(message).toContain("[Delegated Work Result]");
    expect(message).toContain("tool_call_id: call_1");
    expect(message).not.toContain("remote_task_id");
    expect(message).toContain("status: ok");
    expect(message).toContain('"answer": "done"');
  });

  it("formats error and timeout RemoteTask results", () => {
    expect(
      buildRemoteTaskResultMessage({
        requesterSessionKey: WORK_SESSION_KEY,
        toolCallId: "call_error",
        status: "error",
        error: "remote failed",
      }),
    ).toContain("error:\nremote failed");

    expect(
      buildRemoteTaskResultMessage({
        requesterSessionKey: WORK_SESSION_KEY,
        toolCallId: "call_timeout",
        status: "timeout",
        error: "remote timed out",
      }),
    ).toContain("status: timeout");
  });

  it("uses stable delivery keys for the same tool call", () => {
    const input = {
      requesterSessionKey: WORK_SESSION_KEY,
      toolCallId: "call_1",
      status: "ok" as const,
      result: "done",
    };

    expect(buildRemoteTaskFollowupIdempotencyKey(input)).toBe("byai-remote-followup:call_1");
    expect(buildRemoteTaskFollowupIdempotencyKey({ ...input, result: "changed" })).toBe(
      "byai-remote-followup:call_1",
    );
  });

  it("dispatches through runtime.subagent.run on the subagent lane without reply/gateway helpers", async () => {
    const run = vi.fn().mockResolvedValue({ runId: "run-followup" });

    const result = await dispatchRemoteTaskFollowup(
      {
        requesterSessionKey: WORK_SESSION_KEY,
        toolCallId: "call_1",
        status: "ok",
        result: "done",
      },
      {
        runtime: { subagent: { run } } as never,
        sessionExists: () => true,
      },
    );

    expect(result).toEqual({
      runId: "run-followup",
      idempotencyKey: "byai-remote-followup:call_1",
    });
    expect(run).toHaveBeenCalledWith({
      sessionKey: WORK_SESSION_KEY,
      message: expect.stringContaining("[Delegated Work Result]"),
      deliver: false,
      lane: "subagent",
      idempotencyKey: "byai-remote-followup:call_1",
    });
  });

  it("fails terminal when the target WorkAgent session does not exist", async () => {
    const run = vi.fn();

    await expect(
      dispatchRemoteTaskFollowup(
        {
          requesterSessionKey: WORK_SESSION_KEY,
          toolCallId: "call_1",
          status: "ok",
          result: "done",
        },
        { runtime: { subagent: { run } } as never, sessionExists: () => false },
      ),
    ).rejects.toBeInstanceOf(RemoteTaskFollowupSessionMissingError);

    // Never spawn a run (which would create an orphan session) when the target is missing.
    expect(run).not.toHaveBeenCalled();
    expect(classifyRemoteTaskFollowupError(new RemoteTaskFollowupSessionMissingError(WORK_SESSION_KEY))).toBe(
      "terminal",
    );
  });

  it("classifies gateway readiness failures as retryable and deleted-agent errors as terminal", () => {
    expect(
      classifyRemoteTaskFollowupError(
        new Error("Plugin runtime subagent methods are only available during a gateway request."),
      ),
    ).toBe("retryable");
    expect(
      classifyRemoteTaskFollowupError(
        new Error(
          "In-process gateway dispatch requires a gateway request scope. No scope set and no fallback context available.",
        ),
      ),
    ).toBe("retryable");
    // Real openclaw string from sessions-resolve when the owning agent was removed.
    expect(
      classifyRemoteTaskFollowupError(new Error('Agent "work" no longer exists in configuration')),
    ).toBe("terminal");
    // Unknown errors default to retryable (bounded by caller's attempt budget).
    expect(classifyRemoteTaskFollowupError(new Error("boom"))).toBe("retryable");
  });

  it("keeps the follow-up path off channel replies and SDK gateway method dispatch", async () => {
    const source = await readFile(new URL("./remote-followup.ts", import.meta.url), "utf8");

    expect(source).not.toContain("dispatchReplyFromConfig");
    expect(source).not.toContain("dispatchGatewayMethod");
  });
});
