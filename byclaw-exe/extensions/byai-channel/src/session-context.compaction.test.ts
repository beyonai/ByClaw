import { describe, expect, it } from "vitest";
import {
  clearActiveSdkRequestByTarget,
  markActiveSdkCompactionRetryPending,
  markActiveSdkRootLifecycleFinished,
  registerActiveSdkRequest,
  shouldCompleteActiveSdkRequest,
} from "./session-context.js";

// 2026.6.1 的 context-overflow 压缩在同一 run 内静默续跑：compaction start/end{willRetry}
// 之后不再发新的 lifecycle start，只发真正的终态 lifecycle end。compactionRetryPending
// 必须在终态 end/error 时被释放，否则完成门永久关闭、APP_STREAM_RESPONSE 永不发出。
function setupRequest(sessionId: string) {
  const accountId = "acct-compaction";
  const to = `user:${sessionId}`;
  clearActiveSdkRequestByTarget(accountId, to);
  return registerActiveSdkRequest({
    accountId,
    sessionKey: `agent:test:direct:${sessionId}`,
    to,
    sessionId,
    traceId: `trace-${sessionId}`,
    language: "zh_CN",
    languageProvided: true,
  });
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
