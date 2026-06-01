import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { TelemetryConfig } from "./types.js";

const CHANNEL_ID = "byai-channel";

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: true,
  consoleEnabled: false,
  redisEnabled: true,
  logIntervalMs: 30_000,
  activeRunMaxAgeMs: 30 * 60 * 1000,
  activeToolCallMaxAgeMs: 30 * 60 * 1000,
  activeSubagentMaxAgeMs: 2 * 60 * 60 * 1000,
  activeLeaseMs: 5 * 60 * 1000,
  cautiousLeaseMs: 2 * 60 * 1000,
  idleGraceMs: 60 * 1000,
  maxAgeMs: 30 * 60 * 1000,
};

export function resolveTelemetryConfig(params: {
  cfg?: OpenClawConfig | null;
  pluginConfig?: unknown;
}): TelemetryConfig {
  const channelConfig = readRecord(
    readRecord(params.cfg?.channels?.[CHANNEL_ID])?.telemetry,
  );
  const pluginConfig = readRecord(readRecord(params.pluginConfig)?.telemetry);
  const config = {
    ...pluginConfig,
    ...channelConfig,
  };

  return {
    enabled: readBoolean(config, "enabled", DEFAULT_TELEMETRY_CONFIG.enabled),
    consoleEnabled: readBoolean(config, "consoleEnabled", DEFAULT_TELEMETRY_CONFIG.consoleEnabled),
    redisEnabled: readBoolean(config, "redisEnabled", DEFAULT_TELEMETRY_CONFIG.redisEnabled),
    logIntervalMs: readPositiveNumber(config, "logIntervalMs", 1_000),
    activeRunMaxAgeMs: readPositiveNumber(config, "activeRunMaxAgeMs", 1_000),
    activeToolCallMaxAgeMs: readPositiveNumber(config, "activeToolCallMaxAgeMs", 1_000),
    activeSubagentMaxAgeMs: readPositiveNumber(config, "activeSubagentMaxAgeMs", 1_000),
    activeLeaseMs: readPositiveNumber(config, "activeLeaseMs", 1_000),
    cautiousLeaseMs: readPositiveNumber(config, "cautiousLeaseMs", 1_000),
    idleGraceMs: readNonNegativeNumber(config, "idleGraceMs"),
    maxAgeMs: readPositiveNumber(config, "maxAgeMs", 1_000),
  };
}

function readBoolean(
  config: Record<string, unknown>,
  key: keyof TelemetryConfig,
  fallback: boolean,
): boolean {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

function readPositiveNumber(
  config: Record<string, unknown>,
  key: keyof TelemetryConfig,
  minimum: number,
): number {
  const value = config[key];
  const fallback = DEFAULT_TELEMETRY_CONFIG[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    return typeof fallback === "number" ? fallback : minimum;
  }
  return Math.floor(value);
}

function readNonNegativeNumber(
  config: Record<string, unknown>,
  key: keyof TelemetryConfig,
): number {
  const value = config[key];
  const fallback = DEFAULT_TELEMETRY_CONFIG[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return typeof fallback === "number" ? fallback : 0;
  }
  return Math.floor(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
