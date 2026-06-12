// ByAI Channel Plugin for OpenClaw
// Provides HTTP webhook integration with configurable streaming support

import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";
import handleAgentEvent from "./src/agent-event.js";
import { enqueueAfterAgentEvents, replaceAgentEventSubscription } from "./src/agent-event-serial.js";
import { byaiChannelPlugin } from "./src/channel.js";
import { registerByaiHooks } from "./src/hooks.js";
import { registerContextSnapshotHook } from "./src/context-snapshot.js";
import { setByaiRuntime } from "./src/runtime.js";
import {
  markActiveSdkRequestSubagentEnded,
  markActiveSdkRequestSubagentSpawned,
} from "./src/session-context.js";
import {
  cancelActiveSdkCompletionCheck,
  scheduleActiveSdkCompletionCheck,
} from "./src/sdk-session-completion.js";
import { AgentEvent } from "./src/types.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { handleCronChangedEvent, startCronNextRunTimeRedisSync } from "./src/cron.js";

const LOG_ONCE_STATE = Symbol.for("openclaw.byaiChannel.logOnce");

function logInfoOnce(api: OpenClawPluginApi, key: string, message: string): void {
  const globalState = globalThis as typeof globalThis & {
    [LOG_ONCE_STATE]?: Set<string>;
  };
  const seen = globalState[LOG_ONCE_STATE] ?? (globalState[LOG_ONCE_STATE] = new Set<string>());
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  api.logger.info(message);
}

async function enqueueAgentEvent(api: OpenClawPluginApi, event: AgentEvent): Promise<void> {
  await enqueueAfterAgentEvents(
    api,
    `onAgentEvent runId=${event.runId ?? ""} seq=${String(event.seq)}`,
    async () => {
      await handleAgentEvent(api, event);
    },
  );
}

function registerFull(api: OpenClawPluginApi) {
  replaceAgentEventSubscription(api, () => api.runtime.events.onAgentEvent((event) => {
    // Keep SDK streaming completely outside OpenClaw's synchronous agent-event
    // dispatch stack. 2026.5.x releases the embedded session lock while the
    // model/tool loop is running; running Redis/SSE work in the same tick can
    // interleave with core transcript writes and trip the session takeover fence.
    const eventSnapshot = structuredClone(event);
    setImmediate(() => {
      void enqueueAgentEvent(api, eventSnapshot).catch((err) => {
        api.logger.error(`[byai-channel] onAgentEvent enqueue failed: ${String(err)}`);
      });
    });
  }));
  registerByaiHooks(api);

  registerContextSnapshotHook(api);

  api.on("subagent_spawned", async (event: {
    runId: string;
    childSessionKey: string;
    agentId: string;
  }, ctx: {
    requesterSessionKey: string;
  }) => {
    const request = await markActiveSdkRequestSubagentSpawned(
      ctx.requesterSessionKey,
      event.childSessionKey,
      event.agentId,
      event.runId,
    );
    if (!request) {
      return;
    }
    cancelActiveSdkCompletionCheck(request.sessionKey);
  });
  api.on("subagent_ended", (event) => {
    const request = markActiveSdkRequestSubagentEnded(event?.targetSessionKey);
    if (!request) {
      return;
    }
    api.logger.info(
      `[byai-channel] native subagent ended: requester=${request.sessionKey} child=${event?.targetSessionKey ?? ""} rootLifecyclePhase=${request.rootLifecyclePhase ?? ""} awaitingFollowup=${String(request.awaitingFollowup)}`,
    );
    scheduleActiveSdkCompletionCheck(api, request.sessionKey, "subagent_ended");
  });
  startCronNextRunTimeRedisSync(api);
  api.on("cron_changed", (event) => {
    api.logger.info(`[byai-channel] cron_changed: ${JSON.stringify(event)}`);
    handleCronChangedEvent(event, api);
  });
  logInfoOnce(api, "channel-registered-successfully", "[byai-channel] channel registered successfully");
}

export default defineBundledChannelEntry({
  id: "byai-channel",
  name: "ByAI Channel",
  description: "HTTP webhook + Redis SDK channel with configurable streaming output",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "byaiChannelPlugin",
  },
  runtime: {
    specifier: "./runtime-setter-api.js",
    exportName: "setByaiRuntime",
  },
  configSchema: byaiChannelPlugin.configSchema,
  registerCliMetadata(api) {
    logInfoOnce(api, "registering-channel-plugin", "[byai-channel] registering channel plugin");
  },
  registerFull,
});

// 重新导出 channel 插件对象
export { byaiChannelPlugin };
export { setByaiRuntime };

// 重新导出类型
export type {
  ByaiChannelConfig,
  ResolvedByaiAccount,
  ByaiInboundMessage,
  ByaiSdkInboundMessage,
  ByaiProbe,
} from "./src/types.js";
