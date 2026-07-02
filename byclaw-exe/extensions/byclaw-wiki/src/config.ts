import path from "node:path";
import type { ByclawWikiPluginConfig, ResolvedByclawWikiConfig } from "./types.js";
import { resolveDefaultDataDir, resolveOpenClawStateDir, expandPath } from "./paths.js";

export const byclawWikiConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dataDir: {
      type: "string",
      description: "Plugin data directory. Defaults to OPENCLAW_STATE_DIR/byclaw-wiki.",
    },
    gitCommand: { type: "string", default: "git" },
    codegraphCommand: { type: "string", default: "codegraph" },
    zreadCommand: {
      type: "string",
      description: "Zread CLI executable used by wiki_* modes.",
      default: "zread",
    },
    zreadHome: {
      type: "string",
      description: "Service-level HOME directory used when running zread. Defaults to <dataDir>/zread-home.",
    },
    commandTimeoutMs: { type: "number", default: 300000 },
    maxOutputBytes: { type: "number", default: 131072 },
    zreadTimeoutMs: {
      type: "number",
      description: "Timeout for zread generate/read status commands. Default 30 minutes.",
      default: 1800000,
    },
    zreadMaxOutputBytes: {
      type: "number",
      description: "Maximum zread command output captured per stream.",
      default: 262144,
    },
    redisHost: {
      type: "string",
      description: "Redis host for resolving Baiying AI model config. Defaults to REDIS_HOST.",
    },
    redisPort: {
      type: "number",
      description: "Redis port. Defaults to REDIS_PORT or 6379.",
    },
    redisUsername: {
      type: "string",
      description: "Redis username. Defaults to REDIS_USERNAME.",
    },
    redisPassword: {
      type: "string",
      description: "Redis password. Defaults to REDIS_PASSWORD.",
    },
    redisDatabase: {
      type: "number",
      description: "Redis database. Defaults to REDIS_DATABASE, REDIS_DB, or 0.",
    },
    redisConnectTimeoutMs: {
      type: "number",
      description: "Redis connection timeout for Zread model resolution.",
      default: 5000,
    },
    zreadAimodelEnabled: {
      type: "boolean",
      description: "Resolve the Zread LLM config from Baiying Redis AI model config before wiki_* operations.",
      default: true,
    },
    zreadAimodelConfigRedisKey: {
      type: "string",
      description: "Redis Hash key for Baiying AI model config.",
      default: "byai:aimodel:config",
    },
    zreadAimodelTypeListRedisKey: {
      type: "string",
      description: "Redis Hash key for Baiying AI model type list.",
      default: "byai:aimodel:typelist",
    },
    zreadAimodelTypeListField: {
      type: "string",
      description: "Redis typelist field used to select the default Zread LLM.",
      default: "LLM",
    },
    zreadAimodelModelId: {
      type: "string",
      description: "Optional explicit Baiying model id. When unset, the LLM typelist default is used.",
    },
    zreadAimodelProvider: {
      type: "string",
      description: "Optional Zread provider override. Defaults to instanceParam.zreadProvider or openai.",
    },
    zreadLlmProvider: {
      type: "string",
      description: "Fallback Zread LLM provider used when Redis model resolution fails.",
    },
    zreadLlmModel: {
      type: "string",
      description: "Fallback Zread LLM model used when Redis model resolution fails.",
    },
    zreadLlmBaseUrl: {
      type: "string",
      description: "Fallback Zread LLM base URL used when Redis model resolution fails.",
    },
    zreadLlmApiKey: {
      type: "string",
      description: "Fallback Zread LLM API key. Prefer zreadLlmApiKeyEnv when possible.",
    },
    zreadLlmApiKeyEnv: {
      type: "string",
      description: "Environment variable name containing the fallback Zread LLM API key.",
    },
    zreadMaxConcurrent: {
      type: "number",
      description: "Zread concurrency.max_concurrent written to config.yaml.",
      default: 1,
    },
    zreadMaxRetries: {
      type: "number",
      description: "Zread concurrency.max_retries written to config.yaml.",
      default: 0,
    },
    includeRawOutputInToolResult: {
      type: "boolean",
      description: "Whether code_to_wiki returns raw CodeGraph/Zread output to OpenClaw.",
      default: true,
    },
    gitDepth: {
      type: "number",
      description: "Default Git clone/fetch depth. Default 1 keeps only the latest commit.",
      default: 1,
    },
  },
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }
  return undefined;
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) {
    return Math.trunc(parsed);
  }
  return undefined;
}

function resolveConfiguredDataDir(value: unknown): string {
  const raw = readString(value, "");
  if (!raw) {
    return resolveDefaultDataDir();
  }
  if (raw.startsWith("~") || path.isAbsolute(raw)) {
    return expandPath(raw);
  }
  return path.join(resolveOpenClawStateDir(), raw);
}

function resolveConfiguredPath(value: unknown, fallback: string): string {
  const raw = readString(value, "");
  if (!raw) {
    return fallback;
  }
  if (raw.startsWith("~") || path.isAbsolute(raw)) {
    return expandPath(raw);
  }
  return path.join(resolveOpenClawStateDir(), raw);
}

export function resolveByclawWikiConfig(raw: unknown): ResolvedByclawWikiConfig {
  const config = isPlainRecord(raw) ? (raw as ByclawWikiPluginConfig) : {};
  const dataDir = resolveConfiguredDataDir(config.dataDir);

  return {
    dataDir,
    gitCommand: readString(config.gitCommand, "git"),
    codegraphCommand: readString(config.codegraphCommand, "codegraph"),
    zreadCommand: readString(config.zreadCommand, "zread"),
    zreadHome: resolveConfiguredPath(config.zreadHome, path.join(dataDir, "zread-home")),
    commandTimeoutMs: readPositiveInteger(config.commandTimeoutMs, 300000),
    maxOutputBytes: readPositiveInteger(config.maxOutputBytes, 128 * 1024),
    zreadTimeoutMs: readPositiveInteger(config.zreadTimeoutMs, 30 * 60 * 1000),
    zreadMaxOutputBytes: readPositiveInteger(config.zreadMaxOutputBytes, 256 * 1024),
    redisHost: readString(config.redisHost, process.env.REDIS_HOST ?? "") || undefined,
    redisPort: readOptionalPositiveInteger(config.redisPort) ?? readOptionalPositiveInteger(process.env.REDIS_PORT),
    redisUsername: readString(config.redisUsername, process.env.REDIS_USERNAME ?? "") || undefined,
    redisPassword: readString(config.redisPassword, process.env.REDIS_PASSWORD ?? "") || undefined,
    redisDatabase:
      readOptionalNonNegativeInteger(config.redisDatabase) ??
      readOptionalNonNegativeInteger(process.env.REDIS_DATABASE) ??
      readOptionalNonNegativeInteger(process.env.REDIS_DB),
    redisConnectTimeoutMs: readPositiveInteger(config.redisConnectTimeoutMs, 5000),
    zreadAimodelEnabled: readBoolean(config.zreadAimodelEnabled, true),
    zreadAimodelConfigRedisKey: readString(config.zreadAimodelConfigRedisKey, "byai:aimodel:config"),
    zreadAimodelTypeListRedisKey: readString(config.zreadAimodelTypeListRedisKey, "byai:aimodel:typelist"),
    zreadAimodelTypeListField: readString(config.zreadAimodelTypeListField, "LLM").toUpperCase(),
    zreadAimodelModelId: readString(config.zreadAimodelModelId, "") || undefined,
    zreadAimodelProvider: readString(config.zreadAimodelProvider, "") || undefined,
    zreadLlmProvider: readString(config.zreadLlmProvider, "") || undefined,
    zreadLlmModel: readString(config.zreadLlmModel, "") || undefined,
    zreadLlmBaseUrl: readString(config.zreadLlmBaseUrl, "") || undefined,
    zreadLlmApiKey: readString(config.zreadLlmApiKey, "") || undefined,
    zreadLlmApiKeyEnv: readString(config.zreadLlmApiKeyEnv, "") || undefined,
    zreadMaxConcurrent: readPositiveInteger(config.zreadMaxConcurrent, 1),
    zreadMaxRetries: readNonNegativeInteger(config.zreadMaxRetries, 0),
    includeRawOutputInToolResult: readBoolean(config.includeRawOutputInToolResult, true),
    gitDepth: readPositiveInteger(config.gitDepth, 1),
  };
}
