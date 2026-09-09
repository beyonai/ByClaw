import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_MODEL_OVERRIDE_KEY_PREFIX,
  resolveSessionModelOverride,
  sessionModelOverrideRedisKey,
} from "./session-model-override.js";
import { setSharedRedisJsonStore, type BaiyingRedisJsonStore } from "./redis-json-store.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

const PLUGIN_CONFIG = {
  mainParentAgentId: "main",
  aimodelConfigRedisKey: "byai:aimodel:config",
  aimodelTypeListRedisKey: "byai:aimodel:typelist",
  aimodelSecretProviderName: "baiying-aimodel-redis",
} as BaiyingEnhancePluginConfig;

function aimodelPayload(modelId: string, modelCode: string) {
  const raw = {
    authToken: "secret-token",
    instanceId: modelId,
    instanceParam: { maxTokens: 1024 },
    maxContentToken: "128000",
    modelCode,
    modelName: modelCode,
    status: 1,
    url: "https://example.test/v1",
  };
  return { key: `byai:aimodel:config:${modelId}`, content: JSON.stringify(raw), raw, hash: `hash-${modelId}` };
}

function overridePayload(modelId: string, modelCode: string) {
  const raw = { modelId, modelCode, modelName: modelCode, providerName: "DeepSeek" };
  return { key: sessionModelOverrideRedisKey("10006251"), content: JSON.stringify(raw), raw, hash: "override-hash" };
}

function fakeStore(params: {
  override?: ReturnType<typeof overridePayload> | null;
  aimodel?: ReturnType<typeof aimodelPayload> | null;
}): BaiyingRedisJsonStore {
  return {
    getJsonByKey: async () => params.override ?? null,
    getHashJson: async () => params.aimodel ?? null,
    getDigEmployeeJson: async () => null,
    getResourceJson: async () => null,
    close: async () => undefined,
  };
}

function fakeApi(providers: Record<string, unknown> = {}) {
  const writeConfigFile = vi.fn(async () => undefined);
  const cfg = { session: { store: "(multiple)" }, models: { providers } };
  return {
    api: {
      runtime: {
        config: {
          current: () => cfg,
          loadConfig: () => cfg,
          writeConfigFile,
        },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as never,
    writeConfigFile,
  };
}

afterEach(() => {
  setSharedRedisJsonStore(null);
});

describe("resolveSessionModelOverride", () => {
  it("returns the registered override without rewriting the runtime config", async () => {
    setSharedRedisJsonStore(
      fakeStore({
        override: overridePayload("10004014", "deepseek-v4-flash"),
      }),
    );
    const { api, writeConfigFile } = fakeApi({
      "baiying-m-10004014": { models: [{ id: "deepseek-v4-flash" }] },
    });

    const resolved = await resolveSessionModelOverride({
      api,
      pluginConfig: PLUGIN_CONFIG,
      sessionId: "10006251",
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(resolved).toEqual({
      providerKey: "baiying-m-10004014",
      modelRef: "baiying-m-10004014/deepseek-v4-flash",
      model: "deepseek-v4-flash",
    });
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("registers a missing provider from Redis before returning the override", async () => {
    setSharedRedisJsonStore(
      fakeStore({
        override: overridePayload("10004014", "deepseek-v4-flash"),
        aimodel: aimodelPayload("10004014", "deepseek-v4-flash"),
      }),
    );
    const { api, writeConfigFile } = fakeApi();

    const resolved = await resolveSessionModelOverride({
      api,
      pluginConfig: PLUGIN_CONFIG,
      sessionId: "10006251",
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(resolved?.modelRef).toBe("baiying-m-10004014/deepseek-v4-flash");
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0]?.[0] as {
      models?: { providers?: Record<string, { models?: Array<{ id?: string }> }> };
    };
    expect(written.models?.providers?.["baiying-m-10004014"]?.models?.[0]?.id).toBe("deepseek-v4-flash");
  });

  it("returns undefined when there is no session override or no session id", async () => {
    setSharedRedisJsonStore(fakeStore({ override: null }));
    const { api } = fakeApi();

    expect(
      await resolveSessionModelOverride({
        api,
        pluginConfig: PLUGIN_CONFIG,
        sessionId: "10006251",
        log: { warn: vi.fn(), info: vi.fn() },
      }),
    ).toBeUndefined();
    expect(
      await resolveSessionModelOverride({
        api,
        pluginConfig: PLUGIN_CONFIG,
        log: { warn: vi.fn(), info: vi.fn() },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the override model is not in Redis", async () => {
    setSharedRedisJsonStore(
      fakeStore({
        override: overridePayload("999", "missing-model"),
        aimodel: null,
      }),
    );
    const { api, writeConfigFile } = fakeApi();
    const warn = vi.fn();

    const resolved = await resolveSessionModelOverride({
      api,
      pluginConfig: PLUGIN_CONFIG,
      sessionId: "10006251",
      log: { warn, info: vi.fn() },
    });

    expect(resolved).toBeUndefined();
    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("session model override unavailable"));
  });

  it("keeps the Redis key prefix in sync with the BE writer", () => {
    expect(SESSION_MODEL_OVERRIDE_KEY_PREFIX).toBe("byai:chat:session_model:");
    expect(sessionModelOverrideRedisKey(" 42 ")).toBe("byai:chat:session_model:42");
  });
});
