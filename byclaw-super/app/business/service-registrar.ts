const SERVICE_INDEX_KEY = "byai_gateway:sd:services";
const SERVICE_INSTANCES_PREFIX = "byai_gateway:sd:instances:";
const SERVICE_ACTIVE_PREFIX = "byai_gateway:sd:active:";

type RedisServiceRegistryClient = {
  sadd(key: string, member: string): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
};

type ServiceRegistryLogger = {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
};

export interface RedisServiceRegistrarOptions {
  enabled: boolean;
  serviceName: string;
  instanceId: string;
  protocol: "http" | "https";
  host: string;
  port: number;
  pathPrefix: string;
  weight: number;
  heartbeatIntervalMs: number;
  metadata?: Record<string, unknown>;
}

/** 兼容 by-framework ServiceRegistry Redis 协议的服务注册与心跳实现。 */
export class RedisServiceRegistrar {
  readonly #instancesKey: string;
  readonly #activeKey: string;
  readonly #registryInstanceId: string;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #heartbeatOperation: Promise<void> = Promise.resolve();
  #started = false;

  constructor(
    private readonly redis: RedisServiceRegistryClient,
    private readonly options: RedisServiceRegistrarOptions,
    private readonly logger?: ServiceRegistryLogger,
  ) {
    this.#instancesKey = `${SERVICE_INSTANCES_PREFIX}${options.serviceName}`;
    this.#activeKey = `${SERVICE_ACTIVE_PREFIX}${options.serviceName}`;
    this.#registryInstanceId = `${options.serviceName}:${options.instanceId}`;
  }

  /** 写入实例详情和首次心跳，并启动后台续约。 */
  async start(): Promise<void> {
    if (!this.options.enabled || this.#started) {
      return;
    }
    const instance = {
      id: this.#registryInstanceId,
      protocol: this.options.protocol,
      host: this.options.host,
      port: this.options.port,
      path_prefix: normalizePathPrefix(this.options.pathPrefix),
      weight: this.options.weight,
      metadata: this.options.metadata ?? {},
    };
    try {
      await this.redis.hset(
        this.#instancesKey,
        this.#registryInstanceId,
        JSON.stringify(instance),
      );
      await this.redis.zadd(
        this.#activeKey,
        Date.now(),
        this.#registryInstanceId,
      );
      await this.redis.sadd(SERVICE_INDEX_KEY, this.options.serviceName);
    } catch (error) {
      await this.#removeInstance();
      throw error;
    }
    this.#started = true;
    this.#heartbeatTimer = setInterval(() => {
      this.#heartbeatOperation = this.#heartbeatOperation
        .then(() => this.#heartbeat())
        .catch((error: unknown) => {
          this.logger?.warn(
            {
              serviceName: this.options.serviceName,
              instanceId: this.#registryInstanceId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Service discovery heartbeat failed",
          );
        });
    }, this.options.heartbeatIntervalMs);
    this.#heartbeatTimer.unref?.();
    this.logger?.info(
      {
        serviceName: this.options.serviceName,
        instanceId: this.#registryInstanceId,
        protocol: this.options.protocol,
        host: this.options.host,
        port: this.options.port,
        pathPrefix: instance.path_prefix,
      },
      "Service registered",
    );
  }

  /** 停止心跳并删除当前实例；保留服务集合项，避免误删其他副本的服务索引。 */
  async close(): Promise<void> {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    await this.#heartbeatOperation;
    if (!this.options.enabled || !this.#started) {
      return;
    }
    const results = await this.#removeInstance();
    this.#started = false;
    const failure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    if (failure) {
      this.logger?.warn(
        {
          serviceName: this.options.serviceName,
          instanceId: this.#registryInstanceId,
          error:
            failure.reason instanceof Error
              ? failure.reason.message
              : String(failure.reason),
        },
        "Service unregistration failed",
      );
      return;
    }
    this.logger?.info(
      {
        serviceName: this.options.serviceName,
        instanceId: this.#registryInstanceId,
      },
      "Service unregistered",
    );
  }

  async #heartbeat(): Promise<void> {
    if (!this.#started) {
      return;
    }
    await this.redis.zadd(
      this.#activeKey,
      Date.now(),
      this.#registryInstanceId,
    );
  }

  async #removeInstance(): Promise<PromiseSettledResult<unknown>[]> {
    return Promise.allSettled([
      this.redis.hdel(this.#instancesKey, this.#registryInstanceId),
      this.redis.zrem(this.#activeKey, this.#registryInstanceId),
    ]);
  }
}

/** 将注册路径规范化为 SDK 使用的绝对路径前缀。 */
function normalizePathPrefix(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "/";
}
