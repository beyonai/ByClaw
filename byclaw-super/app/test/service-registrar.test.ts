import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisServiceRegistrar } from "../business/service-registrar.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Redis service registrar", () => {
  it("registers, heartbeats, and unregisters with the by-framework schema", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const redis = {
      sadd: vi.fn(async () => 1),
      hset: vi.fn(async () => 1),
      zadd: vi.fn(async () => 1),
      hdel: vi.fn(async () => 1),
      zrem: vi.fn(async () => 1),
    };
    const registrar = new RedisServiceRegistrar(redis, {
      enabled: true,
      serviceName: "ByclawSuperService",
      instanceId: "pod-a",
      protocol: "http",
      host: "10.0.0.8",
      port: 3_000,
      pathPrefix: "/byclawSuper/",
      weight: 2,
      heartbeatIntervalMs: 5_000,
      metadata: { framework: "node" },
    });

    await registrar.start();

    expect(redis.hset).toHaveBeenCalledWith(
      "byai_gateway:sd:instances:ByclawSuperService",
      "ByclawSuperService:pod-a",
      JSON.stringify({
        id: "ByclawSuperService:pod-a",
        protocol: "http",
        host: "10.0.0.8",
        port: 3_000,
        path_prefix: "/byclawSuper",
        weight: 2,
        metadata: { framework: "node" },
      }),
    );
    expect(redis.zadd).toHaveBeenCalledWith(
      "byai_gateway:sd:active:ByclawSuperService",
      1_000,
      "ByclawSuperService:pod-a",
    );
    expect(redis.sadd).toHaveBeenCalledWith(
      "byai_gateway:sd:services",
      "ByclawSuperService",
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(redis.zadd).toHaveBeenLastCalledWith(
      "byai_gateway:sd:active:ByclawSuperService",
      6_000,
      "ByclawSuperService:pod-a",
    );

    await registrar.close();
    expect(redis.hdel).toHaveBeenCalledWith(
      "byai_gateway:sd:instances:ByclawSuperService",
      "ByclawSuperService:pod-a",
    );
    expect(redis.zrem).toHaveBeenCalledWith(
      "byai_gateway:sd:active:ByclawSuperService",
      "ByclawSuperService:pod-a",
    );
  });

  it("does nothing when registration is disabled", async () => {
    const redis = {
      sadd: vi.fn(async () => 1),
      hset: vi.fn(async () => 1),
      zadd: vi.fn(async () => 1),
      hdel: vi.fn(async () => 1),
      zrem: vi.fn(async () => 1),
    };
    const registrar = new RedisServiceRegistrar(redis, {
      enabled: false,
      serviceName: "ByclawSuperService",
      instanceId: "pod-a",
      protocol: "http",
      host: "localhost",
      port: 3_000,
      pathPrefix: "/byclawSuper",
      weight: 1,
      heartbeatIntervalMs: 5_000,
    });

    await registrar.start();
    await registrar.close();

    expect(redis.hset).not.toHaveBeenCalled();
    expect(redis.zadd).not.toHaveBeenCalled();
  });
});
