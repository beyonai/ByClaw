/** 与具体 LLM SDK 无关的 API 协议。 */
export type LlmApiProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages";

export interface LlmReasoningConfig {
  enabled: boolean;
  capability?: string;
  defaultLevel?: string;
  supportedEfforts?: string[];
  effortMap?: Record<string, string>;
  budgets?: {
    minimal?: number;
    low?: number;
    medium?: number;
    high?: number;
  };
  compatFormat?: string;
}

/** Composition Root 传入编排层的中立模型描述，不暴露任何 Pi SDK 类型。 */
export interface LlmProviderConfig {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  protocol: LlmApiProtocol;
  authHeader: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  reasoning: LlmReasoningConfig;
}
