// ByAI Channel Plugin for OpenClaw
// Provides HTTP webhook integration with configurable streaming support

import handleAgentEvent from "./src/agent-event.js";
import { enqueueAfterAgentEvents, replaceAgentEventSubscription } from "./src/agent-event-serial.js";
import { byaiChannelPlugin } from "./src/channel.js";
import { registerByaiHooks } from "./src/hooks.js";
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
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";

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

// 插件定义
const plugin = {
  id: "byai-channel",
  name: "ByAI Channel",
  description: "HTTP webhook + Redis SDK channel with configurable streaming output",
  configSchema: {
    type: "object" as const,
    additionalProperties: true,
    properties: {
      enabled: { type: "boolean" },
      webhookPath: { type: "string" },
      streamEnabled: { type: "boolean", description: "Enable streaming output" },
      streamMode: { type: "string", enum: ["delta", "final"] },
      forceReasoningStream: {
        type: "boolean",
        description: "Force reasoningLevel=stream for inbound SDK sessions before dispatch",
      },
      sessionKeyPerSessionId: {
        type: "boolean",
        description: "Build a dedicated SDK inbound sessionKey from effective agent id and sessionId",
      },
      dmPolicy: { type: "string", enum: ["open", "allowlist", "pairing"] },
      allowFrom: { type: "array", items: { type: "string" } },
      defaultTo: { type: "string" },
      sdk: {
        type: "object",
        description: "SDK mode configuration",
        properties: {
          enabled: { type: "boolean", description: "Enable SDK mode (default: true)" },
        },
      },
    },
  },
  register(api: OpenClawPluginApi) {
    logInfoOnce(api, "registering-channel-plugin", "[byai-channel] registering channel plugin");
    setByaiRuntime(api.runtime);
    api.registerChannel({ plugin: byaiChannelPlugin });
    replaceAgentEventSubscription(api, () => api.runtime.events.onAgentEvent(async (event) => {
      await enqueueAgentEvent(api, event);
    }));
    registerByaiHooks(api);

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
    logInfoOnce(api, "channel-registered-successfully", "[byai-channel] channel registered successfully");
  },
};

export default plugin;

// 重新导出 channel 插件对象
export { byaiChannelPlugin };

// 重新导出类型
export type {
  ByaiChannelConfig,
  ResolvedByaiAccount,
  ByaiInboundMessage,
  ByaiSdkInboundMessage,
  ByaiProbe,
} from "./src/types.js";
