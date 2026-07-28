import type { ProviderBundle } from "./agent-adapter.js";
import { rememberAimodelAuthToken } from "./aimodel-auth-cache.js";
import { decryptBaiyingAimodelAuthTokenSafely } from "./aimodel-token-crypto.js";
import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";
import { MANAGED_PROVIDER_PREFIX } from "./types.js";

export const DEFAULT_AIMODEL_CONFIG_REDIS_KEY = "byai:aimodel:config";
export const DEFAULT_AIMODEL_TYPELIST_REDIS_KEY = "byai:aimodel:typelist";
export const DEFAULT_AIMODEL_TYPELIST_FIELD = "LLM";
export const DEFAULT_AIMODEL_SECRET_PROVIDER_NAME = "baiying-aimodel-redis";

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

const text = (value: unknown): string => typeof value === "string" && value.trim() ? value.trim() : "";
const positiveInt = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};
const active = (value: unknown): boolean => value === true || value === 1 || text(value) === "1" || text(value).toUpperCase() === "ENABLED";

function normalizeProviderPart(value: string): string {
  const raw = value.trim();
  const encoded = raw.startsWith("-") ? `neg-${raw.slice(1)}` : raw;
  return encoded.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function providerKeyForBaiyingModelId(modelId: string): string {
  return `${MANAGED_PROVIDER_PREFIX}${normalizeProviderPart(modelId)}`;
}

export function encodeBaiyingAimodelSecretRefId(modelId: string): string {
  return `model:${modelId.trim()}`;
}

export function decodeBaiyingAimodelSecretRefId(id: string): string {
  const value = id.trim();
  return value.startsWith("model:") ? value.slice("model:".length) : value;
}

export function resolveAimodelConfigRedisKey(value: unknown): string {
  return text(value) || DEFAULT_AIMODEL_CONFIG_REDIS_KEY;
}

export function resolveAimodelTypeListRedisKey(value: unknown): string {
  return text(value) || DEFAULT_AIMODEL_TYPELIST_REDIS_KEY;
}

export function resolveAimodelTypeListField(value: unknown): string {
  return text(value).toUpperCase() || DEFAULT_AIMODEL_TYPELIST_FIELD;
}

export function resolveAimodelSecretProviderName(value: unknown): string {
  const candidate = text(value);
  return /^[a-z][a-z0-9_-]{0,63}$/.test(candidate) ? candidate : DEFAULT_AIMODEL_SECRET_PROVIDER_NAME;
}

function providerApi(instanceParam: Record<string, unknown>): ProviderBundle["api"] {
  const name = text(instanceParam.providerName || instanceParam.modelProtocol).toLowerCase();
  if (name === "anthropic") return "anthropic-messages";
  if (name === "openai-responses" || name === "openai responses" || name === "responses") return "openai-responses";
  return "openai-completions";
}

function inputTypes(instanceParam: Record<string, unknown>): Array<"text" | "image"> {
  const abilities = Array.isArray(instanceParam.abilities) ? instanceParam.abilities.map(String) : [];
  return abilities.includes("7") ? ["text", "image"] : ["text"];
}

function modelIdFromRecord(raw: AimodelRecord): string {
  return text(raw.instanceId) || text(raw.modelCode);
}

function tokenFromRecord(raw: AimodelRecord): string | null {
  const value = text(raw.authToken);
  return value ? decryptBaiyingAimodelAuthTokenSafely(value) : null;
}

export function parseBaiyingAimodelProviderBundle(params: {
  payload: RedisJsonPayload;
  modelId: string;
  secretProviderName: string;
}): ProviderBundle | null {
  const raw = params.payload.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as AimodelRecord;
  const baseUrl = text(record.url);
  const modelCode = text(record.modelCode);
  const instanceParam = record.instanceParam && typeof record.instanceParam === "object" && !Array.isArray(record.instanceParam)
    ? record.instanceParam as Record<string, unknown>
    : {};
  if (!active(record.status) || !baseUrl || !modelCode || !text(record.authToken)) return null;
  return {
    baseUrl,
    apiKey: {
      source: "exec",
      provider: resolveAimodelSecretProviderName(params.secretProviderName),
      id: encodeBaiyingAimodelSecretRefId(params.modelId),
    },
    api: providerApi(instanceParam),
    modelId: modelCode,
    modelName: text(record.modelName) || modelCode,
    contextWindow: positiveInt(record.maxContentToken) ?? 128000,
    maxTokens: positiveInt(instanceParam.maxTokens) ?? 8192,
    input: inputTypes(instanceParam),
    reasoning: active(instanceParam.reasoningEnabled ?? instanceParam.reasoning),
  };
}

export type ResolvedAimodelBundle = {
  providerKey: string;
  modelRef: string;
  provider: ProviderBundle;
  hash: string;
  modelId: string;
};

function resolvedBundle(payload: RedisJsonPayload, modelId: string, secretProviderName: string): ResolvedAimodelBundle | null {
  const provider = parseBaiyingAimodelProviderBundle({ payload, modelId, secretProviderName });
  if (!provider) return null;
  rememberAimodelAuthToken({ modelId, token: tokenFromRecord(payload.raw as AimodelRecord) });
  const providerKey = providerKeyForBaiyingModelId(modelId);
  return { providerKey, modelRef: `${providerKey}/${provider.modelId}`, provider, hash: payload.hash, modelId };
}

export async function resolveDefaultBaiyingAimodelProviderBundle(params: {
  redisJsonStore: BaiyingRedisJsonStore;
  redisKey?: string;
  modelType?: string;
  secretProviderName: string;
  log: { warn: (message: string) => void; info?: (message: string) => void };
}): Promise<ResolvedAimodelBundle | null> {
  const key = resolveAimodelTypeListRedisKey(params.redisKey);
  const field = resolveAimodelTypeListField(params.modelType);
  const payload = await params.redisJsonStore.getHashJson?.({ key, field });
  if (!payload || !Array.isArray(payload.raw)) {
    params.log.warn(`baiying-enhance: Redis AI model typelist missing or invalid key=${key} field=${field}`);
    return null;
  }
  const usable = payload.raw.filter((item): item is AimodelRecord => Boolean(item && typeof item === "object" && active((item as AimodelRecord).status) && (!text((item as AimodelRecord).modelType) || text((item as AimodelRecord).modelType).toUpperCase() === field)));
  const marked = usable.filter((item) => active(item.isDefault));
  if (marked.length > 1) {
    params.log.warn(
      `baiying-enhance: Redis AI model typelist has ${marked.length} active ${field} defaults; selecting the first one to match develop behavior`,
    );
  }
  const selected = marked[0] ?? usable[0];
  if (!selected) {
    params.log.warn(`baiying-enhance: Redis AI model typelist has no active ${field} model`);
    return null;
  }
  const modelId = modelIdFromRecord(selected);
  if (!modelId) {
    params.log.warn(`baiying-enhance: Redis AI model typelist default ${field} has no instanceId/modelCode`);
    return null;
  }
  const result = resolvedBundle({ ...payload, raw: selected }, modelId, params.secretProviderName);
  if (!result) params.log.warn(`baiying-enhance: Redis AI model typelist default ${field} is invalid modelId=${modelId}`);
  if (result) params.log.info?.(`baiying-enhance: Redis default ${field} model resolved to ${result.modelRef}`);
  return result;
}

export async function resolveBaiyingAimodelProvidersFromTypeList(params: {
  redisJsonStore: BaiyingRedisJsonStore;
  redisKey?: string;
  modelType?: string;
  secretProviderName: string;
  log: { warn: (message: string) => void };
}): Promise<ResolvedAimodelBundle[]> {
  const key = resolveAimodelTypeListRedisKey(params.redisKey);
  const field = resolveAimodelTypeListField(params.modelType);
  const payload = await params.redisJsonStore.getHashJson?.({ key, field });
  if (!payload || !Array.isArray(payload.raw)) return [];
  const output: ResolvedAimodelBundle[] = [];
  for (const item of payload.raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as AimodelRecord;
    const modelId = modelIdFromRecord(record);
    if (!modelId || (!text(record.modelType) || text(record.modelType).toUpperCase() === field) === false) continue;
    const result = resolvedBundle({ ...payload, raw: record }, modelId, params.secretProviderName);
    if (result) output.push(result);
  }
  return output;
}

export function readAuthTokenFromAimodelPayload(payload: RedisJsonPayload | null): string | null {
  if (!payload?.raw || typeof payload.raw !== "object" || Array.isArray(payload.raw)) return null;
  return tokenFromRecord(payload.raw as AimodelRecord);
}

export function readAuthTokenFromAimodelTypeListPayload(
  payload: RedisJsonPayload | null,
  modelId: string,
): string | null {
  if (!Array.isArray(payload?.raw)) return null;
  const record = payload.raw.find((item): item is AimodelRecord => Boolean(item && typeof item === "object" && modelIdFromRecord(item as AimodelRecord) === modelId));
  return record ? tokenFromRecord(record) : null;
}
