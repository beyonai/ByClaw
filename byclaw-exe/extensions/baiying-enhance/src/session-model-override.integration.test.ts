import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";

import { syncManagedAgentSessionModelForInbound } from "./managed-agent-model-hook.js";
import { setSharedRedisJsonStore } from "./redis-json-store.js";
import {
  SESSION_MODEL_OVERRIDE_KEY_PREFIX,
  resolveSessionModelOverride,
  sessionModelOverrideRedisKey,
} from "./session-model-override.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

/**
 * 真实 Redis 集成测试（opt-in）：验证 BE 写入的会话级模型覆盖键能被运行时读取、
 * 按需注册 provider 并让本会话的模型对齐到所选模型，且不影响其他会话。
 *
 * 运行：REDIS_INTEGRATION=true REDIS_HOST=127.0.0.1 REDIS_PORT=6390 pnpm exec vitest run src/session-model-override.integration.test.ts
 */
const RUN = process.env.REDIS_INTEGRATION === "true";
const SESSION_AGENT = "baiying-agent-10000455";
const EMPLOYEE_MODEL_REF = "baiying-m-10004000/qwen3.6-27b";
const OVERRIDE_MODEL_ID = "9001";
const OVERRIDE_MODEL_CODE = "deepseek-v4-flash";
const SESSION_WITH_OVERRIDE = "10006251";
const SESSION_WITHOUT_OVERRIDE = "10006252";

const PLUGIN_CONFIG = {
  mainParentAgentId: "main",
  aimodelConfigRedisKey: "byai:aimodel:config",
  aimodelTypeListRedisKey: "byai:aimodel:typelist",
  aimodelSecretProviderName: "baiying-aimodel-redis",
} as BaiyingEnhancePluginConfig;

let redis: Redis | undefined;

type SessionEntry = Record<string, unknown>;

function runtimeConfig(providers: Record<string, unknown>) {
  return {
    session: { store: "(multiple)" },
    agents: {
      list: [{ id: SESSION_AGENT, model: { primary: EMPLOYEE_MODEL_REF } }],
    },
    models: { providers },
  } as never;
}

function fakeRuntime(params: { cfg: Record<string, unknown>; sessions: Map<string, SessionEntry> }) {
  return {
    runtime: {
      config: {
        current: () => params.cfg,
        loadConfig: () => params.cfg,
        writeConfigFile: async (next: Record<string, unknown>) => {
          for (const key of Object.keys(params.cfg)) delete params.cfg[key];
          Object.assign(params.cfg, next);
        },
      },
      agent: {
        session: {
          resolveStorePath: () => "/tmp/byclaw-session-model-override-integration.json",
          updateSessionStoreEntry: async (input: {
            sessionKey: string;
            update: (entry: SessionEntry) => Promise<void> | void;
          }) => {
            const entry = params.sessions.get(input.sessionKey) ?? {
              sessionId: "existing-session-id",
              updatedAt: 1,
            };
            await input.update(entry);
            params.sessions.set(input.sessionKey, entry);
          },
        },
      },
    },
  } as never;
}

describe.skipIf(!RUN)("session model override against real Redis", () => {
  beforeAll(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6390),
      maxRetriesPerRequest: 1,
    });
    await redis.flushdb();
    await redis.hset(
      "byai:aimodel:config",
      OVERRIDE_MODEL_ID,
      JSON.stringify({
        authToken: "secret-token",
        instanceId: OVERRIDE_MODEL_ID,
        instanceParam: { maxTokens: 1024 },
        maxContentToken: "128000",
        modelCode: OVERRIDE_MODEL_CODE,
        modelName: OVERRIDE_MODEL_CODE,
        status: 1,
        url: "https://example.test/v1",
      }),
    );
    // 与 byclaw-be SessionModelSelectionService 写入的 JSON 完全一致。
    await redis.set(
      sessionModelOverrideRedisKey(SESSION_WITH_OVERRIDE),
      JSON.stringify({
        modelId: OVERRIDE_MODEL_ID,
        modelCode: OVERRIDE_MODEL_CODE,
        modelName: OVERRIDE_MODEL_CODE,
        providerName: "DeepSeek",
        updateTime: 1757300000000,
      }),
    );
    setSharedRedisJsonStore(null);
  });

  afterAll(async () => {
    setSharedRedisJsonStore(null);
    await redis?.quit();
  });

  it("reads the BE-written override key, registers the provider and aligns only that session", async () => {
    const cfg = runtimeConfig({
      "baiying-m-10004000": { models: [{ id: "qwen3.6-27b" }] },
    });
    const sessions = new Map<string, SessionEntry>();
    const api = fakeRuntime({ cfg, sessions });
    const log = { info: () => undefined, warn: () => undefined };

    const resolved = await resolveSessionModelOverride({
      api,
      pluginConfig: PLUGIN_CONFIG,
      sessionId: SESSION_WITH_OVERRIDE,
      log,
    });

    expect(resolved).toEqual({
      providerKey: `baiying-m-${OVERRIDE_MODEL_ID}`,
      modelRef: `baiying-m-${OVERRIDE_MODEL_ID}/${OVERRIDE_MODEL_CODE}`,
      model: OVERRIDE_MODEL_CODE,
    });
    const registered = (cfg as { models: { providers: Record<string, { models: Array<{ id: string }> }> } }).models
      .providers[`baiying-m-${OVERRIDE_MODEL_ID}`];
    expect(registered?.models?.[0]?.id).toBe(OVERRIDE_MODEL_CODE);

    const overrideSessionKey = `agent:${SESSION_AGENT}:byai-channel:direct:${SESSION_WITH_OVERRIDE}`;
    await syncManagedAgentSessionModelForInbound({
      api,
      sessionKey: overrideSessionKey,
      modelRefOverride: resolved?.modelRef,
    });

    const overrideEntry = sessions.get(overrideSessionKey);
    expect(overrideEntry?.modelProvider).toBe(`baiying-m-${OVERRIDE_MODEL_ID}`);
    expect(overrideEntry?.model).toBe(OVERRIDE_MODEL_CODE);
    // 会话条目被就地修改，没有新建会话。
    expect(overrideEntry?.sessionId).toBe("existing-session-id");

    // 另一个没有覆盖键的会话仍然对齐到数字员工配置模型。
    expect(
      await resolveSessionModelOverride({
        api,
        pluginConfig: PLUGIN_CONFIG,
        sessionId: SESSION_WITHOUT_OVERRIDE,
        log,
      }),
    ).toBeUndefined();
    const plainSessionKey = `agent:${SESSION_AGENT}:byai-channel:direct:${SESSION_WITHOUT_OVERRIDE}`;
    await syncManagedAgentSessionModelForInbound({ api, sessionKey: plainSessionKey });
    const plainEntry = sessions.get(plainSessionKey);
    expect(plainEntry?.modelProvider).toBe("baiying-m-10004000");
    expect(plainEntry?.model).toBe("qwen3.6-27b");
    expect(plainEntry?.sessionId).toBe("existing-session-id");
  });

  it("keeps the override key prefix in sync with the BE writer", () => {
    expect(SESSION_MODEL_OVERRIDE_KEY_PREFIX).toBe("byai:chat:session_model:");
  });
});
