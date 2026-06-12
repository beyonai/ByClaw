import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import {
  loadMainAgentsTemplate,
  MAIN_AGENTS_MARKER,
  MAIN_CONTEXT_MARKER,
  resolveEffectiveMainAgentsMdMode,
  resolveMainAgentsTemplatePath,
  seedMainAgentAgentsMd,
} from "./main-workspace-seed.js";
import { SUBAGENT_ROUTING_FILENAME, SUBAGENT_ROUTING_MARKER } from "./subagent-routing-seed.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function mockApi(mainWorkspace: string) {
  return {
    runtime: {
      config: {
        loadConfig: vi.fn(() => ({
          agents: {
            list: [{ id: "main", name: "Main", workspace: mainWorkspace }],
          },
        })),
      },
    },
  };
}

function redisPayload(key: string, raw: unknown): RedisJsonPayload {
  const content = JSON.stringify(raw);
  return {
    key,
    content,
    raw,
    hash: `hash:${content.length}`,
  };
}

function mockRedisStore(entries: Map<string, unknown>): BaiyingRedisJsonStore {
  return {
    getJsonByKey: async (key) => {
      const raw = entries.get(key);
      return raw === undefined ? null : redisPayload(key, raw);
    },
    getHashJson: async ({ key, field }) => {
      const raw = entries.get(`${key}:${field}`);
      return raw === undefined ? null : redisPayload(`${key}:${field}`, raw);
    },
    getDigEmployeeJson: async () => null,
    getResourceJson: async () => null,
    close: async () => undefined,
  };
}

describe("main-workspace-seed", () => {
  it("resolveEffectiveMainAgentsMdMode defaults to always with built-in template", () => {
    expect(resolveEffectiveMainAgentsMdMode({})).toBe("always");
  });

  it("resolveEffectiveMainAgentsMdMode returns off when built-in disabled and no path", () => {
    expect(resolveEffectiveMainAgentsMdMode({ useBundledMainAgentsMd: false })).toBe("off");
  });

  it("resolveEffectiveMainAgentsMdMode uses path when built-in disabled", () => {
    expect(resolveEffectiveMainAgentsMdMode({ useBundledMainAgentsMd: false, mainAgentsMdPath: "/tmp/x.md" })).toBe(
      "always",
    );
  });

  it("resolveEffectiveMainAgentsMdMode respects explicit mode", () => {
    expect(resolveEffectiveMainAgentsMdMode({ mainAgentsMdMode: "if_missing" })).toBe("if_missing");
    expect(resolveEffectiveMainAgentsMdMode({ mainAgentsMdMode: "off" })).toBe("off");
  });

  it("seedMainAgentAgentsMd does not write BOOTSTRAP.md", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-bootstrap-"));
    const api = mockApi(ws) as any;

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: { mainAgentsMdMode: "off", useBundledMainAgentsMd: false },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(await pathExists(path.join(ws, "BOOTSTRAP.md"))).toBe(false);
  });

  it("seedMainAgentAgentsMd if_missing writes once", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const tpl = path.join(ws, "tpl.md");
    await writeFile(tpl, "# Hello\n", "utf8");
    const api = mockApi(ws) as any;

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: {
        mainAgentsMdPath: tpl,
        mainAgentsMdMode: "if_missing",
      },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    const dest = path.join(ws, "AGENTS.md");
    const first = await readFile(dest, "utf8");
    expect(first.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
    expect(first).toContain("# Hello");

    const routingFirst = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routingFirst.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: {
        mainAgentsMdPath: tpl,
        mainAgentsMdMode: "if_missing",
      },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    const second = await readFile(dest, "utf8");
    expect(second).toBe(first);

    const routingSecond = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routingSecond).toBe(routingFirst);
  });

  it("seedMainAgentAgentsMd if_missing still seeds SUBAGENT_ROUTING when AGENTS.md pre-exists", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const dest = path.join(ws, "AGENTS.md");
    await writeFile(dest, "# stock OpenClaw AGENTS\n", "utf8");
    const tpl = path.join(ws, "tpl.md");
    await writeFile(tpl, "# Plugin tpl\n", "utf8");
    const api = mockApi(ws) as any;

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: {
        mainAgentsMdPath: tpl,
        mainAgentsMdMode: "if_missing",
      },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(await readFile(dest, "utf8")).toBe("# stock OpenClaw AGENTS\n");
    const routing = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routing.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
  });

  it("seedMainAgentAgentsMd if_managed_marker skips user file without marker", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const dest = path.join(ws, "AGENTS.md");
    await writeFile(dest, "# user\n", "utf8");
    const tpl = path.join(ws, "tpl.md");
    await writeFile(tpl, "# tpl\n", "utf8");
    const api = mockApi(ws) as any;

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: {
        mainAgentsMdPath: tpl,
        mainAgentsMdMode: "if_managed_marker",
        mainAgentsMdForeignTakeover: false,
      },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(await readFile(dest, "utf8")).toBe("# user\n");
    const routing = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routing.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
  });

  it("seedMainAgentAgentsMd if_managed_marker overwrites when marker present", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const dest = path.join(ws, "AGENTS.md");
    await writeFile(dest, `${MAIN_AGENTS_MARKER}\n\nold\n`, "utf8");
    const tpl = path.join(ws, "tpl.md");
    await writeFile(tpl, "# newbody\n", "utf8");
    const api = mockApi(ws) as any;

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: {
        mainAgentsMdPath: tpl,
        mainAgentsMdMode: "if_managed_marker",
      },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    const out = await readFile(dest, "utf8");
    expect(out).toContain("# newbody");
    expect(out).not.toContain("old");
  });

  it("seedMainAgentAgentsMd always overwrites", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const dest = path.join(ws, "AGENTS.md");
    await writeFile(dest, "# user only\n", "utf8");
    const tpl = path.join(ws, "tpl.md");
    await writeFile(tpl, "# forced\n", "utf8");
    const api = mockApi(ws) as any;

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: {
        mainAgentsMdPath: tpl,
        mainAgentsMdMode: "always",
      },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    const out = await readFile(dest, "utf8");
    expect(out.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
    expect(out).toContain("# forced");
    expect(out).not.toContain("user only");

    const routing = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routing.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
    expect(routing).toContain("No `baiying-agent-*`");
  });

  it("resolveMainAgentsTemplatePath prefers mainAgentsMdPath over bundled flag", async () => {
    const p = await resolveMainAgentsTemplatePath({
      mainAgentsMdPath: "/abs/custom.md",
      useBundledMainAgentsMd: true,
    });
    expect(p).toBe("/abs/custom.md");
  });

  it("resolveMainAgentsTemplatePath is null when using bundle-embedded default template", async () => {
    expect(await resolveMainAgentsTemplatePath({})).toBeNull();
  });

  it("loadMainAgentsTemplate returns bundled body without templates/ on disk at runtime", async () => {
    const loaded = await loadMainAgentsTemplate({});
    expect(loaded).not.toBeNull();
    expect(loaded!.kind).toBe("bundled");
    expect(loaded!.body.length).toBeGreaterThan(20);
    expect(loaded!.body).toContain("# AGENTS.md - Your Workspace");
  });

  it("seedMainAgentAgentsMd if_managed_marker foreign takeover replaces unmarked file once", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "oc-state-"));
    const prevState = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    try {
      const dest = path.join(ws, "AGENTS.md");
      await writeFile(dest, "# stock openclaw\n", "utf8");
      const tpl = path.join(ws, "tpl.md");
      await writeFile(tpl, "# from tpl\n", "utf8");
      const api = mockApi(ws) as any;

      await seedMainAgentAgentsMd({
        api,
        pluginConfig: {
          mainAgentsMdPath: tpl,
          mainAgentsMdMode: "if_managed_marker",
          mainAgentsMdForeignTakeover: true,
        },
        log: { warn: vi.fn(), info: vi.fn() },
      });
      const afterFirst = await readFile(dest, "utf8");
      expect(afterFirst.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
      expect(afterFirst).toContain("# from tpl");

      await writeFile(dest, "# user reverted without marker\n", "utf8");
      await seedMainAgentAgentsMd({
        api,
        pluginConfig: {
          mainAgentsMdPath: tpl,
          mainAgentsMdMode: "if_managed_marker",
          mainAgentsMdForeignTakeover: true,
        },
        log: { warn: vi.fn(), info: vi.fn() },
      });
      expect(await readFile(dest, "utf8")).toContain("# user reverted");
    } finally {
      process.env.OPENCLAW_STATE_DIR = prevState;
    }
  });

  it("seedMainAgentAgentsMd uses built-in template when path unset", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const api = mockApi(ws) as any;
    await seedMainAgentAgentsMd({
      api,
      pluginConfig: { mainAgentsMdMode: "always" },
      log: { warn: vi.fn(), info: vi.fn() },
    });
    const out = await readFile(path.join(ws, "AGENTS.md"), "utf8");
    expect(out.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
    expect(out).toContain("一呼百应");

    const routing = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routing.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
  });

  it("seedMainAgentAgentsMd uses Redis main context template before bundled AGENTS.md", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-context-"));
    const api = mockApi(ws) as any;
    await writeFile(path.join(ws, "SOUL.md"), "# Base SOUL\n", "utf8");
    await writeFile(path.join(ws, "IDENTITY.md"), "# Base IDENTITY\n", "utf8");
    await writeFile(path.join(ws, "USER.md"), "# Base USER\n", "utf8");
    const template = {
      schemaVersion: 1,
      templateType: "agentContext",
      scope: "mainWorkspace",
      agentRole: "superAssistant",
      files: {
        "AGENTS.md": { enabled: true, priorityPrompt: "# Redis main AGENTS\n\n由系统配置生成。" },
        "SOUL.md": { enabled: true, priorityPrompt: "# Redis SOUL\n\n主控灵魂。" },
        "IDENTITY.md": { enabled: true, priorityPrompt: "# Redis IDENTITY\n\n超级助手。" },
        "USER.md": { enabled: true, priorityPrompt: "# Redis USER\n\n用户偏好。" },
        "TOOLS.md": { enabled: true, priorityPrompt: "# Redis TOOLS\n\n工具说明。" },
        "HEARTBEAT.md": { enabled: true, priorityPrompt: "# Redis HEARTBEAT\n\n心跳检查。" },
        "SUBAGENT_ROUTING.md": { enabled: true, priorityPrompt: "# Redis SUBAGENT ROUTING\n\n路由覆盖。" },
      },
    };
    const store = mockRedisStore(
      new Map([
        [
          "byai:SystemConfig:paramCode:OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT",
          { paramCode: "OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT", paramValue: JSON.stringify(template) },
        ],
      ]),
    );

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: { mainAgentsMdMode: "always" },
      redisJsonStore: store,
      log: { warn: vi.fn(), info: vi.fn() },
    });

    const agents = await readFile(path.join(ws, "AGENTS.md"), "utf8");
    expect(agents.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
    expect(agents).toContain("# Redis main AGENTS");
    expect(agents).not.toContain("一呼百应");

    for (const filename of ["SOUL.md", "IDENTITY.md", "USER.md"]) {
      const out = await readFile(path.join(ws, filename), "utf8");
      expect(out).toContain(`# Base ${filename.replace(".md", "")}`);
      expect(out).toContain(`<!-- baiying-enhance: main context ${filename}:start -->`);
      expect(out).toContain(`<!-- baiying-enhance: main context ${filename}:end -->`);
      expect(out).toContain(`Redis ${filename.replace(".md", "")}`);
    }
    const tools = await readFile(path.join(ws, "TOOLS.md"), "utf8");
    expect(tools.startsWith(MAIN_CONTEXT_MARKER)).toBe(true);
    expect(tools).toContain("# Redis TOOLS");
    expect(await pathExists(path.join(ws, "HEARTBEAT.md"))).toBe(false);

    const routing = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routing.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
    expect(routing).not.toContain("# Redis SUBAGENT ROUTING");
  });

  it("seedMainAgentAgentsMd can use Redis relPrompt even when bundled AGENTS.md source is disabled", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-context-relprompt-"));
    const api = mockApi(ws) as any;
    await writeFile(path.join(ws, "SOUL.md"), "# Base SOUL\n", "utf8");
    const template = {
      schemaVersion: 1,
      templateType: "agentContext",
      scope: "mainWorkspace",
      agentRole: "superAssistant",
      relPrompt: {
        "AGENTS.md": { priorityPrompt: "# Redis relPrompt AGENTS\n\n主控入口。" },
        "SOUL.md": { priorityPrompt: "# Redis relPrompt SOUL\n\n主控灵魂。" },
      },
    };
    const store = mockRedisStore(
      new Map([
        [
          "byai:SystemConfig:paramCode:OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT",
          { paramCode: "OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT", paramValue: JSON.stringify(template) },
        ],
      ]),
    );

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: { useBundledMainAgentsMd: false },
      redisJsonStore: store,
      log: { warn: vi.fn(), info: vi.fn() },
    });

    const agents = await readFile(path.join(ws, "AGENTS.md"), "utf8");
    expect(agents.startsWith(MAIN_AGENTS_MARKER)).toBe(true);
    expect(agents).toContain("# Redis relPrompt AGENTS");

    const soul = await readFile(path.join(ws, "SOUL.md"), "utf8");
    expect(soul).toContain("# Base SOUL");
    expect(soul).toContain("<!-- baiying-enhance: main context SOUL.md:start -->");
    expect(soul).toContain("# Redis relPrompt SOUL");
  });

  it("seedMainAgentAgentsMd respects Redis if_missing for main context files", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-context-if-missing-"));
    const api = mockApi(ws) as any;
    await writeFile(path.join(ws, "SOUL.md"), "# User SOUL\n", "utf8");
    const template = {
      schemaVersion: 1,
      templateType: "agentContext",
      scope: "mainWorkspace",
      agentRole: "superAssistant",
      writePolicy: "if_missing",
      files: {
        "SOUL.md": {
          enabled: true,
          mergeStrategy: "replace",
          priorityPrompt: "# Redis SOUL\n\n不应覆盖已有内容。",
        },
      },
    };
    const store = mockRedisStore(
      new Map([
        [
          "byai:SystemConfig:paramCode:OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT",
          { paramCode: "OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT", paramValue: JSON.stringify(template) },
        ],
      ]),
    );

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: { useBundledMainAgentsMd: false },
      redisJsonStore: store,
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(await readFile(path.join(ws, "SOUL.md"), "utf8")).toBe("# User SOUL\n");
    expect(await pathExists(path.join(ws, "AGENTS.md"))).toBe(false);
  });

  it("seedMainAgentAgentsMd skips append blocks while BOOTSTRAP.md exists", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-context-bootstrap-"));
    const api = mockApi(ws) as any;
    await writeFile(path.join(ws, "BOOTSTRAP.md"), "# Bootstrap\n", "utf8");
    await writeFile(path.join(ws, "SOUL.md"), "# Base SOUL\n", "utf8");
    const template = {
      schemaVersion: 1,
      templateType: "agentContext",
      scope: "mainWorkspace",
      agentRole: "superAssistant",
      files: {
        "SOUL.md": { enabled: true, priorityPrompt: "# Redis SOUL\n\n初始化后才追加。" },
      },
    };
    const store = mockRedisStore(
      new Map([
        [
          "byai:SystemConfig:paramCode:OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT",
          { paramCode: "OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT", paramValue: JSON.stringify(template) },
        ],
      ]),
    );

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: { useBundledMainAgentsMd: false },
      redisJsonStore: store,
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(await readFile(path.join(ws, "SOUL.md"), "utf8")).toBe("# Base SOUL\n");
    expect(await pathExists(path.join(ws, "AGENTS.md"))).toBe(false);
  });

  it("seedMainAgentAgentsMd embeds managed agent ids in SUBAGENT_ROUTING.md", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-main-"));
    const tpl = path.join(ws, "tpl.md");
    await writeFile(tpl, "# Tpl\n", "utf8");
    const api = mockApi(ws) as any;
    const agentId = `${MANAGED_AGENT_PREFIX}501`;
    const managed: AdaptedManagedAgent[] = [
      {
        sourceKey: "501",
        agentId,
        providerKey: "",
        modelRef: "",
        allowSpawnFrom: ["main"],
        listEntry: { id: agentId, name: "RouterTest", identity: { name: "RouterTest" } },
        systemPrompt: "Do routing test work.",
        integrationType: "NONE",
      },
    ];

    await seedMainAgentAgentsMd({
      api,
      pluginConfig: {
        mainAgentsMdPath: tpl,
        mainAgentsMdMode: "always",
      },
      managedAgents: managed,
      log: { warn: vi.fn(), info: vi.fn() },
    });

    const routing = await readFile(path.join(ws, SUBAGENT_ROUTING_FILENAME), "utf8");
    expect(routing.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
    expect(routing).toContain(agentId);
    expect(routing).toContain("RouterTest");
  });
});
