import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { MAIN_AGENTS_MARKER } from "./main-workspace-seed.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_INDEX_FILENAME,
    INDEX_VERSION,
    loadAgentContentIndex,
} from "./agent-content-index.js";
import {
    createAgentWatchdog as createAgentWatchdogBase,
    loadManagedAgentsFromRedis,
} from "./agent-watchdog.js";
import { AgentRegistryState } from "./agent-state.js";
import { SUBAGENT_ROUTING_FILENAME, SUBAGENT_ROUTING_MARKER } from "./subagent-routing-seed.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";

/** Fixed JSON string so SHA-256 is stable across runs. */
const STABLE_AGENT_JSON =
    '{"agent_list":[{"id":10863047,"name":"Demo","instructions":"Be brief.","runConfig":{"baseUrl":"https://example.com/v1","model":"qwen3-max","apiKey":"test-key"}}]}';

function stableHash(): string {
    return createHash("sha256").update(STABLE_AGENT_JSON, "utf8").digest("hex");
}

function createMockApi(
    writeConfigFile: ReturnType<typeof vi.fn>,
    agentList?: Array<{
        id: string;
        name: string;
        workspace?: string;
        identity?: { name: string };
        skills?: string[];
        tools?: unknown;
    }>,
) {
    const loadConfig = vi.fn(() => ({
        agents: {
            list: agentList ?? [{ id: "main", name: "Main", identity: { name: "Main" } }],
        },
        models: { providers: {} },
    }));
    return {
        logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        runtime: {
            config: {
                loadConfig,
                writeConfigFile: writeConfigFile,
            },
        },
    };
}

async function writeWorkspaceSkill(workspaceDir: string, name: string): Promise<void> {
    await mkdir(path.join(workspaceDir, "skills", name), { recursive: true });
    await writeFile(path.join(workspaceDir, "skills", name, "SKILL.md"), `# ${name}\n`, "utf8");
}

function payloadFromContent(key: string, content: string): RedisJsonPayload {
    return {
        key,
        content,
        raw: JSON.parse(content) as unknown,
        hash: createHash("sha256").update(content, "utf8").digest("hex"),
    };
}

function sourceKeyFromRaw(raw: any, fallback: string): string {
    if (raw?.resourceId != null) return String(raw.resourceId);
    if (Array.isArray(raw?.agent_list) && raw.agent_list[0]?.id != null)
        return String(raw.agent_list[0].id);
    if (raw?.id != null) return String(raw.id).replace(/^baiying-agent-/i, "");
    return fallback;
}

function loadDigEmployeeFixtures(dir: string): Map<string, RedisJsonPayload> {
    const out = new Map<string, RedisJsonPayload>();
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (
            !ent.isFile() ||
            !ent.name.toLowerCase().endsWith(".json") ||
            ent.name === DEFAULT_INDEX_FILENAME
        ) {
            continue;
        }
        const content = readFileSync(path.join(dir, ent.name), "utf8");
        const raw = JSON.parse(content) as any;
        const id = sourceKeyFromRaw(raw, ent.name.replace(/\.json$/i, ""));
        out.set(id, payloadFromContent(`DIG_EMPLOYEE_${id}`, content));
    }
    return out;
}

function createMemoryRedisJsonStore(
    entries: Map<string, RedisJsonPayload>,
    hashEntries = new Map<string, RedisJsonPayload>(),
): BaiyingRedisJsonStore {
    return {
        getJsonByKey: async (key) => {
            const id = key.replace(/^DIG_EMPLOYEE_/, "");
            return entries.get(id) ?? null;
        },
        getHashJson: async ({ key, field }) => hashEntries.get(`${key}:${field}`) ?? null,
        getDigEmployeeJson: async (resourceId) => entries.get(resourceId) ?? null,
        getResourceJson: async ({ resourceBizType, resourceId }) =>
            entries.get(`${resourceBizType}_${resourceId}`) ?? null,
        close: async () => {},
    };
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await access(target);
        return true;
    } catch {
        return false;
    }
}

function createAgentWatchdog(params: any) {
    const fixtureDir = path.dirname(params.contentIndexPath);
    const entries = loadDigEmployeeFixtures(fixtureDir);
    const authorizedIds = new Set(entries.keys());
    return createAgentWatchdogBase({
        redisJsonStore: createMemoryRedisJsonStore(entries),
        authorizationFilter: {
            getAuthorizedSourceKeys: () => new Set(authorizedIds),
        },
        ...params,
    });
}

describe("createAgentWatchdog", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("loads Redis digital employee JSON concurrently with a stable output order", async () => {
        const entries = new Map<string, RedisJsonPayload>();
        for (const id of ["10863047", "10863048", "10863049", "10863050"]) {
            const content = STABLE_AGENT_JSON.replace("10863047", id).replace("Demo", `Demo ${id}`);
            entries.set(id, payloadFromContent(`DIG_EMPLOYEE_${id}`, content));
        }

        let inFlight = 0;
        let maxInFlight = 0;
        const store: BaiyingRedisJsonStore = {
            getJsonByKey: async () => null,
            getHashJson: async () => null,
            getDigEmployeeJson: async (resourceId) => {
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;
                return entries.get(resourceId) ?? null;
            },
            getResourceJson: async () => null,
            close: async () => {},
        };

        const loaded = await loadManagedAgentsFromRedis({
            redisJsonStore: store,
            authorizedSourceKeys: new Set(["10863047", "10863048", "10863049", "10863050"]),
            embedApiKeysFromJson: true,
            concurrency: 2,
            log: { warn: vi.fn() },
        });

        expect(maxInFlight).toBe(2);
        expect(loaded.map((agent) => agent.sourceKey)).toEqual([
            "10863047",
            "10863048",
            "10863049",
            "10863050",
        ]);
    });

    it("attaches Redis AI model config from prologue.modelId", async () => {
        const employeeContent = JSON.stringify({
            resourceId: "10000281",
            resourceName: "项目管理数字员工",
            prologue: JSON.stringify({ modelId: -2000 }),
        });
        const entries = new Map<string, RedisJsonPayload>([
            ["10000281", payloadFromContent("DIG_EMPLOYEE_10000281", employeeContent)],
        ]);
        const modelContent = JSON.stringify({
            authToken: "secret-token",
            instanceParam: { maxTokens: 1024 },
            maxContentToken: "128000",
            modelCode: "glm-5-turbo",
            modelName: "glm-5-turbo",
            status: 1,
            url: "https://lab.iwhalecloud.com/gpt-proxy/v1",
        });
        const hashEntries = new Map<string, RedisJsonPayload>([
            [
                "byai:aimodel:config:-2000",
                payloadFromContent("byai:aimodel:config:-2000", modelContent),
            ],
        ]);

        const loaded = await loadManagedAgentsFromRedis({
            redisJsonStore: createMemoryRedisJsonStore(entries, hashEntries),
            authorizedSourceKeys: new Set(["10000281"]),
            embedApiKeysFromJson: false,
            log: { warn: vi.fn() },
        });

        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.baiyingModelId).toBe("-2000");
        expect(loaded[0]?.providerKey).toBe("baiying-m-neg-2000");
        expect(loaded[0]?.modelRef).toBe("baiying-m-neg-2000/glm-5-turbo");
        expect(loaded[0]?.listEntry.model).toEqual({
            primary: "baiying-m-neg-2000/glm-5-turbo",
        });
        expect(JSON.stringify(loaded[0])).not.toContain("secret-token");
    });

    it("__flushNow syncs prologue modelId changes without periodic scan", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-model-scan-"));
        const employeeKey = "10000455";
        const agentId = `${MANAGED_AGENT_PREFIX}${employeeKey}`;
        const employeeContent = (modelId: number) =>
            JSON.stringify({
                resourceId: employeeKey,
                resourceName: "陈舵主的个人助理",
                prologue: JSON.stringify({ modelId }),
            });
        const entries = new Map<string, RedisJsonPayload>([
            [
                employeeKey,
                payloadFromContent(`DIG_EMPLOYEE_${employeeKey}`, employeeContent(-2000)),
            ],
        ]);
        const hashEntries = new Map<string, RedisJsonPayload>([
            [
                "byai:aimodel:config:-2000",
                payloadFromContent(
                    "byai:aimodel:config:-2000",
                    JSON.stringify({
                        authToken: "secret-token-old",
                        modelCode: "glm-5-turbo",
                        modelName: "glm-5-turbo",
                        status: 1,
                        url: "https://lab.iwhalecloud.com/gpt-proxy/v1",
                    }),
                ),
            ],
            [
                "byai:aimodel:config:10004014",
                payloadFromContent(
                    "byai:aimodel:config:10004014",
                    JSON.stringify({
                        authToken: "secret-token-new",
                        modelCode: "deepseek-v4-flash",
                        modelName: "deepseek-v4-flash",
                        status: 1,
                        url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    }),
                ),
            ],
        ]);
        let activeConfig: any = {
            agents: { list: [{ id: "main", name: "Main", identity: { name: "Main" } }] },
            models: { providers: {} },
        };
        const writeConfigFile = vi.fn(async (next) => {
            activeConfig = next;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => activeConfig);

        const wd = createAgentWatchdogBase({
            redisJsonStore: createMemoryRedisJsonStore(entries, hashEntries),
            authorizationFilter: {
                getAuthorizedSourceKeys: () => new Set([employeeKey]),
            },
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: false,
                workspaceAutoSeed: false,
                persistAgentContentIndex: false,
                workspaceSkillScanIntervalMs: 0,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        expect(activeConfig.agents.list.find((entry: any) => entry.id === agentId)?.model).toEqual({
            primary: "baiying-m-neg-2000/glm-5-turbo",
        });
        writeConfigFile.mockClear();

        entries.set(
            employeeKey,
            payloadFromContent(`DIG_EMPLOYEE_${employeeKey}`, employeeContent(10004014)),
        );
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalled();
        expect(activeConfig.agents.list.find((entry: any) => entry.id === agentId)?.model).toEqual({
            primary: "baiying-m-10004014/deepseek-v4-flash",
        });
        expect(Object.keys(activeConfig.models.providers)).toContain("baiying-m-10004014");
        expect(Object.keys(activeConfig.models.providers)).not.toContain("baiying-m-neg-2000");
        expect(JSON.stringify(activeConfig)).not.toContain("secret-token-new");
    });

    it("leaves model unset on first sync when Redis AI model config is missing", async () => {
        const employeeContent = JSON.stringify({
            resourceId: "10000281",
            resourceName: "项目管理数字员工",
            prologue: JSON.stringify({ modelId: -2000 }),
        });
        const entries = new Map<string, RedisJsonPayload>([
            ["10000281", payloadFromContent("DIG_EMPLOYEE_10000281", employeeContent)],
        ]);
        const warn = vi.fn();

        const loaded = await loadManagedAgentsFromRedis({
            redisJsonStore: createMemoryRedisJsonStore(entries),
            authorizedSourceKeys: new Set(["10000281"]),
            embedApiKeysFromJson: false,
            log: { warn },
        });

        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.provider).toBeUndefined();
        expect(loaded[0]?.listEntry.model).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
            "baiying-enhance: Redis AI model config missing/unreadable modelId=-2000",
        );
    });

    it("retains last synced aimodel when Redis AI model config becomes unavailable", async () => {
        const employeeContent = JSON.stringify({
            resourceId: "10000281",
            resourceName: "项目管理数字员工",
            prologue: JSON.stringify({ modelId: -2000 }),
        });
        const entries = new Map<string, RedisJsonPayload>([
            ["10000281", payloadFromContent("DIG_EMPLOYEE_10000281", employeeContent)],
        ]);
        const warn = vi.fn();
        const previous = {
            sourceKey: "10000281",
            agentId: "baiying-agent-10000281",
            providerKey: "baiying-m-10004000",
            modelRef: "baiying-m-10004000/qwen3.6-27b",
            allowSpawnFrom: ["main"],
            listEntry: {
                id: "baiying-agent-10000281",
                name: "项目管理数字员工",
                model: { primary: "baiying-m-10004000/qwen3.6-27b" },
            },
            provider: {
                baseUrl: "https://example.com/v1",
                apiKey: { source: "exec", provider: "baiying-aimodel-redis", id: "model:10004000" },
                api: "openai-completions" as const,
                modelId: "qwen3.6-27b",
            },
        };

        const loaded = await loadManagedAgentsFromRedis({
            redisJsonStore: createMemoryRedisJsonStore(entries),
            authorizedSourceKeys: new Set(["10000281"]),
            embedApiKeysFromJson: false,
            previousByAgentId: new Map([[previous.agentId, previous]]),
            log: { warn },
        });

        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.listEntry.model).toEqual({
            primary: "baiying-m-10004000/qwen3.6-27b",
        });
        expect(loaded[0]?.providerKey).toBe("baiying-m-10004000");
        expect(warn).toHaveBeenCalledWith(
            "baiying-enhance: Redis AI model config unavailable for modelId=-2000; keeping last synced model baiying-m-10004000/qwen3.6-27b",
        );
    });

    it("does not call writeConfigFile when index matches Redis content", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const indexPayload = {
            version: INDEX_VERSION,
            entries: { [agentId]: stableHash() },
        };
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify(indexPayload),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", identity: { name: "Main" } },
            { id: agentId, name: "Demo", identity: { name: "Demo" } },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).not.toHaveBeenCalled();
    });

    it("calls writeConfigFile when index matches disk but fullWorkspaceReseed (auth) forces sync", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const indexPayload = {
            version: INDEX_VERSION,
            entries: { [agentId]: stableHash() },
        };
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify(indexPayload),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", identity: { name: "Main" } },
            { id: agentId, name: "Demo", identity: { name: "Demo" } },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!({ fullWorkspaceReseed: true });
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
    });

    it("calls writeConfigFile when index matches but managed agent missing in config", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify({
                version: INDEX_VERSION,
                entries: { [agentId]: stableHash() },
            }),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
    });

    it("touches skills reload marker when relTools changes the managed agent tool policy", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-tools-"));
        const raw = {
            resourceId: "10000455",
            resourceName: "Demo",
            roleAttributes: "Be brief.",
            integrationType: "NONE",
            relTools: ["read"],
        };
        const content = JSON.stringify(raw);
        await writeFile(path.join(dir, "demo.json"), content, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10000455`;
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify({
                version: INDEX_VERSION,
                entries: {
                    [agentId]: createHash("sha256").update(content, "utf8").digest("hex"),
                },
            }),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", identity: { name: "Main" } },
            {
                id: agentId,
                name: "Demo",
                identity: { name: "Demo" },
                skills: [],
                tools: { allow: ["*", "read", "write", "baiying_call"] },
            },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const next = writeConfigFile.mock.calls[0][0];
        const entry = next.agents.list.find((a: any) => a.id === agentId);
        expect(entry.tools).toEqual({ allow: ["read", "baiying_call"] });
        expect(next.skills.entries.__baiying_enhance_reload.enabled).toBe(false);
        expect(next.skills.entries.__baiying_enhance_reload.config.reason).toBe(
            "agent-tool-policy-sync",
        );
        expect(
            next.skills.entries.__baiying_enhance_reload.config.managedSnapshotSignature,
        ).toContain('tools={"allow":["read","baiying_call"]}');
    });

    it("calls writeConfigFile once when index is missing", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const idxRaw = await readFile(path.join(dir, DEFAULT_INDEX_FILENAME), "utf8");
        const parsed = JSON.parse(idxRaw) as { version: number; entries: Record<string, string> };
        expect(parsed.version).toBe(INDEX_VERSION);
        expect(parsed.entries[`${MANAGED_AGENT_PREFIX}10863047`]).toBe(stableHash());
    });

    it("calls writeConfigFile when index hash does not match file", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify({
                version: INDEX_VERSION,
                entries: { [agentId]: "0".repeat(64) },
            }),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const loaded = await loadAgentContentIndex(path.join(dir, DEFAULT_INDEX_FILENAME));
        expect(loaded.get(agentId)).toBe(stableHash());
    });

    it("removes managed agent when deletedSourceKeys is set even if JSON file still exists", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-del-"));
        const stateDir = path.join(dir, ".openclaw");
        vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const activeWs = path.join(stateDir, `workspace-${agentId}`);
        const archiveRoot = path.join(dir, ".baiying-workspaces");
        const archiveWs = path.join(archiveRoot, path.basename(activeWs));
        await mkdir(activeWs, { recursive: true });
        await writeFile(path.join(activeWs, "deleted.txt"), "delete signal delete", "utf8");
        const indexPayload = {
            version: INDEX_VERSION,
            entries: { [agentId]: stableHash() },
        };
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify(indexPayload),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", identity: { name: "Main" } },
            { id: agentId, name: "Demo", identity: { name: "Demo" } },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceArchiveDir: archiveRoot,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        expect(writeConfigFile).not.toHaveBeenCalled();

        await wd.__flushNow!({ deletedSourceKeys: ["10863047"] });
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        expect(await pathExists(activeWs)).toBe(false);
        expect(await pathExists(archiveWs)).toBe(false);
        const logText = api.logger.info.mock.calls.map((call: any[]) => String(call[0])).join("\n");
        expect(logText).toContain(`deleted workspace for ${agentId} (DIG_EMPLOYEE_DELETED)`);
    });

    it("cleans up an explicit delete workspace even when auth is not ready", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-del-auth-pending-"));
        const stateDir = path.join(dir, ".openclaw");
        vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const activeWs = path.join(stateDir, `workspace-${agentId}`);
        await mkdir(activeWs, { recursive: true });
        await writeFile(path.join(activeWs, "deleted.txt"), "delete despite pending auth", "utf8");

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", identity: { name: "Main" } },
            { id: agentId, name: "Demo", workspace: activeWs, identity: { name: "Demo" } },
        ]) as any;

        const wd = createAgentWatchdogBase({
            api,
            registry: new AgentRegistryState(),
            redisJsonStore: createMemoryRedisJsonStore(new Map()),
            authorizationFilter: { getAuthorizedSourceKeys: () => undefined },
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: false,
            },
            debounceMs: 60_000,
        });

        await wd.start({ deferInitialFlush: true });
        await wd.__flushNow!({ deletedSourceKeys: ["10863047"] });
        await wd.stop();

        expect(writeConfigFile).not.toHaveBeenCalled();
        expect(await pathExists(activeWs)).toBe(false);
        const warnText = api.logger.warn.mock.calls
            .map((call: any[]) => String(call[0]))
            .join("\n");
        expect(warnText).toContain("applying explicit delete workspace cleanup only for 10863047");
    });

    it("unregisters agent when authorization filter excludes it", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", identity: { name: "Main" } },
            { id: agentId, name: "Demo", identity: { name: "Demo" } },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: true,
            },
            debounceMs: 60_000,
            authorizationFilter: {
                getAuthorizedSourceKeys: () => new Set(),
            },
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
    });

    it("archives a managed workspace when authorization excludes the agent", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "baiying-wd-archive-"));
        const activeWs = path.join(root, ".openclaw", `workspace-${MANAGED_AGENT_PREFIX}10863047`);
        const archiveRoot = path.join(root, ".baiying-workspaces");
        const archiveWs = path.join(archiveRoot, path.basename(activeWs));
        await mkdir(activeWs, { recursive: true });
        await writeFile(path.join(activeWs, "secret.txt"), "do not expose", "utf8");

        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        let activeAgentList: any[] = [
            { id: "main", name: "Main", identity: { name: "Main" } },
            { id: agentId, name: "Demo", workspace: activeWs, identity: { name: "Demo" } },
        ];
        const writeConfigFile = vi.fn(async (next) => {
            activeAgentList = next.agents.list;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: activeAgentList },
            models: { providers: {} },
        }));

        const entries = new Map<string, RedisJsonPayload>([
            ["10863047", payloadFromContent("DIG_EMPLOYEE_10863047", STABLE_AGENT_JSON)],
        ]);
        const wd = createAgentWatchdogBase({
            api,
            registry: new AgentRegistryState(),
            redisJsonStore: createMemoryRedisJsonStore(entries),
            authorizationFilter: { getAuthorizedSourceKeys: () => new Set() },
            contentIndexPath: path.join(root, "agent-content-index.json"),
            executorPath: path.join(root, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceArchiveDir: archiveRoot,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: false,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        expect(await pathExists(activeWs)).toBe(false);
        expect(await readFile(path.join(archiveWs, "secret.txt"), "utf8")).toBe("do not expose");
    });

    it("archives unauthorized mounted managed workspaces on startup even when config has no agent entry", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "baiying-wd-mounted-orphan-"));
        const stateDir = path.join(root, ".openclaw");
        vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
        const orphanAgentId = `${MANAGED_AGENT_PREFIX}222`;
        const activeWs = path.join(stateDir, `workspace-${orphanAgentId}`);
        const archiveRoot = path.join(root, ".baiying-workspaces");
        const archiveWs = path.join(archiveRoot, path.basename(activeWs));
        await mkdir(activeWs, { recursive: true });
        await writeFile(path.join(activeWs, "history.txt"), "archived on startup", "utf8");

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile) as any;

        const wd = createAgentWatchdogBase({
            api,
            registry: new AgentRegistryState(),
            redisJsonStore: createMemoryRedisJsonStore(new Map()),
            authorizationFilter: { getAuthorizedSourceKeys: () => new Set() },
            contentIndexPath: path.join(root, "agent-content-index.json"),
            executorPath: path.join(root, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceArchiveDir: archiveRoot,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: false,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).not.toHaveBeenCalled();
        expect(await pathExists(activeWs)).toBe(false);
        expect(await readFile(path.join(archiveWs, "history.txt"), "utf8")).toBe(
            "archived on startup",
        );
        const logText = api.logger.info.mock.calls.map((call: any[]) => String(call[0])).join("\n");
        expect(logText).toContain("cold-start/pre-restore unauthorized workspace archive check");
        expect(logText).toContain("unauthorizedActiveWorkspaces=1");
        expect(logText).toContain(orphanAgentId);
        expect(logText).toContain(`${activeWs} -> ${archiveWs}`);
    });

    it("restores an archived workspace and seeds latest managed markdown on reauthorization", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "baiying-wd-restore-"));
        const stateDir = path.join(root, ".openclaw");
        vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
        const activeWs = path.join(stateDir, `workspace-${MANAGED_AGENT_PREFIX}10863047`);
        const archiveRoot = path.join(root, ".baiying-workspaces");
        const archiveWs = path.join(archiveRoot, path.basename(activeWs));
        await mkdir(archiveWs, { recursive: true });
        await writeFile(path.join(archiveWs, "notes.txt"), "keep me", "utf8");
        await writeFile(
            path.join(archiveWs, "SOUL.md"),
            "<!-- baiying-enhance: managed seed -->\n\nOld prompt\n",
            "utf8",
        );

        const content = JSON.stringify({
            agent_list: [{ id: 10863047, name: "Demo", instructions: "Fresh prompt." }],
        });
        const entries = new Map<string, RedisJsonPayload>([
            ["10863047", payloadFromContent("DIG_EMPLOYEE_10863047", content)],
        ]);

        let activeAgentList: any[] = [{ id: "main", name: "Main", identity: { name: "Main" } }];
        const writeConfigFile = vi.fn(async (next) => {
            activeAgentList = next.agents.list;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: activeAgentList },
            models: { providers: {} },
        }));

        const wd = createAgentWatchdogBase({
            api,
            registry: new AgentRegistryState(),
            redisJsonStore: createMemoryRedisJsonStore(entries),
            authorizationFilter: { getAuthorizedSourceKeys: () => new Set(["10863047"]) },
            contentIndexPath: path.join(root, "agent-content-index.json"),
            executorPath: path.join(root, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceArchiveDir: archiveRoot,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: false,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(await pathExists(archiveWs)).toBe(false);
        expect(await readFile(path.join(activeWs, "notes.txt"), "utf8")).toBe("keep me");
        expect(await readFile(path.join(activeWs, "SOUL.md"), "utf8")).toContain("Fresh prompt.");
    });

    it("keeps an existing active workspace during restore and still updates managed markdown", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "baiying-wd-restore-existing-"));
        const stateDir = path.join(root, ".openclaw");
        vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
        const activeWs = path.join(stateDir, `workspace-${MANAGED_AGENT_PREFIX}10863047`);
        const archiveRoot = path.join(root, ".baiying-workspaces");
        const archiveWs = path.join(archiveRoot, path.basename(activeWs));
        await mkdir(activeWs, { recursive: true });
        await mkdir(archiveWs, { recursive: true });
        await writeFile(path.join(archiveWs, "archive-only.txt"), "archived", "utf8");
        await writeFile(
            path.join(activeWs, "SOUL.md"),
            "<!-- baiying-enhance: managed seed -->\n\nOld active prompt\n",
            "utf8",
        );

        const content = JSON.stringify({
            agent_list: [{ id: 10863047, name: "Demo", instructions: "Fresh active prompt." }],
        });
        const entries = new Map<string, RedisJsonPayload>([
            ["10863047", payloadFromContent("DIG_EMPLOYEE_10863047", content)],
        ]);
        let activeAgentList: any[] = [{ id: "main", name: "Main", identity: { name: "Main" } }];
        const writeConfigFile = vi.fn(async (next) => {
            activeAgentList = next.agents.list;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: activeAgentList },
            models: { providers: {} },
        }));

        const wd = createAgentWatchdogBase({
            api,
            registry: new AgentRegistryState(),
            redisJsonStore: createMemoryRedisJsonStore(entries),
            authorizationFilter: { getAuthorizedSourceKeys: () => new Set(["10863047"]) },
            contentIndexPath: path.join(root, "agent-content-index.json"),
            executorPath: path.join(root, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceArchiveDir: archiveRoot,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: false,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(await readFile(path.join(archiveWs, "archive-only.txt"), "utf8")).toBe("archived");
        expect(await readFile(path.join(activeWs, "SOUL.md"), "utf8")).toContain(
            "Fresh active prompt.",
        );
    });

    it("rotates an existing archive before archiving the active workspace", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "baiying-wd-archive-rotate-"));
        const activeWs = path.join(root, ".openclaw", `workspace-${MANAGED_AGENT_PREFIX}10863047`);
        const archiveRoot = path.join(root, ".baiying-workspaces");
        const archiveWs = path.join(archiveRoot, path.basename(activeWs));
        await mkdir(activeWs, { recursive: true });
        await mkdir(archiveWs, { recursive: true });
        await writeFile(path.join(activeWs, "active.txt"), "new active", "utf8");
        await writeFile(path.join(archiveWs, "old.txt"), "old archive", "utf8");

        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        let activeAgentList: any[] = [
            { id: "main", name: "Main", identity: { name: "Main" } },
            { id: agentId, name: "Demo", workspace: activeWs, identity: { name: "Demo" } },
        ];
        const writeConfigFile = vi.fn(async (next) => {
            activeAgentList = next.agents.list;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: activeAgentList },
            models: { providers: {} },
        }));

        const wd = createAgentWatchdogBase({
            api,
            registry: new AgentRegistryState(),
            redisJsonStore: createMemoryRedisJsonStore(new Map()),
            authorizationFilter: { getAuthorizedSourceKeys: () => new Set() },
            contentIndexPath: path.join(root, "agent-content-index.json"),
            executorPath: path.join(root, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceArchiveDir: archiveRoot,
                workspaceSkillAutoEnable: false,
                persistAgentContentIndex: false,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(await pathExists(activeWs)).toBe(false);
        expect(await readFile(path.join(archiveWs, "active.txt"), "utf8")).toBe("new active");
        const rotated = (await readdir(archiveRoot)).filter((name) =>
            name.startsWith(`${path.basename(activeWs)}.`),
        );
        expect(rotated).toHaveLength(1);
        expect(await readFile(path.join(archiveRoot, rotated[0], "old.txt"), "utf8")).toBe(
            "old archive",
        );
    });

    it("restores before workspace skill merge even when workspaceAutoSeed is false", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "baiying-wd-restore-skills-"));
        const stateDir = path.join(root, ".openclaw");
        vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
        const activeWs = path.join(stateDir, `workspace-${MANAGED_AGENT_PREFIX}10863047`);
        const archiveRoot = path.join(root, ".baiying-workspaces");
        const archiveWs = path.join(archiveRoot, path.basename(activeWs));
        await writeWorkspaceSkill(archiveWs, "alpha");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const entries = new Map<string, RedisJsonPayload>([
            ["10863047", payloadFromContent("DIG_EMPLOYEE_10863047", STABLE_AGENT_JSON)],
        ]);

        let activeAgentList: any[] = [{ id: "main", name: "Main", identity: { name: "Main" } }];
        const writeConfigFile = vi.fn(async (next) => {
            activeAgentList = next.agents.list;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: activeAgentList },
            models: { providers: {} },
        }));

        const wd = createAgentWatchdogBase({
            api,
            registry: new AgentRegistryState(),
            redisJsonStore: createMemoryRedisJsonStore(entries),
            authorizationFilter: { getAuthorizedSourceKeys: () => new Set(["10863047"]) },
            contentIndexPath: path.join(root, "agent-content-index.json"),
            executorPath: path.join(root, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                workspaceArchiveDir: archiveRoot,
                persistAgentContentIndex: false,
                workspaceSkillScanIntervalMs: 0,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(await pathExists(activeWs)).toBe(true);
        const next = writeConfigFile.mock.calls[0][0];
        const entry = next.agents.list.find((a: any) => a.id === agentId);
        expect(entry.skills).toEqual(["alpha"]);
    });

    it("seeds main AGENTS.md when mainAgentsMdPath is set (default mainWorkspaceAgentsAutoSeed)", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const tplPath = path.join(dir, "main-template.md");
        await writeFile(tplPath, "# From template\n", "utf8");

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            { id: agentId, name: "Demo", identity: { name: "Demo" } },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: true,
                persistAgentContentIndex: true,
                mainAgentsMdPath: tplPath,
                mainAgentsMdMode: "always",
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        const agentsMd = await readFile(path.join(mainWs, "AGENTS.md"), "utf8");
        expect(agentsMd.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
        expect(agentsMd).toContain("# From template");

        const routingMd = await readFile(path.join(mainWs, SUBAGENT_ROUTING_FILENAME), "utf8");
        expect(routingMd.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
        expect(routingMd).toContain(agentId);
    });

    it("seeds main AGENTS.md when workspaceAutoSeed is false but mainWorkspaceAgentsAutoSeed is default", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        const tplPath = path.join(dir, "main-template.md");
        await writeFile(tplPath, "# No managed seed\n", "utf8");

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            { id: agentId, name: "Demo", identity: { name: "Demo" } },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: true,
                mainAgentsMdPath: tplPath,
                mainAgentsMdMode: "always",
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        const agentsMd = await readFile(path.join(mainWs, "AGENTS.md"), "utf8");
        expect(agentsMd.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
        expect(agentsMd).toContain("# No managed seed");

        const routingMd = await readFile(path.join(mainWs, SUBAGENT_ROUTING_FILENAME), "utf8");
        expect(routingMd.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
        expect(routingMd).toContain(agentId);
    });

    it("calls writeConfigFile when only workspace skills changed", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-skill-"));
        const agentWs = await mkdtemp(path.join(tmpdir(), "baiying-agentws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        await writeWorkspaceSkill(agentWs, "alpha");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify({
                version: INDEX_VERSION,
                entries: { [agentId]: stableHash() },
            }),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            {
                id: agentId,
                name: "Demo",
                workspace: agentWs,
                identity: { name: "Demo" },
                skills: [],
            },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: true,
                workspaceSkillScanIntervalMs: 0,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const next = writeConfigFile.mock.calls[0][0];
        const entry = next.agents.list.find((a: any) => a.id === agentId);
        expect(entry.skills).toEqual(["alpha"]);
        expect(entry.workspace).toBe(agentWs);
    });

    it("merges JSON, agent workspace, and main shared workspace skills", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-skill-"));
        const agentWs = await mkdtemp(path.join(tmpdir(), "baiying-agentws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(
            path.join(dir, "demo.json"),
            JSON.stringify({
                skills: ["json-skill", "shared-skill"],
                agent_list: [{ id: 10863047, name: "Demo", instructions: "Be brief." }],
            }),
            "utf8",
        );
        await writeWorkspaceSkill(agentWs, "agent-skill");
        await writeWorkspaceSkill(mainWs, "shared-skill");
        await writeWorkspaceSkill(mainWs, "main-skill");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            {
                id: agentId,
                name: "Demo",
                workspace: agentWs,
                identity: { name: "Demo" },
                skills: [],
            },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: false,
                workspaceSkillIncludeMainShared: true,
                workspaceSkillScanIntervalMs: 0,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const next = writeConfigFile.mock.calls[0][0];
        const entry = next.agents.list.find((a: any) => a.id === agentId);
        expect(entry.skills).toEqual(["json-skill", "shared-skill", "agent-skill", "main-skill"]);
    });

    it("does not merge main workspace skills by default", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-skill-"));
        const agentWs = await mkdtemp(path.join(tmpdir(), "baiying-agentws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        await writeWorkspaceSkill(mainWs, "main-only-skill");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            {
                id: agentId,
                name: "Demo",
                workspace: agentWs,
                identity: { name: "Demo" },
                skills: [],
            },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: false,
                workspaceSkillScanIntervalMs: 0,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const next = writeConfigFile.mock.calls[0][0];
        const entry = next.agents.list.find((a: any) => a.id === agentId);
        expect(entry.skills).toEqual([]);
    });

    it("does not merge skills from another managed agent workspace", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-skill-"));
        const agentOneWs = await mkdtemp(path.join(tmpdir(), "baiying-agent-one-ws-"));
        const agentTwoWs = await mkdtemp(path.join(tmpdir(), "baiying-agent-two-ws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(
            path.join(dir, "one.json"),
            JSON.stringify({
                relSkills: ["dws", "clawhub"],
                agent_list: [{ id: 10863047, name: "One", instructions: "Be brief." }],
            }),
            "utf8",
        );
        await writeFile(
            path.join(dir, "two.json"),
            JSON.stringify({
                agent_list: [{ id: 10863048, name: "Two", instructions: "Be brief." }],
            }),
            "utf8",
        );
        await writeWorkspaceSkill(agentTwoWs, "other-agent-skill");
        const agentOneId = `${MANAGED_AGENT_PREFIX}10863047`;
        const agentTwoId = `${MANAGED_AGENT_PREFIX}10863048`;

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            {
                id: agentOneId,
                name: "One",
                workspace: agentOneWs,
                identity: { name: "One" },
                skills: [],
            },
            {
                id: agentTwoId,
                name: "Two",
                workspace: agentTwoWs,
                identity: { name: "Two" },
                skills: [],
            },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: false,
                workspaceSkillScanIntervalMs: 0,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const next = writeConfigFile.mock.calls[0][0];
        const one = next.agents.list.find((a: any) => a.id === agentOneId);
        const two = next.agents.list.find((a: any) => a.id === agentTwoId);
        expect(one.skills).toEqual(["dws", "clawhub"]);
        expect(two.skills).toEqual(["other-agent-skill"]);
    });

    it("removes stale workspace skills from config when the uploaded SKILL.md is gone", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-skill-"));
        const agentWs = await mkdtemp(path.join(tmpdir(), "baiying-agentws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
        await writeFile(
            path.join(dir, DEFAULT_INDEX_FILENAME),
            JSON.stringify({
                version: INDEX_VERSION,
                entries: { [agentId]: stableHash() },
            }),
            "utf8",
        );

        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile, [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            {
                id: agentId,
                name: "Demo",
                workspace: agentWs,
                identity: { name: "Demo" },
                skills: ["deleted-skill"],
            },
        ]) as any;

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: true,
                workspaceSkillScanIntervalMs: 0,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        const next = writeConfigFile.mock.calls[0][0];
        const entry = next.agents.list.find((a: any) => a.id === agentId);
        expect(entry.skills).toEqual([]);
    });

    it("periodic workspace skill scan does not unregister agents when agent JSON is unavailable", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-skill-"));
        const agentWs = await mkdtemp(path.join(tmpdir(), "baiying-agentws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        const jsonPath = path.join(dir, "demo.json");
        await writeFile(jsonPath, STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;

        let activeAgentList: any[] = [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
        ];
        const writeConfigFile = vi.fn(async (next) => {
            activeAgentList = next.agents.list;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: activeAgentList },
            models: { providers: {} },
        }));

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: false,
                workspaceSkillScanIntervalMs: 100,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        writeConfigFile.mockClear();

        await unlink(jsonPath);
        await writeWorkspaceSkill(agentWs, "alpha");
        activeAgentList = [
            ...activeAgentList.map((entry) =>
                entry.id === agentId ? { ...entry, workspace: agentWs } : entry,
            ),
            {
                id: `${MANAGED_AGENT_PREFIX}99999999`,
                name: "Other Managed",
                identity: { name: "Other Managed" },
                skills: ["keep-me"],
            },
        ];
        await new Promise((resolve) => setTimeout(resolve, 150));
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalled();
        const next = writeConfigFile.mock.calls.at(-1)?.[0];
        const ids = next.agents.list.map((entry: any) => entry.id);
        expect(ids).toContain(agentId);
        expect(ids).toContain(`${MANAGED_AGENT_PREFIX}99999999`);
        expect(ids).not.toEqual(["main"]);
        const agentEntry = next.agents.list.find((entry: any) => entry.id === agentId);
        expect(agentEntry.skills).toContain("alpha");
        const otherEntry = next.agents.list.find(
            (entry: any) => entry.id === `${MANAGED_AGENT_PREFIX}99999999`,
        );
        expect(otherEntry.skills).toEqual(["keep-me"]);
        const logText = api.logger.info.mock.calls.map((call: any[]) => String(call[0])).join("\n");
        expect(logText).toContain(`workspace skill sync`);
        expect(logText).toContain(`${agentId} (Demo)`);
        expect(logText).toContain("enabled=[alpha]");
        expect(logText).toContain("active=[alpha]");
    });

    it("uses a full sync when workspace skill refresh sees a stale config snapshot", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-stale-skill-"));
        const stateDir = await mkdtemp(path.join(tmpdir(), "baiying-state-"));
        const agentOneWs = await mkdtemp(path.join(tmpdir(), "baiying-agentws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
        await writeFile(path.join(dir, "demo-one.json"), STABLE_AGENT_JSON, "utf8");
        await writeFile(
            path.join(dir, "demo-two.json"),
            JSON.stringify({
                agent_list: [{ id: 10863048, name: "Second", instructions: "Be brief." }],
            }),
            "utf8",
        );
        const agentOneId = `${MANAGED_AGENT_PREFIX}10863047`;
        const agentTwoId = `${MANAGED_AGENT_PREFIX}10863048`;
        await writeWorkspaceSkill(
            path.join(stateDir, `workspace-${agentTwoId}`),
            "alpha",
        );

        const staleAgentList: any[] = [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
            {
                id: agentOneId,
                name: "Demo",
                workspace: agentOneWs,
                identity: { name: "Demo" },
                skills: [],
            },
        ];
        const writeConfigFile = vi.fn(async () => {});
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: staleAgentList },
            models: { providers: {} },
        }));

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: false,
                workspaceSkillScanIntervalMs: 50,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        writeConfigFile.mockClear();

        await new Promise((resolve) => setTimeout(resolve, 120));
        await wd.stop();

        expect(writeConfigFile).toHaveBeenCalled();
        const next = writeConfigFile.mock.calls.at(-1)?.[0];
        const ids = next.agents.list.map((entry: any) => entry.id);
        expect(ids).toContain(agentOneId);
        expect(ids).toContain(agentTwoId);
        const agentTwoEntry = next.agents.list.find((entry: any) => entry.id === agentTwoId);
        expect(agentTwoEntry.skills).toEqual(["alpha"]);
        const logText = api.logger.info.mock.calls.map((call: any[]) => String(call[0])).join("\n");
        expect(logText).toContain("stale config snapshot");
    });

    it("suppresses repeated workspace skill write failure logs for the same desired state", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-skill-"));
        const agentWs = await mkdtemp(path.join(tmpdir(), "baiying-agentws-"));
        const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-mainws-"));
        await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
        const agentId = `${MANAGED_AGENT_PREFIX}10863047`;

        let activeAgentList: any[] = [
            { id: "main", name: "Main", workspace: mainWs, identity: { name: "Main" } },
        ];
        const writeConfigFile = vi.fn(async (next) => {
            activeAgentList = next.agents.list;
        });
        const api = createMockApi(writeConfigFile) as any;
        api.runtime.config.loadConfig = vi.fn(() => ({
            agents: { list: activeAgentList },
            models: { providers: {} },
        }));

        const wd = createAgentWatchdog({
            api,
            registry: new AgentRegistryState(),
            absoluteDir: dir,
            contentIndexPath: path.join(dir, DEFAULT_INDEX_FILENAME),
            executorPath: path.join(dir, "executor.py"),
            pluginConfig: {
                embedApiKeysFromJson: true,
                workspaceAutoSeed: false,
                persistAgentContentIndex: false,
                workspaceSkillScanIntervalMs: 50,
            },
            debounceMs: 60_000,
        });

        await wd.start();
        await wd.__flushNow!();
        activeAgentList = activeAgentList.map((entry) =>
            entry.id === agentId ? { ...entry, workspace: agentWs } : entry,
        );
        api.runtime.config.writeConfigFile = vi.fn(async () => {
            throw new Error("Config write rejected");
        });
        await writeWorkspaceSkill(agentWs, "alpha");
        await new Promise((resolve) => setTimeout(resolve, 180));
        await wd.stop();

        const warnings = api.logger.warn.mock.calls
            .map((call: any[]) => String(call[0]))
            .filter((message: string) => message.includes("workspace skill sync failed"));
        expect(warnings).toHaveLength(1);
    });
});
