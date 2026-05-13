import { enqueueAfterAgentEvents } from "./agent-event-serial.js";
import {
  completeActiveSdkRequest,
  resolveActiveSdkRequestBySessionKey,
  shouldCompleteActiveSdkRequest,
} from "./session-context.js";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";


const ACTIVE_SDK_COMPLETION_STATE = Symbol.for("openclaw.byaiChannel.activeSdkCompletionState");
const ACTIVE_SDK_COMPLETION_DEBOUNCE_MS = 200;

type ActiveSdkCompletionEntry = {
  token: number;
  timer?: ReturnType<typeof setTimeout>;
};

type ActiveSdkCompletionState = {
  entries: Map<string, ActiveSdkCompletionEntry>;
};

function getActiveSdkCompletionState(): ActiveSdkCompletionState {
  const globalState = globalThis as typeof globalThis & {
    [ACTIVE_SDK_COMPLETION_STATE]?: ActiveSdkCompletionState;
  };
  if (!globalState[ACTIVE_SDK_COMPLETION_STATE]) {
    globalState[ACTIVE_SDK_COMPLETION_STATE] = {
      entries: new Map<string, ActiveSdkCompletionEntry>(),
    };
  }
  return globalState[ACTIVE_SDK_COMPLETION_STATE];
}

export function scheduleActiveSdkCompletionCheck(
  api: OpenClawPluginApi,
  sessionKey: string | undefined,
  reason: string,
): void {
  if (!sessionKey) {
    return;
  }
  const state = getActiveSdkCompletionState();
  const current = state.entries.get(sessionKey) ?? { token: 0 };
  current.token += 1;
  const token = current.token;
  if (current.timer) {
    clearTimeout(current.timer);
  }
  current.timer = setTimeout(() => {
    void enqueueAfterAgentEvents(
      api,
      `active sdk completion check sessionKey=${sessionKey}`,
      async () => {
        const latestEntry = state.entries.get(sessionKey);
        if (!latestEntry || latestEntry.token !== token) {
          return;
        }
        latestEntry.timer = undefined;
        const request = resolveActiveSdkRequestBySessionKey(sessionKey);
        if (!request) {
          state.entries.delete(sessionKey);
          return;
        }
        if (!shouldCompleteActiveSdkRequest(request)) {
          return;
        }
        const completed = await completeActiveSdkRequest(request);
        if (completed) {
          api.logger.info(
            `[byai-channel] sdk session completed: sessionKey=${sessionKey}, reason=${reason}`,
          );
        }
        state.entries.delete(sessionKey);
      },
    );
  }, ACTIVE_SDK_COMPLETION_DEBOUNCE_MS);
  state.entries.set(sessionKey, current);
}

export function cancelActiveSdkCompletionCheck(sessionKey: string | undefined): void {
  if (!sessionKey) {
    return;
  }
  const state = getActiveSdkCompletionState();
  const current = state.entries.get(sessionKey);
  if (current?.timer) {
    clearTimeout(current.timer);
  }
  state.entries.delete(sessionKey);
}
