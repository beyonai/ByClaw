import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { MAIN_AGENTS_MARKER } from "./main-workspace-seed.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INDEX_FILENAME, INDEX_VERSION, loadAgentContentIndex } from "./agent-content-index.js";
import { createAgentWatchdog } from "./agent-watchdog.js";
import { AgentRegistryState } from "./agent-state.js";
import { SUBAGENT_ROUTING_FILENAME, SUBAGENT_ROUTING_MARKER } from "./subagent-routing-seed.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

/** Fixed JSON string so SHA-256 is stable across runs. */
const STABLE_AGENT_JSON =
  '{"agent_list":[{"id":10863047,"name":"Demo","instructions":"Be brief.","runConfig":{"baseUrl":"https://example.com/v1","model":"qwen3-max","apiKey":"test-key"}}]}';

function stableHash(): string {
  return createHash("sha256").update(STABLE_AGENT_JSON, "utf8").digest("hex");
}

function createMockApi(
  writeConfigFile: ReturnType<typeof vi.fn>,
  agentList?: Array<{ id: string; name: string; workspace?: string; identity?: { name: string } }>,
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

describe("createAgentWatchdog", () => {
  it("does not call writeConfigFile when index matches disk content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baiying-wd-"));
    await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
    const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
    const indexPayload = {
      version: INDEX_VERSION,
      entries: { [agentId]: stableHash() },
    };
    await writeFile(path.join(dir, DEFAULT_INDEX_FILENAME), JSON.stringify(indexPayload), "utf8");

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
    await writeFile(path.join(dir, DEFAULT_INDEX_FILENAME), JSON.stringify(indexPayload), "utf8");

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
        persistAgentContentIndex: true,
      },
      debounceMs: 60_000,
    });

    await wd.start();
    await wd.__flushNow!();
    await wd.stop();

    expect(writeConfigFile).toHaveBeenCalledTimes(1);
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
    await writeFile(path.join(dir, "demo.json"), STABLE_AGENT_JSON, "utf8");
    const agentId = `${MANAGED_AGENT_PREFIX}10863047`;
    const indexPayload = {
      version: INDEX_VERSION,
      entries: { [agentId]: stableHash() },
    };
    await writeFile(path.join(dir, DEFAULT_INDEX_FILENAME), JSON.stringify(indexPayload), "utf8");

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
    });

    await wd.start();
    await wd.__flushNow!();
    expect(writeConfigFile).not.toHaveBeenCalled();

    await wd.__flushNow!({ deletedSourceKeys: ["10863047"] });
    await wd.stop();

    expect(writeConfigFile).toHaveBeenCalledTimes(1);
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
});
