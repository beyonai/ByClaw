import {
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { LlmProviderConfig, LlmReasoningConfig } from "./llm-provider.js";

export interface PiRuntimeProviderConfig {
  providerId: string;
  modelId: string;
  provider: Parameters<ModelRuntime["registerProvider"]>[1];
  requestAdapter?: "volcengine-ark-responses";
  thinkingBudgets?: NonNullable<
    Parameters<typeof SettingsManager.inMemory>[0]
  >["thinkingBudgets"];
}

export interface PiModelRuntime {
  runtime: Awaited<ReturnType<typeof ModelRuntime.create>>;
  selectedModel: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
  requestAdapter: PiRuntimeProviderConfig["requestAdapter"];
  thinkingBudgets: PiRuntimeProviderConfig["thinkingBudgets"];
}

/** 把中立模型描述转换为 Pi SDK Provider 配置。 */
export function buildPiRuntimeProviderConfig(
  config: LlmProviderConfig,
): PiRuntimeProviderConfig {
  const reasoning = resolveReasoning(config);
  return {
    providerId: config.providerId,
    modelId: config.modelId,
    ...(isVolcengineArk(config)
      ? { requestAdapter: "volcengine-ark-responses" as const }
      : {}),
    ...(reasoning.thinkingBudgets
      ? { thinkingBudgets: reasoning.thinkingBudgets }
      : {}),
    provider: {
      name: config.providerName,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      authHeader: config.authHeader,
      api: config.protocol,
      models: [
        {
          id: config.modelId,
          name: config.modelName,
          reasoning: config.reasoning.enabled,
          input: config.input,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: config.contextWindow,
          maxTokens: config.maxTokens,
          ...(reasoning.thinkingLevelMap
            ? { thinkingLevelMap: reasoning.thinkingLevelMap }
            : {}),
          ...(reasoning.compat ? { compat: reasoning.compat } : {}),
        },
      ],
    },
  };
}

/** 创建 Pi ModelRuntime、注册 Provider，并完成认证后的目标模型选择。 */
export async function createPiModelRuntime(
  config: LlmProviderConfig,
): Promise<PiModelRuntime> {
  const provider = buildPiRuntimeProviderConfig(config);
  const runtime = await ModelRuntime.create();
  runtime.registerProvider(provider.providerId, provider.provider);
  const available = await runtime.getAvailable(provider.providerId);
  const selectedModel = available.find(
    (candidate) =>
      candidate.provider === provider.providerId &&
      candidate.id === provider.modelId,
  );
  if (!selectedModel) {
    throw new Error(
      `Pi model is unavailable or unauthenticated: ${provider.providerId}/${provider.modelId}`,
    );
  }
  return {
    runtime,
    selectedModel,
    requestAdapter: provider.requestAdapter,
    thinkingBudgets: provider.thinkingBudgets,
  };
}

function resolveReasoning(config: LlmProviderConfig): {
  thinkingLevelMap?: Record<string, string | null>;
  compat?: Record<string, unknown>;
  thinkingBudgets?: PiRuntimeProviderConfig["thinkingBudgets"];
} {
  if (!config.reasoning.enabled) return {};
  const capability = config.reasoning.capability?.toLowerCase() ?? "";
  const explicitMap = config.reasoning.effortMap ?? {};
  const supported = config.reasoning.supportedEfforts ?? [];
  const defaultLevel = config.reasoning.defaultLevel ?? "medium";
  const map: Record<string, string | null> = { off: null };
  for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
    const supportedLevel = supported.includes(level)
      ? level
      : supported.includes(defaultLevel)
        ? defaultLevel
        : supported[0] ?? defaultLevel;
    map[level] = explicitMap[level] ?? supportedLevel;
  }
  const format = inferThinkingFormat(config.reasoning, config);
  const compat =
    config.protocol === "openai-completions"
      ? {
          supportsUsageInStreaming: true,
          supportsReasoningEffort: capability === "effort",
          ...(format ? { thinkingFormat: format } : {}),
        }
      : undefined;
  return {
    thinkingLevelMap: isVolcengineArk(config) ? deepSeekThinkingLevelMap() : map,
    ...(compat ? { compat } : {}),
    ...(config.reasoning.budgets
      ? { thinkingBudgets: config.reasoning.budgets }
      : {}),
  };
}

function inferThinkingFormat(
  reasoning: LlmReasoningConfig,
  config: LlmProviderConfig,
): string | undefined {
  const configured = reasoning.compatFormat?.toLowerCase();
  const supportedFormats = new Set([
    "openai", "openrouter", "deepseek", "together", "zai", "qwen",
    "chat-template", "qwen-chat-template", "string-thinking", "ant-ling",
  ]);
  if (configured && supportedFormats.has(configured)) return configured;
  const normalized = config.baseUrl.toLowerCase();
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("dashscope") || normalized.includes("qwen")) return "qwen";
  if (normalized.includes("openrouter")) return "openrouter";
  if (normalized.includes("together")) return "together";
  return config.protocol === "openai-completions" ? "openai" : undefined;
}

function isVolcengineArk(config: LlmProviderConfig): boolean {
  const marker = `${config.baseUrl} ${config.providerName}`.toLowerCase();
  return config.protocol === "openai-responses" && /volcengine|volces|ark/.test(marker);
}

function deepSeekThinkingLevelMap() {
  return {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
    max: "high",
  };
}
