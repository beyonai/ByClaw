import { describe, expect, it } from "vitest";
import { mergeManagedAgentsIntoConfig } from "./agent-registry.js";

describe("managed model registry", () => {
  it("replaces stale managed providers while preserving static providers", () => {
    const result = mergeManagedAgentsIntoConfig({
      base: {
        agents: {
          list: [{ id: "main", default: true }],
          defaults: { models: {} },
        },
        models: {
          providers: {
            "static-provider": { models: [] },
            "baiying-m-stale": { models: [{ id: "stale" }] },
          },
        },
      } as never,
      managed: [],
      defaultModel: {
        providerKey: "baiying-m-current",
        modelRef: "baiying-m-current/current-model",
        provider: {
          baseUrl: "https://model.example/v1",
          apiKey: { source: "exec", provider: "baiying-aimodel-redis", id: "model:current" },
          api: "openai-completions",
          modelId: "current-model",
          modelName: "Current",
        },
      },
      mainParentAgentId: "main",
      mergeAllowSpawnForMain: true,
    });

    expect(result.models?.providers).toHaveProperty("static-provider");
    expect(result.models?.providers).not.toHaveProperty("baiying-m-stale");
    expect(result.models?.providers?.["baiying-m-current"]).toMatchObject({
      api: "openai-completions",
      models: [{ id: "current-model", name: "Current" }],
    });
    expect(result.agents?.defaults?.model).toMatchObject({
      primary: "baiying-m-current/current-model",
    });
    expect(result.agents?.defaults?.models).toHaveProperty("baiying-m-current/current-model");
    expect((result as any).secrets?.providers?.["baiying-aimodel-redis"]).toMatchObject({
      source: "exec",
      jsonOnly: true,
      passEnv: expect.arrayContaining(["REDIS_CLUSTER_HOST", "REDIS_PASSWORD"]),
    });
  });
});
