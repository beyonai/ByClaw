import { beforeEach, describe, expect, it, vi } from "vitest";
import { rememberAimodelAuthToken, resetAimodelAuthTokenCacheForTests } from "./aimodel-auth-cache.js";
import { registerBaiyingAimodelRuntimeProvider } from "./aimodel-runtime-provider.js";

describe("Baiying AI model runtime provider", () => {
    beforeEach(() => {
        resetAimodelAuthTokenCacheForTests();
    });

    it("resolves cached Redis authToken for dynamic baiying providers", () => {
        const registerProvider = vi.fn();
        registerBaiyingAimodelRuntimeProvider(
            { registerProvider } as unknown as Parameters<typeof registerBaiyingAimodelRuntimeProvider>[0],
            {},
        );
        rememberAimodelAuthToken({ modelId: "10004009", token: "redis-token" });

        const provider = registerProvider.mock.calls[0]?.[0];
        expect(provider?.id).toBe("baiying-aimodel");
        expect(provider?.hookAliases).toEqual([
            "openai-completions",
            "openai-responses",
            "anthropic-messages",
        ]);
        expect(
            provider?.resolveSyntheticAuth?.({
                provider: "baiying-m-10004009",
                providerConfig: {
                    api: "openai-completions",
                },
            }),
        ).toEqual({
            apiKey: "redis-token",
            source: "baiying-enhance Redis authToken (10004009)",
            mode: "api-key",
        });
    });

    it("derives negative Redis model ids from managed provider ids", () => {
        const registerProvider = vi.fn();
        registerBaiyingAimodelRuntimeProvider(
            { registerProvider } as unknown as Parameters<typeof registerBaiyingAimodelRuntimeProvider>[0],
            {},
        );
        rememberAimodelAuthToken({ modelId: "-500", token: "negative-token" });

        const provider = registerProvider.mock.calls[0]?.[0];
        expect(
            provider?.resolveSyntheticAuth?.({
                provider: "baiying-m-neg-500",
                providerConfig: {
                    api: "openai-responses",
                },
            }),
        ).toEqual({
            apiKey: "negative-token",
            source: "baiying-enhance Redis authToken (-500)",
            mode: "api-key",
        });
    });

    it("ignores non-Baiying providers and missing cache entries", () => {
        const registerProvider = vi.fn();
        registerBaiyingAimodelRuntimeProvider(
            { registerProvider } as unknown as Parameters<typeof registerBaiyingAimodelRuntimeProvider>[0],
            {},
        );
        const provider = registerProvider.mock.calls[0]?.[0];

        expect(
            provider?.resolveSyntheticAuth?.({
                provider: "openai",
                providerConfig: {
                    apiKey: {
                        source: "exec",
                        provider: "baiying-aimodel-redis",
                        id: "model:10004009",
                    },
                },
            }),
        ).toBeUndefined();
        expect(
            provider?.resolveSyntheticAuth?.({
                provider: "baiying-m-10004009",
                providerConfig: {
                },
            }),
        ).toBeUndefined();
    });
});
