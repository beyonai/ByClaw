import type { RedisConnectionConfig } from "@byclaw/connector-openclaw-by-framework";

export interface AppConfig {
  host: string;
  port: number;
  corsOrigin: string | boolean;
  logLevel: string;
  delegationTimeoutMs: number;
  redis: RedisConnectionConfig;
  piProvider?: string;
  piModel?: string;
  openAiBaseUrl?: string;
}

/** 从环境变量加载并校验应用配置，避免无效端口或半配置模型进入运行期。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = integer(env.PORT ?? "3000", "PORT", 1, 65_535);
  const delegationTimeoutMs = integer(
    env.DELEGATION_TIMEOUT_MS ?? "1800000",
    "DELEGATION_TIMEOUT_MS",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if ((env.PI_PROVIDER && !env.PI_MODEL) || (!env.PI_PROVIDER && env.PI_MODEL)) {
    throw new Error("PI_PROVIDER and PI_MODEL must be configured together");
  }
  const redis: RedisConnectionConfig = {
    host: env.REDIS_HOST ?? "127.0.0.1",
    port: integer(env.REDIS_PORT ?? "6379", "REDIS_PORT", 1, 65_535),
    db: integer(env.REDIS_DATABASE ?? env.REDIS_DB ?? "0", "REDIS_DATABASE", 0, 15),
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  };
  return {
    host: env.HOST ?? "0.0.0.0",
    port,
    corsOrigin: !env.CORS_ORIGIN || env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
    logLevel: env.LOG_LEVEL ?? "info",
    delegationTimeoutMs,
    redis,
    ...(env.PI_PROVIDER ? { piProvider: env.PI_PROVIDER } : {}),
    ...(env.PI_MODEL ? { piModel: env.PI_MODEL } : {}),
    ...(env.OPENAI_BASE_URL ? { openAiBaseUrl: env.OPENAI_BASE_URL } : {}),
  };
}

/** 解析带上下界的整数环境变量，并在启动阶段给出明确错误。 */
function integer(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, received: ${raw}`);
  }
  return value;
}
