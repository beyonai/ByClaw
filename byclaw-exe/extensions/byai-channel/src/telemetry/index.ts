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

type TelemetryRuntimeRegistry = {
  current?: TelemetryRuntimeController;
  interval?: ReturnType<typeof setInterval>;
};

const TELEMETRY_RUNTIME_REGISTRY = Symbol.for("byai-channel.telemetry.runtime");

export function registerTelemetry(api: OpenClawPluginApi): TelemetryController {
  const config = resolveTelemetryConfig({
    cfg: readCurrentConfig(api),
    pluginConfig: (api as OpenClawPluginApi & { pluginConfig?: unknown }).pluginConfig,
  });

  if (!config.enabled) {
    replaceTelemetryRuntime(undefined);
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
  const runtime = new TelemetryRuntimeController(state, reporter);
  replaceTelemetryRuntime(runtime);

  registerTelemetryHooks(api);
  registerTelemetryReporterService(api, config.logIntervalMs);

  return {
    recordAgentEvent: (event) => {
      getCurrentTelemetryRuntime()?.recordAgentEvent(event);
    },
  };
}

function registerTelemetryHooks(api: OpenClawPluginApi): void {
  api.on("before_agent_start", (_event, ctx) => {
    getCurrentTelemetryRuntime()?.markRunStarted(ctx.runId ?? ctx.sessionKey ?? ctx.sessionId, {
      label: firstStringField(ctx, "agentName", "agentId", "sessionId", "sessionKey"),
    });
  });

  api.on("agent_end", (event, ctx) => {
    getCurrentTelemetryRuntime()?.markRunEnded(
      ctx.runId ?? ctx.sessionKey ?? ctx.sessionId,
      event.success === false,
    );
  });

  api.on("before_tool_call", (event, ctx) => {
    getCurrentTelemetryRuntime()?.markToolCallStarted(
      buildScopedWorkKey(ctx.runId ?? event.runId, event.toolCallId ?? ctx.toolCallId),
      {
        label: firstStringField(event, "toolName", "name"),
        kind: "tool",
      },
    );
  });

  api.on("after_tool_call", (event, ctx) => {
    getCurrentTelemetryRuntime()?.markToolCallEnded(
      buildScopedWorkKey(ctx.runId ?? event.runId, event.toolCallId ?? ctx.toolCallId),
      Boolean(event.error),
    );
  });

  api.on("subagent_spawned", (event) => {
    getCurrentTelemetryRuntime()?.markSubagentStarted(event.runId ?? event.childSessionKey, {
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
    getCurrentTelemetryRuntime()?.markSubagentEnded(
      event.runId ?? event.targetSessionKey,
      event.outcome === "error" || event.outcome === "timeout" || event.outcome === "killed",
    );
  });
}

function registerTelemetryReporterService(
  api: OpenClawPluginApi,
  logIntervalMs: number,
): void {
  api.registerService({
    id: "byai-channel-telemetry-reporter",
    start: async () => {
      startTelemetryReporterLoop(api, logIntervalMs);
      api.logger.info(`[byai-channel] telemetry snapshot interval=${logIntervalMs}ms`);
    },
    stop: async () => {
      await stopTelemetryReporterLoop();
      await replaceTelemetryRuntime(undefined);
      api.logger.info("[byai-channel] telemetry stopped");
    },
  });
}

function replaceTelemetryRuntime(next: TelemetryRuntimeController | undefined): void {
  const registry = getTelemetryRuntimeRegistry();
  const previous = registry.current;
  registry.current = next;
  if (previous && previous !== next) {
    void previous.close().catch(() => undefined);
  }
}

function getTelemetryRuntimeRegistry(): TelemetryRuntimeRegistry {
  const globalState = globalThis as typeof globalThis & {
    [TELEMETRY_RUNTIME_REGISTRY]?: TelemetryRuntimeRegistry;
  };
  return globalState[TELEMETRY_RUNTIME_REGISTRY] ?? (
    globalState[TELEMETRY_RUNTIME_REGISTRY] = {}
  );
}

function getCurrentTelemetryRuntime(): TelemetryRuntimeController | undefined {
  return getTelemetryRuntimeRegistry().current;
}

function startTelemetryReporterLoop(api: OpenClawPluginApi, logIntervalMs: number): void {
  const registry = getTelemetryRuntimeRegistry();
  if (registry.interval) {
    clearInterval(registry.interval);
  }
  registry.interval = setInterval(() => {
    getCurrentTelemetryRuntime()?.emitSnapshot();
  }, logIntervalMs);
  registry.interval.unref?.();
}

async function stopTelemetryReporterLoop(): Promise<void> {
  const registry = getTelemetryRuntimeRegistry();
  if (!registry.interval) {
    return;
  }
  clearInterval(registry.interval);
  registry.interval = undefined;
}

class TelemetryRuntimeController {
  private closed = false;

  constructor(
    private readonly state: TelemetryRuntimeState,
    private readonly reporter: TelemetryReporter,
  ) {}

  recordAgentEvent(event: AgentEventLike): void {
    if (this.closed) {
      return;
    }
    this.state.recordAgentEvent(event);
  }

  markRunStarted(
    runKey: string | undefined,
    details: {
      label?: string;
    },
  ): void {
    if (this.closed) {
      return;
    }
    this.state.markRunStarted(runKey, "hook", {
      ...(details.label ? { label: details.label } : {}),
    });
  }

  markRunEnded(
    runKey: string | undefined,
    failed: boolean,
  ): void {
    if (this.closed) {
      return;
    }
    this.state.markRunEnded(runKey, failed);
  }

  markToolCallStarted(
    toolKey: string | undefined,
    metadata: { label?: string; kind?: string },
  ): void {
    if (this.closed) {
      return;
    }
    this.state.markToolCallStarted(toolKey, "hook", metadata);
  }

  markToolCallEnded(
    toolKey: string | undefined,
    failed: boolean,
  ): void {
    if (this.closed) {
      return;
    }
    this.state.markToolCallEnded(toolKey, failed);
  }

  markSubagentStarted(
    subagentKey: string | undefined,
    metadata: { label?: string },
  ): void {
    if (this.closed) {
      return;
    }
    this.state.markSubagentStarted(subagentKey, "hook", metadata);
  }

  markSubagentEnded(
    subagentKey: string | undefined,
    failed: boolean,
  ): void {
    if (this.closed) {
      return;
    }
    this.state.markSubagentEnded(subagentKey, failed);
  }

  emitSnapshot(): void {
    if (this.closed) {
      return;
    }
    this.reporter.emit("snapshot");
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.reporter.close();
  }
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
