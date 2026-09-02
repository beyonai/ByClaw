import type { AdaptedManagedAgent } from "../agent-adapter.js";
import { rememberAimodelAuthToken } from "../aimodel-auth-cache.js";
import { decryptBaiyingAimodelAuthTokenSafely } from "../aimodel-token-crypto.js";
import type {
  BaiyingRedisJsonStore,
  RedisJsonReadResult,
} from "../redis-json-store.js";
import {
  ImageModelResolutionError,
  type ImageModelSource,
  type ResolvedImageModel,
} from "./types.js";

const IMAGE_MODEL_CONFIG_KEY = "byai:aimodel:config";
const IMAGE_MODEL_TYPELIST_KEY = "byai:aimodel:typelist";
const IMAGE_MODEL_TYPE = "IMAGE_GENERATION";
const DEFAULT_TIMEOUT_MS = 120_000;

type EmployeeConfig = {
  imageModelId?: unknown;
};

type ModelDto = {
  authToken?: unknown;
  instanceId?: unknown;
  instanceParam?: unknown;
  isDefault?: unknown;
  modelCode?: unknown;
  modelProtocol?: unknown;
  modelType?: unknown;
  providerName?: unknown;
  status?: unknown;
  url?: unknown;
};

export type ImageModelCache = {
  readonly bySelection: Map<string, ResolvedImageModel>;
  readonly byAgent: Map<string, ResolvedImageModel>;
};

export function createImageModelCache(): ImageModelCache {
  return {
    bySelection: new Map(),
    byAgent: new Map(),
  };
}

const sharedCaches = new WeakMap<BaiyingRedisJsonStore, ImageModelCache>();
const cacheOwners = new WeakMap<ImageModelCache, BaiyingRedisJsonStore>();

function cacheForStore(store: BaiyingRedisJsonStore): ImageModelCache {
  const existing = sharedCaches.get(store);
  if (existing) {
    return existing;
  }
  const cache = createImageModelCache();
  cacheOwners.set(cache, store);
  sharedCaches.set(store, cache);
  return cache;
}

function bindCacheToStore(
  cache: ImageModelCache | undefined,
  store: BaiyingRedisJsonStore,
): ImageModelCache {
  if (!cache) {
    return cacheForStore(store);
  }
  const owner = cacheOwners.get(cache);
  if (!owner) {
    cacheOwners.set(cache, store);
    return cache;
  }
  if (owner === store) {
    return cache;
  }
  const isolated = createImageModelCache();
  cacheOwners.set(isolated, store);
  return isolated;
}

function nonEmptyString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function numericValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseExtendParam(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      return plainRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return plainRecord(value);
}

function modelEnum(record: ModelDto, field: "providerName" | "modelProtocol"): string {
  const direct = nonEmptyString(record[field]);
  if (direct) {
    return direct.toUpperCase();
  }
  return nonEmptyString(plainRecord(record.instanceParam)[field]).toUpperCase();
}

function resolveTimeout(instanceParam: Record<string, unknown>): number {
  const seconds = numericValue(instanceParam.readTimeoutSec);
  return seconds && seconds > 0 ? Math.floor(seconds * 1_000) : DEFAULT_TIMEOUT_MS;
}

function validateModel(params: {
  raw: unknown;
  requestedModelId?: string;
  source: ImageModelSource;
}): ResolvedImageModel | null {
  const record = plainRecord(params.raw) as ModelDto;
  const status = numericValue(record.status);
  const modelType = nonEmptyString(record.modelType).toUpperCase();
  const provider = modelEnum(record, "providerName");
  const protocol = modelEnum(record, "modelProtocol");
  const modelId = params.requestedModelId || nonEmptyString(record.instanceId);
  const modelCode = nonEmptyString(record.modelCode);
  const endpoint = nonEmptyString(record.url);
  const apiToken = decryptBaiyingAimodelAuthTokenSafely(
    nonEmptyString(record.authToken),
  );
  if (
    status !== 1 ||
    modelType !== IMAGE_MODEL_TYPE ||
    !provider ||
    !protocol ||
    !modelId ||
    !modelCode ||
    !endpoint ||
    !apiToken
  ) {
    return null;
  }
  const instanceParam = plainRecord(record.instanceParam);
  return {
    modelId,
    modelCode,
    providerName: provider,
    modelProtocol: protocol,
    endpoint,
    apiToken,
    extendParam: parseExtendParam(instanceParam.extendParam),
    source: params.source,
    timeout: resolveTimeout(instanceParam),
  };
}

function isDefault(record: unknown): boolean {
  return numericValue(plainRecord(record).isDefault) === 1;
}

function unavailable(message: string): ImageModelResolutionError {
  return new ImageModelResolutionError("IMAGE_MODEL_UNAVAILABLE", message);
}

function notConfigured(message: string): ImageModelResolutionError {
  return new ImageModelResolutionError("IMAGE_MODEL_NOT_CONFIGURED", message);
}

async function readEmployee(params: {
  employee?: EmployeeConfig;
  agent?: Pick<AdaptedManagedAgent, "sourceKey">;
  store: BaiyingRedisJsonStore;
  cache: ImageModelCache;
}): Promise<EmployeeConfig | ResolvedImageModel> {
  if (params.employee) {
    return params.employee;
  }
  const sourceKey = params.agent?.sourceKey?.trim();
  if (!sourceKey) {
    return {};
  }
  let result: RedisJsonReadResult = { status: "transport-error" };
  if (params.store.getDigEmployeeJsonStrict) {
    try {
      result = await params.store.getDigEmployeeJsonStrict(sourceKey);
    } catch {
      result = { status: "transport-error" };
    }
  }
  if (result.status === "transport-error") {
    const cached = params.cache.byAgent.get(sourceKey);
    if (cached) {
      return cached;
    }
    throw unavailable("Image model configuration is temporarily unavailable");
  }
  if (result.status !== "ok") {
    params.cache.byAgent.delete(sourceKey);
    throw unavailable("Digital employee image model configuration is unavailable");
  }
  if (!result.value.raw || typeof result.value.raw !== "object" || Array.isArray(result.value.raw)) {
    params.cache.byAgent.delete(sourceKey);
    throw unavailable("Digital employee image model configuration is invalid");
  }
  return plainRecord(result.value.raw);
}

function isResolvedImageModel(value: EmployeeConfig | ResolvedImageModel): value is ResolvedImageModel {
  return "modelId" in value && "apiToken" in value && "source" in value;
}

async function resolveExplicit(params: {
  modelId: string;
  store: BaiyingRedisJsonStore;
  cache: ImageModelCache;
}): Promise<ResolvedImageModel> {
  const cacheKey = `employee:${params.modelId}`;
  let result: RedisJsonReadResult = { status: "transport-error" };
  if (params.store.getHashJsonStrict) {
    try {
      result = await params.store.getHashJsonStrict({
        key: IMAGE_MODEL_CONFIG_KEY,
        field: params.modelId,
      });
    } catch {
      result = { status: "transport-error" };
    }
  }
  if (result.status === "transport-error") {
    const cached = params.cache.bySelection.get(cacheKey);
    if (cached) {
      return cached;
    }
    throw unavailable("The selected image model is temporarily unavailable");
  }
  if (result.status !== "ok") {
    params.cache.bySelection.delete(cacheKey);
    rememberAimodelAuthToken({ modelId: params.modelId, token: null });
    throw unavailable("The selected image model is unavailable");
  }
  const resolved = validateModel({
    raw: result.value.raw,
    requestedModelId: params.modelId,
    source: "employee",
  });
  if (!resolved) {
    params.cache.bySelection.delete(cacheKey);
    rememberAimodelAuthToken({ modelId: params.modelId, token: null });
    throw unavailable("The selected image model is disabled or incompatible");
  }
  rememberAimodelAuthToken({ modelId: resolved.modelId, token: resolved.apiToken });
  params.cache.bySelection.set(cacheKey, resolved);
  return resolved;
}

async function resolveDefault(params: {
  store: BaiyingRedisJsonStore;
  cache: ImageModelCache;
}): Promise<ResolvedImageModel> {
  const cacheKey = "global-default";
  let result: RedisJsonReadResult = { status: "transport-error" };
  if (params.store.getHashJsonStrict) {
    try {
      result = await params.store.getHashJsonStrict({
        key: IMAGE_MODEL_TYPELIST_KEY,
        field: IMAGE_MODEL_TYPE,
      });
    } catch {
      result = { status: "transport-error" };
    }
  }
  if (result.status === "transport-error") {
    const cached = params.cache.bySelection.get(cacheKey);
    if (cached) {
      return cached;
    }
    throw unavailable("The global image model is temporarily unavailable");
  }
  if (result.status === "missing") {
    const previous = params.cache.bySelection.get(cacheKey);
    params.cache.bySelection.delete(cacheKey);
    if (previous) {
      rememberAimodelAuthToken({ modelId: previous.modelId, token: null });
    }
    throw notConfigured("No global image model is configured");
  }
  if (result.status === "malformed") {
    const previous = params.cache.bySelection.get(cacheKey);
    params.cache.bySelection.delete(cacheKey);
    if (previous) {
      rememberAimodelAuthToken({ modelId: previous.modelId, token: null });
    }
    throw unavailable("The global image model configuration is invalid");
  }
  const records = Array.isArray(result.value.raw) ? result.value.raw : [];
  const selected = records.find(isDefault);
  const resolved = selected
    ? validateModel({ raw: selected, source: "global-default" })
    : null;
  if (!resolved) {
    const previous = params.cache.bySelection.get(cacheKey);
    params.cache.bySelection.delete(cacheKey);
    if (previous) {
      rememberAimodelAuthToken({ modelId: previous.modelId, token: null });
    }
    throw unavailable("No usable global image model is configured");
  }
  rememberAimodelAuthToken({ modelId: resolved.modelId, token: resolved.apiToken });
  params.cache.bySelection.set(cacheKey, resolved);
  return resolved;
}

export async function resolveImageModel(params: {
  employee?: EmployeeConfig;
  agent?: Pick<AdaptedManagedAgent, "sourceKey">;
  store: BaiyingRedisJsonStore;
  cache?: ImageModelCache;
}): Promise<ResolvedImageModel> {
  const cache = bindCacheToStore(params.cache, params.store);
  const employee = await readEmployee({ ...params, cache });
  if (isResolvedImageModel(employee)) {
    return employee;
  }
  const explicitModelId = nonEmptyString(employee.imageModelId);
  const resolved = explicitModelId
    ? await resolveExplicit({ modelId: explicitModelId, store: params.store, cache })
    : await resolveDefault({ store: params.store, cache });
  const sourceKey = params.agent?.sourceKey?.trim();
  if (sourceKey) {
    cache.byAgent.set(sourceKey, resolved);
  }
  return resolved;
}
