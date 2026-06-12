import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveActiveSdkRequestBySessionKey } from "./session-context.js";

const CHANNEL_ID = "byai-channel";
const DEFAULT_FILE_NAME = "llm_input_snapshots.json";
const DEFAULT_MAX_STRING_CHARS = 200_000;
const DEFAULT_MAX_ARRAY_ITEMS = 200;

export type ContextSnapshotConfig = {
  enabled: boolean;
  fileName: string;
  maxStringChars: number;
  maxArrayItems: number;
  includeHistoryMessages: boolean;
  includeTools: boolean;
};

type LlmInputEvent = {
  runId?: string;
  sessionId?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  prompt?: string;
  historyMessages?: unknown[];
  imagesCount?: number;
  tools?: unknown;
};

type LlmInputContext = {
  runId?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  trigger?: string;
  channelId?: string;
  accountId?: string;
};

export function registerContextSnapshotHook(api: OpenClawPluginApi): void {
  api.on("llm_input", (event: LlmInputEvent, ctx: LlmInputContext) => {
    const config = resolveContextSnapshotConfig(api);
    if (!config.enabled) {
      return;
    }
    void writeContextSnapshot(api, config, event, ctx).catch((err) => {
      api.logger.warn(
        `[byai-channel] context snapshot write failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  });

  const config = resolveContextSnapshotConfig(api);
  api.logger.info(
    config.enabled
      ? `[byai-channel] context snapshot hook registered and enabled file=${config.fileName} mode=overwrite`
      : "[byai-channel] context snapshot hook registered but disabled",
  );
}

function resolveContextSnapshotConfig(api: OpenClawPluginApi): ContextSnapshotConfig {
  const cfg = readCurrentConfig(api);
  const channelConfig = readRecord(
    readRecord(cfg?.channels?.[CHANNEL_ID])?.contextSnapshot,
  );
  const entryConfig = readRecord(
    readRecord(readRecord(cfg?.plugins?.entries?.[CHANNEL_ID])?.config)?.contextSnapshot,
  );
  const pluginConfig = readRecord(
    readRecord((api as OpenClawPluginApi & { pluginConfig?: unknown }).pluginConfig)?.contextSnapshot,
  );
  const raw = {
    ...pluginConfig,
    ...entryConfig,
    ...channelConfig,
  };

  return {
    enabled: readBoolean(raw, "enabled", false),
    fileName: sanitizeFileName(readString(raw, "fileName", DEFAULT_FILE_NAME), DEFAULT_FILE_NAME),
    maxStringChars: readPositiveNumber(raw, "maxStringChars", DEFAULT_MAX_STRING_CHARS, 10_000),
    maxArrayItems: readPositiveNumber(raw, "maxArrayItems", DEFAULT_MAX_ARRAY_ITEMS, 1),
    includeHistoryMessages: readBoolean(raw, "includeHistoryMessages", true),
    includeTools: readBoolean(raw, "includeTools", true),
  };
}

async function writeContextSnapshot(
  api: OpenClawPluginApi,
  config: ContextSnapshotConfig,
  event: LlmInputEvent,
  ctx: LlmInputContext,
): Promise<void> {
  const runtime = api.runtime;
  const stateDir =
    typeof runtime?.state?.resolveStateDir === "function"
      ? runtime.state.resolveStateDir()
      : ".openclaw";
  const agentId = normalizeAgentId(ctx.agentId);
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });

  const snapshotPath = path.join(sessionsDir, config.fileName);
  await fs.writeFile(
    snapshotPath,
    `${JSON.stringify(buildSnapshot(config, event, ctx), null, 2)}\n`,
    "utf8",
  );
  logSnapshotPathOnce(api, snapshotPath);
}

function buildSnapshot(
  config: ContextSnapshotConfig,
  event: LlmInputEvent,
  ctx: LlmInputContext,
): Record<string, unknown> {
  const request = ctx.sessionKey
    ? resolveActiveSdkRequestBySessionKey(ctx.sessionKey)
    : undefined;
  return sanitizeForSnapshot(
    {
      schemaVersion: 1,
      type: "byai-channel.llm_input",
      capturedAt: new Date().toISOString(),
      runId: event.runId ?? ctx.runId,
      sessionId: event.sessionId ?? ctx.sessionId,
      sessionKey: ctx.sessionKey,
      agentId: ctx.agentId ?? "main",
      provider: event.provider,
      model: event.model,
      workspaceDir: ctx.workspaceDir,
      trigger: ctx.trigger,
      channelId: ctx.channelId,
      accountId: ctx.accountId,
      byai: request
        ? {
            accountId: request.accountId,
            sessionId: request.sessionId,
            traceId: request.traceId,
            language: request.language,
            channelExtension: request.channelExtension,
          }
        : undefined,
      imagesCount: event.imagesCount,
      sizes: {
        systemPromptChars: event.systemPrompt?.length ?? 0,
        promptChars: event.prompt?.length ?? 0,
        historyMessagesCount: Array.isArray(event.historyMessages)
          ? event.historyMessages.length
          : 0,
        toolsJsonChars: event.tools == null ? 0 : safeJsonLength(event.tools),
      },
      systemPrompt: event.systemPrompt,
      prompt: event.prompt,
      historyMessages: config.includeHistoryMessages ? event.historyMessages : undefined,
      tools: config.includeTools ? event.tools : undefined,
    },
    config,
  ) as Record<string, unknown>;
}

function sanitizeForSnapshot(value: unknown, config: ContextSnapshotConfig, depth = 0): unknown {
  if (typeof value === "string") {
    return truncateString(value, config.maxStringChars);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, config.maxArrayItems).map((item) =>
      sanitizeForSnapshot(item, config, depth + 1),
    );
    if (value.length > config.maxArrayItems) {
      items.push({
        __truncated: true,
        omittedItems: value.length - config.maxArrayItems,
      });
    }
    return items;
  }
  if (depth > 12) {
    return { __truncated: true, reason: "max_depth" };
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitizeForSnapshot(child, config, depth + 1);
  }
  return out;
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function normalizeAgentId(raw: unknown): string {
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : "main";
  return value.replace(/[\\/]/g, "_");
}

function sanitizeFileName(raw: string, fallback: string): string {
  const base = path.basename(raw.trim() || fallback);
  return base || fallback;
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

function logSnapshotPathOnce(api: OpenClawPluginApi, snapshotPath: string): void {
  const key = "__byaiContextSnapshotLoggedPaths";
  const globalState = globalThis as typeof globalThis & {
    [key]?: Set<string>;
  };
  const seen = globalState[key] ?? (globalState[key] = new Set<string>());
  if (seen.has(snapshotPath)) {
    return;
  }
  seen.add(snapshotPath);
  api.logger.info(`[byai-channel] context snapshot writing to ${snapshotPath}`);
}

function readBoolean(
  config: Record<string, unknown>,
  key: keyof ContextSnapshotConfig,
  fallback: boolean,
): boolean {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

function readString(
  config: Record<string, unknown>,
  key: keyof ContextSnapshotConfig,
  fallback: string,
): string {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readPositiveNumber(
  config: Record<string, unknown>,
  key: keyof ContextSnapshotConfig,
  fallback: number,
  minimum: number,
): number {
  const value = config[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    return fallback;
  }
  return Math.floor(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
