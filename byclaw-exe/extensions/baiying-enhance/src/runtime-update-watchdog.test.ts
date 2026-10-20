import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createRuntimeUpdateQueue,
    RUNTIME_UPDATE_IDLE_MS,
    type RuntimeUpdateGate,
    type RuntimeUpdatePayload,
} from "../../shared/src/redis-runtime-update-gate.js";
import { AgentRegistryState } from "./agent-state.js";
import { createAgentWatchdog, loadManagedAgentsFromRedis } from "./agent-watchdog.js";
import { mergeManagedAgentsIntoConfig } from "./agent-registry.js";
import { saveAgentContentIndex } from "./agent-content-index.js";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";


/** Controlled admission boundary. Shared integration tests exercise the actual Redis Lua. */
function createAdmissionGate() {
    const pending = new Map<string, { revision: number; payload: RuntimeUpdatePayload; blocked?: boolean }>();
    let active = 0;
    let idleSince = Date.now();
    let owner: string | undefined;
    const gate: RuntimeUpdateGate = {
        async enqueue(key, payload) {
            const previous = pending.get(key);
            pending.set(key, {
                revision: (previous?.revision ?? 0) + 1,
                payload: {
                    ...previous?.payload,
                    ...payload,
                    fullWorkspaceReseed: previous?.payload.fullWorkspaceReseed || payload.fullWorkspaceReseed,
                    deletedSourceKeys: [...new Set([
                        ...(previous?.payload.deletedSourceKeys ?? []), ...(payload.deletedSourceKeys ?? []),
                    ])],
                },
            });
        },
        async claim(key) {
            const job = pending.get(key);
            if (!job || job.blocked || active || owner || Date.now() - idleSince < RUNTIME_UPDATE_IDLE_MS) return null;
            owner = key;
            return { owner: key, ...job };
        },
        async finish(key, claim, error) {
            const job = pending.get(key);
            if (job?.revision === claim.revision) {
                if (!error) pending.delete(key);
                else job.blocked = error.blocked;
            }
            owner = undefined;
        },
    };
    return {
        gate,
        pending,
        enter() {
            if (owner) throw new Error("New execution must wait while updating");
            active += 1;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                active -= 1;
                if (!active) idleSince = Date.now();
            };
        },
    };
}

async function createFixture(admission = createAdmissionGate(), providers: Record<string, unknown> = {}) {
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-safe-update-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const deletedWorkspace = path.join(stateDir, "workspace-baiying-agent-99999999");
    await mkdir(deletedWorkspace, { recursive: true });
    const toolFile = path.join(deletedWorkspace, "tool-input.txt");
    await writeFile(toolFile, "in-flight tool still needs this", "utf8");
    let config: any = {
        agents: { list: [
            { id: "main", name: "Main" },
            { id: "baiying-agent-99999999", name: "Deleted employee", workspace: deletedWorkspace },
        ] },
        models: { providers },
    };
    const writeConfigFile = vi.fn(async (next) => { config = next; });
    const api = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        runtime: { version: "2026.7.1", config: { loadConfig: () => config, writeConfigFile } },
    } as any;
    const registry = new AgentRegistryState();
    const queue = createRuntimeUpdateQueue({ gate: admission.gate, logger: api.logger });
    const watchdog = createAgentWatchdog({
        api,
        registry,
        redisJsonStore: {
            getJsonByKey: async () => null,
            getHashJson: async () => null,
            getDigEmployeeJson: async () => null,
            getResourceJson: async () => null,
            close: async () => {},
        },
        contentIndexPath: path.join(stateDir, "content-index.json"),
        executorPath: stateDir,
        pluginConfig: {
            persistAgentContentIndex: false,
            workspaceAutoSeed: false,
            mainWorkspaceAgentsAutoSeed: false,
            workspaceSkillAutoEnable: false,
            workspaceArchiveBackend: "local",
            hubSkillAutoSync: false,
        },
        debounceMs: 500,
        runtimeUpdateQueue: queue,
        authorizationFilter: { getAuthorizedSourceKeys: () => new Set() },
    });
    return { admission, queue, watchdog, writeConfigFile, toolFile, registry, api };
}

async function createExistingSnapshotFixture(options: {
    invalidIndex?: boolean;
    missingIndex?: boolean;
    unauthorized?: boolean;
    changedModelConfig?: boolean;
    materializedSecrets?: boolean;
} = {}) {
    const admission = createAdmissionGate();
    const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-existing-snapshot-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const employee = { resourceId: "10863047", resourceName: "Demo", prologue: JSON.stringify({ modelId: 123 }) };
    const model = { authToken: "test-token", modelCode: "demo", status: 1, url: "https://example.com/v1" };
    const store: BaiyingRedisJsonStore = {
        getJsonByKey: async () => null,
        getHashJson: async ({ field }) => field === "123"
            ? { key: "byai:aimodel:config:123", raw: model, content: JSON.stringify(model), hash: "model-hash" }
            : null,
        getDigEmployeeJson: async () => ({
            key: "DIG_EMPLOYEE_10863047", raw: employee, content: JSON.stringify(employee), hash: "employee-hash",
        }),
        getResourceJson: async () => null,
        close: async () => {},
    };
    const loaded = await loadManagedAgentsFromRedis({
        redisJsonStore: store,
        authorizedSourceKeys: new Set(["10863047"]),
        embedApiKeysFromJson: false,
        log: { warn: vi.fn() },
    });
    const config = mergeManagedAgentsIntoConfig({
        base: {
            agents: { list: [{ id: "main", name: "Main" }] },
            models: { providers: {
                custom: {
                    baseUrl: "https://example.com/v1", api: "openai-completions", apiKey: "test-key",
                    models: [{ id: "thinking", name: "Thinking", params: { baiyingReasoningConfig: {
                        enabled: true, capability: "effort", compatFormat: "bailian",
                    } } }],
                },
            } },
        } as any,
        managed: loaded,
        mainParentAgentId: "main",
        mergeAllowSpawnForMain: true,
        aimodelSecretResolverCommand: process.execPath,
        aimodelSecretResolverArgs: ["aimodel-secret-resolver-cli.js"],
    });
    if (options.changedModelConfig) config.models!.providers![loaded[0]!.providerKey!].baseUrl = "https://changed.example.com/v1";
    const contentIndexPath = path.join(stateDir, "content-index.json");
    if (!options.missingIndex) {
        await saveAgentContentIndex(contentIndexPath, new Map([
            [loaded[0]!.agentId, options.invalidIndex ? "different-old-hash" : loaded[0]!.contentHash],
        ]));
    }
    const workspace = config.agents!.list!.find((entry) => entry.id === loaded[0]!.agentId)!.workspace!;
    await mkdir(workspace, { recursive: true });
    const workspaceFile = path.join(workspace, "SOUL.md");
    await writeFile(workspaceFile, "keep applied workspace unchanged", "utf8");
    const appliedConfig = structuredClone(config);
    if (options.materializedSecrets) appliedConfig.models!.providers![loaded[0]!.providerKey!].apiKey = "materialized-test-key";
    const writeConfigFile = vi.fn(async () => {});
    const onSynced = vi.fn();
    const onReadonlySnapshotRestored = vi.fn();
    const api = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        runtime: { version: "2026.7.1", config: { current: () => appliedConfig, loadConfig: () => config, writeConfigFile } },
    } as any;
    const queue = createRuntimeUpdateQueue({ gate: admission.gate, logger: api.logger });
    const registry = new AgentRegistryState();
    const watchdog = createAgentWatchdog({
        api, registry, redisJsonStore: store, contentIndexPath, executorPath: stateDir,
        pluginConfig: { persistAgentContentIndex: true, workspaceSkillAutoEnable: false },
        debounceMs: 60_000,
        runtimeUpdateQueue: queue,
        onSynced,
        onReadonlySnapshotRestored,
        authorizationFilter: {
            getAuthorizedSourceKeys: () => new Set(options.unauthorized ? [] : ["10863047"]),
        },
    });
    await watchdog.start({ deferInitialFlush: true });
    return { admission, queue, registry, watchdog, onSynced, onReadonlySnapshotRestored, writeConfigFile, workspaceFile, loaded };
}

describe("watchdog Redis idle update integration", () => {
    afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

    it("keeps configuration and tool workspace intact until model and tool finish, then waits 3 seconds", async () => {
        const fixture = await createFixture();
        vi.useFakeTimers({ toFake: ["Date"] });
        const finishModel = fixture.admission.enter();
        const finishTool = fixture.admission.enter();
        let resolveModel!: () => void;
        let resolveTool!: () => void;
        const model = new Promise<void>((resolve) => { resolveModel = resolve; }).finally(finishModel);
        const tool = new Promise<void>((resolve) => { resolveTool = resolve; })
            .then(() => readFile(fixture.toolFile, "utf8"))
            .finally(finishTool);
        await fixture.watchdog.enqueueSync({ fullWorkspaceReseed: true });
        await fixture.watchdog.enqueueSync({ deletedSourceKeys: ["99999999"] });
        await fixture.queue.drain();
        expect(fixture.writeConfigFile).not.toHaveBeenCalled();
        expect(await readFile(fixture.toolFile, "utf8")).toContain("in-flight tool");

        resolveModel();
        await model;
        vi.setSystemTime(Date.now() + 10_000);
        await fixture.queue.drain();
        expect(fixture.writeConfigFile).not.toHaveBeenCalled();
        expect(await readFile(fixture.toolFile, "utf8")).toContain("in-flight tool");

        resolveTool();
        expect(await tool).toContain("in-flight tool");
        vi.setSystemTime(Date.now() + 2_999);
        await fixture.queue.drain();
        expect(fixture.writeConfigFile).not.toHaveBeenCalled();
        vi.setSystemTime(Date.now() + 1);
        await fixture.queue.drain();
        expect(fixture.writeConfigFile).toHaveBeenCalledTimes(1);
        await expect(readFile(fixture.toolFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        expect(fixture.admission.pending.size).toBe(0);
        await fixture.queue.stop();
        await fixture.watchdog.stop();
    });

    it("restarts the idle window when an execution arrives at 2.9 seconds", async () => {
        const fixture = await createFixture();
        vi.useFakeTimers({ toFake: ["Date"] });
        await fixture.watchdog.enqueueSync({ deletedSourceKeys: ["99999999"] });
        vi.setSystemTime(Date.now() + 2_900);
        const finishExecution = fixture.admission.enter();
        vi.setSystemTime(Date.now() + 1_000);
        finishExecution();
        vi.setSystemTime(Date.now() + 2_999);
        await fixture.queue.drain();
        expect(fixture.writeConfigFile).not.toHaveBeenCalled();
        vi.setSystemTime(Date.now() + 1);
        await fixture.queue.drain();
        expect(fixture.writeConfigFile).toHaveBeenCalledTimes(1);
        await fixture.queue.stop();
        await fixture.watchdog.stop();
    });

    it("retains native plugin reload as pending before cleanup or config mutation", async () => {
        const fixture = await createFixture(createAdmissionGate(), {
            custom: {
                baseUrl: "https://example.com/v1",
                api: "openai-completions",
                models: [{ id: "demo", params: { baiyingReasoningConfig: {
                    enabled: true, capability: "effort", compatFormat: "bailian",
                } } }],
            },
        });
        vi.useFakeTimers({ toFake: ["Date"] });
        await fixture.watchdog.enqueueSync({ deletedSourceKeys: ["99999999"] });
        vi.setSystemTime(Date.now() + 3_000);
        await fixture.queue.drain();
        expect(fixture.writeConfigFile).not.toHaveBeenCalled();
        expect(await readFile(fixture.toolFile, "utf8")).toContain("in-flight tool");
        expect(fixture.admission.pending.get("baiying-enhance:managed-agent-sync")?.blocked).toBe(true);
        expect(fixture.admission.pending.get("baiying-enhance:managed-agent-sync")?.payload.deletedSourceKeys)
            .toEqual(["99999999"]);
        expect(fixture.registry.list()).toEqual([]);
        const finishNewExecution = fixture.admission.enter();
        finishNewExecution();
        await fixture.queue.stop();
        await fixture.watchdog.stop();
    });

    it.each([false, true])("restores a hash-verified authorized live snapshot read-only while native reload remains pending (materialized secrets=%s)", async (materializedSecrets) => {
        const fixture = await createExistingSnapshotFixture({ materializedSecrets });
        vi.useFakeTimers({ toFake: ["Date"] });
        await fixture.watchdog.enqueueSync({ fullWorkspaceReseed: true });
        vi.setSystemTime(Date.now() + 3_000);
        await fixture.queue.drain();
        expect(fixture.onReadonlySnapshotRestored).toHaveBeenCalledTimes(1);
        expect(fixture.onSynced).not.toHaveBeenCalled();
        expect(fixture.registry.get(fixture.loaded[0]!.agentId)?.sourceJson).toEqual(fixture.loaded[0]!.sourceJson);
        expect(fixture.writeConfigFile).not.toHaveBeenCalled();
        expect(await readFile(fixture.workspaceFile, "utf8")).toBe("keep applied workspace unchanged");
        expect(fixture.admission.pending.get("baiying-enhance:managed-agent-sync")?.blocked).toBe(true);
        await fixture.queue.stop();
        await fixture.watchdog.stop();
    });

    it.each([
        { missingIndex: true },
        { invalidIndex: true },
        { unauthorized: true },
        { changedModelConfig: true },
    ])("keeps cold readiness unavailable without a verifiable existing snapshot: %j", async (options) => {
        const fixture = await createExistingSnapshotFixture(options);
        vi.useFakeTimers({ toFake: ["Date"] });
        await fixture.watchdog.enqueueSync({ fullWorkspaceReseed: true });
        vi.setSystemTime(Date.now() + 3_000);
        await fixture.queue.drain();
        expect(fixture.onReadonlySnapshotRestored).not.toHaveBeenCalled();
        expect(fixture.onSynced).not.toHaveBeenCalled();
        expect(fixture.registry.list()).toEqual([]);
        expect(fixture.writeConfigFile).not.toHaveBeenCalled();
        expect(await readFile(fixture.workspaceFile, "utf8")).toBe("keep applied workspace unchanged");
        expect(fixture.admission.pending.get("baiying-enhance:managed-agent-sync")?.blocked).toBe(true);
        await fixture.queue.stop();
        await fixture.watchdog.stop();
    });

});
