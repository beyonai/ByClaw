import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionModelOverride } from "./session-model-override.js";
import { mergeAimodelProviderIntoConfig } from "./agent-registry.js";

const { getJsonByKey } = vi.hoisted(() => ({ getJsonByKey: vi.fn() }));
vi.mock("./redis-json-store.js", () => ({ getSharedRedisJsonStore: () => ({ getJsonByKey,
  getHashJson: ({ key }: { key: string }) => getJsonByKey(key),
}) }));

beforeEach(() => {
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
    let cfg = mergeAimodelProviderIntoConfig({
      base: {} as never, providerKey: "baiying-m-42",
      provider: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", api: "openai-completions",
        apiKey: "unused", modelId: "qwen3.6-plus", contextWindow: 202752, reasoning: false },
    });
    const mutateConfigFile = vi.fn(async ({ mutate }: any) => { cfg = await mutate(cfg); });
    const params = {
      sessionId: "test-session", pluginConfig: {}, log: { warn: vi.fn(), info: vi.fn() },
      api: { runtime: { config: { current: () => cfg, loadConfig: () => cfg, mutateConfigFile } } } as never,
    };
    expect(await resolveSessionModelOverride(params)).toMatchObject({ modelRef: "baiying-m-42/qwen3.6-plus" });
    expect(cfg.models?.providers?.["baiying-m-42"]?.models[0]).toMatchObject({
      contextWindow: 1_000_000, maxTokens: 65536, reasoning: true, compat: { thinkingFormat: "qwen" },
    });
    await resolveSessionModelOverride(params);
    expect(mutateConfigFile).toHaveBeenCalledTimes(1);

    // A timeout-only config change must also wait for the runtime reload.
    vi.useFakeTimers();
    delete cfg.agents!.defaults!.compaction!.timeoutSeconds;
    mutateConfigFile.mockImplementation(async () => {});
    const pending = expect(resolveSessionModelOverride(params)).rejects.toThrow("configuration reload timed out");
    await vi.advanceTimersByTimeAsync(3100);
    await pending;
  });
});
