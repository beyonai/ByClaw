import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  status: "wait",
  connect: vi.fn(async () => {}),
  on: vi.fn(),
  get: vi.fn(),
  hget: vi.fn(),
  hgetall: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../../shared/src/redis-compat.js", () => ({
  createRedisClient: vi.fn(() => redis),
  hasRedisConnectionConfig: vi.fn(() => true),
  readRedisConfig: vi.fn(() => ({
    host: "127.0.0.1",
    port: 6379,
    mode: "standalone",
    clusterNodes: [],
    keySchemaVersion: "v1",
  })),
}));

import { createRedisJsonStore } from "./redis-json-store.js";

describe("createRedisJsonStore strict JSON reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = "wait";
    redis.connect.mockImplementation(async () => {
      redis.status = "ready";
    });
  });

  it("returns ok(value) for a valid Redis Hash JSON value", async () => {
    redis.hget.mockResolvedValueOnce('{"instanceId":"22"}');
    const store = createRedisJsonStore();

    await expect(
      store.getHashJsonStrict!({ key: "byai:aimodel:config", field: "22" }),
    ).resolves.toMatchObject({
      status: "ok",
      value: { raw: { instanceId: "22" } },
    });
  });

  it("distinguishes a missing Redis Hash field", async () => {
    redis.hget.mockResolvedValueOnce(null);
    const store = createRedisJsonStore();

    await expect(
      store.getHashJsonStrict!({ key: "byai:aimodel:config", field: "missing" }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("distinguishes malformed JSON from a missing Redis Hash field", async () => {
    redis.hget.mockResolvedValueOnce("{not-json");
    const store = createRedisJsonStore();

    await expect(
      store.getHashJsonStrict!({ key: "byai:aimodel:config", field: "22" }),
    ).resolves.toEqual({ status: "malformed" });
  });

  it("distinguishes Redis transport errors", async () => {
    redis.hget.mockRejectedValueOnce(new Error("transport failed"));
    const store = createRedisJsonStore();

    await expect(
      store.getHashJsonStrict!({ key: "byai:aimodel:config", field: "22" }),
    ).resolves.toEqual({ status: "transport-error" });
  });
});
