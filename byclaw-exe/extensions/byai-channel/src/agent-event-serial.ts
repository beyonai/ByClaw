import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import { getOptionalByaiRuntime } from "./runtime.js";

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

// 已入队的 assistant 事件之后执行，从而读到权威的 answer 缓冲（消除异步流滞后竞争）。
export async function enqueueAfterAgentEvents(
  label: string,
  task: () => Promise<void>,
): Promise<void> {
  const state = getAgentEventSerialState();
  const nextTask = state.queue.then(task);

  state.queue = nextTask.catch((err) => {
    const logger = getOptionalByaiRuntime()?.logger;
    if (logger) {
      logger.error(`[byai-channel] ${label} failed: ${String(err)}`);
    } else {
      console.error(`[byai-channel] ${label} failed: ${String(err)}`);
    }
  });

  await state.queue;
}
