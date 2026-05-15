import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
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
  agentList?: Array<{
    id: string;
    name: string;
    workspace?: string;
    identity?: { name: string };
    skills?: string[];
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
      { id: agentId, name: "Demo", workspace: agentWs, identity: { name: "Demo" }, skills: [] },
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
      { id: agentId, name: "Demo", workspace: agentWs, identity: { name: "Demo" }, skills: [] },
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
      { id: agentId, name: "Demo", workspace: agentWs, identity: { name: "Demo" }, skills: [] },
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
    const otherEntry = next.agents.list.find((entry: any) => entry.id === `${MANAGED_AGENT_PREFIX}99999999`);
    expect(otherEntry.skills).toEqual(["keep-me"]);
    const logText = api.logger.info.mock.calls.map((call: any[]) => String(call[0])).join("\n");
    expect(logText).toContain(`workspace skill sync`);
    expect(logText).toContain(`${agentId} (Demo)`);
    expect(logText).toContain("enabled=[alpha]");
    expect(logText).toContain("active=[alpha]");
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
