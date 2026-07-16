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
  it("formats concise Chinese result-file notifications without embedding result content", () => {
    const message = buildRemoteTaskResultMessage({
      requesterSessionKey: WORK_SESSION_KEY,
      language: "zh_CN",
      tasks: [
        { toolCallId: "call_2", status: "error", resultFilePath: "/tmp/call_2.json" },
        { toolCallId: "call_1", status: "ok", resultFilePath: "/tmp/call_1.json" },
      ],
    });

    expect(message).toContain("[委派任务结果]");
    expect(message).toContain("- tool_call_id: /tmp/call_1.json");
    expect(message).toContain("- tool_call_id: /tmp/call_2.json");
    expect(message.indexOf("call_1.json")).toBeLessThan(message.indexOf("call_2.json"));
    expect(message).not.toContain("remote failed");
    expect(message).not.toContain("finalAnswer");
    expect(message).not.toContain("同一批次");
    expect(message).not.toContain("均已");
    expect(message).not.toContain("分别");
    expect(message).not.toContain("读取全部结果文件后");
  });

  it("formats English result-file notifications from language", () => {
    const message = buildRemoteTaskResultMessage({
      requesterSessionKey: WORK_SESSION_KEY,
      language: "en_US",
      tasks: [{ toolCallId: "call_1", status: "ok", resultFilePath: "/tmp/call_1.json" }],
    });

    expect(message).toContain("[Delegated Work Results]");
    expect(message).toContain("Delegated work results are available in the following files:");
    expect(message).toContain("- tool_call_id: /tmp/call_1.json");
    expect(message).not.toContain("委派任务结果");
  });

  it("uses stable delivery keys for the same session task group", () => {
    const input = {
      requesterSessionKey: WORK_SESSION_KEY,
      tasks: [
        { toolCallId: "call_2", status: "ok" as const, resultFilePath: "/tmp/call_2.json" },
        { toolCallId: "call_1", status: "ok" as const, resultFilePath: "/tmp/call_1.json" },
      ],
    };

    const key = buildRemoteTaskFollowupIdempotencyKey(input);
    expect(key).toMatch(/^byai-remote-followup:[a-f0-9]{32}$/);
    expect(buildRemoteTaskFollowupIdempotencyKey({ ...input, tasks: [...input.tasks].reverse() })).toBe(key);
    expect(
      buildRemoteTaskFollowupIdempotencyKey({
        ...input,
        tasks: input.tasks.map((task) => ({
          ...task,
          status: "error" as const,
          resultFilePath: `${task.resultFilePath}.changed`,
        })),
      }),
    ).toBe(key);
    expect(
      buildRemoteTaskFollowupIdempotencyKey({
        ...input,
        tasks: [{ toolCallId: "call_3", status: "ok", resultFilePath: "/tmp/call_3.json" }],
      }),
    ).not.toBe(key);
  });

  it("dispatches through runtime.subagent.run on the subagent lane without reply/gateway helpers", async () => {
    const run = vi.fn().mockResolvedValue({ runId: "run-followup" });

    const result = await dispatchRemoteTaskFollowup(
      {
        requesterSessionKey: WORK_SESSION_KEY,
        tasks: [{ toolCallId: "call_1", status: "ok", resultFilePath: "/tmp/call_1.json" }],
      },
      {
        runtime: { subagent: { run } } as never,
        sessionExists: () => true,
      },
    );

    expect(result.runId).toBe("run-followup");
    expect(result.idempotencyKey).toMatch(/^byai-remote-followup:[a-f0-9]{32}$/);
    expect(run).toHaveBeenCalledWith({
      sessionKey: WORK_SESSION_KEY,
      message: expect.stringContaining("[委派任务结果]"),
      deliver: false,
      lane: "subagent",
      idempotencyKey: result.idempotencyKey,
    });
  });

  it("fails terminal when the target WorkAgent session does not exist", async () => {
    const run = vi.fn();

    await expect(
      dispatchRemoteTaskFollowup(
        {
          requesterSessionKey: WORK_SESSION_KEY,
          tasks: [{ toolCallId: "call_1", status: "ok", resultFilePath: "/tmp/call_1.json" }],
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
