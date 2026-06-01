import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import { resolveTelemetryConfig } from "./config.js";
import { TelemetryReporter, type TelemetrySink } from "./reporter.js";
import { buildScopedWorkKey, TelemetryRuntimeState } from "./state.js";
import { ConsoleTelemetrySink } from "./sinks/console.js";
import { createRedisTelemetrySinkFromEnv } from "./sinks/redis-stats.js";
import type { AgentEventLike } from "./types.js";

export type TelemetryController = {
  recordAgentEvent(event: AgentEventLike): void;
};

export function registerTelemetry(api: OpenClawPluginApi): TelemetryController {
  const config = resolveTelemetryConfig({
    cfg: readCurrentConfig(api),
    pluginConfig: (api as OpenClawPluginApi & { pluginConfig?: unknown }).pluginConfig,
  });
  if (!config.enabled) {
    api.logger.info("[byai-channel] telemetry disabled");
    return {
      recordAgentEvent: () => undefined,
    };
  }

  const state = new TelemetryRuntimeState(config);
  const redisSink = config.redisEnabled
    ? createRedisTelemetrySinkFromEnv({ logger: api.logger })
    : null;
  const sinks: TelemetrySink[] = [];
  if (config.consoleEnabled) {
    sinks.push(new ConsoleTelemetrySink());
  }
  if (redisSink) {
    sinks.push(redisSink);
  }
  const reporter = new TelemetryReporter(state, sinks);

  registerTelemetryHooks(api, state);
  registerTelemetryReporterService(api, reporter, config.logIntervalMs);

  return {
    recordAgentEvent: (event) => {
      state.recordAgentEvent(event);
    },
  };
}

function registerTelemetryHooks(
  api: OpenClawPluginApi,
  state: TelemetryRuntimeState,
): void {
  api.on("before_agent_start", (_event, ctx) => {
    state.markRunStarted(ctx.runId ?? ctx.sessionKey ?? ctx.sessionId, "hook", {
      label: firstStringField(ctx, "agentName", "agentId", "sessionId", "sessionKey"),
    });
  });

  api.on("agent_end", (event, ctx) => {
    state.markRunEnded(ctx.runId ?? ctx.sessionKey ?? ctx.sessionId, event.success === false);
  });

  api.on("before_tool_call", (event, ctx) => {
    state.markToolCallStarted(
      buildScopedWorkKey(ctx.runId ?? event.runId, event.toolCallId ?? ctx.toolCallId),
      "hook",
      {
        label: firstStringField(event, "toolName", "name"),
        kind: "tool",
      },
    );
  });

  api.on("after_tool_call", (event, ctx) => {
    state.markToolCallEnded(
      buildScopedWorkKey(ctx.runId ?? event.runId, event.toolCallId ?? ctx.toolCallId),
      Boolean(event.error),
    );
  });

  api.on("subagent_spawned", (event) => {
    state.markSubagentStarted(event.runId ?? event.childSessionKey, "hook", {
      label: firstStringField(
        event,
        "agentName",
        "childAgentName",
        "targetAgentName",
        "childSessionKey",
        "runId",
      ),
    });
  });

  api.on("subagent_ended", (event) => {
    state.markSubagentEnded(
      event.runId ?? event.targetSessionKey,
      event.outcome === "error" || event.outcome === "timeout" || event.outcome === "killed",
    );
  });
}

function registerTelemetryReporterService(
  api: OpenClawPluginApi,
  reporter: TelemetryReporter,
  logIntervalMs: number,
): void {
  let interval: ReturnType<typeof setInterval> | undefined;
  api.registerService({
    id: "byai-channel-telemetry-reporter",
    start: async () => {
      interval = setInterval(() => {
        reporter.emit("snapshot");
      }, logIntervalMs);
      interval.unref?.();
      api.logger.info(`[byai-channel] telemetry snapshot interval=${logIntervalMs}ms`);
    },
    stop: async () => {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
      await reporter.close();
    },
  });
}

function readCurrentConfig(api: OpenClawPluginApi): OpenClawConfig | null {
  const runtimeConfig = api.runtime?.config;
  if (typeof runtimeConfig?.current === "function") {
    return runtimeConfig.current() as OpenClawConfig;
  }
  if (typeof runtimeConfig?.loadConfig === "function") {
    return runtimeConfig.loadConfig() as OpenClawConfig;
  }
  return null;
}

function firstStringField(value: unknown, ...keys: string[]): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}
