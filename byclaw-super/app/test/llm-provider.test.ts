import { describe, expect, it, vi } from "vitest";
import {
  RedisFirstLlmProvider,
  buildRedisProvider,
} from "../llm-provider/index.js";

const fallback = {
  providerId: "volcengine-ark",
  modelId: "deepseek-v4-pro-260425",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "environment-secret",
};

describe("Redis-first LLM provider", () => {
  it("selects the marked Redis default as an SDK-neutral model config", async () => {
    const hget = vi.fn().mockResolvedValue(
      JSON.stringify([
        modelRecord({ instanceId: "100", modelCode: "old-model", isDefault: 0 }),
        modelRecord({
          instanceId: "200",
          modelCode: "redis-deepseek",
          modelName: "Redis DeepSeek",
          isDefault: 1,
          authToken: "redis-secret",
        }),
      ]),
    );
    const resolution = await new RedisFirstLlmProvider({
      redis: { hget },
      fallback,
      logger: { info: vi.fn(), warn: vi.fn() },
    }).resolve();

    expect(hget).toHaveBeenCalledWith("byai:aimodel:typelist", "LLM");
    expect(resolution.source).toBe("redis");
    expect(resolution.config.providerId).toBe("baiying-m-200");
    expect(resolution.config.modelId).toBe("redis-deepseek");
    expect(resolution.config).toMatchObject({
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "redis-secret",
      protocol: "openai-responses",
      authHeader: true,
    });
    expect(resolution.config).not.toHaveProperty("requestAdapter");
    expect(resolution.config).not.toHaveProperty("provider");
    expect(resolution.config.reasoning).not.toHaveProperty("thinkingLevelMap");
    expect(resolution.config.reasoning).not.toHaveProperty("compat");
  });

  it("falls back to the existing DeepSeek environment configuration on Redis failure", async () => {
    const warn = vi.fn();
    const resolution = await new RedisFirstLlmProvider({
      redis: { hget: vi.fn().mockRejectedValue(new Error("redis unavailable")) },
      fallback,
      logger: { info: vi.fn(), warn },
    }).resolve();

    expect(resolution.source).toBe("environment");
    expect(resolution.config.providerId).toBe("volcengine-ark");
    expect(resolution.config.modelId).toBe("deepseek-v4-pro-260425");
    expect(resolution.config.apiKey).toBe("environment-secret");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("redis unavailable"));
  });

  it("decrypts the backend SM4 token before passing it to Pi", () => {
    const config = buildRedisProvider(
      modelRecord({
        instanceId: "300",
        authToken: "EgPL44ILxzG36CXPVwwJwA==",
      }),
      "00112233445566778899aabbccddeeff",
    );

    expect(config.apiKey).toBe("secret-token");
  });
});

function modelRecord(overrides: Record<string, unknown> = {}) {
  return {
    status: 1,
    isDefault: 1,
    modelType: "LLM",
    instanceId: "100",
    modelCode: "deepseek-v4-pro-260425",
    modelName: "DeepSeek V4 Pro",
    url: "https://ark.cn-beijing.volces.com/api/v3",
    authToken: "redis-secret",
    maxContentToken: 1_000_000,
    instanceParam: {
      providerName: "Volcengine Ark",
      modelProtocol: "openai-responses",
      abilities: ["3"],
      maxTokens: 384_000,
      reasoningConfig: {
        enabled: true,
        capability: "effort",
        defaultLevel: "high",
        supportedEfforts: ["low", "medium", "high"],
      },
    },
    ...overrides,
  };
}
