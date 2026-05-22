import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveAimodelSecretRequest } from "./aimodel-secret-resolver.js";
import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";

function payload(raw: Record<string, unknown>): RedisJsonPayload {
    const content = JSON.stringify(raw);
    return {
        key: "byai:aimodel:config:-2000",
        content,
        raw,
        hash: createHash("sha256").update(content, "utf8").digest("hex"),
    };
}

function store(entries: Map<string, RedisJsonPayload>): BaiyingRedisJsonStore {
    return {
        getJsonByKey: async () => null,
        getHashJson: async ({ key, field }) => entries.get(`${key}:${field}`) ?? null,
        getDigEmployeeJson: async () => null,
        getResourceJson: async () => null,
        close: async () => {},
    };
}

describe("AI model exec SecretRef resolver", () => {
    it("returns authToken by protocol id without logging model config", async () => {
        const response = await resolveAimodelSecretRequest({
            request: JSON.stringify({ protocolVersion: 1, ids: ["model:-2000"] }),
            redisJsonStore: store(
                new Map([
                    [
                        "byai:aimodel:config:-2000",
                        payload({
                            authToken: "secret-token",
                            modelCode: "glm-5-turbo",
                            status: 1,
                            url: "https://lab.iwhalecloud.com/gpt-proxy/v1",
                        }),
                    ],
                ]),
            ),
        });

        expect(response).toEqual({
            protocolVersion: 1,
            values: {
                "model:-2000": "secret-token",
            },
        });
    });

    it("returns a protocol error when the Redis model entry is missing", async () => {
        const response = await resolveAimodelSecretRequest({
            request: JSON.stringify({ protocolVersion: 1, ids: ["model:-2000"] }),
            redisJsonStore: store(new Map()),
        });

        expect(response).toEqual({
            protocolVersion: 1,
            values: {},
            errors: {
                "model:-2000": {
                    message: "AI model config missing or invalid for id model:-2000",
                },
            },
        });
    });
});
