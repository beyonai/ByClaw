const BYAI_SERVICE_NAME = "ByaiService";
const SERVICE_INSTANCES_KEY = `byai_gateway:sd:instances:${BYAI_SERVICE_NAME}`;
const REDIS_LOOKUP_TIMEOUT_MS = 1_000;

type RedisHashReader = {
  hgetall(key: string): Promise<Record<string, string>>;
};

type ServiceInstance = {
  protocol: "http" | "https";
  host: string;
  port: number;
  pathPrefix: string;
  weight: number;
};

export interface ByClawBeEndpointResolver {
  /** 返回当前选择的 ByClaw BE 根地址；没有可用实例时返回 undefined。 */
  resolve(): Promise<string | undefined>;
}

/** 从 ByAI Gateway 服务发现 Hash 中选择一个 ByaiService 实例。 */
export class RedisByClawBeEndpointResolver implements ByClawBeEndpointResolver {
  #counter = 0;

  /** 注入 Redis Hash Reader，便于与 Connector 共享连接并进行单元测试。 */
  constructor(private readonly redis: RedisHashReader) {}

  /** 读取全部实例并按 weight 做平滑的轮询选择；读取失败时交给环境变量兜底。 */
  async resolve(): Promise<string | undefined> {
    let values: Record<string, string>;
    try {
      values = await withTimeout(
        this.redis.hgetall(SERVICE_INSTANCES_KEY),
        REDIS_LOOKUP_TIMEOUT_MS,
      );
    } catch {
      return undefined;
    }
    const instances = Object.values(values)
      .map(parseServiceInstance)
      .filter((instance): instance is ServiceInstance => instance !== undefined);
    if (instances.length === 0) {
      return undefined;
    }
    const selected = selectWeighted(instances, this.#counter++);
    return toBaseUrl(selected);
  }
}

/** 为 Redis 服务发现读取设置短超时，超时后立即允许环境变量地址兜底。 */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Redis service discovery timed out")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** 解析并校验 Redis Hash value，忽略损坏或不支持协议的实例。 */
function parseServiceInstance(raw: string): ServiceInstance | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) {
      return undefined;
    }
    const protocol = value.protocol;
    const host = stringValue(value.host);
    const port = Number(value.port);
    if ((protocol !== "http" && protocol !== "https") || !host || !isValidPort(port)) {
      return undefined;
    }
    return {
      protocol,
      host,
      port,
      pathPrefix: normalizePathPrefix(value.path_prefix),
      weight: positiveWeight(value.weight),
    };
  } catch {
    return undefined;
  }
}

/** 根据实例 weight 和单调计数器选择实例，避免始终命中同一个副本。 */
function selectWeighted(instances: ServiceInstance[], counter: number): ServiceInstance {
  const totalWeight = instances.reduce((sum, instance) => sum + instance.weight, 0);
  let ticket = counter % totalWeight;
  for (const instance of instances) {
    if (ticket < instance.weight) {
      return instance;
    }
    ticket -= instance.weight;
  }
  return instances[0]!;
}

/** 将服务实例安全转换为包含可选 path_prefix 的 HTTP 根地址。 */
function toBaseUrl(instance: ServiceInstance): string {
  const url = new URL(`${instance.protocol}://placeholder`);
  url.hostname = instance.host;
  url.port = String(instance.port);
  url.pathname = instance.pathPrefix || "/";
  return url.toString().replace(/\/$/, "");
}

/** 只接受 1 到 65535 的整数端口。 */
function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

/** 将非法或非正权重归一为 1，防止单条异常数据破坏选择算法。 */
function positiveWeight(value: unknown): number {
  const weight = Number(value);
  return Number.isInteger(weight) && weight > 0 ? weight : 1;
}

/** 将 path_prefix 标准化为无尾斜杠的绝对路径。 */
function normalizePathPrefix(value: unknown): string {
  const path = stringValue(value);
  if (!path || path === "/") {
    return "";
  }
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

/** 判断未知 JSON 值是否为对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从服务发现字段中安全读取字符串。 */
function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
