import { createDecipheriv } from "node:crypto";
import type {
  LlmProviderConfig,
  LlmReasoningConfig,
} from "@byclaw/by-conductor";
import type {
  DeepSeekEnvironmentFallback,
  LlmProviderLogger,
  LlmProviderResolution,
  RedisHashReader,
} from "./types.js";

export const DEFAULT_AIMODEL_TYPELIST_REDIS_KEY = "byai:aimodel:typelist";
export const DEFAULT_AIMODEL_TYPELIST_FIELD = "LLM";
export const DEFAULT_AIMODEL_CONFIG_REDIS_KEY = "byai:aimodel:config";
export const AIMODEL_AUTH_TOKEN_SM4_KEY_HEX_ENV =
  "BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX";

type AimodelRecord = {
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

type ReasoningConfig = {
  enabled?: unknown;
  capability?: unknown;
  defaultLevel?: unknown;
  compatFormat?: unknown;
  supportedEfforts?: unknown;
  effortMap?: unknown;
  budgets?: unknown;
};

export class RedisFirstLlmProvider {
  readonly #redis: RedisHashReader;
  readonly #fallback: DeepSeekEnvironmentFallback;
  readonly #logger: LlmProviderLogger;
  readonly #redisKey: string;
  readonly #modelConfigRedisKey: string;
  readonly #sm4KeyHex: string | undefined;

  constructor(options: {
    redis: RedisHashReader;
    fallback: DeepSeekEnvironmentFallback;
    logger: LlmProviderLogger;
    redisKey?: string;
    modelConfigRedisKey?: string;
    sm4KeyHex?: string;
  }) {
    this.#redis = options.redis;
    this.#fallback = options.fallback;
    this.#logger = options.logger;
    this.#redisKey = nonEmptyString(options.redisKey) || DEFAULT_AIMODEL_TYPELIST_REDIS_KEY;
    this.#modelConfigRedisKey =
      nonEmptyString(options.modelConfigRedisKey) || DEFAULT_AIMODEL_CONFIG_REDIS_KEY;
    this.#sm4KeyHex = options.sm4KeyHex;
  }

  async resolve(): Promise<LlmProviderResolution> {
    try {
      const config = await this.#resolveRedisDefault();
      this.#logger.info(
        `byclaw-super: using Redis default LLM ${config.providerId}/${config.modelId}`,
      );
      return { source: "redis", config };
    } catch (error) {
      this.#logger.warn(
        `byclaw-super: Redis default LLM unavailable, falling back to environment DeepSeek: ${errorMessage(error)}`,
      );
      const config = buildDeepSeekEnvironmentProvider(this.#fallback);
      this.#logger.info(
        `byclaw-super: using environment fallback LLM ${config.providerId}/${config.modelId}`,
      );
      return { source: "environment", config };
    }
  }

  /** 按 BE 返回的模型实例主键解析运行配置；该路径不允许静默回退到默认模型。 */
  async resolveByModelId(modelId: string): Promise<LlmProviderConfig> {
    const normalizedModelId = requiredString(modelId, "modelId");
    const raw = await this.#redis.hget(this.#modelConfigRedisKey, normalizedModelId);
    if (raw === null) {
      throw new Error(
        `missing Redis hash field ${this.#modelConfigRedisKey}:${normalizedModelId}`,
      );
    }
    const parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("Redis model config must be a JSON object");
    }
    const record = parsed as AimodelRecord;
    if (normalizeNumber(record.status) !== 1) {
      throw new Error(`Redis model config is not active: ${normalizedModelId}`);
    }
    return buildRedisProvider(record, this.#sm4KeyHex);
  }

  async #resolveRedisDefault(): Promise<LlmProviderConfig> {
    const raw = await this.#redis.hget(this.#redisKey, DEFAULT_AIMODEL_TYPELIST_FIELD);
    if (raw === null) {
      throw new Error(
        `missing Redis hash field ${this.#redisKey}:${DEFAULT_AIMODEL_TYPELIST_FIELD}`,
      );
    }
    const parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Redis LLM typelist must be a JSON array");
    }
    const records = parsed.filter(isRecord).map((item) => item as AimodelRecord);
    const usable = records.filter(
      (record) =>
        normalizeNumber(record.status) === 1 &&
        (!nonEmptyString(record.modelType) ||
          nonEmptyString(record.modelType).toUpperCase() === DEFAULT_AIMODEL_TYPELIST_FIELD),
    );
    const marked = usable.filter((record) => normalizeDefault(record.isDefault) === 1);
    if (marked.length > 1) {
      this.#logger.warn(
        `byclaw-super: Redis LLM typelist has ${marked.length} active defaults; using the first marked entry`,
      );
    }
    const selected = marked[0] ?? usable[0];
    if (!selected) {
      throw new Error("Redis LLM typelist has no active model");
    }
    if (marked.length === 0) {
      this.#logger.warn(
        "byclaw-super: Redis LLM typelist has no isDefault=1 entry; using the first active model",
      );
    }
    return buildRedisProvider(selected, this.#sm4KeyHex);
  }
}

export function buildDeepSeekEnvironmentProvider(
  fallback: DeepSeekEnvironmentFallback,
): LlmProviderConfig {
  const providerId = requiredString(fallback.providerId, "PI_PROVIDER");
  const modelId = requiredString(fallback.modelId, "PI_MODEL");
  const baseUrl = requiredString(fallback.baseUrl, "ARK_BASE_URL");
  const apiKey = requiredString(fallback.apiKey, "ARK_API_KEY");
  return {
    providerId,
    providerName: "Volcengine Ark",
    modelId,
    modelName: "DeepSeek V4 Pro 260425",
    baseUrl,
    apiKey,
    authHeader: true,
    protocol: "openai-responses",
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: {
      enabled: true,
      capability: "effort",
      defaultLevel: "medium",
      supportedEfforts: ["low", "medium", "high"],
    },
  };
}

export function buildRedisProvider(
  record: AimodelRecord,
  sm4KeyHex = process.env[AIMODEL_AUTH_TOKEN_SM4_KEY_HEX_ENV],
): LlmProviderConfig {
  const instanceId = requiredString(
    nonEmptyString(record.instanceId) || record.modelCode,
    "instanceId/modelCode",
  );
  const modelId = requiredString(record.modelCode, "modelCode");
  const modelName = nonEmptyString(record.modelName) || modelId;
  const baseUrl = requiredString(record.url, "url");
  const encryptedToken = requiredString(record.authToken, "authToken");
  const apiKey = decryptAuthToken(encryptedToken, sm4KeyHex);
  const instanceParam = parseObject(record.instanceParam);
  const protocol = resolveApi(instanceParam);
  const reasoning = resolveReasoning(instanceParam.reasoningConfig);
  const providerId = `baiying-m-${normalizeProviderKeyPart(instanceId)}`;
  return {
    providerId,
    providerName: nonEmptyString(instanceParam.providerName) || modelName,
    modelId,
    modelName,
    baseUrl,
    apiKey,
    authHeader: protocol !== "anthropic-messages",
    protocol,
    input: resolveInput(instanceParam.abilities),
    contextWindow: positiveInt(record.maxContentToken) ?? 128_000,
    maxTokens: positiveInt(instanceParam.maxTokens) ?? 8_192,
    reasoning,
  };
}

function resolveApi(instanceParam: Record<string, unknown>) {
  for (const value of [instanceParam.providerName, instanceParam.modelProtocol]) {
    const protocol = nonEmptyString(value).toLowerCase();
    if (protocol === "anthropic") {
      return "anthropic-messages" as const;
    }
    if (["openai-responses", "openai responses", "responses"].includes(protocol)) {
      return "openai-responses" as const;
    }
    if (protocol === "openai") {
      return "openai-completions" as const;
    }
  }
  return "openai-completions" as const;
}

function resolveReasoning(
  raw: unknown,
): LlmReasoningConfig {
  const config = parseObject(raw) as ReasoningConfig;
  const capability = nonEmptyString(config.capability).toLowerCase();
  const enabled = normalizeBoolean(config.enabled) && capability !== "unsupported";
  if (!enabled) {
    return { enabled: false };
  }
  const budgets = normalizeThinkingBudgets(config.budgets);
  return {
    enabled: true,
    ...(capability ? { capability } : {}),
    defaultLevel: nonEmptyString(config.defaultLevel).toLowerCase() || "medium",
    supportedEfforts: normalizeStringArray(config.supportedEfforts),
    effortMap: normalizeStringMap(config.effortMap),
    ...(budgets ? { budgets } : {}),
    ...(nonEmptyString(config.compatFormat)
      ? { compatFormat: nonEmptyString(config.compatFormat).toLowerCase() }
      : {}),
  };
}

function resolveInput(raw: unknown): Array<"text" | "image"> {
  const abilities = Array.isArray(raw) ? raw.map(String) : [];
  return abilities.includes("7") ? ["text", "image"] : ["text"];
}

function decryptAuthToken(token: string, rawKeyHex?: string): string {
  const keyHex = nonEmptyString(rawKeyHex);
  if (!/^[0-9a-fA-F]{32}$/.test(keyHex)) {
    return token;
  }
  try {
    const cipherText = Buffer.from(token, "base64");
    if (cipherText.length === 0 || cipherText.length % 16 !== 0) {
      return token;
    }
    const decipher = createDecipheriv("sm4-ecb", Buffer.from(keyHex, "hex"), null);
    const plainText = Buffer.concat([decipher.update(cipherText), decipher.final()])
      .toString("utf8")
      .trim();
    return plainText || token;
  } catch {
    return token;
  }
}

function normalizeThinkingBudgets(raw: unknown) {
  const input = parseObject(raw);
  const budgets: { minimal?: number; low?: number; medium?: number; high?: number } = {};
  for (const level of ["minimal", "low", "medium", "high"] as const) {
    const value = positiveInt(input[level]);
    if (value) budgets[level] = value;
  }
  return Object.keys(budgets).length > 0 ? budgets : undefined;
}


function normalizeProviderKeyPart(value: string): string {
  const withoutMinus = value.trim().startsWith("-") ? `neg-${value.trim().slice(1)}` : value.trim();
  return (
    withoutMinus
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => nonEmptyString(item).toLowerCase()).filter(Boolean))]
    : [];
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const input = parseObject(value);
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, item]) => [key.toLowerCase(), nonEmptyString(item)] as const)
      .filter((entry) => Boolean(entry[1])),
  );
}

function positiveInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(nonEmptyString(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(nonEmptyString(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDefault(value: unknown): number | undefined {
  return typeof value === "boolean" ? (value ? 1 : 0) : normalizeNumber(value);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = nonEmptyString(value).toLowerCase();
  return normalized === "true" || normalized === "1" || value === 1;
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function requiredString(value: unknown, name: string): string {
  const resolved = nonEmptyString(value);
  if (!resolved) throw new Error(`${name} must not be empty`);
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
