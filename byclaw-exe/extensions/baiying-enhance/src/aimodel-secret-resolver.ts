import {
  DEFAULT_AIMODEL_TYPELIST_FIELD,
  readAuthTokenFromAimodelPayload,
  readAuthTokenFromAimodelTypeListPayload,
  resolveAimodelConfigRedisKey,
  resolveAimodelTypeListRedisKey,
} from "./aimodel-config.js";
import { rememberAimodelAuthToken } from "./aimodel-auth-cache.js";
import { loadBaiyingRedisEnvDefaults } from "./redis-env.js";
import { createRedisJsonStore, type BaiyingRedisJsonStore } from "./redis-json-store.js";

export type AimodelSecretResolverResponse = {
  protocolVersion: 1;
  values: Record<string, string>;
  errors?: Record<string, { message: string }>;
};

function parseRequest(raw: string): string[] {
  const parsed = JSON.parse(raw) as { protocolVersion?: unknown; ids?: unknown };
  if (parsed.protocolVersion !== 1 || !Array.isArray(parsed.ids)) {
    throw new Error("protocolVersion must be 1 and ids must be an array");
  }
  return parsed.ids.map((id) => String(id ?? "").trim()).filter(Boolean);
}

export async function resolveAimodelSecretRequest(params: {
  request: string;
  redisJsonStore: BaiyingRedisJsonStore;
  redisKey?: string;
  typeListRedisKey?: string;
}): Promise<AimodelSecretResolverResponse> {
  const ids = parseRequest(params.request);
  const values: Record<string, string> = {};
  const errors: Record<string, { message: string }> = {};
  const redisKey = resolveAimodelConfigRedisKey(params.redisKey);
  const typeListKey = resolveAimodelTypeListRedisKey(params.typeListRedisKey);
  let typelistPayload: Awaited<ReturnType<NonNullable<BaiyingRedisJsonStore["getHashJson"]>>> | null = null;

  for (const id of ids) {
    const modelId = id.startsWith("model:") ? id.slice("model:".length) : id;
    const modelPayload = await params.redisJsonStore.getHashJson?.({ key: redisKey, field: modelId });
    let token = readAuthTokenFromAimodelPayload(modelPayload ?? null);
    if (!token) {
      typelistPayload ??= await params.redisJsonStore.getHashJson?.({ key: typeListKey, field: DEFAULT_AIMODEL_TYPELIST_FIELD }) ?? null;
      token = readAuthTokenFromAimodelTypeListPayload(typelistPayload, modelId);
    }
    if (token) {
      values[id] = token;
      rememberAimodelAuthToken({ modelId, token });
    } else {
      errors[id] = { message: `AI model config missing or invalid for id ${modelId}` };
      rememberAimodelAuthToken({ modelId, token: null });
    }
  }
  return Object.keys(errors).length > 0 ? { protocolVersion: 1, values, errors } : { protocolVersion: 1, values };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

export async function runAimodelSecretResolverCli(): Promise<void> {
  loadBaiyingRedisEnvDefaults({ logger: { warn: (message) => console.error(message) } });
  const store = createRedisJsonStore({ logger: { warn: (message) => console.error(message), error: (message) => console.error(message) } });
  try {
    const response = await resolveAimodelSecretRequest({
      request: await readStdin(),
      redisJsonStore: store,
      redisKey: process.env.BAIYING_AIMODEL_CONFIG_REDIS_KEY,
      typeListRedisKey: process.env.BAIYING_AIMODEL_TYPELIST_REDIS_KEY,
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    await store.close();
  }
}
