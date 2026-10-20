import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMainContextTemplateWatch } from "./main-context-template-watch.js";
import { seedMainAgentAgentsMd } from "./main-workspace-seed.js";
import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";
import { SUBAGENT_ROUTING_FILENAME } from "./subagent-routing-seed.js";

const REDIS_KEY = "byai:SystemConfig:paramCode";
const PARAM_CODE = "OPENCLAW_AGENT_CONTEXT_TEMPLATE_SUPER_ASSISTANT";
const HASH_ENTRY_KEY = `${REDIS_KEY}:${PARAM_CODE}`;

afterEach(() => vi.useRealTimers());

function payloadFromContent(key: string, content: string): RedisJsonPayload {
  return {
    key,
    content,
    raw: JSON.parse(content),
    hash: createHash("sha256").update(content).digest("hex"),
  };
}

function systemConfigPayload(template: unknown): RedisJsonPayload {
  return payloadFromContent(
    HASH_ENTRY_KEY,
    JSON.stringify({
      paramCode: PARAM_CODE,
      paramValue: JSON.stringify(template),
    }),
  );
}

function createMemoryRedisJsonStore(hashEntries: Map<string, RedisJsonPayload>): BaiyingRedisJsonStore {
  return {
    getJsonByKey: async () => null,
    getResourceJson: async () => null,
    getDigEmployeeJson: async () => null,
    getHashJson: async ({ key, field }) => hashEntries.get(`${key}:${field}`) ?? null,
    close: async () => undefined,
  };
}

function createMockApi(mainWorkspace: string): any {
  return {
    runtime: {
      config: {
        loadConfig: () => ({
          agents: {
            list: [{ id: "main", workspace: mainWorkspace, identity: { name: "Main" } }],
          },
        }),
      },
    },
  };
}

function mainContextTemplate(version: string) {
  return {
    schemaVersion: 1,
    templateType: "agentContext",
    scope: "mainWorkspace",
    agentRole: "superAssistant",
    files: {
      "AGENTS.md": {
        enabled: true,
        priorityPrompt: `# Redis AGENTS ${version}\n\n主控提示词。`,
      },
      "SOUL.md": {
        enabled: true,
        priorityPrompt: `# Redis SOUL ${version}\n\n主控上下文。`,
      },
    },
  };
}

describe("main context template watcher", () => {
  it("retries an unchanged first template on the polling timer after Redis enqueue fails", async () => {
    vi.useFakeTimers();
    const hashEntries = new Map([[HASH_ENTRY_KEY, systemConfigPayload(mainContextTemplate("v1"))]]);
    const onChange = vi.fn().mockRejectedValueOnce(new Error("Redis enqueue unavailable")).mockResolvedValue(undefined);
    const watcher = createMainContextTemplateWatch({
      redisJsonStore: createMemoryRedisJsonStore(hashEntries),
      pluginConfig: { mainContextTemplatePollMs: 1000 },
      logger: { info: vi.fn(), warn: vi.fn() },
      onChange,
    });

    try {
      await watcher.start();
      expect(onChange).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange.mock.calls[1][0]).toEqual(onChange.mock.calls[0][0]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      await watcher.stop();
    }
  });

  it("keeps the previous acknowledged hash until a changed template is queued successfully", async () => {
    vi.useFakeTimers();
    const hashEntries = new Map([[HASH_ENTRY_KEY, systemConfigPayload(mainContextTemplate("v1"))]]);
    const onChange = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Redis enqueue unavailable")).mockResolvedValue(undefined);
    const watcher = createMainContextTemplateWatch({
      redisJsonStore: createMemoryRedisJsonStore(hashEntries),
      pluginConfig: { mainContextTemplatePollMs: 1000 },
      logger: { info: vi.fn(), warn: vi.fn() },
      onChange,
    });

    try {
      await watcher.start();
      hashEntries.set(HASH_ENTRY_KEY, systemConfigPayload(mainContextTemplate("v2")));
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenCalledTimes(3);
      expect(onChange.mock.calls[2][0]).toEqual(onChange.mock.calls[1][0]);
      expect(onChange.mock.calls[2][0].firstRun).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenCalledTimes(3);
    } finally {
      await watcher.stop();
    }
  });

  it("polls Redis context template independently and refreshes only when hash changes", async () => {
    const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-main-context-watch-"));
    await writeFile(path.join(mainWs, "SOUL.md"), "# Base SOUL\n", "utf8");

    const hashEntries = new Map<string, RedisJsonPayload>([
      [HASH_ENTRY_KEY, systemConfigPayload(mainContextTemplate("v1"))],
    ]);
    const redisJsonStore = createMemoryRedisJsonStore(hashEntries);
    const api = createMockApi(mainWs);
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    const watcher = createMainContextTemplateWatch({
      redisJsonStore,
      pluginConfig: {
        useBundledMainAgentsMd: false,
        mainAgentsMdMode: "always",
        mainContextTemplatePollMs: 1000,
      },
      logger: log,
      onChange: async () => {
        await seedMainAgentAgentsMd({
          api,
          pluginConfig: {
            useBundledMainAgentsMd: false,
            mainAgentsMdMode: "always",
          },
          redisJsonStore,
          redisContextOnly: true,
          skipSubagentRouting: true,
          log,
        });
      },
    });

    await watcher.__pollNow?.();
    expect(await readFile(path.join(mainWs, "AGENTS.md"), "utf8")).toContain("# Redis AGENTS v1");
    expect(await readFile(path.join(mainWs, "SOUL.md"), "utf8")).toContain("# Redis SOUL v1");
    await expect(readFile(path.join(mainWs, SUBAGENT_ROUTING_FILENAME), "utf8")).rejects.toThrow();

    await writeFile(path.join(mainWs, "AGENTS.md"), "# Manual AGENTS\n", "utf8");
    await watcher.__pollNow?.();
    expect(await readFile(path.join(mainWs, "AGENTS.md"), "utf8")).toBe("# Manual AGENTS\n");

    hashEntries.set(HASH_ENTRY_KEY, systemConfigPayload(mainContextTemplate("v2")));
    await watcher.__pollNow?.();
    expect(await readFile(path.join(mainWs, "AGENTS.md"), "utf8")).toContain("# Redis AGENTS v2");
    const soul = await readFile(path.join(mainWs, "SOUL.md"), "utf8");
    expect(soul).toContain("# Base SOUL");
    expect(soul).toContain("# Redis SOUL v2");
  });

  it("does not fall back to bundled AGENTS.md when Redis context field is missing", async () => {
    const mainWs = await mkdtemp(path.join(tmpdir(), "baiying-main-context-missing-"));
    const hashEntries = new Map<string, RedisJsonPayload>();
    const redisJsonStore = createMemoryRedisJsonStore(hashEntries);
    const api = createMockApi(mainWs);
    const onChange = vi.fn(async () => {
      await seedMainAgentAgentsMd({
        api,
        pluginConfig: {
          mainAgentsMdPath: path.join(mainWs, "unused-template.md"),
          mainAgentsMdMode: "always",
        },
        redisJsonStore,
        redisContextOnly: true,
        skipSubagentRouting: true,
        log: { info: vi.fn(), warn: vi.fn() },
      });
    });

    const watcher = createMainContextTemplateWatch({
      redisJsonStore,
      pluginConfig: { mainContextTemplatePollMs: 1000 },
      logger: { info: vi.fn(), warn: vi.fn() },
      onChange,
    });

    await watcher.__pollNow?.();
    expect(onChange).not.toHaveBeenCalled();
    await expect(readFile(path.join(mainWs, "AGENTS.md"), "utf8")).rejects.toThrow();
  });
});
