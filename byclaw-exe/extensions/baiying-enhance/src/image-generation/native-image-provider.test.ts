import { describe, expect, it, vi } from "vitest";
import type { AdaptedManagedAgent } from "../agent-adapter.js";
import { AgentRegistryState } from "../agent-state.js";
import type {
  BaiyingRedisJsonStore,
  RedisJsonPayload,
} from "../redis-json-store.js";
import {
  BAIYING_IMAGE_PROVIDER_ID,
  createBaiyingNativeImageProvider,
  createManagedImageToolRoutingHook,
  registerBaiyingNativeImageRouting,
} from "./native-image-provider.js";

const TEST_TOKEN = "native-image-provider-test-token";

function payload(key: string, raw: unknown): RedisJsonPayload {
  const content = JSON.stringify(raw);
  return { key, content, raw, hash: `hash:${content}` };
}

function model(params: {
  id: string;
  code: string;
  providerName: string;
  modelProtocol: string;
  url: string;
  extendParam?: Record<string, unknown>;
}) {
  return {
    authToken: TEST_TOKEN,
    instanceId: params.id,
    instanceParam: {
      providerName: params.providerName,
      modelProtocol: params.modelProtocol,
      readTimeoutSec: 120,
      ...(params.extendParam ? { extendParam: JSON.stringify(params.extendParam) } : {}),
    },
    modelCode: params.code,
    providerName: params.providerName,
    modelProtocol: params.modelProtocol,
    status: 1,
    url: params.url,
    modelType: "IMAGE_GENERATION",
    isDefault: 0,
  };
}

function managedAgent(): AdaptedManagedAgent {
  return {
    sourceKey: "employee-1",
    agentId: "baiying-agent-employee-1",
    providerKey: "",
    modelRef: "",
    allowSpawnFrom: ["main"],
    listEntry: { id: "baiying-agent-employee-1", name: "Image employee" },
  };
}

function memoryStore(state: { imageModelId: string }): BaiyingRedisJsonStore {
  const models: Record<string, unknown> = {
    "22": model({
      id: "22",
      code: "image-01",
      providerName: "MINIMAX",
      modelProtocol: "MINIMAX_IMAGE",
      url: "https://api.minimaxi.com/v1/image_generation",
    }),
    "33": model({
      id: "33",
      code: "gpt-image-1",
      providerName: "OPENAI",
      modelProtocol: "OPENAI_IMAGE",
      url: "https://api.openai.com/v1/images/generations",
    }),
  };
  return {
    getJsonByKey: async () => null,
    getJsonByKeyStrict: async () => ({ status: "missing" }),
    getDigEmployeeJson: async () =>
      payload("DIG_EMPLOYEE_employee-1", { imageModelId: state.imageModelId }),
    getDigEmployeeJsonStrict: async () => ({
      status: "ok",
      value: payload("DIG_EMPLOYEE_employee-1", {
        imageModelId: state.imageModelId,
      }),
    }),
    getHashJson: async ({ field }) =>
      models[field] ? payload(`byai:aimodel:config:${field}`, models[field]) : null,
    getHashJsonStrict: async ({ field }) =>
      models[field]
        ? {
            status: "ok",
            value: payload(`byai:aimodel:config:${field}`, models[field]),
          }
        : { status: "missing" },
    getResourceJson: async () => null,
    close: async () => {},
  };
}

function request(agentId = "baiying-agent-employee-1") {
  return {
    provider: BAIYING_IMAGE_PROVIDER_ID,
    model: agentId,
    prompt: "draw a blue whale",
    cfg: { agents: { defaults: {} } },
    count: 1,
    aspectRatio: "1:1",
  };
}

describe("Baiying native image provider", () => {
  it("registers an image provider and a native image_generate routing hook", () => {
    const registeredProviders: Array<{ id: string }> = [];
    const registeredHooks: Array<{ name: string; handler: unknown }> = [];
    const registry = new AgentRegistryState();

    registerBaiyingNativeImageRouting({
      api: {
        registerImageGenerationProvider: (provider) => registeredProviders.push(provider),
        on: (name, handler) => registeredHooks.push({ name, handler }),
      },
      registry,
      store: memoryStore({ imageModelId: "22" }),
      loadGenerateImage: async () => vi.fn(),
    });

    expect(registeredProviders.map((provider) => provider.id)).toEqual([
      BAIYING_IMAGE_PROVIDER_ID,
      "volcengine",
    ]);
    expect(registeredHooks.map((hook) => hook.name)).toEqual(["before_tool_call"]);
  });

  it("forces managed employees onto OpenClaw's native image_generate tool", () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const hook = createManagedImageToolRoutingHook({ registry });

    expect(
      hook(
        { toolName: "image_generate", params: { prompt: "a whale", model: "openai/other" } },
        { toolName: "image_generate", agentId: "baiying-agent-employee-1" },
      ),
    ).toEqual({
      params: {
        prompt: "a whale",
        model: `${BAIYING_IMAGE_PROVIDER_ID}/baiying-agent-employee-1`,
      },
    });
    expect(
      hook(
        { toolName: "image_generate", params: { prompt: "main" } },
        { toolName: "image_generate", agentId: "main" },
      ),
    ).toBeUndefined();
  });

  it("hot-switches Redis models and delegates both calls to OpenClaw's native runtime", async () => {
    const state = { imageModelId: "22" };
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const generateImage = vi.fn(async (params: Record<string, unknown>) => ({
      images: [{ buffer: Buffer.from("image"), mimeType: "image/png" }],
      provider: String(params.modelOverride).split("/")[0],
      model: String(params.modelOverride).split("/").slice(1).join("/"),
      attempts: [],
      ignoredOverrides: [],
    }));
    const provider = createBaiyingNativeImageProvider({
      registry,
      store: memoryStore(state),
      loadGenerateImage: async () => generateImage,
    });

    const first = await provider.generateImage(request());
    state.imageModelId = "33";
    const second = await provider.generateImage(request());

    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(generateImage.mock.calls[0]?.[0]).toMatchObject({
      modelOverride: "minimax/image-01",
      autoProviderFallback: false,
      timeoutMs: 120_000,
      cfg: {
        models: {
          providers: {
            minimax: {
              apiKey: TEST_TOKEN,
              baseUrl: "https://api.minimaxi.com",
            },
          },
        },
      },
    });
    expect(generateImage.mock.calls[1]?.[0]).toMatchObject({
      modelOverride: "openai/gpt-image-1",
      cfg: {
        models: {
          providers: {
            openai: {
              apiKey: TEST_TOKEN,
              baseUrl: "https://api.openai.com/v1",
            },
          },
        },
      },
    });
    expect(first.model).toBe("minimax/image-01");
    expect(second.model).toBe("openai/gpt-image-1");
    expect(JSON.stringify([first, second])).not.toContain(TEST_TOKEN);
  });

  it.each([
    ["COMFYUI", "COMFY_IMAGE", "comfy"],
    ["DEEPINFRA", "DEEPINFRA_IMAGE", "deepinfra"],
    ["FAL", "FAL_IMAGE", "fal"],
    ["GOOGLE", "GOOGLE_IMAGE", "google"],
    ["LITELLM", "LITELLM_IMAGE", "litellm"],
    ["MICROSOFT_FOUNDRY", "MICROSOFT_FOUNDRY_IMAGE", "microsoft-foundry"],
    ["MINIMAX", "MINIMAX_IMAGE", "minimax"],
    ["OPENAI", "OPENAI_IMAGE", "openai"],
    ["OPENROUTER", "OPENROUTER_IMAGE", "openrouter"],
    ["VYDRA", "VYDRA_IMAGE", "vydra"],
    ["XAI", "XAI_IMAGE", "xai"],
    ["VOLCENGINE", "VOLCENGINE_IMAGE", "volcengine"],
    ["DOUBAO", "VOLCENGINE_IMAGE", "volcengine"],
  ])("routes %s/%s to the OpenClaw %s provider", async (providerName, modelProtocol, expectedProvider) => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const store = memoryStore({ imageModelId: "22" });
    store.getHashJsonStrict = async ({ field }) => ({
      status: "ok",
      value: payload(
        `byai:aimodel:config:${field}`,
        model({
          id: field,
          code: "image-model",
          providerName,
          modelProtocol,
          url: "https://images.example.com/v1",
        }),
      ),
    });
    const generateImage = vi.fn(async (params: Record<string, unknown>) => ({
      images: [{ buffer: Buffer.from("image"), mimeType: "image/png" }],
      provider: String(params.modelOverride).split("/")[0],
      model: "image-model",
      attempts: [],
      ignoredOverrides: [],
    }));
    const provider = createBaiyingNativeImageProvider({
      registry,
      store,
      loadGenerateImage: async () => generateImage,
    });

    await provider.generateImage(request());

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: `${expectedProvider}/image-model` }),
    );
  });

  it("rejects a provider paired with another provider's image protocol before network access", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const store = memoryStore({ imageModelId: "22" });
    store.getHashJsonStrict = async ({ field }) => ({
      status: "ok",
      value: payload(
        `byai:aimodel:config:${field}`,
        model({
          id: field,
          code: "gpt-image-2",
          providerName: "OPENAI",
          modelProtocol: "GOOGLE_IMAGE",
          url: "https://api.openai.com/v1",
        }),
      ),
    });
    const generateImage = vi.fn();
    const provider = createBaiyingNativeImageProvider({
      registry,
      store,
      loadGenerateImage: async () => generateImage,
    });

    await expect(provider.generateImage(request())).rejects.toThrow(
      "Unsupported image model route OPENAI/GOOGLE_IMAGE",
    );
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("injects ComfyUI workflow settings into the in-memory plugin config", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const store = memoryStore({ imageModelId: "22" });
    store.getHashJsonStrict = async ({ field }) => ({
      status: "ok",
      value: payload(
        `byai:aimodel:config:${field}`,
        model({
          id: field,
          code: "workflow",
          providerName: "COMFYUI",
          modelProtocol: "COMFY_IMAGE",
          url: "http://127.0.0.1:8188",
          extendParam: {
            mode: "local",
            workflowPath: "/workspace/comfy-image.json",
            promptNodeId: "6",
          },
        }),
      ),
    });
    const generateImage = vi.fn(async () => ({
      images: [{ buffer: Buffer.from("image"), mimeType: "image/png" }],
      provider: "comfy",
      model: "workflow",
      attempts: [],
      ignoredOverrides: [],
    }));
    const provider = createBaiyingNativeImageProvider({
      registry,
      store,
      loadGenerateImage: async () => generateImage,
    });

    await provider.generateImage(request());

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.objectContaining({
          plugins: expect.objectContaining({
            entries: expect.objectContaining({
              comfy: expect.objectContaining({
                config: expect.objectContaining({
                  mode: "local",
                  baseUrl: "http://127.0.0.1:8188",
                  workflowPath: "/workspace/comfy-image.json",
                  promptNodeId: "6",
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("rejects providers that OpenClaw cannot route without exposing the token", async () => {
    const registry = new AgentRegistryState();
    registry.replaceAll([managedAgent()]);
    const state = { imageModelId: "22" };
    const store = memoryStore(state);
    store.getHashJsonStrict = async ({ field }) => ({
      status: "ok",
      value: payload(
        `byai:aimodel:config:${field}`,
        model({
          id: field,
          code: "qwen-image",
          providerName: "QWEN",
          modelProtocol: "DASHSCOPE_IMAGE",
          url: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        }),
      ),
    });
    const provider = createBaiyingNativeImageProvider({
      registry,
      store,
      loadGenerateImage: async () => vi.fn(),
    });

    const error = await provider.generateImage(request()).catch((value) => value);

    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).toContain("QWEN/DASHSCOPE_IMAGE");
    expect(String(error.message)).not.toContain(TEST_TOKEN);
  });
});
