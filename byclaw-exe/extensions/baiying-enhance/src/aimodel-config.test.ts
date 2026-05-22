import { describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { mergeManagedAgentsIntoConfig } from "./agent-registry.js";
import {
  DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
  parseBaiyingAimodelProviderBundle,
  providerKeyForBaiyingModelId,
} from "./aimodel-config.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

function createAimodelPayload() {
  return {
    key: "byai:aimodel:config:-2000",
    content: JSON.stringify({
      authToken: "secret-token",
      instanceId: "-2000",
      instanceParam: {
        maxTokens: 1024,
      },
      maxContentToken: "128000",
      modelCode: "glm-5-turbo",
      modelName: "glm-5-turbo",
      status: 1,
      url: "https://lab.iwhalecloud.com/gpt-proxy/v1",
    }),
    raw: {
      authToken: "secret-token",
      instanceId: "-2000",
      instanceParam: {
        maxTokens: 1024,
      },
      maxContentToken: "128000",
      modelCode: "glm-5-turbo",
      modelName: "glm-5-turbo",
      status: 1,
      url: "https://lab.iwhalecloud.com/gpt-proxy/v1",
    },
    hash: "model-hash",
  };
}

describe("Baiying AI model config", () => {
  it("maps Redis model config into a provider without plaintext authToken", () => {
    const provider = parseBaiyingAimodelProviderBundle({
      payload: createAimodelPayload(),
      modelId: "-2000",
      secretProviderName: DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
    });
    expect(provider).toEqual({
      baseUrl: "https://lab.iwhalecloud.com/gpt-proxy/v1",
      apiKey: {
        source: "exec",
        provider: "baiying-aimodel-redis",
        id: "model:-2000",
      },
      api: "openai-completions",
      modelId: "glm-5-turbo",
      modelName: "glm-5-turbo",
      contextWindow: 128000,
      maxTokens: 1024,
    });
    expect(JSON.stringify(provider)).not.toContain("secret-token");
  });

  it("writes managed provider config with SecretRef and agent model primary", () => {
    const provider = parseBaiyingAimodelProviderBundle({
      payload: createAimodelPayload(),
      modelId: "-2000",
      secretProviderName: DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
    });
    expect(provider).not.toBeNull();
    if (!provider) return;

    const providerKey = providerKeyForBaiyingModelId("-2000");
    const managed: AdaptedManagedAgent = {
      sourceKey: "10000281",
      agentId: `${MANAGED_AGENT_PREFIX}10000281`,
      providerKey,
      modelRef: `${providerKey}/glm-5-turbo`,
      allowSpawnFrom: ["main"],
      listEntry: {
        id: `${MANAGED_AGENT_PREFIX}10000281`,
        name: "项目管理数字员工",
        identity: { name: "项目管理数字员工" },
        model: { primary: `${providerKey}/glm-5-turbo` },
        skills: [],
      },
      provider,
    };

    const cfg = mergeManagedAgentsIntoConfig({
      base: { agents: { list: [{ id: "main" }] } },
      managed: [managed],
      mainParentAgentId: "main",
      mergeAllowSpawnForMain: true,
      aimodelSecretResolverCommand: "/usr/bin/node",
      aimodelSecretResolverArgs: ["/plugin/dist/aimodel-secret-resolver-cli.js"],
    }) as {
      agents?: { list?: Array<{ id?: string; model?: unknown }> };
      models?: { providers?: Record<string, unknown> };
      secrets?: { providers?: Record<string, unknown> };
    };

    expect(cfg.agents?.list?.find((entry) => entry.id === managed.agentId)?.model).toEqual({
      primary: "baiying-m-neg-2000/glm-5-turbo",
    });
    expect(cfg.agents?.defaults?.models?.["baiying-m-neg-2000/glm-5-turbo"]).toEqual({
      alias: "项目管理数字员工",
    });
    expect(cfg.models?.providers?.[providerKey]).toEqual({
      baseUrl: "https://lab.iwhalecloud.com/gpt-proxy/v1",
      apiKey: {
        source: "exec",
        provider: "baiying-aimodel-redis",
        id: "model:-2000",
      },
      api: "openai-completions",
      models: [
        expect.objectContaining({
          id: "glm-5-turbo",
          api: "openai-completions",
          contextWindow: 128000,
          maxTokens: 1024,
        }),
      ],
    });
    expect(cfg.secrets?.providers?.["baiying-aimodel-redis"]).toEqual(
      expect.objectContaining({
        source: "exec",
        command: "/usr/bin/node",
        args: ["/plugin/dist/aimodel-secret-resolver-cli.js"],
        jsonOnly: true,
      }),
    );
    expect(JSON.stringify(cfg)).not.toContain("secret-token");
  });

  it("does not write a managed provider for invalid model config", () => {
    const provider = parseBaiyingAimodelProviderBundle({
      payload: {
        ...createAimodelPayload(),
        raw: { modelCode: "glm-5-turbo", status: 0 },
      },
      modelId: "-2000",
      secretProviderName: DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
    });
    expect(provider).toBeNull();
  });
});
