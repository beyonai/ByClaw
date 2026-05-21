import { afterEach, describe, expect, it, vi } from "vitest";
import {
    applySessionModelFromPrimary,
    collectModelReconcileTargets,
    isManagedModelRegisteredInConfig,
    parseModelPrimaryRef,
    reconcileAgentSessionModelsAfterSync,
} from "./agent-session-model-reconcile.js";

describe("isManagedModelRegisteredInConfig", () => {
    it("returns true when provider and model exist", () => {
        expect(
            isManagedModelRegisteredInConfig(
                {
                    models: {
                        providers: {
                            "baiying-m-10004009": {
                                models: [{ id: "deepseek-v4-pro" }],
                            },
                        },
                    },
                },
                "baiying-m-10004009",
                "deepseek-v4-pro",
            ),
        ).toBe(true);
    });

    it("returns false when provider or model id is missing", () => {
        expect(
            isManagedModelRegisteredInConfig(
                { models: { providers: { "baiying-m-10004009": { models: [] } } } },
                "baiying-m-10004009",
                "deepseek-v4-pro",
            ),
        ).toBe(false);
    });
});

describe("parseModelPrimaryRef", () => {
    it("parses provider/model refs", () => {
        expect(parseModelPrimaryRef("baiying-m-10004000/qwen3.6-27b")).toEqual({
            provider: "baiying-m-10004000",
            model: "qwen3.6-27b",
        });
    });
});

describe("applySessionModelFromPrimary", () => {
    it("sets overrides and liveModelSwitchPending when runtime model changes", () => {
        const entry: Record<string, unknown> = {
            modelProvider: "baiying-m-10004014",
            model: "qwen3.6-35b-a3b",
        };
        const result = applySessionModelFromPrimary(entry, {
            provider: "baiying-m-10004014",
            model: "deepseek-v4-flash",
        });
        expect(result).toEqual({ changed: true, liveSwitchRequested: true });
        expect(entry.model).toBe("deepseek-v4-flash");
        expect(entry.modelProvider).toBe("baiying-m-10004014");
        expect(entry.providerOverride).toBe("baiying-m-10004014");
        expect(entry.modelOverride).toBe("deepseek-v4-flash");
        expect(entry.modelOverrideSource).toBe("auto");
        expect(entry.liveModelSwitchPending).toBe(true);
    });

    it("updates overrides when only runtime fields were previously synced", () => {
        const entry: Record<string, unknown> = {
            modelProvider: "baiying-m-10004019",
            model: "kimi-k2.6",
            liveModelSwitchPending: true,
        };
        const result = applySessionModelFromPrimary(entry, {
            provider: "baiying-m-10004014",
            model: "deepseek-v4-flash",
        });
        expect(result.liveSwitchRequested).toBe(true);
        expect(entry.providerOverride).toBe("baiying-m-10004014");
        expect(entry.modelOverride).toBe("deepseek-v4-flash");
        expect(entry.liveModelSwitchPending).toBe(true);
    });

    it("is a no-op when overrides and runtime already match", () => {
        const entry: Record<string, unknown> = {
            modelProvider: "baiying-m-10004014",
            model: "deepseek-v4-flash",
            providerOverride: "baiying-m-10004014",
            modelOverride: "deepseek-v4-flash",
            modelOverrideSource: "auto",
        };
        const result = applySessionModelFromPrimary(entry, {
            provider: "baiying-m-10004014",
            model: "deepseek-v4-flash",
        });
        expect(result).toEqual({ changed: false, liveSwitchRequested: false });
        expect(entry.liveModelSwitchPending).toBeUndefined();
    });

    it("clears stale liveModelSwitchPending when overrides and runtime already match", () => {
        const entry: Record<string, unknown> = {
            modelProvider: "baiying-m-10003989",
            model: "qwen3.6-35b-a3b",
            providerOverride: "baiying-m-10003989",
            modelOverride: "qwen3.6-35b-a3b",
            modelOverrideSource: "auto",
            liveModelSwitchPending: true,
        };
        const result = applySessionModelFromPrimary(entry, {
            provider: "baiying-m-10003989",
            model: "qwen3.6-35b-a3b",
        });
        expect(result).toEqual({ changed: true, liveSwitchRequested: false });
        expect(entry.liveModelSwitchPending).toBeUndefined();
    });
});

describe("collectModelReconcileTargets", () => {
    const managed = [
        {
            agentId: "baiying-agent-10000455",
            listEntry: { model: { primary: "baiying-m-10004014/deepseek-v4-flash" } },
            modelRef: "baiying-m-10004014/deepseek-v4-flash",
        },
        {
            agentId: "baiying-agent-10000281",
            listEntry: { model: { primary: "baiying-m-10004000/qwen3.6-27b" } },
            modelRef: "baiying-m-10004000/qwen3.6-27b",
        },
    ];

    it("includes agents whose config primary drifted even when not in added/updated", () => {
        const targets = collectModelReconcileTargets({
            managed,
            added: [],
            updated: [],
            forceFullWorkspaceReseed: false,
            previousConfigModelPrimaryByAgentId: new Map([
                ["baiying-agent-10000455", "baiying-m-10004014/qwen3.6-35b-a3b"],
                ["baiying-agent-10000281", "baiying-m-10004000/qwen3.6-27b"],
            ]),
        });
        expect(targets).toEqual([
            {
                agentId: "baiying-agent-10000455",
                modelPrimary: "baiying-m-10004014/deepseek-v4-flash",
            },
        ]);
    });
});

describe("reconcileAgentSessionModelsAfterSync", () => {
    const prevStateDir = process.env.OPENCLAW_STATE_DIR;

    afterEach(() => {
        if (prevStateDir === undefined) {
            delete process.env.OPENCLAW_STATE_DIR;
        } else {
            process.env.OPENCLAW_STATE_DIR = prevStateDir;
        }
    });

    it("updates session store overrides and marks live model switch pending", async () => {
        const store: Record<string, Record<string, unknown>> = {
            "agent:baiying-agent-10000455:byai-channel:direct:10004894": {
                sessionId: "8b33bf27-44e8-4e66-87ea-bda1344fe677",
                model: "qwen3.6-35b-a3b",
                modelProvider: "baiying-m-10004014",
            },
        };
        const updateSessionStore = vi.fn(async (_storePath, mutator) => mutator(store));
        const resolveStorePath = vi.fn(() => "/tmp/sessions.json");
        const info = vi.fn();

        await reconcileAgentSessionModelsAfterSync({
            api: {
                runtime: {
                    config: {
                        loadConfig: () => ({ session: { store: "(multiple)" } }),
                    },
                    agent: {
                        session: {
                            resolveStorePath,
                            updateSessionStore,
                        },
                    },
                },
            } as never,
            agents: [
                {
                    agentId: "baiying-agent-10000455",
                    modelPrimary: "baiying-m-10004014/deepseek-v4-flash",
                },
            ],
            log: { info, warn: vi.fn() },
        });

        const entry = store["agent:baiying-agent-10000455:byai-channel:direct:10004894"];
        expect(entry.modelProvider).toBe("baiying-m-10004014");
        expect(entry.model).toBe("deepseek-v4-flash");
        expect(entry.providerOverride).toBe("baiying-m-10004014");
        expect(entry.modelOverride).toBe("deepseek-v4-flash");
        expect(entry.modelOverrideSource).toBe("auto");
        expect(entry.liveModelSwitchPending).toBe(true);
        expect(updateSessionStore).toHaveBeenCalledOnce();
        expect(info).toHaveBeenCalledWith(
            expect.stringContaining("liveModelSwitchPending"),
        );
    });
});
