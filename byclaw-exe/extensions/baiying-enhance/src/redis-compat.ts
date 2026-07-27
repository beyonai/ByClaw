import Redis, { Cluster } from "ioredis";
import { QueueNames, RegistryKeys } from "@byclaw/by-framework";

export type RedisCompatClient = Redis | Cluster;

export type RedisCompatConfig = {
  mode: "standalone" | "cluster";
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  clusterNodes: Array<{ host: string; port: number }>;
};

export type RedisCompatClientOptions = {
  lazyConnect?: boolean;
  enableOfflineQueue?: boolean;
  connectTimeout?: number;
  maxRetriesPerRequest?: number | null;
  retryStrategy?: (times: number) => number | null;
};

const V2_PREFIX = "byai_gateway:v2:";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseClusterNodes(raw: string | undefined): Array<{ host: string; port: number }> {
  const nodes: Array<{ host: string; port: number }> = [];
  for (const item of (raw || "").split(",")) {
    const value = item.trim();
    if (!value) {
      continue;
    }
    const splitAt = value.lastIndexOf(":");
    if (splitAt <= 0 || splitAt === value.length - 1) {
      throw new Error(`Invalid REDIS_CLUSTER_HOST node: ${value}`);
    }
    const host = value.slice(0, splitAt).trim();
    const port = Number.parseInt(value.slice(splitAt + 1).trim(), 10);
    if (!host || !Number.isFinite(port)) {
      throw new Error(`Invalid REDIS_CLUSTER_HOST node: ${value}`);
    }
    nodes.push({ host, port });
  }
  return nodes;
}

export function resolveRedisCompatConfig(env: NodeJS.ProcessEnv = process.env): RedisCompatConfig | null {
  const clusterHost = nonEmpty(env.REDIS_CLUSTER_HOST);
  const explicitMode = nonEmpty(env.REDIS_MODE)?.toLowerCase();
  const mode = explicitMode === "standalone" ? "standalone" : clusterHost ? "cluster" : "standalone";
  const standaloneHost = nonEmpty(env.REDIS_HOST);
  const standalonePort = nonEmpty(env.REDIS_PORT);
  if (mode === "standalone" && (!standaloneHost || !standalonePort)) {
    return null;
  }
  const host = standaloneHost || "localhost";
  const port = parsePort(env.REDIS_PORT, 6379);
  const db = parsePort(env.REDIS_DATABASE ?? env.REDIS_DB, 0);
  const username = nonEmpty(env.REDIS_USERNAME);
  const password = env.REDIS_PASSWORD !== undefined && env.REDIS_PASSWORD !== "" ? env.REDIS_PASSWORD : undefined;
  const clusterNodes = parseClusterNodes(clusterHost);

  if (mode === "cluster" && clusterNodes.length === 0) {
    throw new Error("REDIS_MODE=cluster requires REDIS_CLUSTER_HOST");
  }

  if (mode === "cluster") {
    return { mode, host, port, db, username, password, clusterNodes };
  }

  if (!host || !Number.isFinite(port) || !Number.isFinite(db)) {
    return null;
  }

  return { mode, host, port, db, username, password, clusterNodes };
}

export function isRedisClusterMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveRedisCompatConfig(env)?.mode === "cluster";
}

function redisKeySchemaVersion(env: NodeJS.ProcessEnv = process.env): "v1" | "v2" {
  const value = (env.REDIS_KEY_SCHEMA_VERSION || "v1").trim();
  if (value !== "v1" && value !== "v2") {
    throw new Error(`Invalid REDIS_KEY_SCHEMA_VERSION: ${value}`);
  }
  return value;
}

export function assertRedisKeySchemaForMode(config = resolveRedisCompatConfig()): void {
  if (config?.mode === "cluster" && redisKeySchemaVersion() !== "v2") {
    throw new Error(
      "Redis Cluster mode requires REDIS_KEY_SCHEMA_VERSION=v2 for by-framework key compatibility",
    );
  }
}

function versioned(v1Key: string, v2Suffix: string): string {
  return redisKeySchemaVersion() === "v2" ? `${V2_PREFIX}${v2Suffix}` : v1Key;
}

export const RedisCompatKeys = {
  ctrlStream(agentType: string): string {
    return versioned(`byai_gateway:ctrl:agent_type:${agentType}`, `ctrl:agent_type:${agentType}`);
  },
  workerCtrlStream(workerId: string): string {
    return versioned(`byai_gateway:ctrl:worker:${workerId}`, `ctrl:worker:{${workerId}}`);
  },
  capabilityCtrlStream(workerId: string): string {
    return versioned(`byai_gateway:ctrl:capability:${workerId}`, `ctrl:capability:{${workerId}}`);
  },
  sessionDataStream(sessionId: string): string {
    return versioned(`byai_gateway:session:${sessionId}:data_stream`, `session:{${sessionId}}:data_stream`);
  },
  sessionDataStreamScanPattern(): string {
    return redisKeySchemaVersion() === "v2"
      ? `${V2_PREFIX}session:{*}:data_stream`
      : "byai_gateway:session:*:data_stream";
  },
  sessionRegistry(sessionId: string): string {
    return versioned(`byai_gateway:session:${sessionId}:registry`, `session:{${sessionId}}:registry`);
  },
  taskGroup(groupId: string): string {
    return versioned(`byai_gateway:task_group:${groupId}`, `task_group:{${groupId}}`);
  },
  taskGroupResults(groupId: string): string {
    return versioned(`byai_gateway:task_group:${groupId}:results`, `task_group:{${groupId}}:results`);
  },
  knownWorkers(): string {
    return versioned("byai_gateway:registry:workers", "registry:workers");
  },
  workerDeclaredAgentTypes(workerId: string): string {
    return versioned(
      `byai_gateway:registry:worker:agent_types:${workerId}`,
      `registry:worker:{${workerId}}:agent_types`,
    );
  },
  agentTypeMembers(agentType: string): string {
    return versioned(
      `byai_gateway:registry:agent_type:workers:${agentType}`,
      `registry:agent_type:{${agentType}}:workers`,
    );
  },
  workerOnlineLease(workerId: string): string {
    return versioned(
      `byai_gateway:registry:worker:online:${workerId}`,
      `registry:worker:{${workerId}}:online`,
    );
  },
  workerLock(workerId: string): string {
    return versioned(
      `byai_gateway:registry:worker:lock:${workerId}`,
      `registry:worker:{${workerId}}:lock`,
    );
  },
  serviceDiscoveryInstances(serviceName: string): string {
    return versioned(`byai_gateway:sd:instances:${serviceName}`, `sd:{${serviceName}}:instances`);
  },
  serviceDiscoveryActive(serviceName: string): string {
    return versioned(`byai_gateway:sd:active:${serviceName}`, `sd:{${serviceName}}:active`);
  },
  serviceDiscoveryServices(): string {
    return versioned("byai_gateway:sd:services", "sd:services");
  },
};

export function patchByFrameworkRedisKeys(): void {
  assertRedisKeySchemaForMode();

  (QueueNames as unknown as { ctrl_stream: (agentType: string) => string }).ctrl_stream =
    RedisCompatKeys.ctrlStream;
  (QueueNames as unknown as { worker_ctrl_stream: (workerId: string) => string }).worker_ctrl_stream =
    RedisCompatKeys.workerCtrlStream;
  (QueueNames as unknown as { session_data_stream: (sessionId: string) => string }).session_data_stream =
    RedisCompatKeys.sessionDataStream;
  (QueueNames as unknown as { task_group: (groupId: string) => string }).task_group =
    RedisCompatKeys.taskGroup;
  (QueueNames as unknown as { task_group_results: (groupId: string) => string }).task_group_results =
    RedisCompatKeys.taskGroupResults;

  const registry = RegistryKeys as unknown as {
    KNOWN_WORKERS: string;
    SD_SERVICES: string;
    workerDeclaredAgentTypes: (workerId: string) => string;
    agentTypeMembers: (agentType: string) => string;
    worker_online_lease: (workerId: string) => string;
    worker_lock: (workerId: string) => string;
    session_registry: (sessionId: string) => string;
    sd_instance_details: (serviceName: string) => string;
    sd_active_instances: (serviceName: string) => string;
  };
  registry.KNOWN_WORKERS = RedisCompatKeys.knownWorkers();
  registry.SD_SERVICES = RedisCompatKeys.serviceDiscoveryServices();
  registry.workerDeclaredAgentTypes = RedisCompatKeys.workerDeclaredAgentTypes;
  registry.agentTypeMembers = RedisCompatKeys.agentTypeMembers;
  registry.worker_online_lease = RedisCompatKeys.workerOnlineLease;
  registry.worker_lock = RedisCompatKeys.workerLock;
  registry.session_registry = RedisCompatKeys.sessionRegistry;
  registry.sd_instance_details = RedisCompatKeys.serviceDiscoveryInstances;
  registry.sd_active_instances = RedisCompatKeys.serviceDiscoveryActive;

}

export function ensureByFrameworkRedisKeysPatched(): void {
  patchByFrameworkRedisKeys();
}

export function createRedisCompatClient(options: RedisCompatClientOptions = {}): RedisCompatClient {
  const config = resolveRedisCompatConfig();
  if (!config) {
    throw new Error("REDIS_HOST/REDIS_PORT missing or invalid");
  }
  assertRedisKeySchemaForMode(config);

  if (config.mode === "cluster") {
    return new Cluster(config.clusterNodes, {
      lazyConnect: options.lazyConnect,
      enableOfflineQueue: options.enableOfflineQueue,
      redisOptions: {
        username: config.username,
        password: config.password,
        connectTimeout: options.connectTimeout,
        maxRetriesPerRequest: options.maxRetriesPerRequest,
        enableOfflineQueue: options.enableOfflineQueue,
      },
      clusterRetryStrategy: options.retryStrategy
        ? (times) => options.retryStrategy?.(times) ?? null
        : undefined,
    });
  }

  return new Redis({
    host: config.host,
    port: config.port,
    db: config.db,
    username: config.username,
    password: config.password,
    lazyConnect: options.lazyConnect,
    enableOfflineQueue: options.enableOfflineQueue,
    connectTimeout: options.connectTimeout,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
    retryStrategy: options.retryStrategy,
  });
}

export function createByFrameworkRedisClient(options: RedisCompatClientOptions = {}): RedisCompatClient {
  ensureByFrameworkRedisKeysPatched();
  return createRedisCompatClient({ enableOfflineQueue: true, ...options });
}

export async function closeRedisCompatClient(client: RedisCompatClient | null | undefined): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
