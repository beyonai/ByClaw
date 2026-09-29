import { currentDelivery, DeliveryOwnershipLostError } from "./by-framework-delivery-scope.js";
import { createHash } from "node:crypto";
import type { RedisClient } from "./by-framework-worker-contracts.js";

/** Redis 持久保存传输进度和跨实例取消路由；Run/会话/授权仍以 PostgreSQL 为准。 */
export class ByFrameworkDeliveryState {
  #cancellationCursor = "0";
  constructor(private readonly redis: RedisClient) {}

  async register(input: {
    runId: string;
    messageId: string;
    executionId: string;
    sessionId: string;
    traceId: string;
  }): Promise<void> {
    const routingKeys = [input.messageId, input.executionId].filter(Boolean)
      .map((id) => key("route", input.sessionId, id));
    const traceKey = key("trace", input.sessionId, input.traceId);
    for (const routingKey of routingKeys) {
      await this.redis.set(routingKey, input.runId);
    }
    await this.redis.hset(traceKey, input.runId, input.runId);
    await this.redis.set(key("run-routes", input.runId), JSON.stringify({ ...input, routingKeys, traceKey }));
    await this.redis.sadd("byclaw-super:worker:active-runs", input.runId);
  }

  async resolveRun(sessionId: string, messageId: string, executionId: string): Promise<string | undefined> {
    for (const id of [messageId, executionId].filter(Boolean)) {
      const runId = await this.redis.get(key("route", sessionId, id));
      if (runId) return runId;
    }
    return undefined;
  }

  async resolveTrace(sessionId: string, traceId: string): Promise<string | undefined> {
    const values = await this.redis.hvals(key("trace", sessionId, traceId));
    return values.length === 1 ? values[0] : undefined;
  }

  async release(runId: string): Promise<void> {
    const raw = await this.redis.get(key("run-routes", runId));
    if (!raw) return;
    const route = JSON.parse(raw) as { routingKeys: string[]; traceKey: string; sessionId: string };
    await this.redis.hdel(route.traceKey, runId);
    await this.redis.srem("byclaw-super:worker:active-runs", runId);
    // 保留短期 message/execution 关联，让延迟到达的取消仍可交给数据库幂等处理。
    for (const routingKey of route.routingKeys) await this.redis.expire(routingKey, 86_400);
    await this.redis.expire(key("run-routes", runId), 86_400);
    await this.redis.expire(forwardKey(route.sessionId, runId, "ask"), 7 * 86_400);
    await this.redis.expire(forwardKey(route.sessionId, runId, `${runId}:super-summary`), 7 * 86_400);
  }

  async cancellationRoutes(): Promise<Array<{ runId: string; messageId: string; sessionId: string }>> {
    const [cursor, runIds] = await this.redis.sscan("byclaw-super:worker:active-runs", this.#cancellationCursor, "COUNT", 100);
    this.#cancellationCursor = cursor;
    const routes: Array<{ runId: string; messageId: string; sessionId: string }> = [];
    for (const runId of runIds) {
      const raw = await this.redis.get(key("run-routes", runId));
      if (raw) routes.push(JSON.parse(raw));
      else await this.redis.srem("byclaw-super:worker:active-runs", runId);
    }
    return routes;
  }

  async load<T>(runId: string, deliveryId: string, sessionId: string): Promise<T | undefined> {
    const raw = await this.redis.get(forwardKey(sessionId, runId, deliveryId));
    return raw ? JSON.parse(raw) as T : undefined;
  }

  async save(runId: string, deliveryId: string, state: unknown, finished: boolean, sessionId: string): Promise<void> {
    const stateKey = forwardKey(sessionId, runId, deliveryId);
    const scope = currentDelivery();
    if (scope) {
      const saved = await this.redis.eval(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local previous = redis.call('GET', KEYS[2])
if previous then
  local before = cjson.decode(previous)
  local incoming = cjson.decode(ARGV[2])
  if tonumber(before.afterEventId or 0) > tonumber(incoming.afterEventId or 0) then return 0 end
end
redis.call('SET', KEYS[2], ARGV[2])
if tonumber(ARGV[3]) > 0 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
return 1`, 2, scope.leaseKey, stateKey, scope.token, JSON.stringify(state), finished ? 7 * 86_400 : 0);
      if (Number(saved) !== 1) throw new DeliveryOwnershipLostError();
      return;
    }
    await this.redis.set(stateKey, JSON.stringify(state));
    if (finished) await this.redis.expire(stateKey, 7 * 86_400);
  }
}

function key(kind: string, ...values: string[]): string {
  const digest = createHash("sha256").update(JSON.stringify(values)).digest("hex");
  return `byclaw-super:worker:${kind}:${digest}`;
}

function forwardKey(sessionId: string, runId: string, deliveryId: string): string {
  return `byclaw-super:worker:{${sessionId}}:${key("forward", runId, deliveryId)}`;
}
