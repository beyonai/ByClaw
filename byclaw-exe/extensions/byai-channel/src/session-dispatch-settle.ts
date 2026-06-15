import {
  completeActiveSdkRequest,
  markActiveSdkDispatchSettled,
  resolveActiveSdkRequestBySessionKey,
  shouldCompleteActiveSdkRequest,
  type ActiveSdkRequest,
} from "./session-context.js";
import { clearPromptInjectionSnapshot } from "./prompt-injection-snapshot.js";

const DEFAULT_SETTLE_POLL_MS = 1000;
const DEFAULT_SETTLE_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRequestSettled(request: ActiveSdkRequest | undefined): boolean {
  if (!request) {
    return true;
  }
  return shouldCompleteActiveSdkRequest(request);
}

function isAbortSettled(
  request: ActiveSdkRequest | undefined,
  abortSignal?: AbortSignal,
): boolean {
  if (!abortSignal?.aborted) {
    return false;
  }
  if (!request) {
    return true;
  }
  return (
    request.boundRunIds.size === 0 &&
    request.pendingChildSessionKeys.size === 0 &&
    request.pendingOutboundCount === 0 &&
    !request.awaitingFollowup &&
    !request.followupRunStarted
  );
}

export type SdkSessionDispatchSettleResult = {
  settled: boolean;
  timedOut: boolean;
  waitMs: number;
  rootLifecyclePhase?: ActiveSdkRequest["rootLifecyclePhase"];
  clearedRequest: boolean;
};

/**
 * Wait until the active SDK request for `sessionKey` reaches a completable state,
 * then finish SDK stream cleanup. Called after `dispatchReplyFromConfig` returns.
 */
export async function waitForSdkSessionDispatchSettled(
  sessionKey: string,
  options?: {
    abortSignal?: AbortSignal;
    pollMs?: number;
    timeoutMs?: number;
  },
): Promise<SdkSessionDispatchSettleResult> {
  const normalized = sessionKey?.trim();
  const startedAt = Date.now();
  const pollMs = options?.pollMs ?? DEFAULT_SETTLE_POLL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

  if (!normalized) {
    return { settled: true, timedOut: false, waitMs: 0, clearedRequest: false };
  }

  // settle 运行 ⇒ dispatch promise 已 resolve ⇒ 这一轮 agent run 已终结。置权威终结标记，
  // 兜住 onAgentEvent 零事件的路径（precheck-blocked），避免 poll 到超时挂死前端流。
  markActiveSdkDispatchSettled(normalized);

  for (;;) {
    const request = resolveActiveSdkRequestBySessionKey(normalized);
    if (isAbortSettled(request, options?.abortSignal)) {
      clearPromptInjectionSnapshot(normalized);
      return {
        settled: true,
        timedOut: false,
        waitMs: Date.now() - startedAt,
        rootLifecyclePhase: request?.rootLifecyclePhase,
        clearedRequest: false,
      };
    }

    if (isRequestSettled(request)) {
      let clearedRequest = false;
      if (request) {
        try {
          clearedRequest = await completeActiveSdkRequest(request);
        } catch {
          clearedRequest = false;
        }
      }
      clearPromptInjectionSnapshot(normalized);
      return {
        settled: true,
        timedOut: false,
        waitMs: Date.now() - startedAt,
        rootLifecyclePhase: request?.rootLifecyclePhase,
        clearedRequest,
      };
    }

    if (Date.now() - startedAt >= timeoutMs) {
      return {
        settled: false,
        timedOut: true,
        waitMs: Date.now() - startedAt,
        rootLifecyclePhase: request?.rootLifecyclePhase,
        clearedRequest: false,
      };
    }

    await sleep(pollMs);
  }
}
