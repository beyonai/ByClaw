import { describe, expect, it } from "vitest";
import type { GatewayDataEmitter } from "@byclaw/by-framework";
import { buildContextOverflowText } from "./i18n.js";
import {
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestByTarget,
  completeActiveSdkRequest,
  getAgentRunEndPromiseResolver,
  markActiveSdkContextWindow,
  markActiveSdkDispatchSettled,
  markActiveSdkOverflowContinuePending,
  markActiveSdkOverflowLength,
  markActiveSdkRootLifecycleFinished,
  registerActiveSdkRequest,
  registerAgentRunEndPromise,
  registerSdkEmitter,
  resolveActiveSdkRequestBySessionKey,
  shouldCompleteActiveSdkRequest,
} from "./session-context.js";

// 上下文溢出型 length 截断 → 自动续跑：截断 run 的 lifecycle-end 会把 rootLifecyclePhase="end"，
// 若不阻断完成门，settle/completion-check 会在续跑启动前提前收尾、丢掉续跑答案。
// overflowContinuePending 必须挡住完成门，直到续跑结束（或放弃续跑）才释放。
function setupRequest(sessionId: string) {
  const accountId = "acct-overflow";
  const to = `user:${sessionId}`;
  clearActiveSdkRequestByTarget(accountId, to);
  const request = registerActiveSdkRequest({
    accountId,
    sessionKey: `agent:test:direct:${sessionId}`,
    to,
    sessionId,
    traceId: `trace-${sessionId}`,
    language: "zh_CN",
    languageProvided: true,
  });
  bindActiveSdkRequestRunId(request.sessionKey, `run-${sessionId}`);
  return request;
}

describe("session-context overflow auto-continue completion gate", () => {
  it("blocks completion while overflowContinuePending even after truncated run lifecycle end", () => {
    const request = setupRequest("overflow-block");
    const sessionKey = request.sessionKey;

    // 截断 run 终态到达（lifecycle end）。
    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    // hook 同步阻断完成门（覆盖截断→续跑窗口）。
    markActiveSdkOverflowContinuePending(sessionKey, true);
    markActiveSdkOverflowLength(sessionKey, true);

    expect(request.overflowContinuePending).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("completes after continuation run ends and gate is released", () => {
    const request = setupRequest("overflow-continue");
    const sessionKey = request.sessionKey;

    // 截断 run + 阻断门。
    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    markActiveSdkOverflowContinuePending(sessionKey, true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    // 续跑 run 启动并结束。
    bindActiveSdkRequestRunId(sessionKey, "run-continuation");
    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    // 续跑结束、无新溢出 → 编排释放完成门。
    markActiveSdkOverflowContinuePending(sessionKey, false);

    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("overflowContinuePending blocks completion even when dispatchSettled is set", () => {
    const request = setupRequest("overflow-dispatch");
    const sessionKey = request.sessionKey;

    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    markActiveSdkOverflowContinuePending(sessionKey, true);
    markActiveSdkDispatchSettled(sessionKey);

    // dispatch promise resolve 也不能放行——续跑尚未结束。
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("lastRunOverflowLength is a one-shot snapshot, independent of the completion gate", () => {
    const request = setupRequest("overflow-snapshot");
    const sessionKey = request.sessionKey;

    markActiveSdkOverflowLength(sessionKey, true);
    expect(resolveActiveSdkRequestBySessionKey(sessionKey)?.lastRunOverflowLength).toBe(true);
    // 快照本身不挡完成门（挡门的是 overflowContinuePending）。
    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });
});

describe("completeActiveSdkRequest terminal runId selection (overflow auto-continue)", () => {
  it("awaits the LAST bound run's end result, not the first (truncated) run", async () => {
    const accountId = "acct-overflow-complete";
    const sessionId = "overflow-terminal";
    const to = `user:${sessionId}`;
    clearActiveSdkRequestByTarget(accountId, to);

    const emitted: string[] = [];
    const fakeEmitter = {
      emitChunk: async (_s: string, _t: string, event: string) => {
        emitted.push(event);
      },
      emitState: async () => {},
    } as unknown as GatewayDataEmitter;
    registerSdkEmitter(accountId, fakeEmitter);

    const request = registerActiveSdkRequest({
      accountId,
      sessionKey: `agent:test:direct:${sessionId}`,
      to,
      sessionId,
      traceId: `trace-${sessionId}`,
      language: "zh_CN",
      languageProvided: true,
    });
    const sessionKey = request.sessionKey;

    // 截断 run：resolve 无 error（溢出截断不交付答案）。
    bindActiveSdkRequestRunId(sessionKey, "run-truncated");
    registerAgentRunEndPromise("run-truncated");
    getAgentRunEndPromiseResolver("run-truncated")?.({ success: true });

    // 续跑 run：终态带真实错误，必须以它为准。
    bindActiveSdkRequestRunId(sessionKey, "run-continuation");
    registerAgentRunEndPromise("run-continuation");
    getAgentRunEndPromiseResolver("run-continuation")?.({
      success: false,
      error: "continuation-error-text",
    });

    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    markActiveSdkOverflowContinuePending(sessionKey, false);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    const completed = await completeActiveSdkRequest(request);
    expect(completed).toBe(true);
    // emit 的应是续跑 run 的错误文案，而非首个截断 run（截断 run 无 error）。
    expect(emitted).toContain("continuation-error-text");

    clearActiveSdkRequestByTarget(accountId, to);
  });

  it("maps core precheck overflow after auto-continue to the friendly context-overflow text", async () => {
    const accountId = "acct-overflow-precheck";
    const sessionId = "overflow-precheck";
    const to = `user:${sessionId}`;
    clearActiveSdkRequestByTarget(accountId, to);

    const emitted: string[] = [];
    const fakeEmitter = {
      emitChunk: async (_s: string, _t: string, event: string) => {
        emitted.push(event);
      },
      emitState: async () => {},
    } as unknown as GatewayDataEmitter;
    registerSdkEmitter(accountId, fakeEmitter);

    const request = registerActiveSdkRequest({
      accountId,
      sessionKey: `agent:test:direct:${sessionId}`,
      to,
      sessionId,
      traceId: `trace-${sessionId}`,
      language: "zh_CN",
      languageProvided: true,
    });
    const sessionKey = request.sessionKey;
    request.overflowContinueCount = 1;

    bindActiveSdkRequestRunId(sessionKey, "run-continuation-precheck");
    registerAgentRunEndPromise("run-continuation-precheck");
    getAgentRunEndPromiseResolver("run-continuation-precheck")?.({
      success: false,
      error: "Context overflow: prompt too large for the model (precheck).",
    });

    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    markActiveSdkOverflowContinuePending(sessionKey, false);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    const completed = await completeActiveSdkRequest(request);
    expect(completed).toBe(true);
    expect(emitted).toContain(buildContextOverflowText("zh_CN"));
    expect(emitted).not.toContain("Context overflow: prompt too large for the model (precheck).");

    clearActiveSdkRequestByTarget(accountId, to);
  });

  it("ignores runtime-event placeholder runs without end results when choosing terminal text", async () => {
    const accountId = "acct-overflow-runtime-event";
    const sessionId = "overflow-runtime-event";
    const to = `user:${sessionId}`;
    clearActiveSdkRequestByTarget(accountId, to);

    const emitted: string[] = [];
    const fakeEmitter = {
      emitChunk: async (_s: string, _t: string, event: string) => {
        emitted.push(event);
      },
      emitState: async () => {},
    } as unknown as GatewayDataEmitter;
    registerSdkEmitter(accountId, fakeEmitter);

    const request = registerActiveSdkRequest({
      accountId,
      sessionKey: `agent:test:direct:${sessionId}`,
      to,
      sessionId,
      traceId: `trace-${sessionId}`,
      language: "zh_CN",
      languageProvided: true,
    });
    const sessionKey = request.sessionKey;

    bindActiveSdkRequestRunId(sessionKey, "run-continuation");
    registerAgentRunEndPromise("run-continuation");
    getAgentRunEndPromiseResolver("run-continuation")?.({
      success: false,
      error: "continuation-terminal-error",
    });
    // Core may persist a runtime-only placeholder prompt such as
    // "Continue the OpenClaw runtime event."; if no agent_end result is registered,
    // it must not displace the real terminal run result.
    bindActiveSdkRequestRunId(sessionKey, "run-runtime-event-placeholder");

    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    const completed = await completeActiveSdkRequest(request);
    expect(completed).toBe(true);
    expect(emitted).toContain("continuation-terminal-error");

    clearActiveSdkRequestByTarget(accountId, to);
  });
});

describe("markActiveSdkContextWindow snapshot (model_call_started capture)", () => {
  it("stores window + budget on the request for agent_end to read", () => {
    const request = setupRequest("ctxwindow-store");
    const sessionKey = request.sessionKey;

    markActiveSdkContextWindow(sessionKey, 50000, 42000);
    const snap = resolveActiveSdkRequestBySessionKey(sessionKey);
    expect(snap?.lastContextWindow).toBe(50000);
    expect(snap?.lastContextBudget).toBe(42000);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("ignores non-positive window/budget (keeps prior snapshot)", () => {
    const request = setupRequest("ctxwindow-guard");
    const sessionKey = request.sessionKey;

    markActiveSdkContextWindow(sessionKey, 50000, 42000);
    // 后续无效值不得覆盖已捕获的有效窗口。
    markActiveSdkContextWindow(sessionKey, 0, undefined);
    const snap = resolveActiveSdkRequestBySessionKey(sessionKey);
    expect(snap?.lastContextWindow).toBe(50000);
    expect(snap?.lastContextBudget).toBe(42000);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("is a no-op for unknown sessionKey", () => {
    expect(markActiveSdkContextWindow("agent:test:direct:nope", 50000, 42000)).toBeUndefined();
  });
});
