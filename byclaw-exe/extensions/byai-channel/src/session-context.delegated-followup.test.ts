import { describe, expect, it, vi } from "vitest";

vi.mock("./utils.js", () => ({
  generateRandomId: () => "mock-message-id",
}));

vi.mock("./diagnostics.js", () => ({
  emitByaiSdkFirstResponse: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: () => "test",
}));

import {
  addActiveSdkDelegatedWork,
  bindActiveSdkRequestRunId,
  clearActiveSdkRequestRecord,
  markActiveSdkAwaitingDelegatedFollowup,
  markActiveSdkDelegatedFollowupDispatched,
  markActiveSdkRootLifecycleFinished,
  markActiveSdkRootLifecycleStarted,
  registerActiveSdkRequest,
  removeActiveSdkDelegatedWork,
  shouldCompleteActiveSdkRequest,
} from "./session-context.js";

function setupRequest(suffix: string) {
  const request = registerActiveSdkRequest({
    accountId: `acct-${suffix}`,
    sessionKey: `agent:test:direct:${suffix}`,
    to: `user:${suffix}`,
    sessionId: suffix,
    traceId: `trace-${suffix}`,
    language: "zh_CN",
    languageProvided: true,
  });
  bindActiveSdkRequestRunId(request.sessionKey, `run-original-${suffix}`);
  markActiveSdkRootLifecycleStarted(request.sessionKey, `run-original-${suffix}`);
  addActiveSdkDelegatedWork(request.sessionKey, `call-${suffix}`);
  return request;
}

describe("session-context delegated follow-up completion gate", () => {
  it("keeps the session open when follow-up dispatch wins the race with the old lifecycle end", () => {
    const request = setupRequest("fast-result");
    const followupRunId = "run-followup-fast-result";

    markActiveSdkAwaitingDelegatedFollowup({ requesterSessionKey: request.sessionKey });
    markActiveSdkDelegatedFollowupDispatched({
      requesterSessionKey: request.sessionKey,
      runId: followupRunId,
    });
    removeActiveSdkDelegatedWork({
      requesterSessionKey: request.sessionKey,
      toolCallId: "call-fast-result",
    });

    markActiveSdkRootLifecycleFinished(
      request.sessionKey,
      "end",
      "run-original-fast-result",
    );

    expect(request.pendingDelegatedFollowupRunId).toBe(followupRunId);
    expect(request.awaitingFollowup).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    bindActiveSdkRequestRunId(request.sessionKey, followupRunId);
    markActiveSdkRootLifecycleStarted(request.sessionKey, followupRunId);
    expect(request.pendingDelegatedFollowupRunId).toBeUndefined();
    expect(request.followupRunStarted).toBe(true);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    markActiveSdkRootLifecycleFinished(request.sessionKey, "end", followupRunId);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);
    clearActiveSdkRequestRecord(request);
  });

  it("ignores an old terminal event that arrives after the follow-up start", () => {
    const request = setupRequest("stale-terminal");
    const followupRunId = "run-followup-stale-terminal";

    markActiveSdkAwaitingDelegatedFollowup({ requesterSessionKey: request.sessionKey });
    markActiveSdkDelegatedFollowupDispatched({
      requesterSessionKey: request.sessionKey,
      runId: followupRunId,
    });
    removeActiveSdkDelegatedWork({
      requesterSessionKey: request.sessionKey,
      toolCallId: "call-stale-terminal",
    });
    bindActiveSdkRequestRunId(request.sessionKey, followupRunId);
    markActiveSdkRootLifecycleStarted(request.sessionKey, followupRunId);

    expect(
      markActiveSdkRootLifecycleFinished(
        request.sessionKey,
        "end",
        "run-original-stale-terminal",
      ),
    ).toBeUndefined();
    expect(request.activeRootRunId).toBe(followupRunId);
    expect(request.rootLifecyclePhase).toBeUndefined();
    expect(shouldCompleteActiveSdkRequest(request)).toBe(false);

    markActiveSdkRootLifecycleFinished(request.sessionKey, "end", followupRunId);
    expect(shouldCompleteActiveSdkRequest(request)).toBe(true);
    clearActiveSdkRequestRecord(request);
  });
});
