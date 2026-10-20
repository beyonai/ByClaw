import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionModelOverride } from "./session-model-override.js";
import { mergeAimodelProviderIntoConfig } from "./agent-registry.js";
import { runRuntimeUpdateContext, RuntimeUpdateDeferredError } from "../../shared/src/redis-runtime-update-gate.js";
import { withThinkingProviderReloadConfig } from "./configured-thinking.js";

const resolveInUpdate = (params: Parameters<typeof resolveSessionModelOverride>[0]) =>
  runRuntimeUpdateContext(() => resolveSessionModelOverride(params));

const { getJsonByKey, updates } = vi.hoisted(() => ({
  getJsonByKey: vi.fn(),
  updates: {
    queue: { register: vi.fn(), start: vi.fn(), enqueue: vi.fn(), applyNow: vi.fn(), stop: vi.fn() },
    readPending: vi.fn(),
  },
}));
vi.mock("../../shared/src/redis-runtime-update-gate.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../shared/src/redis-runtime-update-gate.js")>(),
  createRuntimeUpdateQueue: () => updates.queue,
  readPendingRuntimeUpdate: updates.readPending,
}));
vi.mock("./redis-json-store.js", () => ({ getSharedRedisJsonStore: () => ({ getJsonByKey,
  getHashJson: ({ key }: { key: string }) => getJsonByKey(key),
}) }));

beforeEach(() => {
  vi.clearAllMocks();
  updates.queue.enqueue.mockReset().mockResolvedValue(undefined);
  updates.queue.applyNow.mockReset().mockResolvedValue("queued");
  updates.readPending.mockReset().mockResolvedValue(null);
  getJsonByKey.mockReset().mockImplementation(async (key: string) => {
    const raw = key.startsWith("byai:chat:session_model:") ? { modelId: "42", modelCode: "qwen3.6-plus" } : {
      status: 1, authToken: "synthetic-test-token", modelCode: "qwen3.6-plus", maxContentToken: "1000000",
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1", instanceParam: { maxTokens: 65536 },
    };
    return { key, raw, content: JSON.stringify(raw), hash: "fresh" };
  });
});
afterEach(() => vi.useRealTimers());

describe("session model configuration refresh", () => {
  it("refreshes same-ID window and thinking settings, then avoids redundant writes", async () => {
    // The provider adapter is already loaded; this test changes ordinary model fields only.
    let cfg = withThinkingProviderReloadConfig(mergeAimodelProviderIntoConfig({
      base: {} as never, providerKey: "baiying-m-42",
      provider: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", api: "openai-completions",
        apiKey: "unused", modelId: "qwen3.6-plus", contextWindow: 202752, reasoning: false,
        reasoningConfig: { enabled: false, compatFormat: "qwen", capability: "binary" } },
    }));
    const mutateConfigFile = vi.fn(async ({ mutate }: any) => { cfg = await mutate(cfg); });
    const params = {
      sessionId: "test-session", pluginConfig: {}, log: { warn: vi.fn(), info: vi.fn() },
      api: { runtime: { version: "2026.7.1", config: { current: () => cfg, loadConfig: () => cfg, mutateConfigFile } } } as never,
    };
    expect(await resolveInUpdate(params)).toMatchObject({ modelRef: "baiying-m-42/qwen3.6-plus" });
    expect(cfg.models?.providers?.["baiying-m-42"]?.models[0]).toMatchObject({
      contextWindow: 1_000_000, maxTokens: 65536, reasoning: true, compat: { thinkingFormat: "qwen" },
    });
    await resolveInUpdate(params);
    expect(mutateConfigFile).toHaveBeenCalledTimes(1);

    // Compaction defaults are unrelated to whether a selected model is ready.
    delete cfg.agents!.defaults!.compaction!.timeoutSeconds;
    await resolveInUpdate(params);
    expect(mutateConfigFile).toHaveBeenCalledTimes(1);

    // A config reload is allowed to replace the plugin runtime snapshot after
    // this function returns; it must not block the dispatch on the old object.
    cfg.models!.providers!["baiying-m-42"]!.models[0]!.contextWindow = 202752;
    mutateConfigFile.mockImplementation(async ({ mutate }: any) => { cfg = await mutate(cfg); });
    await expect(resolveInUpdate(params)).resolves.toMatchObject({ modelRef: "baiying-m-42/qwen3.6-plus" });
  });

  function unregisteredParams() {
    let cfg = {} as any;
    const committed = vi.fn();
    const mutateConfigFile = vi.fn(async ({ mutate }: any) => {
      cfg = await mutate(cfg);
      committed();
    });
    return {
      params: {
        sessionId: "test-session", pluginConfig: {}, log: { warn: vi.fn(), info: vi.fn() },
        api: { runtime: { version: "2026.7.1", config: { current: () => cfg, loadConfig: () => cfg, mutateConfigFile } } } as never,
      },
      committed,
      mutateConfigFile,
      current: () => cfg,
    };
  }

  it("queues a read-only missing selection without writing or returning an unavailable model", async () => {
    const { params, mutateConfigFile, current } = unregisteredParams();

    await expect(resolveSessionModelOverride({ ...params, allowConfigMutation: false })).resolves.toBeUndefined();

    expect(updates.queue.register).toHaveBeenCalledWith("session-model:test-session", expect.any(Function));
    expect(updates.queue.enqueue).toHaveBeenCalledWith("session-model:test-session", { sessionId: "test-session" });
    expect(updates.queue.applyNow).not.toHaveBeenCalled();
    expect(mutateConfigFile).not.toHaveBeenCalled();
    expect(current()).toEqual({});
  });

  it("returns pending without direct writes when a normal selection cannot acquire the update window", async () => {
    const { params, mutateConfigFile } = unregisteredParams();

    await expect(resolveSessionModelOverride(params)).resolves.toBeUndefined();

    expect(updates.queue.applyNow).toHaveBeenCalledWith("session-model:test-session", { sessionId: "test-session" });
    expect(mutateConfigFile).not.toHaveBeenCalled();
  });

  it("fails readiness explicitly for a blocked update instead of using an unregistered model", async () => {
    const { params, mutateConfigFile } = unregisteredParams();
    updates.readPending.mockResolvedValue({ blocked: true, error: "Plugin reload requires maintenance" });

    await expect(resolveSessionModelOverride({ ...params, requireReady: true }))
      .rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(updates.readPending).toHaveBeenCalledWith("session-model:test-session");
    expect(mutateConfigFile).not.toHaveBeenCalled();
  });

  it("propagates a Thinking membership rejection from the queued handler without committing config", async () => {
    const { params, committed, current } = unregisteredParams();

    await expect(resolveInUpdate(params)).rejects.toBeInstanceOf(RuntimeUpdateDeferredError);

    expect(committed).not.toHaveBeenCalled();
    expect(current()).toEqual({});
    expect(updates.queue.enqueue).not.toHaveBeenCalled();
  });

  it("keeps a running model hook on its prepared model when reading Redis fails", async () => {
    const { params, mutateConfigFile } = unregisteredParams();
    getJsonByKey.mockImplementation(async (key: string) => {
      if (!key.startsWith("byai:chat:session_model:")) throw new Error("Redis unavailable");
      return { raw: { modelId: "42" } };
    });
    await expect(resolveSessionModelOverride({ ...params, allowConfigMutation: false })).resolves.toBeUndefined();
    expect(params.log.warn).toHaveBeenCalledWith(expect.stringContaining("refresh unavailable"));
    expect(mutateConfigFile).not.toHaveBeenCalled();
  });

  it("retains a queued refresh on source read failure instead of acknowledging it", async () => {
    const { params } = unregisteredParams();
    getJsonByKey.mockRejectedValue(new Error("Redis unavailable"));
    await expect(resolveInUpdate(params)).rejects.toThrow("Redis unavailable");
    await expect(resolveSessionModelOverride({ ...params, requireReady: true })).rejects.toThrow("Redis unavailable");
  });
});
