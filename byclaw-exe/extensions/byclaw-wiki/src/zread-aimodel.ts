import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedByclawWikiConfig } from "./types.js";

type Logger = {
  warn(message: string): void;
};

type AiModelConfigRecord = {
  authToken?: unknown;
  instanceId?: unknown;
  instanceParam?: unknown;
  isDefault?: unknown;
  maxContentToken?: unknown;
  modelCode?: unknown;
  modelName?: unknown;
  modelType?: unknown;
  status?: unknown;
  url?: unknown;
};

type RedisLike = {
  hget(key: string, field: string): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
};

export type ZreadAimodelConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  modelName?: string;
  source: "redis" | "config";
  redisKey?: string;
  redisField?: string;
};

export type ZreadConfigSyncResult =
  | {
      ok: true;
      source: "redis" | "config";
      configPath: string;
      provider: string;
      model: string;
      baseUrl: string;
      redisKey?: string;
      redisField?: string;
    }
  | {
      ok: false;
      source: "none";
      configPath: string;
      error: string;
    };

function nonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return undefined;
}

function decodeMaybeJson(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return decodeMaybeJson(value.toString("utf8"));
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function recordFromMaybeJson(value: unknown): Record<string, unknown> {
  const parsed = decodeMaybeJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function modelIdFromRecord(record: AiModelConfigRecord): string {
  return nonEmptyString(record.instanceId) || nonEmptyString(record.modelCode);
}

function normalizeType(value: unknown): string {
  return nonEmptyString(value).toUpperCase();
}

function isUsableRecord(record: AiModelConfigRecord, modelType: string): boolean {
  const recordType = normalizeType(record.modelType);
  return (
    normalizeStatus(record.status) === 1 &&
    (recordType === modelType || (!recordType && modelType === "LLM"))
  );
}

function isDefaultRecord(record: AiModelConfigRecord): boolean {
  return normalizeStatus(record.isDefault) === 1;
}

function yamlScalar(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseRedisModelPayload(raw: unknown): unknown {
  const decoded = decodeMaybeJson(raw);
  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    const record = decoded as Record<string, unknown>;
    if ("raw" in record) {
      return decodeMaybeJson(record.raw);
    }
  }
  return decoded;
}

function resolveProvider(params: {
  config: ResolvedByclawWikiConfig;
  instanceParam: Record<string, unknown>;
  baseUrl: string;
  model: string;
}): string {
  if (params.config.zreadAimodelProvider) {
    return params.config.zreadAimodelProvider;
  }
  const candidates = [
    params.instanceParam.zreadProvider,
    params.instanceParam.zread_provider,
    params.instanceParam.provider,
    params.instanceParam.providerName,
    params.instanceParam.modelProtocol,
  ].map(nonEmptyString);
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (normalized === "bigmodel-coding-plan") {
      return "bigmodel-coding-plan";
    }
    if (normalized === "openrouter") {
      return "openrouter";
    }
    if (normalized === "openai" || normalized === "openai-completions" || normalized === "openai-responses") {
      return "openai";
    }
  }
  const haystack = `${params.baseUrl} ${params.model}`.toLowerCase();
  if (haystack.includes("openrouter")) {
    return "openrouter";
  }
  return "openai";
}

function buildZreadAimodelConfig(params: {
  record: AiModelConfigRecord;
  config: ResolvedByclawWikiConfig;
  redisKey: string;
  redisField: string;
}): ZreadAimodelConfig | null {
  if (normalizeStatus(params.record.status) !== 1) {
    return null;
  }
  const baseUrl = nonEmptyString(params.record.url);
  const model = nonEmptyString(params.record.modelCode);
  const apiKey = nonEmptyString(params.record.authToken);
  if (!baseUrl || !model || !apiKey) {
    return null;
  }
  const instanceParam = recordFromMaybeJson(params.record.instanceParam);
  return {
    provider: resolveProvider({ config: params.config, instanceParam, baseUrl, model }),
    model,
    apiKey,
    baseUrl,
    modelName: nonEmptyString(params.record.modelName) || model,
    source: "redis",
    redisKey: params.redisKey,
    redisField: params.redisField,
  };
}

async function createRedisClient(config: ResolvedByclawWikiConfig): Promise<RedisLike> {
  const module = await import("ioredis");
  const Redis = module.default;
  return new Redis({
    host: config.redisHost || "localhost",
    port: config.redisPort ?? 6379,
    username: config.redisUsername || undefined,
    password: config.redisPassword || undefined,
    db: config.redisDatabase ?? 0,
    maxRetriesPerRequest: 2,
    connectTimeout: config.redisConnectTimeoutMs,
  }) as unknown as RedisLike;
}

async function closeRedis(client: RedisLike): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

async function resolveExplicitModel(params: {
  client: RedisLike;
  config: ResolvedByclawWikiConfig;
}): Promise<ZreadAimodelConfig | null> {
  const modelId = params.config.zreadAimodelModelId?.trim();
  if (!modelId) {
    return null;
  }
  const redisKey = params.config.zreadAimodelConfigRedisKey;
  const raw = await params.client.hget(redisKey, modelId);
  const payload = parseRedisModelPayload(raw);
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as AiModelConfigRecord)
    : undefined;
  return record
    ? buildZreadAimodelConfig({ record, config: params.config, redisKey, redisField: modelId })
    : null;
}

async function resolveDefaultModel(params: {
  client: RedisLike;
  config: ResolvedByclawWikiConfig;
  logger: Logger;
}): Promise<ZreadAimodelConfig | null> {
  const redisKey = params.config.zreadAimodelTypeListRedisKey;
  const redisField = params.config.zreadAimodelTypeListField;
  const raw = await params.client.hget(redisKey, redisField);
  const payload = parseRedisModelPayload(raw);
  if (!Array.isArray(payload)) {
    return null;
  }
  const records = payload.filter((item): item is AiModelConfigRecord => {
    return !!item && typeof item === "object" && !Array.isArray(item);
  });
  const usable = records.filter((record) => isUsableRecord(record, redisField));
  const defaults = usable.filter(isDefaultRecord);
  if (defaults.length > 1) {
    params.logger.warn(
      `byclaw-wiki: Redis ${redisField} typelist has ${defaults.length} models with isDefault=1; using the first marked entry.`,
    );
  }
  const selected = defaults[0] ?? usable[0];
  if (!selected) {
    return null;
  }
  if (!defaults[0]) {
    params.logger.warn(
      `byclaw-wiki: Redis ${redisField} typelist has no isDefault=1 entry; falling back to first usable model (${modelIdFromRecord(selected) || "unknown"}).`,
    );
  }
  return buildZreadAimodelConfig({
    record: selected,
    config: params.config,
    redisKey,
    redisField,
  });
}

export async function resolveZreadAimodelConfig(params: {
  config: ResolvedByclawWikiConfig;
  logger: Logger;
}): Promise<ZreadAimodelConfig | null> {
  if (!params.config.zreadAimodelEnabled) {
    return null;
  }
  const client = await createRedisClient(params.config);
  try {
    return (
      await resolveExplicitModel({ client, config: params.config })
    ) ?? await resolveDefaultModel({ client, config: params.config, logger: params.logger });
  } finally {
    await closeRedis(client);
  }
}

export function resolveZreadFallbackConfig(params: {
  config: ResolvedByclawWikiConfig;
}): ZreadAimodelConfig | null {
  const apiKeyFromEnv = params.config.zreadLlmApiKeyEnv
    ? process.env[params.config.zreadLlmApiKeyEnv]?.trim()
    : undefined;
  const apiKey = apiKeyFromEnv || params.config.zreadLlmApiKey?.trim();
  if (!params.config.zreadLlmProvider || !params.config.zreadLlmModel || !params.config.zreadLlmBaseUrl || !apiKey) {
    return null;
  }
  return {
    provider: params.config.zreadLlmProvider,
    model: params.config.zreadLlmModel,
    apiKey,
    baseUrl: params.config.zreadLlmBaseUrl,
    modelName: params.config.zreadLlmModel,
    source: "config",
  };
}

export function zreadConfigPath(zreadHome: string): string {
  return path.join(zreadHome, ".zread", "config.yaml");
}

export function zreadLoginPath(zreadHome: string): string {
  return path.join(zreadHome, ".zread", "login.json");
}

export async function writeZreadConfig(params: {
  config: ResolvedByclawWikiConfig;
  model: ZreadAimodelConfig;
}): Promise<string> {
  const configPath = zreadConfigPath(params.config.zreadHome);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const content = [
    "llm:",
    `    provider: ${yamlScalar(params.model.provider)}`,
    `    model: ${yamlScalar(params.model.model)}`,
    `    api_key: ${yamlScalar(params.model.apiKey)}`,
    `    base_url: ${yamlScalar(params.model.baseUrl)}`,
    "concurrency:",
    `    max_concurrent: ${params.config.zreadMaxConcurrent}`,
    `    max_retries: ${params.config.zreadMaxRetries}`,
    "",
  ].join("\n");
  await fs.writeFile(configPath, content, { encoding: "utf8", mode: 0o600 });
  return configPath;
}

export async function syncZreadConfig(params: {
  config: ResolvedByclawWikiConfig;
  logger: Logger;
}): Promise<ZreadConfigSyncResult> {
  const configPath = zreadConfigPath(params.config.zreadHome);
  let redisError = "";
  try {
    const model = await resolveZreadAimodelConfig(params);
    if (model) {
      await writeZreadConfig({ config: params.config, model });
      return {
        ok: true,
        source: model.source,
        configPath,
        provider: model.provider,
        model: model.model,
        baseUrl: model.baseUrl,
        redisKey: model.redisKey || undefined,
        redisField: model.redisField || undefined,
      };
    }
    redisError = params.config.zreadAimodelEnabled
      ? "No active Redis AI model config found for Zread."
      : "Redis AI model resolution is disabled.";
  } catch (error) {
    redisError = error instanceof Error ? error.message : String(error);
  }

  const fallback = resolveZreadFallbackConfig({ config: params.config });
  if (fallback) {
    await writeZreadConfig({ config: params.config, model: fallback });
    return {
      ok: true,
      source: "config",
      configPath,
      provider: fallback.provider,
      model: fallback.model,
      baseUrl: fallback.baseUrl,
    };
  }

  return {
    ok: false,
    source: "none",
    configPath,
    error: `${redisError} No fallback Zread LLM config is complete.`,
  };
}
