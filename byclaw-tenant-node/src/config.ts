import { hostname } from "node:os";
import { requireId } from "./domain/values.js";
import type { TenantIdentity } from "./domain/tenant.js";

export interface Config extends TenantIdentity {
  tenantId: string;
  instanceId: string;
  host: string;
  port: number;
  advertiseHost: string;
  stateDir: string;
  beUrl: string;
  kmsUrl: string;
  beClientIdentity: string;
  transport?: "http" | "https";
  internalToken?: string;
  tls?: { certFile: string; keyFile: string; caFile: string };
  redis: { host: string; port: number; db: number; username: string; password: string; tls?: {} };
}
/** 读取并校验启动配置；租户身份由 BE 创建容器时注入，本地 .env 用于模拟这一过程。 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (key: string): string => {
    const value = env[key];
    if (!value) throw new Error(`Missing configuration: ${key}`);
    return value;
  };
  const integer = (key: string, fallback: number, max = 65535): number => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const transport = env.INTERNAL_TRANSPORT === "http" ? "http" : "https";
  const secureUrl = (key: string): string => {
    const value = new URL(required(key));
    if (
      value.protocol !== `${transport}:` ||
      value.username ||
      value.password ||
      value.search ||
      value.hash
    )
      throw new Error(`Invalid ${key}`);
    return value.toString().replace(/\/$/, "");
  };
  const enterpriseId = requireId(required("ENTERPRISE_ID"));
  // 方案约定两个环境变量是同一个 enterprise_id，拒绝部署注入错配。
  if (requireId(required("TENANT_ID")) !== enterpriseId) throw new Error("Tenant IDs must match");
  if (env.REDIS_TLS !== "true" && env.REDIS_TLS !== "false")
    throw new Error("REDIS_TLS must be true or false");
  if (transport === "http" && !env.INTERNAL_API_TOKEN)
    throw new Error("Missing configuration: INTERNAL_API_TOKEN");
  const port = integer("PORT", 3100),
    redisPort = integer("REDIS_PORT", 6379);
  if (!port || !redisPort) throw new Error("Ports must be positive");
  return {
    enterpriseId,
    tenantId: enterpriseId,
    generation: requireId(required("TENANT_GENERATION")),
    dbSandboxRecordId: requireId(required("DB_SANDBOX_RECORD_ID")),
    instanceId: env.INSTANCE_ID ?? hostname(),
    host: env.HOST ?? "0.0.0.0",
    port,
    advertiseHost: required("ADVERTISE_HOST"),
    stateDir: required("NODE_STATE_DIR"),
    beUrl: secureUrl("BE_INTERNAL_URL"),
    kmsUrl: secureUrl("KMS_DECRYPT_URL"),
    beClientIdentity: transport === "https" ? required("BE_CLIENT_IDENTITY") : "",
    transport,
    internalToken: transport === "http" ? required("INTERNAL_API_TOKEN") : undefined,
    tls:
      transport === "https"
        ? {
            certFile: required("TLS_CERT_FILE"),
            keyFile: required("TLS_KEY_FILE"),
            caFile: required("TLS_CA_FILE"),
          }
        : undefined,
    redis: {
      host: required("REDIS_HOST"),
      port: redisPort,
      db: integer("REDIS_DATABASE", 0),
      username: required("REDIS_USERNAME"),
      password: required("REDIS_PASSWORD"),
      tls: env.REDIS_TLS === "true" ? {} : undefined,
    },
  };
}
