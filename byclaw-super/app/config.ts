import type { RedisConnectionConfig } from "@byclaw/connector-openclaw-by-framework";
import {
  DEFAULT_BYCLAW_LOGIN_JWT_PUBLIC_KEY,
  type BeyondTokenVerifierOptions,
} from "./auth/beyond-token.js";
import type { ByClawBeAgentCatalogOptions } from "./byclaw-be-agent-catalog.js";

export interface AppConfig {
  host: string;
  port: number;
  corsOrigin: string | boolean;
  logLevel: string;
  delegationTimeoutMs: number;
  redis: RedisConnectionConfig;
  auth: BeyondTokenVerifierOptions;
  byClawBe: Omit<ByClawBeAgentCatalogOptions, "fetchImpl">;
  worker: ByFrameworkWorkerConfig;
  piProvider?: string;
  piModel?: string;
  openAiBaseUrl?: string;
}

/** by-framework 入站 Worker 的业务层配置。 */
export interface ByFrameworkWorkerConfig {
  enabled: boolean;
  agentType: string;
  workerId?: string;
  maxConcurrency: number;
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
    auth: {
      publicKey: env.LOGIN_JWT_PUBLIC_KEY ?? DEFAULT_BYCLAW_LOGIN_JWT_PUBLIC_KEY,
    },
    byClawBe: {
      baseUrl: env.BYCLAW_BE_BASE_URL ?? "http://127.0.0.1:8086",
      timeoutMs: integer(env.BYCLAW_BE_TIMEOUT_MS ?? "10000", "BYCLAW_BE_TIMEOUT_MS", 1, 300_000),
    },
    worker: {
      enabled: booleanValue(env.BYCLAW_WORKER_ENABLED ?? "true", "BYCLAW_WORKER_ENABLED"),
      agentType: nonEmpty(env.BYCLAW_WORKER_AGENT_TYPE ?? "BY_MAESTRO", "BYCLAW_WORKER_AGENT_TYPE"),
      ...(env.BYCLAW_WORKER_ID
        ? { workerId: nonEmpty(env.BYCLAW_WORKER_ID, "BYCLAW_WORKER_ID") }
        : {}),
      maxConcurrency: integer(
        env.BYCLAW_WORKER_MAX_CONCURRENCY ?? "10",
        "BYCLAW_WORKER_MAX_CONCURRENCY",
        1,
        1_000,
      ),
    },
    ...(env.PI_PROVIDER ? { piProvider: env.PI_PROVIDER } : {}),
    ...(env.PI_MODEL ? { piModel: env.PI_MODEL } : {}),
    ...(env.OPENAI_BASE_URL ? { openAiBaseUrl: env.OPENAI_BASE_URL } : {}),
  };
}

/** 解析显式布尔环境变量，避免任意非空字符串被误判为开启。 */
function booleanValue(raw: string, name: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1 or 0, received: ${raw}`);
}

/** 校验必须存在的文本环境变量，并返回去除首尾空白后的值。 */
function nonEmpty(raw: string, name: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

/** 解析带上下界的整数环境变量，并在启动阶段给出明确错误。 */
function integer(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, received: ${raw}`);
  }
  return value;
}
