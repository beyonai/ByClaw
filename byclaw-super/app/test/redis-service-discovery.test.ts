import { describe, expect, it, vi } from "vitest";
import { RedisByClawBeEndpointResolver } from "../redis-service-discovery.js";

describe("Redis ByClaw BE service discovery", () => {
  it("reads ByaiService instances and returns the registered endpoint", async () => {
    const hgetall = vi.fn(async () => ({
      "ByaiService:b30c235b": JSON.stringify({
        id: "ByaiService:b30c235b",
        protocol: "http",
        host: "byclaw-be.by-service.svc.cluster.local",
        port: 8086,
        path_prefix: null,
        weight: 1,
      }),
    }));
    const resolver = new RedisByClawBeEndpointResolver({ hgetall });

    await expect(resolver.resolve()).resolves.toBe(
      "http://byclaw-be.by-service.svc.cluster.local:8086",
    );
    expect(hgetall).toHaveBeenCalledWith("byai_gateway:sd:instances:ByaiService");
  });

  it("supports path_prefix and weighted round-robin", async () => {
    const resolver = new RedisByClawBeEndpointResolver({
      hgetall: async () => ({
        first: JSON.stringify({
          protocol: "http",
          host: "first.internal",
          port: 8086,
          path_prefix: "/gateway/",
          weight: 1,
        }),
        second: JSON.stringify({
          protocol: "https",
          host: "second.internal",
          port: 8443,
          path_prefix: null,
          weight: 2,
        }),
      }),
    });

    await expect(resolver.resolve()).resolves.toBe("http://first.internal:8086/gateway");
    await expect(resolver.resolve()).resolves.toBe("https://second.internal:8443");
    await expect(resolver.resolve()).resolves.toBe("https://second.internal:8443");
  });

  it("returns undefined for empty, invalid, or failed Redis reads", async () => {
    const empty = new RedisByClawBeEndpointResolver({ hgetall: async () => ({}) });
    const invalid = new RedisByClawBeEndpointResolver({
      hgetall: async () => ({ broken: "not-json" }),
    });
    const failed = new RedisByClawBeEndpointResolver({
      hgetall: async () => {
        throw new Error("Redis unavailable");
      },
    });

    await expect(empty.resolve()).resolves.toBeUndefined();
    await expect(invalid.resolve()).resolves.toBeUndefined();
    await expect(failed.resolve()).resolves.toBeUndefined();
  });

  it("falls back after the Redis lookup timeout", async () => {
    vi.useFakeTimers();
    try {
      const resolver = new RedisByClawBeEndpointResolver({
        hgetall: async () => new Promise<Record<string, string>>(() => undefined),
      });

      const result = resolver.resolve();
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(result).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
