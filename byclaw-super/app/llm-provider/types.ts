import type { LlmProviderConfig } from "@byclaw/by-conductor";

export interface RedisHashReader {
  hget(key: string, field: string): Promise<string | Buffer | null>;
}

export interface LlmProviderLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface DeepSeekEnvironmentFallback {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
}

export interface LlmProviderResolution {
  source: "redis" | "environment";
  config: LlmProviderConfig;
}
