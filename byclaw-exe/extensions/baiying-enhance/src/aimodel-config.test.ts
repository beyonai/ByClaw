import { describe, expect, it } from "vitest";
import {
  parseBaiyingAimodelProviderBundle,
  providerKeyForBaiyingModelId,
  resolveDefaultBaiyingAimodelProviderBundle,
} from "./aimodel-config.js";

describe("baiying aimodel configuration", () => {
  it("normalizes an active Redis model without persisting its token", () => {
    const bundle = parseBaiyingAimodelProviderBundle({
      payload: {
        key: "byai:aimodel:config",
        content: "{}",
        hash: "hash-1",
        raw: {
          status: 1,
          instanceId: "model-instance-1",
          modelCode: "qwen-max",
          modelName: "Qwen Max",
          url: "https://model.example/v1",
          authToken: "secret-token-must-not-be-in-bundle",
          maxContentToken: 64000,
          instanceParam: {
            providerName: "openai",
            abilities: ["3", "7"],
          },
        },
      },
      modelId: "model-instance-1",
      secretProviderName: "baiying-aimodel-redis",
    });

    expect(bundle).toMatchObject({
      baseUrl: "https://model.example/v1",
      api: "openai-completions",
      modelId: "qwen-max",
      modelName: "Qwen Max",
      contextWindow: 64000,
      input: ["text", "image"],
      apiKey: {
        source: "exec",
        provider: "baiying-aimodel-redis",
        id: "model:model-instance-1",
      },
    });
    expect(JSON.stringify(bundle)).not.toContain("secret-token-must-not-be-in-bundle");
  });

  it("uses the explicitly marked active LLM from the Redis typelist", async () => {
    const result = await resolveDefaultBaiyingAimodelProviderBundle({
      redisJsonStore: {
        getHashJson: async ({ key, field }) => {
          expect(key).toBe("byai:aimodel:typelist");
          expect(field).toBe("LLM");
          return {
            key,
            field,
            content: "typelist",
            hash: "hash-2",
            raw: [
              {
                status: 1,
                isDefault: 0,
                instanceId: "old-model",
                modelCode: "old-code",
                modelName: "Old",
                url: "https://old.example/v1",
                authToken: "old-token",
                modelType: "LLM",
                instanceParam: { providerName: "openai" },
              },
              {
                status: 1,
                isDefault: 1,
                instanceId: "default-model",
                modelCode: "default-code",
                modelName: "Default",
                url: "https://default.example/v1",
                authToken: "default-token",
                modelType: "LLM",
                instanceParam: { providerName: "anthropic" },
              },
            ],
          };
        },
      } as never,
      secretProviderName: "baiying-aimodel-redis",
      log: { warn: () => undefined },
    });

    expect(result).toMatchObject({
      providerKey: providerKeyForBaiyingModelId("default-model"),
      modelRef: "baiying-m-default-model/default-code",
      provider: {
        api: "anthropic-messages",
        modelId: "default-code",
      },
    });
  });

  it("selects the first active default when Redis contains multiple default flags", async () => {
    const warnings: string[] = [];
    const result = await resolveDefaultBaiyingAimodelProviderBundle({
      redisJsonStore: {
        getHashJson: async ({ key, field }) => ({
          key,
          field,
          content: "typelist",
          hash: "hash-3",
          raw: [
            {
              status: 1,
              isDefault: 1,
              instanceId: "first-default",
              modelCode: "first-code",
              url: "https://first.example/v1",
              authToken: "first-token",
              modelType: "LLM",
              instanceParam: { providerName: "openai" },
            },
            {
              status: 1,
              isDefault: 1,
              instanceId: "second-default",
              modelCode: "second-code",
              url: "https://second.example/v1",
              authToken: "second-token",
              modelType: "LLM",
              instanceParam: { providerName: "openai" },
            },
          ],
        }),
      } as never,
      secretProviderName: "baiying-aimodel-redis",
      log: { warn: (message) => warnings.push(message) },
    });

    expect(result?.modelRef).toBe("baiying-m-first-default/first-code");
    expect(warnings).toContain(
      "baiying-enhance: Redis AI model typelist has 2 active LLM defaults; selecting the first one to match develop behavior",
    );
  });
});
