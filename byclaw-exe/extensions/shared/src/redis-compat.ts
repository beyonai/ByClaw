import { Cluster, Redis } from "ioredis";
import type { ClusterNode, ClusterOptions, RedisOptions } from "ioredis";

export type RedisMode = "standalone" | "cluster";
export type RedisKeySchemaVersion = "v1" | "v2";
export type RedisClusterNode = { host: string; port: number };

export type RedisConnectionConfig = {
  host?: string;
  port?: number;
  db?: number;
  username?: string;
  password?: string;
  mode: RedisMode;
  clusterNodes: RedisClusterNode[];
  keySchemaVersion: RedisKeySchemaVersion;
  connectTimeoutMs?: number;
};

export type RedisClient = Redis | Cluster;

export type RedisClientOptions = {
  lazyConnect?: boolean;
  enableOfflineQueue?: boolean;
  connectTimeout?: number;
  maxRetriesPerRequest?: number | null;
  retryStrategy?: RedisOptions["retryStrategy"];
};

const SPRING_DATA_REDIS = "spring.data.redis";
const SPRING_REDIS = "spring.redis";

function envValue(env: NodeJS.ProcessEnv, names: string[]): string {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseInteger(raw: string, fallback?: number): number | undefined {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseClusterNodes(raw: string): RedisClusterNode[] {
  if (!raw.trim()) {
    return [];
  }
  const out: RedisClusterNode[] = [];
  for (const entry of raw.split(",")) {
    const item = entry.trim();
    if (!item) {
      continue;
    }
    const idx = item.lastIndexOf(":");
    if (idx <= 0) {
      continue;
    }
    const host = item.slice(0, idx).trim();
    const port = Number.parseInt(item.slice(idx + 1).trim(), 10);
    if (host && Number.isFinite(port)) {
      out.push({ host, port });
    }
  }
  return out;
}

function normalizeMode(raw: string, hasClusterNodes: boolean): RedisMode {
  const mode = raw.trim().toLowerCase();
  if (mode === "cluster") {
    return "cluster";
  }
  if (mode === "standalone") {
    return "standalone";
  }
  return hasClusterNodes ? "cluster" : "standalone";
}

function normalizeKeySchemaVersion(raw: string, mode: RedisMode): RedisKeySchemaVersion {
  if (!raw) {
    return mode === "cluster" ? "v2" : "v1";
  }
  if (raw === "v1" || raw === "v2") {
    return raw;
  }
  throw new Error(`Invalid REDIS_KEY_SCHEMA_VERSION: ${raw}`);
}

export function applyRedisEnvAliases(env: NodeJS.ProcessEnv = process.env): void {
  const springClusterNodes = envValue(env, [
    `${SPRING_DATA_REDIS}.cluster.nodes`,
    `${SPRING_REDIS}.cluster.nodes`,
  ]);
  if (!env.REDIS_CLUSTER_HOST && springClusterNodes) {
    env.REDIS_CLUSTER_HOST = springClusterNodes;
  }

  const aliases: Array<[string, string[]]> = [
    ["REDIS_HOST", [`${SPRING_DATA_REDIS}.host`, `${SPRING_REDIS}.host`]],
    ["REDIS_PORT", [`${SPRING_DATA_REDIS}.port`, `${SPRING_REDIS}.port`]],
    ["REDIS_USERNAME", [`${SPRING_DATA_REDIS}.username`, `${SPRING_REDIS}.username`]],
    ["REDIS_PASSWORD", [`${SPRING_DATA_REDIS}.password`, `${SPRING_REDIS}.password`]],
    ["REDIS_DATABASE", [`${SPRING_DATA_REDIS}.database`, `${SPRING_REDIS}.database`, "REDIS_DB"]],
  ];
  for (const [target, sources] of aliases) {
    if (!env[target]) {
      const value = envValue(env, sources);
      if (value) {
        env[target] = value;
      }
    }
  }
  if (!env.REDIS_DB && env.REDIS_DATABASE) {
    env.REDIS_DB = env.REDIS_DATABASE;
  }
  if ((env.REDIS_CLUSTER_HOST || env.REDIS_CLUSTER_NODES) && !env.REDIS_KEY_SCHEMA_VERSION) {
    env.REDIS_KEY_SCHEMA_VERSION = "v2";
  }
}

export function readRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConnectionConfig {
  if (env === process.env) {
    applyRedisEnvAliases(env);
  }
  const clusterNodesRaw = envValue(env, [
    "REDIS_CLUSTER_HOST",
    "REDIS_CLUSTER_NODES",
    `${SPRING_DATA_REDIS}.cluster.nodes`,
    `${SPRING_REDIS}.cluster.nodes`,
  ]);
  const clusterNodes = parseClusterNodes(clusterNodesRaw);
  const mode = normalizeMode(envValue(env, ["REDIS_MODE"]), clusterNodes.length > 0);
  const keySchemaVersion = normalizeKeySchemaVersion(
    envValue(env, ["REDIS_KEY_SCHEMA_VERSION"]),
    mode,
  );
  return {
    host: envValue(env, ["REDIS_HOST", `${SPRING_DATA_REDIS}.host`, `${SPRING_REDIS}.host`]) || undefined,
    port: parseInteger(envValue(env, ["REDIS_PORT", `${SPRING_DATA_REDIS}.port`, `${SPRING_REDIS}.port`])),
    db: parseInteger(
      envValue(env, [
        "REDIS_DATABASE",
        "REDIS_DB",
        `${SPRING_DATA_REDIS}.database`,
        `${SPRING_REDIS}.database`,
      ]),
    ),
    username:
      envValue(env, ["REDIS_USERNAME", `${SPRING_DATA_REDIS}.username`, `${SPRING_REDIS}.username`]) ||
      undefined,
    password:
      envValue(env, ["REDIS_PASSWORD", `${SPRING_DATA_REDIS}.password`, `${SPRING_REDIS}.password`]) ||
      undefined,
    mode,
    clusterNodes,
    keySchemaVersion,
    connectTimeoutMs: parseInteger(envValue(env, ["REDIS_CONNECT_TIMEOUT_MS"])),
  };
}

export function hasRedisConnectionConfig(config: RedisConnectionConfig): boolean {
  if (config.mode === "cluster") {
    return config.clusterNodes.length > 0;
  }
  return Boolean(config.host && Number.isFinite(config.port));
}

function redisOptions(config: RedisConnectionConfig, options: RedisClientOptions): RedisOptions {
  return {
    username: config.username,
    password: config.password,
    lazyConnect: options.lazyConnect,
    enableOfflineQueue: options.enableOfflineQueue,
    connectTimeout: options.connectTimeout ?? config.connectTimeoutMs,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
    retryStrategy: options.retryStrategy,
  };
}

export function createRedisClient(
  config: RedisConnectionConfig = readRedisConfig(),
  options: RedisClientOptions = {},
): RedisClient {
  if (config.mode === "cluster") {
    if (config.keySchemaVersion !== "v2") {
      throw new Error("Redis Cluster requires REDIS_KEY_SCHEMA_VERSION=v2");
    }
    if (config.clusterNodes.length === 0) {
      throw new Error("Redis Cluster requires REDIS_CLUSTER_HOST/REDIS_CLUSTER_NODES");
    }
    const startupNodes: ClusterNode[] = config.clusterNodes.map((node) => ({
      host: node.host,
      port: node.port,
    }));
    const clusterOptions: ClusterOptions = {
      redisOptions: redisOptions(config, options),
      lazyConnect: options.lazyConnect,
      enableOfflineQueue: options.enableOfflineQueue,
      scaleReads: "master",
      slotsRefreshTimeout: options.connectTimeout ?? config.connectTimeoutMs,
    };
    return new Cluster(startupNodes, clusterOptions);
  }

  return new Redis({
    ...redisOptions(config, options),
    host: config.host || "127.0.0.1",
    port: config.port ?? 6379,
    db: config.db ?? 0,
  });
}

export function isRedisClusterClient(redis: RedisClient): redis is Cluster {
  return typeof (redis as { nodes?: unknown }).nodes === "function";
}

export async function scanRedisKeys(
  redis: RedisClient,
  pattern: string,
  count = 300,
): Promise<string[]> {
  const keys = new Set<string>();
  if (isRedisClusterClient(redis)) {
    const nodes = redis.nodes("master");
    for (const node of nodes) {
      let cursor = "0";
      do {
        const reply = (await node.scan(cursor, "MATCH", pattern, "COUNT", String(count))) as [
          string,
          string[],
        ];
        cursor = String(reply[0] ?? "0");
        for (const key of reply[1] ?? []) {
          keys.add(key);
        }
      } while (cursor !== "0");
    }
    return [...keys];
  }

  let cursor = "0";
  do {
    const reply = (await redis.scan(cursor, "MATCH", pattern, "COUNT", String(count))) as [
      string,
      string[],
    ];
    cursor = String(reply[0] ?? "0");
    for (const key of reply[1] ?? []) {
      keys.add(key);
    }
  } while (cursor !== "0");
  return [...keys];
}

function isV2(config: RedisConnectionConfig = readRedisConfig()): boolean {
  return config.keySchemaVersion === "v2";
}

function versioned(v1Key: string, v2Suffix: string, config?: RedisConnectionConfig): string {
  return isV2(config) ? `byai_gateway:v2:${v2Suffix}` : v1Key;
}

export const byFrameworkRedisKeys = {
  ctrlStream(agentType: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:ctrl:agent_type:${agentType}`, `ctrl:agent_type:${agentType}`, config);
  },
  workerCtrlStream(workerId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:ctrl:worker:${workerId}`, `ctrl:worker:{${workerId}}`, config);
  },
  capabilityCtrlStream(workerId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:ctrl:capability:${workerId}`, `ctrl:capability:{${workerId}}`, config);
  },
  sessionDataStream(sessionId: string, config?: RedisConnectionConfig): string {
    return versioned(
      `byai_gateway:session:${sessionId}:data_stream`,
      `session:{${sessionId}}:data_stream`,
      config,
    );
  },
  sessionEventDataStream(config?: RedisConnectionConfig): string {
    return versioned("byai_gateway:session_event:data_stream", "session_event:data_stream", config);
  },
  traceMeta(traceId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:trace:${traceId}:meta`, `trace:{${traceId}}`, config);
  },
  traceSpans(traceId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:trace:${traceId}:spans`, `trace:spans:{${traceId}}`, config);
  },
  traceIndexSession(sessionId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:trace:idx:session:${sessionId}`, `trace:idx:session:${sessionId}`, config);
  },
  traceIndexWorker(workerId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:trace:idx:worker:${workerId}`, `trace:idx:worker:${workerId}`, config);
  },
  traceIndexAgent(agentType: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:trace:idx:agent:${agentType}`, `trace:idx:agent:${agentType}`, config);
  },
  taskGroup(groupId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:task_group:${groupId}`, `task_group:{${groupId}}`, config);
  },
  taskGroupResults(groupId: string, config?: RedisConnectionConfig): string {
    return versioned(
      `byai_gateway:task_group:${groupId}:results`,
      `task_group:{${groupId}}:results`,
      config,
    );
  },
  sessionRegistry(sessionId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:session:${sessionId}:registry`, `session:{${sessionId}}:registry`, config);
  },
  knownWorkers(config?: RedisConnectionConfig): string {
    return versioned("byai_gateway:registry:workers", "registry:workers", config);
  },
  workerDeclaredAgentTypes(workerId: string, config?: RedisConnectionConfig): string {
    return versioned(
      `byai_gateway:registry:worker:agent_types:${workerId}`,
      `registry:worker:{${workerId}}:agent_types`,
      config,
    );
  },
  agentTypeMembers(agentType: string, config?: RedisConnectionConfig): string {
    return versioned(
      `byai_gateway:registry:agent_type:workers:${agentType}`,
      `registry:agent_type:{${agentType}}:workers`,
      config,
    );
  },
  agentTypeDenied(agentType: string, config?: RedisConnectionConfig): string {
    return versioned(
      `byai_gateway:registry:agent_type:denied:${agentType}`,
      `registry:agent_type:{${agentType}}:denied`,
      config,
    );
  },
  workerLock(workerId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:registry:worker:lock:${workerId}`, `registry:worker:{${workerId}}:lock`, config);
  },
  workerAdminState(workerId: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:registry:worker:admin:${workerId}`, `registry:worker:{${workerId}}:admin`, config);
  },
  workerOnlineLease(workerId: string, config?: RedisConnectionConfig): string {
    return versioned(
      `byai_gateway:registry:worker:online:${workerId}`,
      `registry:worker:{${workerId}}:online`,
      config,
    );
  },
  serviceInstances(serviceName: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:sd:instances:${serviceName}`, `sd:{${serviceName}}:instances`, config);
  },
  serviceActiveInstances(serviceName: string, config?: RedisConnectionConfig): string {
    return versioned(`byai_gateway:sd:active:${serviceName}`, `sd:{${serviceName}}:active`, config);
  },
  services(config?: RedisConnectionConfig): string {
    return versioned("byai_gateway:sd:services", "sd:services", config);
  },
};

export function sessionDataStreamScanPattern(config: RedisConnectionConfig = readRedisConfig()): string {
  return isV2(config)
    ? "byai_gateway:v2:session:{*}:data_stream"
    : "byai_gateway:session:*:data_stream";
}

export function applyByFrameworkRedisKeyPatch(
  framework: { QueueNames?: unknown; RegistryKeys?: unknown },
  config: RedisConnectionConfig = readRedisConfig(),
): void {
  if (!isV2(config)) {
    return;
  }

  const queueNames = framework.QueueNames as
    | {
        ctrl_stream?: (agentType: string) => string;
        worker_ctrl_stream?: (workerId: string) => string;
        session_data_stream?: (sessionId: string) => string;
        trace_meta?: (traceId: string) => string;
        trace_spans?: (traceId: string) => string;
        trace_index_session?: (sessionId: string) => string;
        trace_index_worker?: (workerId: string) => string;
        trace_index_agent?: (agentType: string) => string;
        task_group?: (groupId: string) => string;
        task_group_results?: (groupId: string) => string;
      }
    | undefined;
  if (queueNames) {
    queueNames.ctrl_stream = (agentType: string) => byFrameworkRedisKeys.ctrlStream(agentType, config);
    queueNames.worker_ctrl_stream = (workerId: string) => byFrameworkRedisKeys.workerCtrlStream(workerId, config);
    queueNames.session_data_stream = (sessionId: string) => byFrameworkRedisKeys.sessionDataStream(sessionId, config);
    queueNames.trace_meta = (traceId: string) => byFrameworkRedisKeys.traceMeta(traceId, config);
    queueNames.trace_spans = (traceId: string) => byFrameworkRedisKeys.traceSpans(traceId, config);
    queueNames.trace_index_session = (sessionId: string) => byFrameworkRedisKeys.traceIndexSession(sessionId, config);
    queueNames.trace_index_worker = (workerId: string) => byFrameworkRedisKeys.traceIndexWorker(workerId, config);
    queueNames.trace_index_agent = (agentType: string) => byFrameworkRedisKeys.traceIndexAgent(agentType, config);
    queueNames.task_group = (groupId: string) => byFrameworkRedisKeys.taskGroup(groupId, config);
    queueNames.task_group_results = (groupId: string) => byFrameworkRedisKeys.taskGroupResults(groupId, config);
  }

  const registryKeys = framework.RegistryKeys as
    | {
        KNOWN_WORKERS?: string;
        SD_SERVICES?: string;
        known_workers?: () => string;
        sd_services?: () => string;
        WORKER_DEFAULT_LEASE_TTL_SECONDS?: number;
        worker_online_lease?: (workerId: string) => string;
        workerDeclaredAgentTypes?: (workerId: string) => string;
        agentTypeMembers?: (agentType: string) => string;
        agentTypeDenied?: (agentType: string) => string;
        workerAdminState?: (workerId: string) => string;
        worker_lock?: (workerId: string) => string;
        session_registry?: (sessionId: string) => string;
        sd_instance_details?: (serviceName: string) => string;
        sd_active_instances?: (serviceName: string) => string;
      }
    | undefined;
  if (registryKeys) {
    registryKeys.KNOWN_WORKERS = byFrameworkRedisKeys.knownWorkers(config);
    registryKeys.SD_SERVICES = byFrameworkRedisKeys.services(config);
    registryKeys.known_workers = () => byFrameworkRedisKeys.knownWorkers(config);
    registryKeys.sd_services = () => byFrameworkRedisKeys.services(config);
    registryKeys.WORKER_DEFAULT_LEASE_TTL_SECONDS = 30;
    registryKeys.worker_online_lease = (workerId: string) =>
      byFrameworkRedisKeys.workerOnlineLease(workerId, config);
    registryKeys.workerDeclaredAgentTypes = (workerId: string) =>
      byFrameworkRedisKeys.workerDeclaredAgentTypes(workerId, config);
    registryKeys.agentTypeMembers = (agentType: string) =>
      byFrameworkRedisKeys.agentTypeMembers(agentType, config);
    registryKeys.agentTypeDenied = (agentType: string) =>
      byFrameworkRedisKeys.agentTypeDenied(agentType, config);
    registryKeys.workerAdminState = (workerId: string) =>
      byFrameworkRedisKeys.workerAdminState(workerId, config);
    registryKeys.worker_lock = (workerId: string) => byFrameworkRedisKeys.workerLock(workerId, config);
    registryKeys.session_registry = (sessionId: string) =>
      byFrameworkRedisKeys.sessionRegistry(sessionId, config);
    registryKeys.sd_instance_details = (serviceName: string) =>
      byFrameworkRedisKeys.serviceInstances(serviceName, config);
    registryKeys.sd_active_instances = (serviceName: string) =>
      byFrameworkRedisKeys.serviceActiveInstances(serviceName, config);
  }
}

export function describeRedisTarget(config: RedisConnectionConfig = readRedisConfig()): string {
  if (config.mode === "cluster") {
    return `mode=cluster nodes=${config.clusterNodes.map((node) => `${node.host}:${node.port}`).join(",")}`;
  }
  return `mode=standalone host=${config.host || "127.0.0.1"} port=${config.port ?? 6379} db=${config.db ?? 0}`;
}
