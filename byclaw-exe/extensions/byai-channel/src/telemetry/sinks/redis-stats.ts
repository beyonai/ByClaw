import type { TelemetrySink } from "../reporter.js";
import type { TelemetryBusyLogLine } from "../types.js";
import {
  closeRedisCompatClient,
  createRedisCompatClient,
  resolveRedisCompatConfig,
  type RedisCompatClient,
} from "../../redis-compat.js";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type TelemetryRedisPublishConfig = {
  mode: "standalone" | "cluster";
  host: string;
  port: number;
  db: number;
  clusterNodes?: Array<{ host: string; port: number }>;
  username?: string;
  password?: string;
  userCode: string;
  agentType: string;
  topic: string;
  connectTimeoutMs: number;
};

export type TelemetryRedisStatsMessage = {
  schema: "openclaw.busy_state.redis_stats";
  schemaVersion: 1;
  topic: string;
  agentType: string;
  userCode: string;
  emittedAt: string;
  payload: TelemetryBusyLogLine;
};

export const TELEMETRY_REDIS_STATS_TOPIC = "byai_gateway:registry:worker:stats:openclaw";
const TELEMETRY_AGENT_TYPE = "BYCLAW_EXE";

export class RedisTelemetrySink implements TelemetrySink {
  readonly id = "redis-pubsub";
  private readonly client: RedisCompatClient;
  private queue: Promise<void> = Promise.resolve();
  private warnedPublishFailure = false;

  constructor(
    private readonly config: TelemetryRedisPublishConfig,
    private readonly logger?: LoggerLike,
  ) {
    this.client = createRedisCompatClient({
      connectTimeout: config.connectTimeoutMs,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: true,
    });
  }

  publish(line: TelemetryBusyLogLine): void {
    const payload = JSON.stringify(createRedisStatsMessage(this.config, line));
    this.queue = this.queue
      .then(async () => {
        await this.client.publish(this.config.topic, payload);
      })
      .then(() => {
        this.warnedPublishFailure = false;
      })
      .catch((error: unknown) => {
        if (!this.warnedPublishFailure) {
          this.warnedPublishFailure = true;
          this.logger?.warn?.(
            `byai-channel telemetry: Redis publish failed: ${formatError(error)}`,
          );
        }
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async close(): Promise<void> {
    await this.flush();
    await closeRedisCompatClient(this.client);
  }
}

export function createRedisTelemetrySinkFromEnv(params: {
  logger?: LoggerLike;
} = {}): RedisTelemetrySink | null {
  const config = resolveTelemetryRedisPublishConfig(process.env);
  if (!config) {
    params.logger?.warn?.(
      "byai-channel telemetry: Redis stats publisher disabled (REDIS_HOST/REDIS_PORT/USER_CODE missing or invalid)",
    );
    return null;
  }
  params.logger?.info?.(`byai-channel telemetry: Redis stats publisher topic=${config.topic}`);
  return new RedisTelemetrySink(config, params.logger);
}

export function resolveTelemetryRedisPublishConfig(
  env: NodeJS.ProcessEnv,
): TelemetryRedisPublishConfig | null {
  const redis = resolveRedisCompatConfig(env);
  const userCode = env.USER_CODE?.trim();

  if (!redis || !userCode) {
    return null;
  }

  return {
    mode: redis.mode,
    host: redis.mode === "cluster" ? redis.clusterNodes[0]?.host ?? redis.host : redis.host,
    port: redis.mode === "cluster" ? redis.clusterNodes[0]?.port ?? redis.port : redis.port,
    db: redis.db,
    clusterNodes: redis.clusterNodes,
    username: redis.username,
    password: redis.password,
    userCode,
    agentType: TELEMETRY_AGENT_TYPE,
    topic: TELEMETRY_REDIS_STATS_TOPIC,
    connectTimeoutMs: 3_000,
  };
}

export function createRedisStatsMessage(
  config: Pick<TelemetryRedisPublishConfig, "topic" | "agentType" | "userCode">,
  line: TelemetryBusyLogLine,
): TelemetryRedisStatsMessage {
  return {
    schema: "openclaw.busy_state.redis_stats",
    schemaVersion: 1,
    topic: config.topic,
    agentType: config.agentType,
    userCode: config.userCode,
    emittedAt: new Date().toISOString(),
    payload: line,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
