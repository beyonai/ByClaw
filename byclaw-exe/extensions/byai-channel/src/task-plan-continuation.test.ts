import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("openclaw/plugin-sdk/runtime-store", () => ({
  createPluginRuntimeStore: () => ({
    getRuntime: vi.fn(),
    setRuntime: vi.fn(),
    tryGetRuntime: vi.fn(),
  }),
}));
vi.mock("openclaw/plugin-sdk/diagnostic-runtime", () => ({
  createDiagnosticTraceContext: vi.fn(() => ({})),
  emitTrustedDiagnosticEvent: vi.fn(),
  freezeDiagnosticTraceContext: vi.fn((value) => value),
  isValidDiagnosticSpanId: vi.fn(() => false),
  isValidDiagnosticTraceId: vi.fn(() => false),
}));
vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: vi.fn(() => "main"),
}));
vi.mock("../../shared/src/redis-compat.js", () => ({
  byFrameworkRedisKeys: {},
  createRedisClient: vi.fn(),
  hasRedisConnectionConfig: vi.fn(() => false),
  readRedisConfig: vi.fn(() => ({})),
}));
import {
  clearTaskPlanExecutionContext,
  isTaskPlanContinuationPending,
  markTaskPlanContinuationPending,
  rememberTaskPlanExecutionContext,
  registerTaskPlanRuntimeBridge,
  type TaskPlanRuntimeBridge,
  type TaskPlanSnapshot,
} from "../../shared/src/task-plan-runtime.js";
import {
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestRecord,
  markActiveSdkRootLifecycleFinished,
  markActiveSdkRootLifecycleStarted,
  registerActiveSdkRequest,
  shouldCompleteActiveSdkRequest,
  type ActiveSdkRequest,
} from "./session-context.js";
import { continueActiveTaskPlan } from "./task-plan-continuation.js";

let request: ActiveSdkRequest | undefined;

function plan(status: TaskPlanSnapshot["status"], version: number): TaskPlanSnapshot {
  return {
    planId: "plan-1",
    version,
    title: "Complex work",
    status,
    sessionId: "session-1",
    messageId: "answer-1",
    traceId: "trace-1",
    sourceRuntime: "OPENCLAW",
    sourceRunId: "run-1",
    tasks: [
      {
        taskId: "task-1",
        position: 1,
        title: "First step",
        status: status === "ACTIVE" ? "IN_PROGRESS" : status === "FAILED" ? "FAILED" : "COMPLETED",
      },
    ],
  };
}

function createReadyRequest(): ActiveSdkRequest {
  const active = registerActiveSdkRequest({
    accountId: "default",
    sessionKey: "agent:main:direct:session-1",
    to: "main:session-1",
    sessionId: "session-1",
    messageId: "answer-1",
    traceId: "trace-1",
    language: "zh_CN",
    languageProvided: true,
    beyondToken: "token-1",
  });
  active.dispatchSettled = true;
  request = active;
  return active;
}

afterEach(() => {
  if (request) {
    clearActiveSdkRequestRecord(request);
    request = undefined;
  }
  clearTaskPlanExecutionContext("agent:main:direct:session-1");
});

describe("continueActiveTaskPlan", () => {
  it("keeps the SDK completion gate closed while continuation is pending", () => {
    const active = createReadyRequest();
    expect(shouldCompleteActiveSdkRequest(active)).toBe(true);

    markTaskPlanContinuationPending(active.sessionKey, true);
    expect(shouldCompleteActiveSdkRequest(active)).toBe(false);

    markTaskPlanContinuationPending(active.sessionKey, false);
    expect(shouldCompleteActiveSdkRequest(active)).toBe(true);
  });

  it("continues an active plan and stops when it reaches a terminal state", async () => {
    const active = createReadyRequest();
    const loadActive = vi
      .fn()
      .mockResolvedValueOnce(plan("ACTIVE", 1))
      .mockResolvedValueOnce(plan("COMPLETED", 2));
    const runtime = {
      loadActive,
      command: vi.fn(),
      cancel: vi.fn(),
    } as unknown as TaskPlanRuntimeBridge;
    registerTaskPlanRuntimeBridge(runtime);
    const dispatch = vi.fn(async () => undefined);

    await continueActiveTaskPlan({
      request: active,
      language: "zh_CN",
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toContain("权威任务计划仍处于 ACTIVE");
    expect(runtime.command).not.toHaveBeenCalled();
    expect(isTaskPlanContinuationPending(active.sessionKey)).toBe(false);
  });

  it("uses the plan owner's run identity after OpenClaw starts a follow-up run", async () => {
    const active = createReadyRequest();
    rememberTaskPlanExecutionContext({
      sessionKey: active.sessionKey,
      sessionId: active.sessionId,
      messageId: active.messageId!,
      traceId: active.traceId,
      sourceRuntime: "OPENCLAW",
      sourceRunId: "owner-run",
      beyondToken: active.beyondToken,
    });
    bindActiveSdkRequestRunId(active.sessionKey, "follow-up-run");
    markActiveSdkRootLifecycleStarted(active.sessionKey, "follow-up-run");
    markActiveSdkRootLifecycleFinished(active.sessionKey, "end", "follow-up-run");
    const loadActive = vi
      .fn()
      .mockResolvedValueOnce(plan("ACTIVE", 1))
      .mockResolvedValueOnce(plan("COMPLETED", 2));
    const runtime = {
      loadActive,
      command: vi.fn(),
      cancel: vi.fn(),
    } as unknown as TaskPlanRuntimeBridge;
    registerTaskPlanRuntimeBridge(runtime);

    await continueActiveTaskPlan({
      request: active,
      language: "zh_CN",
      dispatch: async () => {
        bindActiveSdkRequestRunId(active.sessionKey, "second-follow-up-run");
        markActiveSdkRootLifecycleStarted(active.sessionKey, "second-follow-up-run");
        markActiveSdkRootLifecycleFinished(active.sessionKey, "end", "second-follow-up-run");
      },
    });

    expect(loadActive.mock.calls.map(([context]) => context.sourceRunId)).toEqual([
      "owner-run",
      "owner-run",
    ]);
  });

  it("does not dispatch another continuation after the request is stopped", async () => {
    const active = createReadyRequest();
    const runtime = {
      loadActive: vi.fn(async () => plan("ACTIVE", 1)),
      command: vi.fn(),
      cancel: vi.fn(),
    } as unknown as TaskPlanRuntimeBridge;
    registerTaskPlanRuntimeBridge(runtime);
    const abortController = new AbortController();
    abortController.abort(new Error("user stopped"));
    const dispatch = vi.fn(async () => undefined);

    await continueActiveTaskPlan({
      request: active,
      language: "zh_CN",
      signal: abortController.signal,
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(isTaskPlanContinuationPending(active.sessionKey)).toBe(false);
  });

  it("fails the current task after three unchanged continuation attempts", async () => {
    const active = createReadyRequest();
    const runtime = {
      loadActive: vi.fn(async () => plan("ACTIVE", 7)),
      command: vi.fn(async () => ({ ok: true as const, plan: plan("FAILED", 8) })),
      cancel: vi.fn(),
    } as unknown as TaskPlanRuntimeBridge;
    registerTaskPlanRuntimeBridge(runtime);
    const dispatch = vi.fn(async () => undefined);

    await continueActiveTaskPlan({
      request: active,
      language: "en_US",
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(runtime.command).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          action: "fail_current",
          statusReason: expect.objectContaining({ code: "TASK_PLAN_STALLED" }),
        },
      }),
    );
    expect(isTaskPlanContinuationPending(active.sessionKey)).toBe(false);
  });
});
