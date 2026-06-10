import { describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { mergeManagedAgentsIntoConfig } from "./agent-registry.js";
import {
  DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
  parseBaiyingAimodelProviderBundle,
  providerKeyForBaiyingModelId,
  readAuthTokenFromAimodelTypeListPayload,
  resolveAimodelModelInputFromAbilities,
  resolveAimodelProviderApiFromInstanceParam,
  resolveDefaultBaiyingAimodelProviderBundle,
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

function createAimodelTypeListPayload() {
  const content = JSON.stringify([
    {
      authToken: "default-secret-token",
      instanceId: "10004014",
      instanceParam: { maxTokens: 1024 },
      isDefault: 1,
      maxContentToken: "128000",
      modelCode: "deepseek-v4-flash",
      modelName: "deepseek-v4-flash",
      modelType: "LLM",
      status: 1,
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  ]);
  return {
    key: "byai:aimodel:typelist:LLM",
    content,
    raw: JSON.parse(content) as unknown,
    hash: "typelist-hash",
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
      input: ["text"],
    });
    expect(JSON.stringify(provider)).not.toContain("secret-token");
  });

  it("maps providerName OpenAI and Anthropic to OpenClaw provider APIs", () => {
    expect(
      resolveAimodelProviderApiFromInstanceParam({
        providerName: "OpenAI",
      }),
    ).toBe("openai-completions");
    expect(
      resolveAimodelProviderApiFromInstanceParam({
        providerName: "Anthropic",
      }),
    ).toBe("anthropic-messages");
    expect(
      resolveAimodelProviderApiFromInstanceParam({
        modelProtocol: "Anthropic",
      }),
    ).toBe("anthropic-messages");
  });

  it("maps abilities 3 to text-only and 7 to multimodal input", () => {
    expect(resolveAimodelModelInputFromAbilities(["3"])).toEqual(["text"]);
    expect(resolveAimodelModelInputFromAbilities(["7"])).toEqual(["text", "image"]);
    expect(resolveAimodelModelInputFromAbilities(["3", "7"])).toEqual(["text", "image"]);
  });

  it("maps Redis Anthropic multimodal model config into provider bundle", () => {
    const provider = parseBaiyingAimodelProviderBundle({
      payload: {
        ...createAimodelPayload(),
        raw: {
          authToken: "secret-token",
          instanceId: "10243472",
          instanceParam: {
            providerName: "Anthropic",
            abilities: ["6", "5", "7", "2"],
            maxTokens: 131072,
          },
          maxContentToken: "262144",
          modelCode: "claude-sonnet-4-6",
          modelName: "claude-sonnet-4-6",
          status: 1,
          url: "https://api.example.com/anthropic",
        },
      },
      modelId: "10243472",
      secretProviderName: DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
    });
    expect(provider).toEqual(
      expect.objectContaining({
        api: "anthropic-messages",
        input: ["text", "image"],
        modelId: "claude-sonnet-4-6",
      }),
    );
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
          input: ["text"],
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

  it("writes the Baiying LLM typelist model as the OpenClaw default model", () => {
    const cfg = mergeManagedAgentsIntoConfig({
      base: {
        agents: {
          list: [{ id: "main" }],
          defaults: { model: { primary: "minimax/MiniMax-M2.7-highspeed" } },
        },
      },
      managed: [],
      defaultModel: {
        providerKey: "baiying-m-10004014",
        modelRef: "baiying-m-10004014/deepseek-v4-flash",
        provider: {
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: {
            source: "exec",
            provider: "baiying-aimodel-redis",
            id: "model:10004014",
          },
          api: "openai-completions",
          modelId: "deepseek-v4-flash",
          modelName: "deepseek-v4-flash",
        },
      },
      mainParentAgentId: "main",
      mergeAllowSpawnForMain: true,
      aimodelSecretResolverCommand: "/usr/bin/node",
      aimodelSecretResolverArgs: ["/plugin/dist/aimodel-secret-resolver-cli.js"],
    }) as {
      agents?: { defaults?: { model?: { primary?: string }; models?: Record<string, unknown> } };
      models?: { providers?: Record<string, unknown> };
      secrets?: { providers?: Record<string, { env?: Record<string, string> }> };
    };

    expect(cfg.agents?.defaults?.model?.primary).toBe(
      "baiying-m-10004014/deepseek-v4-flash",
    );
    expect(cfg.agents?.list?.find((entry) => entry.id === "main")?.model).toEqual({
      primary: "baiying-m-10004014/deepseek-v4-flash",
    });
    expect(cfg.agents?.defaults?.models?.["baiying-m-10004014/deepseek-v4-flash"]).toEqual({
      alias: "deepseek-v4-flash",
    });
    expect(cfg.models?.providers?.["baiying-m-10004014"]).toEqual(
      expect.objectContaining({
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      }),
    );
    expect(
      cfg.secrets?.providers?.["baiying-aimodel-redis"]?.env?.BAIYING_AIMODEL_TYPELIST_REDIS_KEY,
    ).toBe("byai:aimodel:typelist");
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

  it("prefers typelist isDefault=1 over stale list order", async () => {
    const warns: string[] = [];
    const content = JSON.stringify([
      {
        authToken: "token-a",
        instanceId: "10004014",
        isDefault: 0,
        modelCode: "deepseek-v4-flash",
        modelType: "LLM",
        status: 1,
        url: "https://example.com/v1",
      },
      {
        authToken: "token-b",
        instanceId: "10004000",
        isDefault: 1,
        modelCode: "qwen3.6-27b",
        modelType: "LLM",
        status: 1,
        url: "https://example.com/v1",
      },
    ]);
    const provider = await resolveDefaultBaiyingAimodelProviderBundle({
      redisJsonStore: {
        getJsonByKey: async () => null,
        getHashJson: async () => ({
          key: "byai:aimodel:typelist:LLM",
          content,
          raw: JSON.parse(content) as unknown,
          hash: "multi-default-hash",
        }),
        getDigEmployeeJson: async () => null,
        getResourceJson: async () => null,
        close: async () => {},
      },
      secretProviderName: DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
      log: { warn: (m) => warns.push(m) },
    });

    expect(provider?.modelRef).toBe("baiying-m-10004000/qwen3.6-27b");
    expect(warns.some((m) => m.includes("selecting marked default 10004000"))).toBe(true);
  });

  it("picks first typelist entry when qwen is ordered before deepseek", async () => {
    const content = JSON.stringify([
      {
        authToken: "token-b",
        instanceId: "10004000",
        isDefault: 1,
        modelCode: "qwen3.6-27b",
        modelType: "LLM",
        status: 1,
        url: "https://example.com/v1",
      },
      {
        authToken: "token-a",
        instanceId: "10004014",
        isDefault: 1,
        modelCode: "deepseek-v4-flash",
        modelType: "LLM",
        status: 1,
        url: "https://example.com/v1",
      },
    ]);
    const provider = await resolveDefaultBaiyingAimodelProviderBundle({
      redisJsonStore: {
        getJsonByKey: async () => null,
        getHashJson: async () => ({
          key: "byai:aimodel:typelist:LLM",
          content,
          raw: JSON.parse(content) as unknown,
          hash: "qwen-first-hash",
        }),
        getDigEmployeeJson: async () => null,
        getResourceJson: async () => null,
        close: async () => {},
      },
      secretProviderName: DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
      log: { warn: () => undefined },
    });

    expect(provider?.modelRef).toBe("baiying-m-10004000/qwen3.6-27b");
  });

  it("maps Redis LLM typelist default into a provider without plaintext authToken", async () => {
    const payload = createAimodelTypeListPayload();
    const provider = await resolveDefaultBaiyingAimodelProviderBundle({
      redisJsonStore: {
        getJsonByKey: async () => null,
        getHashJson: async ({ key, field }) =>
          key === "byai:aimodel:typelist" && field === "LLM" ? payload : null,
        getDigEmployeeJson: async () => null,
        getResourceJson: async () => null,
        close: async () => {},
      },
      secretProviderName: DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
      log: { warn: () => undefined },
    });

    expect(provider).toEqual({
      providerKey: "baiying-m-10004014",
      modelRef: "baiying-m-10004014/deepseek-v4-flash",
      hash: "typelist-hash",
      provider: expect.objectContaining({
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: {
          source: "exec",
          provider: "baiying-aimodel-redis",
          id: "model:10004014",
        },
        modelId: "deepseek-v4-flash",
      }),
    });
    expect(JSON.stringify(provider)).not.toContain("default-secret-token");
  });

  it("can read a default model token from the LLM typelist payload", () => {
    expect(readAuthTokenFromAimodelTypeListPayload(createAimodelTypeListPayload(), "10004014")).toBe(
      "default-secret-token",
    );
  });
});
