import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/compat";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from "openclaw/plugin-sdk/image-generation";
import type {
  GenerateImageParams,
  GenerateImageRuntimeResult,
} from "openclaw/plugin-sdk/image-generation-runtime";
import type { AgentRegistryState } from "../agent-state.js";
import type { BaiyingRedisJsonStore } from "../redis-json-store.js";
import {
  createImageModelCache,
  resolveImageModel,
  type ImageModelCache,
} from "./image-model-selector.js";
import type { ResolvedImageModel } from "./types.js";

export const BAIYING_IMAGE_PROVIDER_ID = "baiying-redis-image";
export const BAIYING_IMAGE_MODEL_REF = `${BAIYING_IMAGE_PROVIDER_ID}/dynamic`;

type NativeGenerateImage = (
  params: GenerateImageParams,
) => Promise<GenerateImageRuntimeResult>;

type ImageToolHookEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

type ImageToolHookContext = {
  toolName: string;
  agentId?: string;
};

const NATIVE_PROVIDER_BY_NAME: Record<string, string> = {
  CHATGPT: "openai",
  COMFY: "comfy",
  COMFYUI: "comfy",
  DEEPINFRA: "deepinfra",
  FAL: "fal",
  GEMINI: "google",
  GOOGLE: "google",
  LITELLM: "litellm",
  MICROSOFT_FOUNDRY: "microsoft-foundry",
  MINIMAX: "minimax",
  OPENAI: "openai",
  OPENROUTER: "openrouter",
  VYDRA: "vydra",
  XAI: "xai",
};

function normalizedEnum(value: string): string {
  return value.trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function resolveNativeProvider(model: ResolvedImageModel): string {
  const providerName = normalizedEnum(model.providerName);
  const protocol = normalizedEnum(model.modelProtocol);
  if (providerName === "MINIMAX" && protocol !== "MINIMAX_IMAGE") {
    throw new Error(`Unsupported image model route ${providerName}/${protocol}`);
  }
  if (providerName === "QWEN") {
    if (protocol === "OPENAI_IMAGE" || protocol === "OPENAI_COMPATIBLE_IMAGE") {
      return "openai";
    }
    throw new Error(`Unsupported image model route ${providerName}/${protocol}`);
  }
  const provider = NATIVE_PROVIDER_BY_NAME[providerName];
  if (!provider) {
    throw new Error(`Unsupported image model route ${providerName}/${protocol}`);
  }
  return provider;
}

function stripKnownEndpointPath(rawEndpoint: string, provider: string): string {
  const parsed = new URL(rawEndpoint);
  const suffixes =
    provider === "minimax"
      ? [/\/v1\/image_generation\/?$/i]
      : provider === "openai" || provider === "litellm"
        ? [/\/images\/(?:generations|edits)\/?$/i]
        : [];
  for (const suffix of suffixes) {
    parsed.pathname = parsed.pathname.replace(suffix, "");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function mergeNativeProviderConfig(params: {
  cfg: OpenClawConfig;
  provider: string;
  model: ResolvedImageModel;
}): OpenClawConfig {
  const existingProviders = params.cfg.models?.providers ?? {};
  const existingProvider = existingProviders[params.provider];
  const existingPlugins = params.cfg.plugins;
  const existingEntry = existingPlugins?.entries?.[params.provider];
  const allow = existingPlugins?.allow;
  return {
    ...params.cfg,
    models: {
      ...params.cfg.models,
      providers: {
        ...existingProviders,
        [params.provider]: {
          ...existingProvider,
          apiKey: params.model.apiToken,
          auth: "api-key",
          baseUrl: stripKnownEndpointPath(params.model.endpoint, params.provider),
          models: existingProvider?.models ?? [],
        },
      },
    },
    plugins: {
      ...existingPlugins,
      ...(allow
        ? { allow: Array.from(new Set([...allow, params.provider])) }
        : {}),
      entries: {
        ...existingPlugins?.entries,
        [params.provider]: {
          ...existingEntry,
          enabled: true,
        },
      },
    },
  };
}

function resolveManagedAgent(params: {
  registry: AgentRegistryState;
  agentDir?: string;
  model?: string;
}) {
  const modelAgentId = params.model?.trim();
  if (modelAgentId && modelAgentId !== "dynamic") {
    const byModel = params.registry.get(modelAgentId);
    if (byModel) {
      return byModel;
    }
  }
  const agentDir = params.agentDir?.trim();
  if (!agentDir) {
    return undefined;
  }
  const normalizedDir = path.resolve(agentDir);
  const defaultAgentId = path.basename(path.dirname(normalizedDir));
  const byDefaultPath = params.registry.get(defaultAgentId);
  if (byDefaultPath) {
    return byDefaultPath;
  }
  return params.registry.list().find((agent) => {
    const configured = agent.listEntry.agentDir?.trim();
    return configured ? path.resolve(configured) === normalizedDir : false;
  });
}

function sanitizedProviderError(error: unknown, token: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = token ? message.replaceAll(token, "[redacted]") : message;
  return new Error(safeMessage, error instanceof Error ? { cause: error } : undefined);
}

function toNativeGenerateParams(params: {
  request: ImageGenerationRequest;
  cfg: OpenClawConfig;
  model: ResolvedImageModel;
  provider: string;
}): GenerateImageParams {
  const request = params.request;
  return {
    cfg: params.cfg,
    prompt: request.prompt,
    agentDir: request.agentDir,
    authStore: request.authStore,
    modelOverride: `${params.provider}/${params.model.modelCode}`,
    count: request.count,
    size: request.size,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    quality: request.quality,
    outputFormat: request.outputFormat,
    background: request.background,
    inputImages: request.inputImages,
    providerOptions: request.providerOptions,
    ssrfPolicy: request.ssrfPolicy,
    timeoutMs: request.timeoutMs ?? params.model.timeout,
    autoProviderFallback: false,
  };
}

export function createManagedImageToolRoutingHook(params: {
  registry: AgentRegistryState;
}) {
  return (event: ImageToolHookEvent, ctx: ImageToolHookContext) => {
    if (event.toolName !== "image_generate") {
      return undefined;
    }
    const agentId = ctx.agentId?.trim();
    if (!agentId || !params.registry.get(agentId)) {
      return undefined;
    }
    const action = typeof event.params.action === "string" ? event.params.action : "";
    if (action === "list" || action === "status") {
      return undefined;
    }
    return {
      params: {
        ...event.params,
        model: `${BAIYING_IMAGE_PROVIDER_ID}/${agentId}`,
      },
    };
  };
}

export function createBaiyingNativeImageProvider(deps: {
  registry: AgentRegistryState;
  store: BaiyingRedisJsonStore;
  loadGenerateImage: () => Promise<NativeGenerateImage>;
  cache?: ImageModelCache;
}): ImageGenerationProvider {
  const cache = deps.cache ?? createImageModelCache();
  return {
    id: BAIYING_IMAGE_PROVIDER_ID,
    label: "Baiying Redis image router",
    defaultModel: "dynamic",
    models: ["dynamic"],
    defaultTimeoutMs: 120_000,
    isConfigured: ({ agentDir }) => Boolean(resolveManagedAgent({ registry: deps.registry, agentDir })),
    capabilities: {
      generate: {
        maxCount: 9,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      edit: {
        enabled: true,
        maxCount: 9,
        maxInputImages: 5,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      output: {
        qualities: ["low", "medium", "high", "auto"],
        formats: ["png", "jpeg", "webp"],
        backgrounds: ["transparent", "opaque", "auto"],
      },
    },
    async generateImage(request): Promise<ImageGenerationResult> {
      const agent = resolveManagedAgent({
        registry: deps.registry,
        agentDir: request.agentDir,
        model: request.model,
      });
      if (!agent) {
        throw new Error("Managed digital employee image configuration is unavailable");
      }
      const model = await resolveImageModel({
        agent,
        store: deps.store,
        cache,
      });
      try {
        const provider = resolveNativeProvider(model);
        const cfg = mergeNativeProviderConfig({ cfg: request.cfg, provider, model });
        const generateImage = await deps.loadGenerateImage();
        const result = await generateImage(
          toNativeGenerateParams({ request, cfg, model, provider }),
        );
        return {
          images: result.images,
          model: `${result.provider}/${result.model}`,
          metadata: {
            ...result.metadata,
            baiyingDynamicImageModel: {
              modelId: model.modelId,
              provider: result.provider,
              source: model.source,
            },
          },
        };
      } catch (error) {
        throw sanitizedProviderError(error, model.apiToken);
      }
    },
  };
}

export function registerBaiyingNativeImageRouting(params: {
  api: {
    registerImageGenerationProvider: (provider: ImageGenerationProvider) => void;
    on: (
      name: "before_tool_call",
      handler: ReturnType<typeof createManagedImageToolRoutingHook>,
    ) => void;
  };
  registry: AgentRegistryState;
  store: BaiyingRedisJsonStore;
  loadGenerateImage: () => Promise<NativeGenerateImage>;
}): void {
  params.api.registerImageGenerationProvider(
    createBaiyingNativeImageProvider({
      registry: params.registry,
      store: params.store,
      loadGenerateImage: params.loadGenerateImage,
    }),
  );
  params.api.on(
    "before_tool_call",
    createManagedImageToolRoutingHook({ registry: params.registry }),
  );
}
