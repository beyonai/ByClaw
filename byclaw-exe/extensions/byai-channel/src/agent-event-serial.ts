import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";

const AGENT_EVENT_SERIAL_STATE = Symbol.for("openclaw.byaiChannel.agentEventSerialState");

type AgentEventSerialState = {
  queue: Promise<void>;
  unsubscribe?: () => void;
};

function getAgentEventSerialState(): AgentEventSerialState {
  const globalState = globalThis as typeof globalThis & {
    [AGENT_EVENT_SERIAL_STATE]?: AgentEventSerialState;
  };
  if (!globalState[AGENT_EVENT_SERIAL_STATE]) {
    globalState[AGENT_EVENT_SERIAL_STATE] = {
      queue: Promise.resolve(),
    };
  }
  return globalState[AGENT_EVENT_SERIAL_STATE];
}

export function replaceAgentEventSubscription(
  api: OpenClawPluginApi,
  subscribe: () => () => void,
): void {
  const state = getAgentEventSerialState();
  try {
    state.unsubscribe?.();
  } catch {
    // Ignore stale unsubscribe failures during plugin re-registration.
  }
  state.unsubscribe = subscribe();
}

export async function enqueueAfterAgentEvents(
  api: OpenClawPluginApi,
  label: string,
  task: () => Promise<void>,
): Promise<void> {
  const state = getAgentEventSerialState();
  const nextTask = state.queue.then(task);

  state.queue = nextTask.catch((err) => {
    api.logger.error(`[byai-channel] ${label} failed: ${String(err)}`);
  });

  await state.queue;
}
