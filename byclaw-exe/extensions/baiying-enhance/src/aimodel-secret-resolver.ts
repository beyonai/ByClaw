import {
    DEFAULT_AIMODEL_TYPELIST_FIELD,
    decodeBaiyingAimodelSecretRefId,
    readAuthTokenFromAimodelPayload,
    readAuthTokenFromAimodelTypeListPayload,
    resolveAimodelConfigRedisKey,
    resolveAimodelTypeListRedisKey,
} from "./aimodel-config.js";
import { rememberAimodelAuthToken } from "./aimodel-auth-cache.js";
import { loadBaiyingRedisEnvDefaults } from "./redis-env.js";
import { createRedisJsonStore, type BaiyingRedisJsonStore } from "./redis-json-store.js";

type ExecSecretResolverRequest = {
    protocolVersion?: unknown;
    ids?: unknown;
};

export type ExecSecretResolverResponse = {
    protocolVersion: 1;
    values: Record<string, string>;
    errors?: Record<string, { message: string }>;
};

function parseRequest(raw: string): { ids: string[] } {
    const parsed = JSON.parse(raw) as ExecSecretResolverRequest;
    if (parsed.protocolVersion !== 1) {
        throw new Error("protocolVersion must be 1");
    }
    if (!Array.isArray(parsed.ids)) {
        throw new Error("ids must be an array");
    }
    return {
        ids: parsed.ids.map((id) => String(id ?? "").trim()).filter(Boolean),
    };
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString("utf8");
}

export async function resolveAimodelSecretRequest(params: {
    request: string;
    redisJsonStore: BaiyingRedisJsonStore;
    redisKey?: string;
    typeListRedisKey?: string;
}): Promise<ExecSecretResolverResponse> {
    const request = parseRequest(params.request);
    const values: Record<string, string> = {};
    const errors: Record<string, { message: string }> = {};
    const redisKey = resolveAimodelConfigRedisKey(params.redisKey);
    const typeListRedisKey = resolveAimodelTypeListRedisKey(params.typeListRedisKey);

    for (const id of request.ids) {
        const modelId = decodeBaiyingAimodelSecretRefId(id);
        const payload = await params.redisJsonStore.getHashJson?.({
            key: redisKey,
            field: modelId,
        });
        let token = readAuthTokenFromAimodelPayload(payload ?? null);
        if (!token) {
            const typeListPayload = await params.redisJsonStore.getHashJson?.({
                key: typeListRedisKey,
                field: DEFAULT_AIMODEL_TYPELIST_FIELD,
            });
            token = readAuthTokenFromAimodelTypeListPayload(typeListPayload ?? null, modelId);
        }
        if (token) {
            values[id] = token;
            rememberAimodelAuthToken({ modelId, token });
        } else {
            rememberAimodelAuthToken({ modelId, token: null });
            errors[id] = { message: `AI model config missing or invalid for id ${id}` };
        }
    }

    return Object.keys(errors).length > 0
        ? { protocolVersion: 1, values, errors }
        : { protocolVersion: 1, values };
}

export async function runAimodelSecretResolverCli(): Promise<void> {
    loadBaiyingRedisEnvDefaults({
        logger: {
            info: (message) => console.error(message),
            warn: (message) => console.error(message),
        },
    });
    const store = createRedisJsonStore({
        logger: {
            warn: (message) => console.error(message),
            error: (message) => console.error(message),
        },
    });
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
