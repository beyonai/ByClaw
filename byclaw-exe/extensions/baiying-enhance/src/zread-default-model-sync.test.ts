import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    rememberAimodelAuthToken,
    resetAimodelAuthTokenCacheForTests,
} from "./aimodel-auth-cache.js";
import type { ResolvedDefaultBaiyingAimodelProviderBundle } from "./aimodel-config.js";
import {
    createZreadDefaultModelSync,
    resolveZreadConfigFields,
    runZreadConfigStdio,
} from "./zread-default-model-sync.js";

const bundle: ResolvedDefaultBaiyingAimodelProviderBundle = {
    providerKey: "baiying-m-10004014",
    modelRef: "baiying-m-10004014/deepseek-v4-flash",
    provider: {
        baseUrl: "https://example.com/v1",
        apiKey: {
            source: "exec",
            provider: "baiying-aimodel-redis",
            id: "model:10004014",
        },
        api: "openai-completions",
        modelId: "deepseek-v4-flash",
        modelName: "deepseek-v4-flash",
    },
    hash: "hash-new",
};

describe("zread-default-model-sync", () => {
    beforeEach(() => {
        rememberAimodelAuthToken({
            modelId: "10004014",
            token: "secret-api-key",
        });
    });

    afterEach(() => {
        resetAimodelAuthTokenCacheForTests();
        vi.restoreAllMocks();
    });

    it("maps the Redis default model to Zread custom provider fields", () => {
        expect(resolveZreadConfigFields(bundle)).toEqual({
            llm_provider: "custom",
            llm_base_url: "https://example.com/v1",
            llm_model: "deepseek-v4-flash",
            llm_api_key: "secret-api-key",
        });
    });

    it("rejects provider protocols that Zread custom provider cannot use", () => {
        const anthropicBundle = {
            ...bundle,
            provider: {
                ...bundle.provider,
                api: "anthropic-messages" as const,
            },
        };

        expect(() => resolveZreadConfigFields(anthropicBundle)).toThrow(
            "does not support provider API anthropic-messages",
        );
    });

    it("deduplicates unchanged model notifications", async () => {
        const runConfig = vi.fn(async () => undefined);
        const secureConfigFile = vi.fn(async () => undefined);
        const logger = { info: vi.fn(), warn: vi.fn() };
        const sync = createZreadDefaultModelSync({
            settings: {
                enabled: true,
                command: "/usr/local/bin/zread",
                configTimeoutMs: 12_000,
            },
            logger,
            runConfig,
            secureConfigFile,
        });

        sync.notify(bundle);
        sync.notify(bundle);
        await sync.waitForIdle();

        expect(runConfig).toHaveBeenCalledTimes(1);
        expect(runConfig).toHaveBeenCalledWith({
            command: "/usr/local/bin/zread",
            fields: expect.objectContaining({ llm_model: "deepseek-v4-flash" }),
            timeoutMs: 12_000,
        });
        expect(secureConfigFile).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(
            "baiying-enhance: synchronized Zread default model deepseek-v4-flash",
        );
    });

    it("keeps deduplication state healthy when queued models oscillate", async () => {
        const pending: Array<() => void> = [];
        const runConfig = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    pending.push(resolve);
                }),
        );
        const sync = createZreadDefaultModelSync({
            settings: {
                enabled: true,
                command: "zread",
                configTimeoutMs: 30_000,
            },
            logger: { info: vi.fn(), warn: vi.fn() },
            runConfig,
            secureConfigFile: vi.fn(async () => undefined),
        });
        const otherBundle = {
            ...bundle,
            provider: { ...bundle.provider, modelId: "other-model" },
            hash: "hash-other",
        };

        sync.notify(bundle);
        await vi.waitFor(() => expect(runConfig).toHaveBeenCalledTimes(1));
        sync.notify(otherBundle);
        pending.shift()?.();
        await vi.waitFor(() => expect(runConfig).toHaveBeenCalledTimes(2));
        sync.notify(bundle);
        pending.shift()?.();
        await vi.waitFor(() => expect(runConfig).toHaveBeenCalledTimes(3));
        pending.shift()?.();
        await sync.waitForIdle();

        sync.notify(otherBundle);
        await vi.waitFor(() => expect(runConfig).toHaveBeenCalledTimes(4));
        pending.shift()?.();
        await sync.waitForIdle();
    });

    it("redacts the API key when the Zread command fails", async () => {
        const logger = { info: vi.fn(), warn: vi.fn() };
        const sync = createZreadDefaultModelSync({
            settings: {
                enabled: true,
                command: "zread",
                configTimeoutMs: 30_000,
            },
            logger,
            runConfig: vi.fn(async () => {
                throw new Error("zread rejected secret-api-key");
            }),
            secureConfigFile: vi.fn(async () => undefined),
        });

        sync.notify(bundle);
        await sync.waitForIdle();

        const warning = String(logger.warn.mock.calls[0]?.[0] ?? "");
        expect(warning).toContain("<redacted>");
        expect(warning).not.toContain("secret-api-key");
    });

    it("uses the Zread JSONL update_fields and save protocol", async () => {
        const protocolScript = String.raw`
            process.stdout.write(JSON.stringify({ waiting_for: ["update_fields", "save"] }) + "\n");
            let input = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk) => {
                input += chunk;
                for (;;) {
                    const newline = input.indexOf("\n");
                    if (newline < 0) break;
                    const line = input.slice(0, newline);
                    input = input.slice(newline + 1);
                    const request = JSON.parse(line);
                    if (request.type === "update_fields") {
                        const fields = request.params.fields;
                        if (fields.llm_model !== "deepseek-v4-flash" || fields.llm_api_key !== "secret-api-key") {
                            process.stderr.write("unexpected fields");
                            process.exit(2);
                        }
                        process.stdout.write(JSON.stringify({ waiting_for: ["save"] }) + "\n");
                    } else if (request.type === "save") {
                        process.stdout.write(JSON.stringify({ done: true }) + "\n");
                        process.exit(0);
                    }
                }
            });
        `;

        await expect(
            runZreadConfigStdio({
                command: process.execPath,
                args: ["-e", protocolScript],
                fields: resolveZreadConfigFields(bundle),
                timeoutMs: 5_000,
            }),
        ).resolves.toBeUndefined();
    });
});
