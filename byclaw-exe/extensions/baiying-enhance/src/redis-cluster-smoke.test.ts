import { describe, expect, it } from "vitest";
import {
  RedisCompatKeys,
  closeRedisCompatClient,
  createByFrameworkRedisClient,
  createRedisCompatClient,
} from "./redis-compat.js";

const describeSmoke = process.env.RUN_REDIS_CLUSTER_SMOKE === "1" ? describe : describe.skip;

describeSmoke("Redis Cluster smoke", () => {
  it("runs key, pubsub, stream, and by-framework key operations against Redis Cluster", async () => {
    expect(process.env.REDIS_CLUSTER_HOST).toBeTruthy();
    expect(process.env.REDIS_KEY_SCHEMA_VERSION).toBe("v2");

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stringKey = `openclaw:smoke:{${suffix}}:string`;
    const hashKey = `openclaw:smoke:{${suffix}}:hash`;
    const channel = `openclaw:smoke:${suffix}:channel`;
    const agentType = `OPENCLAW_SMOKE_${suffix}`;
    const sessionId = `smoke-session-${suffix}`;
    const ctrlStream = RedisCompatKeys.ctrlStream(agentType);
    const sessionStream = RedisCompatKeys.sessionDataStream(sessionId);
    const group = `smoke-group-${suffix}`;
    const consumer = `smoke-consumer-${suffix}`;

    const redis = createRedisCompatClient({
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
    });
    const sub = createRedisCompatClient({
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
    });
    const frameworkRedis = createByFrameworkRedisClient({
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
    });

    try {
      await redis.connect();
      await sub.connect();
      await frameworkRedis.connect();

      await redis.set(stringKey, "ok", "EX", 60);
      expect(await redis.get(stringKey)).toBe("ok");

      await redis.hset(hashKey, "field", "value");
      await redis.expire(hashKey, 60);
      expect(await redis.hget(hashKey, "field")).toBe("value");

      const pubsubMessage = new Promise<string>((resolve) => {
        sub.once("message", (_channel, message) => resolve(String(message)));
      });
      await sub.subscribe(channel);
      await redis.publish(channel, "hello");
      expect(await pubsubMessage).toBe("hello");

      await frameworkRedis.xgroup("CREATE", ctrlStream, group, "0", "MKSTREAM").catch((err) => {
        if (!String(err).includes("BUSYGROUP")) throw err;
      });
      const messageId = await frameworkRedis.xadd(
        ctrlStream,
        "*",
        "data",
        JSON.stringify({ smoke: true, sessionId }),
      );
      const rows = await frameworkRedis.xreadgroup(
        "GROUP",
        group,
        consumer,
        "COUNT",
        1,
        "STREAMS",
        ctrlStream,
        ">",
      );
      expect(JSON.stringify(rows)).toContain(String(messageId));
      await frameworkRedis.xack(ctrlStream, group, String(messageId));

      const sessionMessageId = await frameworkRedis.xadd(
        sessionStream,
        "*",
        "data",
        JSON.stringify({ event_type: "finalAnswer", session_id: sessionId }),
      );
      const sessionRows = await frameworkRedis.xread(
        "COUNT",
        1,
        "STREAMS",
        sessionStream,
        "0-0",
      );
      expect(JSON.stringify(sessionRows)).toContain(String(sessionMessageId));
    } finally {
      await redis.del(stringKey, hashKey).catch(() => undefined);
      await frameworkRedis.del(ctrlStream, sessionStream).catch(() => undefined);
      await closeRedisCompatClient(frameworkRedis);
      await closeRedisCompatClient(sub);
      await closeRedisCompatClient(redis);
    }
  }, 30_000);
});
