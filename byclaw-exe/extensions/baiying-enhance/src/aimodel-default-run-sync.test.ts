import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    buildAimodelDefaultLlmSnapshot,
    saveAimodelDefaultLlmIndex,
} from "./aimodel-default-index.js";
import { resolveAgentIdFromSessionKey } from "./session-agent-id.js";
import {
    resetAimodelDefaultRunSyncForTests,
    resolveMainDefaultAimodelOnAgentRun,
} from "./aimodel-default-run-sync.js";
import { resolveDefaultBaiyingAimodelProviderBundle } from "./aimodel-config.js";
import { runRuntimeUpdateContext, RuntimeUpdateDeferredError } from "../../shared/src/redis-runtime-update-gate.js";

const updates = vi.hoisted(() => ({
    queue: {
        register: vi.fn(), start: vi.fn(), enqueue: vi.fn(), applyNow: vi.fn(), stop: vi.fn(),
    },
    readPending: vi.fn(),
}));
vi.mock("../../shared/src/redis-runtime-update-gate.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../shared/src/redis-runtime-update-gate.js")>(),
    createRuntimeUpdateQueue: () => updates.queue,
    readPendingRuntimeUpdate: updates.readPending,
}));

const bundle = {
    providerKey: "baiying-m-10004014",
    modelRef: "baiying-m-10004014/deepseek-v4-flash",
    provider: {
        baseUrl: "https://example.com/v1",
        apiKey: { source: "exec" as const, provider: "baiying-aimodel-redis", id: "model:10004014" },
        api: "openai-completions" as const,
        modelId: "deepseek-v4-flash",
        modelName: "deepseek-v4-flash",
    },
    hash: "hash-new",
};

vi.mock("./aimodel-config.js", () => ({
    DEFAULT_AIMODEL_CONFIG_REDIS_KEY: "byai:aimodel:config",
    DEFAULT_AIMODEL_SECRET_PROVIDER_NAME: "baiying-aimodel-redis",
    DEFAULT_AIMODEL_TIMEOUT_SECONDS: 600,
    DEFAULT_AIMODEL_TYPELIST_FIELD: "LLM",
    DEFAULT_AIMODEL_TYPELIST_REDIS_KEY: "byai:aimodel:typelist",
    resolveAimodelConfigRedisKey: () => "byai:aimodel:config",
    resolveAimodelSecretProviderName: () => "baiying-aimodel-redis",
    resolveAimodelTypeListRedisKey: () => "byai:aimodel:typelist",
    resolveDefaultBaiyingAimodelProviderBundle: vi.fn(async () => bundle),
}));

describe("aimodel-default-run-sync", () => {
    let indexDir: string;
    let flushCalls = 0;

    beforeEach(async () => {
        resetAimodelDefaultRunSyncForTests();
        indexDir = await mkdtemp(path.join(tmpdir(), "aimodel-run-sync-"));
        vi.stubEnv("OPENCLAW_STATE_DIR", indexDir);
        flushCalls = 0;
        updates.queue.enqueue.mockReset().mockResolvedValue(undefined);
        updates.queue.applyNow.mockReset().mockResolvedValue("queued");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    function createDeps() {
        const cfg = {
            agents: {
                list: [{ id: "main", model: "minimax-portal/MiniMax-M2.7-highspeed" }],
                defaults: { model: { primary: "baiying-m-10004014/deepseek-v4-flash" } },
            },
            models: {
                providers: {
                    "baiying-m-10004014": {
                        api: "openai-completions",
                        models: [{ id: "deepseek-v4-flash" }],
                    },
                },
            },
        };
        return {
            api: {
                logger: { info: vi.fn(), warn: vi.fn() },
                runtime: {
                    version: "2026.7.1",
                    config: {
                        current: () => cfg,
                        loadConfig: () => cfg,
                    },
                },
            },
            redisJsonStore: {},
            pluginConfig: { mainParentAgentId: "main" },
            getFlushNow: () => async () => {
                flushCalls += 1;
            },
        } as Parameters<typeof resolveMainDefaultAimodelOnAgentRun>[0];
    }

    function createUnregisteredDeps() {
        let diskCfg = {
            agents: {
                list: [{ id: "main", model: "minimax-portal/MiniMax-M2.7-highspeed" }],
                defaults: { model: { primary: "minimax-portal/MiniMax-M2.7-highspeed" } },
            },
            models: {
                providers: {},
            },
        };
        const currentCfg = structuredClone(diskCfg);
        return {
            api: {
                logger: { info: vi.fn(), warn: vi.fn() },
                runtime: {
                    version: "2026.7.1",
                    config: {
                        current: () => currentCfg,
                        loadConfig: () => diskCfg,
                        writeConfigFile: vi.fn(async (next) => {
                            diskCfg = next as typeof diskCfg;
                        }),
                    },
                },
            },
            redisJsonStore: {},
            pluginConfig: { mainParentAgentId: "main" },
            getFlushNow: () => undefined,
        } as Parameters<typeof resolveMainDefaultAimodelOnAgentRun>[0];
    }

    it("returns override without flush when changed default is already registered", async () => {
        const deps = createDeps();
        const override = await resolveMainDefaultAimodelOnAgentRun(deps, "main");
        expect(flushCalls).toBe(0);
        expect(override).toEqual({
            providerOverride: "baiying-m-10004014",
            modelOverride: "deepseek-v4-flash",
        });
    });

    it("notifies observers after resolving the Redis default model", async () => {
        const deps = createDeps();
        deps.onDefaultAimodelResolved = vi.fn();

        await resolveMainDefaultAimodelOnAgentRun(deps, "main");

        expect(deps.onDefaultAimodelResolved).toHaveBeenCalledWith(bundle);
    });

    it("waits for asynchronous default-model observers", async () => {
        const deps = createDeps();
        let releaseObserver: (() => void) | undefined;
        deps.onDefaultAimodelResolved = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    releaseObserver = resolve;
                }),
        );
        let settled = false;

        const pending = resolveMainDefaultAimodelOnAgentRun(deps, "main").then(() => {
            settled = true;
        });
        await vi.waitFor(() => expect(deps.onDefaultAimodelResolved).toHaveBeenCalled());
        expect(settled).toBe(false);

        releaseObserver?.();
        await pending;
        expect(settled).toBe(true);
    });

    it("triggers flush and returns override when Redis default LLM is registered by the sync", async () => {
        const cfg = {
            agents: {
                list: [{ id: "main", model: "minimax-portal/MiniMax-M2.7-highspeed" }],
                defaults: { model: { primary: "minimax-portal/MiniMax-M2.7-highspeed" } },
            },
            models: {
                providers: {} as Record<string, { api?: string; models: Array<{ id: string }> }>,
            },
        };
        const deps = {
            api: {
                logger: { info: vi.fn(), warn: vi.fn() },
                runtime: {
                    version: "2026.7.1",
                    config: {
                        current: () => cfg,
                        loadConfig: () => cfg,
                    },
                },
            },
            redisJsonStore: {},
            pluginConfig: { mainParentAgentId: "main" },
            getFlushNow: () => async () => {
                flushCalls += 1;
                cfg.models.providers["baiying-m-10004014"] = {
                    api: "openai-completions",
                    models: [{ id: "deepseek-v4-flash" }],
                };
            },
        } as Parameters<typeof resolveMainDefaultAimodelOnAgentRun>[0];

        const override = await resolveMainDefaultAimodelOnAgentRun(deps, "main");
        expect(flushCalls).toBe(1);
        expect(override).toEqual({
            providerOverride: "baiying-m-10004014",
            modelOverride: "deepseek-v4-flash",
        });
    });

    it("does not flush again when index already matches Redis", async () => {
        const indexPath = path.join(indexDir, "baiying-enhance", "aimodel-default-llm-index.json");
        await saveAimodelDefaultLlmIndex(
            indexPath,
            buildAimodelDefaultLlmSnapshot({
                redisKey: "byai:aimodel:typelist",
                typelistField: "LLM",
                typelistHash: "hash-new",
                providerKey: bundle.providerKey,
                modelRef: bundle.modelRef,
                instanceId: "10004014",
                modelCode: "deepseek-v4-flash",
            }),
        );
        const deps = createDeps();
        const override = await resolveMainDefaultAimodelOnAgentRun(deps, "main");
        expect(flushCalls).toBe(0);
        expect(override).toEqual({
            providerOverride: "baiying-m-10004014",
            modelOverride: "deepseek-v4-flash",
        });
        expect(deps.api.logger.info).toHaveBeenCalled();
    });

    it("queues a missing model without returning an unavailable override when allowConfigMutation is false", async () => {
        const deps = createUnregisteredDeps();
        const override = await resolveMainDefaultAimodelOnAgentRun(deps, "main", {
            allowConfigMutation: false,
        });
        expect(override).toBeUndefined();
        expect(updates.queue.register).toHaveBeenCalledWith("platform-default-model", expect.any(Function));
        expect(updates.queue.enqueue).toHaveBeenCalledWith("platform-default-model", { reason: "main run aimodel diff" });
        expect(updates.queue.applyNow).not.toHaveBeenCalled();
        expect(deps.api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
    });

    it("writes the default provider when the watchdog is unavailable and keeps this run on the prior runtime model", async () => {
        const deps = createUnregisteredDeps();
        const override = await runRuntimeUpdateContext(() => resolveMainDefaultAimodelOnAgentRun(deps, "main"));
        expect(override).toBeUndefined();
        const indexPath = path.join(indexDir, "baiying-enhance", "aimodel-default-llm-index.json");
        await expect(access(indexPath)).resolves.toBeUndefined();
        expect(deps.api.runtime.config.writeConfigFile).toHaveBeenCalled();
        expect(deps.api.runtime.config.loadConfig().models.providers["baiying-m-10004014"]).toEqual(
            expect.objectContaining({
                api: "openai-completions",
                models: [expect.objectContaining({ id: "deepseek-v4-flash" })],
            }),
        );
        expect(deps.api.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining("not visible in current runtime yet"),
        );
    });

    it("waits for hot reload to expose a newly written default provider", async () => {
        let diskCfg = {
            agents: {
                list: [{ id: "main", model: "minimax-portal/MiniMax-M2.7-highspeed" }],
                defaults: { model: { primary: "minimax-portal/MiniMax-M2.7-highspeed" } },
            },
            models: {
                providers: {} as Record<string, { api?: string; models: Array<{ id: string }> }>,
            },
        };
        let currentCfg = structuredClone(diskCfg);
        const deps = {
            api: {
                logger: { info: vi.fn(), warn: vi.fn() },
                runtime: {
                    version: "2026.7.1",
                    config: {
                        current: () => currentCfg,
                        loadConfig: () => diskCfg,
                        writeConfigFile: vi.fn(async (next) => {
                            diskCfg = next as typeof diskCfg;
                            setTimeout(() => {
                                currentCfg = structuredClone(diskCfg);
                            }, 20);
                        }),
                    },
                },
            },
            redisJsonStore: {},
            pluginConfig: { mainParentAgentId: "main" },
            getFlushNow: () => undefined,
        } as Parameters<typeof resolveMainDefaultAimodelOnAgentRun>[0];

        const override = await runRuntimeUpdateContext(() => resolveMainDefaultAimodelOnAgentRun(deps, "main", {
            runtimeConfigWaitMs: 200,
            runtimeConfigPollMs: 5,
        }));

        expect(override).toEqual({
            providerOverride: "baiying-m-10004014",
            modelOverride: "deepseek-v4-flash",
        });
    });

    it("resolves main agent id from session key when ctx.agentId is missing", async () => {
        const deps = createDeps();
        const override = await resolveMainDefaultAimodelOnAgentRun(
            deps,
            resolveAgentIdFromSessionKey("agent:main:main"),
        );
        expect(override?.modelOverride).toBe("deepseek-v4-flash");
    });

    it("ignores non-main agents", async () => {
        const deps = createDeps();
        const override = await resolveMainDefaultAimodelOnAgentRun(deps, "baiying-agent-1");
        expect(flushCalls).toBe(0);
        expect(override).toBeUndefined();
    });

    it("keeps a normal run on its prior model while the config repair is pending", async () => {
        const deps = createUnregisteredDeps();

        await expect(resolveMainDefaultAimodelOnAgentRun(deps, "main")).resolves.toBeUndefined();

        expect(updates.queue.applyNow).toHaveBeenCalledWith("platform-default-model", { reason: "main run aimodel diff" });
        expect(deps.api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
        expect(deps.api.runtime.config.loadConfig().models.providers).toEqual({});
    });

    it("propagates a plugin reload rejection from the update handler without writing or saving the index", async () => {
        const deps = createUnregisteredDeps();
        vi.mocked(resolveDefaultBaiyingAimodelProviderBundle).mockResolvedValueOnce({
            ...bundle,
            provider: { ...bundle.provider, reasoningConfig: { enabled: true, compatFormat: "bailian", capability: "effort" } },
        } as any);

        await expect(runRuntimeUpdateContext(() => resolveMainDefaultAimodelOnAgentRun(deps, "main")))
            .rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

        expect(deps.api.runtime.config.writeConfigFile).not.toHaveBeenCalled();
        expect(deps.api.runtime.config.loadConfig().models.providers).toEqual({});
        const indexPath = path.join(indexDir, "baiying-enhance", "aimodel-default-llm-index.json");
        await expect(access(indexPath)).rejects.toMatchObject({ code: "ENOENT" });
    });
});
