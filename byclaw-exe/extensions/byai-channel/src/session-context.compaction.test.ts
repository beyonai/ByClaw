import { describe, expect, it } from "vitest";
import {
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestByTarget,
  markActiveSdkCompactionRetryPending,
  markActiveSdkDispatchSettled,
  markActiveSdkRequestSubagentSpawned,
  markActiveSdkRootLifecycleFinished,
  registerActiveSdkRequest,
  shouldCompleteActiveSdkRequest,
} from "./session-context.js";

// 2026.6.1 的 context-overflow 压缩在同一 run 内静默续跑：compaction start/end{willRetry}
// 之后不再发新的 lifecycle start，只发真正的终态 lifecycle end。compactionRetryPending
// 必须在终态 end/error 时被释放，否则完成门永久关闭、APP_STREAM_RESPONSE 永不发出。
//
// boundRunId 默认绑定：模拟“真正启动过 agent run”（onAgentEvent 总线有活动）。这类 request
// 的完成只能靠 rootLifecyclePhase（lifecycle terminal flush 完 delta 才置位），不能靠 dispatchSettled。
function setupRequest(sessionId: string, options?: { bindRunId?: boolean }) {
  const accountId = "acct-compaction";
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
  if (options?.bindRunId !== false) {
    bindActiveSdkRequestRunId(request.sessionKey, `run-${sessionId}`);
  }
  return request;
}

describe("session-context compaction completion gate", () => {
  it("releases compactionRetryPending on terminal lifecycle end (2026.6.1 silent retry)", () => {
    const request = setupRequest("compaction-end");
    const sessionKey = request.sessionKey;

    // compaction start → 挡住完成门
    markActiveSdkCompactionRetryPending(sessionKey, true);
    expect(request.compactionRetryPending).toBe(true);

    // compaction end {willRetry:true} → 仍挡住（同 run 即将续跑）
    markActiveSdkCompactionRetryPending(sessionKey, Boolean(true));
    expect(request.compactionRetryPending).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    // 静默续跑后到达真正终态 end → 必须释放该门
    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    expect(request.compactionRetryPending).toBe(false);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("releases compactionRetryPending on terminal lifecycle error too", () => {
    const request = setupRequest("compaction-error");
    const sessionKey = request.sessionKey;

    markActiveSdkCompactionRetryPending(sessionKey, true);
    expect(request.compactionRetryPending).toBe(true);

    markActiveSdkRootLifecycleFinished(sessionKey, "error");
    expect(request.compactionRetryPending).toBe(false);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("keeps blocking completion while only the compaction-start gate is set", () => {
    const request = setupRequest("compaction-pending");
    const sessionKey = request.sessionKey;

    markActiveSdkCompactionRetryPending(sessionKey, true);
    // 没有终态 lifecycle，完成门必须保持关闭（续跑尚未结束）。
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });
});

// context-overflow precheck 被 blocked 时，onAgentEvent 零事件、rootLifecyclePhase 永远 undefined，
// 只有 dispatch promise resolve 这一个终结信号。dispatchSettled 必须能独立放行完成门。
describe("session-context dispatchSettled completion gate", () => {
  it("completes precheck-blocked run via dispatchSettled (no run started, no lifecycle events)", () => {
    // precheck-blocked：prompt 从未提交，onAgentRunStart 不触发 → boundRunIds 为空。
    const request = setupRequest("dispatch-blocked", { bindRunId: false });
    const sessionKey = request.sessionKey;

    expect(request.boundRunIds.size).toBe(0);
    expect(request.rootLifecyclePhase).toBeUndefined();
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    // dispatch promise resolve → settle 置位 → 应放行（无 run 启动、无子 agent、无 followup）。
    markActiveSdkDispatchSettled(sessionKey);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("does NOT complete on dispatchSettled alone while a run is streaming (anti-truncation)", () => {
    // 正常流式：boundRunIds 非空。dispatch promise 可能早于 onAgentEvent assistant 流 drain，
    // 此时 dispatchSettled 已置但 lifecycle end 未到——绝不能放行，否则截断在途 delta。
    const request = setupRequest("dispatch-streaming");
    const sessionKey = request.sessionKey;

    expect(request.boundRunIds.size).toBeGreaterThan(0);
    markActiveSdkDispatchSettled(sessionKey);
    expect(request.rootLifecyclePhase).toBeUndefined();
    // 关键：有 run 在跑 + 仅 dispatchSettled → 必须保持关闭，等 lifecycle terminal。
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    // lifecycle end 到达（core 保证此前已 flush 完所有 assistant delta）→ 才放行。
    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("still blocks completion while a child subagent is pending even if dispatchSettled", () => {
    const request = setupRequest("dispatch-child", { bindRunId: false });
    const sessionKey = request.sessionKey;
    const childSessionKey = `${sessionKey}:sub:1`;

    markActiveSdkRequestSubagentSpawned(sessionKey, childSessionKey, "run-child-1");
    markActiveSdkDispatchSettled(sessionKey);
    // 主 dispatch resolve 了，但子 agent 仍在跑（独立 dispatch）→ 不能完成。
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });

  it("does not require dispatchSettled when lifecycle end already arrived (fast path intact)", () => {
    const request = setupRequest("dispatch-fastpath");
    const sessionKey = request.sessionKey;

    // 正常路径：lifecycle end 先到 → 不依赖 dispatchSettled 即可完成。
    markActiveSdkRootLifecycleFinished(sessionKey, "end");
    expect(request.dispatchSettled).toBe(false);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);

    clearActiveSdkRequestByTarget(request.accountId, request.to);
  });
});
