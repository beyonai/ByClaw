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
    pendingChildSessionKeys: new Set(),
    pendingOutboundCount: 0,
    awaitingFollowup: false,
    deferredForFollowup: false,
    followupRunStarted: false,
    compactionRetryPending: false,
    modelFallbackPending: false,
    rootLifecyclePhase: "end",
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

  it("does not settle while compaction retry is pending", async () => {
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
      sessionContext.markActiveSdkCompactionRetryPending(request.sessionKey, true);
      sessionContext.markActiveSdkRootLifecycleFinished(request.sessionKey, "end");
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(false);

      sessionContext.markActiveSdkRootLifecycleStarted(request.sessionKey);
      expect(request.rootLifecyclePhase).toBeUndefined();
      expect(request.compactionRetryPending).toBe(false);
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(false);

      sessionContext.markActiveSdkRootLifecycleFinished(request.sessionKey, "end");
      expect(sessionContext.shouldCompleteActiveSdkRequest(request)).toBe(true);
    } finally {
      sessionContext.clearActiveSdkRequestRecord(request);
    }
  });
});
