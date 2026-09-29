import { QueueNames, RegistryKeys, WorkerRegistry } from "@byclaw/by-framework";
import type { RedisClient } from "./by-framework-worker-contracts.js";
import { currentDelivery, DeliveryOwnershipLostError, retryWorkerDelivery } from "./by-framework-delivery-scope.js";

const FENCED_XADD = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return redis.error_reply('SUPER_DELIVERY_LEASE_LOST') end
return redis.call('XADD', KEYS[2], unpack(ARGV, 2))`;

/** SDK 输出通过 Lua 校验租约并追加同一 session slot 的流；pipeline 错误必须向上抛出。 */
export function deliveryRedis(redis: RedisClient): RedisClient {
  return new Proxy(redis, {
    get(target, property) {
      if (property === "pipeline") return (...args: Parameters<RedisClient["pipeline"]>) => {
        const pipeline = target.pipeline(...args);
        const xadd = pipeline.xadd.bind(pipeline);
        const hset = pipeline.hset.bind(pipeline);
        const exec = pipeline.exec.bind(pipeline);
        pipeline.xadd = ((...command: unknown[]) => {
          const scope = currentDelivery();
          if (scope && command[0] === QueueNames.session_data_stream(scope.sessionId)) {
            pipeline.eval(FENCED_XADD, 2, scope.leaseKey, String(command[0]), scope.token, ...command.slice(1) as string[]);
            return pipeline;
          }
          return (xadd as (...values: unknown[]) => typeof pipeline)(...command);
        }) as typeof pipeline.xadd;
        pipeline.hset = ((...command: unknown[]) => {
          const scope = currentDelivery();
          if (scope && command[0] === RegistryKeys.session_registry(scope.sessionId)) {
            pipeline.eval(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return redis.error_reply('SUPER_DELIVERY_LEASE_LOST') end
return redis.call('HSET', KEYS[2], unpack(ARGV, 2))`, 2,
              scope.leaseKey, String(command[0]), scope.token, ...command.slice(1) as string[]);
            return pipeline;
          }
          return (hset as (...values: unknown[]) => typeof pipeline)(...command);
        }) as typeof pipeline.hset;
        pipeline.exec = (async (...command: Parameters<typeof exec>) => {
          try {
            const result = await exec(...command);
            for (const [error] of result ?? []) {
              if (error?.message.includes("SUPER_DELIVERY_LEASE_LOST")) throw new DeliveryOwnershipLostError();
              if (error) throw error;
            }
            return result;
          } catch (error) {
            if (currentDelivery()) throw retryWorkerDelivery(error);
            throw error;
          }
        }) as typeof pipeline.exec;
        return pipeline;
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** 当前 execution 的终结必须和租约校验原子提交，且保留并发写入的 cancel_requested。 */
export class ByFrameworkDeliveryRegistry extends WorkerRegistry {
  constructor(private readonly deliveryClient: RedisClient) { super(deliveryRedis(deliveryClient)); }

  override async markExecutionFinished(executionId: string, sessionId: string, status: string): Promise<void> {
    const scope = currentDelivery();
    if (!scope) return super.markExecutionFinished(executionId, sessionId, status);
    const saved = await this.deliveryClient.eval(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local raw = redis.call('HGET', KEYS[2], ARGV[2])
if not raw then return 1 end
local record = cjson.decode(raw)
record.status = ARGV[3]
record.finished_at = tonumber(ARGV[4])
record.updated_at = tonumber(ARGV[4])
record.timeline = record.timeline or {}
table.insert(record.timeline, {status = ARGV[3], timestamp = tonumber(ARGV[4])})
redis.call('HSET', KEYS[2], ARGV[2], cjson.encode(record))
redis.call('EXPIRE', KEYS[2], ARGV[5])
return 1`, 2, scope.leaseKey, RegistryKeys.session_registry(sessionId), scope.token,
      `exec:${executionId}`, status, Date.now(), RegistryKeys.DEFAULT_SESSION_TTL);
    if (Number(saved) !== 1) throw new DeliveryOwnershipLostError();
  }
}
