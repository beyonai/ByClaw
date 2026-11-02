import { hostname } from "node:os";
import type { RedisConnectionConfig } from "@byclaw/by-framework";
import { requireId } from "./domain/values.js";
import type { TenantIdentity } from "./domain/tenant.js";

export interface Config extends TenantIdentity {
  tenantId: string;
  commercialManaged?: boolean;
  instanceId: string;
  host: string;
  port: number;
  advertiseHost: string;
  stateDir: string;
  beUrl: string;
  kmsUrl: string;
  beClientIdentity: string;
  transport?: "http" | "https";
  internalToken: string;
  tls?: { certFile: string; keyFile: string; caFile: string };
  redis: RedisConnectionConfig;
  quota?: { keyPrefix: string; failurePolicy: "ALLOW" | "REJECT" };
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
  const quotaFailurePolicy = env.QUOTA_REDIS_FAILURE_POLICY ?? "ALLOW";
  if (quotaFailurePolicy !== "ALLOW" && quotaFailurePolicy !== "REJECT")
    throw new Error("Invalid QUOTA_REDIS_FAILURE_POLICY");
  const quotaKeyPrefix = env.QUOTA_REDIS_KEY_PREFIX ?? "byclaw:shared:quota:v1:";
  if (!quotaKeyPrefix.trim()) throw new Error("Invalid QUOTA_REDIS_KEY_PREFIX");
  // 方案约定两个环境变量是同一个 enterprise_id，拒绝部署注入错配。
  if (requireId(required("TENANT_ID")) !== enterpriseId) throw new Error("Tenant IDs must match");
  if (env.REDIS_TLS !== "true" && env.REDIS_TLS !== "false")
    throw new Error("REDIS_TLS must be true or false");
  if (!env.INTERNAL_API_TOKEN?.trim()) throw new Error("Missing configuration: INTERNAL_API_TOKEN");
  const port = integer("PORT", 3100),
    redisPort = integer("REDIS_PORT", 6379);
  if (!port || !redisPort) throw new Error("Ports must be positive");
  // Match the shared SDK: REDIS_CLUSTER_HOST selects Cluster before REDIS_MODE.
  const redisMode = env.REDIS_CLUSTER_HOST ? "cluster" : (env.REDIS_MODE ?? "standalone");
  if (redisMode !== "standalone" && redisMode !== "cluster") throw new Error("Invalid REDIS_MODE");
  const redisDatabase = integer("REDIS_DATABASE", 0);
  let clusterNodes: RedisConnectionConfig["clusterNodes"];
  if (redisMode === "cluster") {
    if ((env.REDIS_KEY_SCHEMA_VERSION || (env.REDIS_CLUSTER_HOST ? "v2" : "v1")) !== "v2")
      throw new Error("REDIS_MODE=cluster requires REDIS_KEY_SCHEMA_VERSION=v2");
    if (redisDatabase !== 0) throw new Error("Redis Cluster requires REDIS_DATABASE=0");
    const nodes = env.REDIS_CLUSTER_HOST || env.REDIS_CLUSTER_NODES;
    if (!nodes) throw new Error("Missing configuration: REDIS_CLUSTER_HOST");
    clusterNodes = nodes.split(",").map((entry) => {
      const node = entry.trim();
      const separator = node.lastIndexOf(":");
      const host = node.slice(0, separator);
      const portText = node.slice(separator + 1);
      const port = Number(portText);
      if (
        separator <= 0 ||
        !host.trim() ||
        /\s/.test(host) ||
        !/^\d+$/.test(portText) ||
        !Number.isSafeInteger(port) ||
        port < 1 ||
        port > 65535
      )
        throw new Error("Invalid REDIS_CLUSTER_HOST node (expected host:port)");
      return { host, port };
    });
  }

  return {
    enterpriseId,
    tenantId: enterpriseId,
    commercialManaged: env.COMMERCIAL_MANAGED === "true",
    generation: requireId(required("TENANT_GENERATION")),
    dbSandboxRecordId: requireId(required("DB_SANDBOX_RECORD_ID")),
    instanceId: env.INSTANCE_ID ?? hostname(),
    host: env.HOST ?? "0.0.0.0",
    port,
    // The host-machine alias does not point to this sandbox's unexposed service port.
    advertiseHost:
      !env.ADVERTISE_HOST || env.ADVERTISE_HOST === "host.containers.internal"
        ? env.POD_IP || hostname()
        : env.ADVERTISE_HOST,
    stateDir: required("NODE_STATE_DIR"),
    beUrl: secureUrl("BE_INTERNAL_URL"),
    kmsUrl: secureUrl("KMS_DECRYPT_URL"),
    beClientIdentity: transport === "https" ? required("BE_CLIENT_IDENTITY") : "",
    transport,
    internalToken: required("INTERNAL_API_TOKEN"),
    tls:
      transport === "https"
        ? {
            certFile: required("TLS_CERT_FILE"),
            keyFile: required("TLS_KEY_FILE"),
            caFile: required("TLS_CA_FILE"),
          }
        : undefined,
    redis: {
      mode: redisMode,
      clusterNodes,
      host: redisMode === "standalone" ? required("REDIS_HOST") : undefined,
      port: redisPort,
      db: redisDatabase,
      username: required("REDIS_USERNAME"),
      password: required("REDIS_PASSWORD"),
      tls: env.REDIS_TLS === "true" ? {} : undefined,
    },
    quota: { keyPrefix: quotaKeyPrefix, failurePolicy: quotaFailurePolicy },
  };
}
