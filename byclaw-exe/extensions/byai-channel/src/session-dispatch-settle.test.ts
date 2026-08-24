import { describe, expect, it, vi } from "vitest";
import type { ActiveSdkRequest } from "./session-context.js";

function mockRequest(overrides: Partial<ActiveSdkRequest> = {}): ActiveSdkRequest {
  return {
    accountId: "default",
    sessionKey: "agent:main:direct:settle",
    to: "user:settle",
    sessionId: "settle",
    traceId: "trace-settle",
    createdAt: Date.now(),
    boundRunIds: new Set(),
    nativeChildRuns: new Map(),
    pendingOutboundCount: 0,
    awaitingFollowup: false,
    deferredForFollowup: false,
    followupRunStarted: false,
    compactionRetryPending: false,
    modelFallbackPending: false,
    rootLifecyclePhase: "end",
    dispatchSettled: false,
    lastReasoningText: "",
    lastReasoningMessageId: "",
    language: "zh-CN",
    languageProvided: false,
    ...overrides,
  };
}

describe("waitForSdkSessionDispatchSettled", () => {
  it("resolves when request is already completable", async () => {
    vi.resetModules();
    const sessionContext = await import("./session-context.js");
    const settle = await import("./session-dispatch-settle.js");
    const request = mockRequest();

    vi.spyOn(sessionContext, "resolveActiveSdkRequestBySessionKey").mockReturnValue(request);
    vi.spyOn(sessionContext, "shouldCompleteActiveSdkRequest").mockReturnValue(true);
    vi.spyOn(sessionContext, "completeActiveSdkRequest").mockResolvedValue(true);

    const result = await settle.waitForSdkSessionDispatchSettled(request.sessionKey, {
      pollMs: 5,
      timeoutMs: 1000,
    });

    expect(result.settled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.clearedRequest).toBe(true);
    vi.restoreAllMocks();
  });

  it("resolves when abortSignal is set and no pending work remains", async () => {
    vi.resetModules();
    const sessionContext = await import("./session-context.js");
    const settle = await import("./session-dispatch-settle.js");
    const request = mockRequest({ rootLifecyclePhase: undefined });
    const abortController = new AbortController();
    abortController.abort();

    vi.spyOn(sessionContext, "resolveActiveSdkRequestBySessionKey").mockReturnValue(request);
    vi.spyOn(sessionContext, "shouldCompleteActiveSdkRequest").mockReturnValue(false);

    const result = await settle.waitForSdkSessionDispatchSettled(request.sessionKey, {
      abortSignal: abortController.signal,
      pollMs: 5,
      timeoutMs: 1000,
    });

    expect(result.settled).toBe(true);
    expect(result.timedOut).toBe(false);
    vi.restoreAllMocks();
  });

  it("does not settle while a model fallback attempt is pending", async () => {
    vi.resetModules();
    const sessionContext = await import("./session-context.js");
    const request = sessionContext.registerActiveSdkRequest({
      accountId: "default",
      sessionKey: "agent:main:direct:fallback-settle",
      to: "user:fallback-settle",
      sessionId: "fallback-settle",
      traceId: "trace-fallback-settle",
      language: "zh_CN",
      languageProvided: false,
    });

    try {
      // 收到 lifecycle 事件 ⇒ run 真正启动过，绑定 runId 以走 rootLifecyclePhase 完成路径。
      sessionContext.bindActiveSdkRequestRunId(request.sessionKey, "run-fallback-settle");
      sessionContext.markActiveSdkRootLifecycleFinished(request.sessionKey, "error");
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(true);

      sessionContext.markActiveSdkModelFallbackStep(request.sessionKey, "next_fallback");
      expect(request.rootLifecyclePhase).toBeUndefined();
      expect(request.modelFallbackPending).toBe(true);
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(false);

      sessionContext.markActiveSdkRootLifecycleFinished(request.sessionKey, "end");
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(false);

      sessionContext.markActiveSdkModelFallbackStep(request.sessionKey, "succeeded");
      expect(request.modelFallbackPending).toBe(false);
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(true);
    } finally {
      sessionContext.clearActiveSdkRequestRecord(request);
    }
  });

  it("settles after compaction retry once the terminal lifecycle arrives (2026.6.1 silent retry)", async () => {
    vi.resetModules();
    const sessionContext = await import("./session-context.js");
    const request = sessionContext.registerActiveSdkRequest({
      accountId: "default",
      sessionKey: "agent:main:direct:compaction-settle",
      to: "user:compaction-settle",
      sessionId: "compaction-settle",
      traceId: "trace-compaction-settle",
      language: "zh_CN",
      languageProvided: false,
    });

    try {
      // compaction start/end{willRetry} 挡住完成门；2026.6.1 压缩后在同一 run 内静默续跑，
      // 不再发新的 lifecycle start，所以完成门只能靠真正的终态 lifecycle end 来释放。
      sessionContext.bindActiveSdkRequestRunId(request.sessionKey, "run-compaction-settle");
      sessionContext.markActiveSdkCompactionRetryPending(request.sessionKey, true);
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(false);

      sessionContext.markActiveSdkRootLifecycleFinished(request.sessionKey, "end");
      expect(request.compactionRetryPending).toBe(false);
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(true);
    } finally {
      sessionContext.clearActiveSdkRequestRecord(request);
    }
  });

  it("settles a precheck-blocked run via dispatchSettled (no lifecycle events, no timeout)", async () => {
    vi.resetModules();
    const sessionContext = await import("./session-context.js");
    const settle = await import("./session-dispatch-settle.js");
    const sessionKey = "agent:main:direct:precheck-blocked";
    const request = sessionContext.registerActiveSdkRequest({
      accountId: "default",
      sessionKey,
      to: "user:precheck-blocked",
      sessionId: "precheck-blocked",
      traceId: "trace-precheck-blocked",
      language: "zh_CN",
      languageProvided: false,
    });

    // 模拟 context-overflow precheck-blocked：dispatch 已 resolve 但 onAgentEvent 零事件，
    // rootLifecyclePhase 永远 undefined。settle 必须靠 dispatchSettled 立即收尾，而非 poll 超时。
    vi.spyOn(sessionContext, "completeActiveSdkRequest").mockResolvedValue(true);

    const result = await settle.waitForSdkSessionDispatchSettled(sessionKey, {
      pollMs: 5,
      timeoutMs: 1000,
    });

    expect(request.dispatchSettled).toBe(true);
    expect(result.settled).toBe(true);
    expect(result.timedOut).toBe(false);
    vi.restoreAllMocks();
    sessionContext.clearActiveSdkRequestRecord(request);
  });
});
