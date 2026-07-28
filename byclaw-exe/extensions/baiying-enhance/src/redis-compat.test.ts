import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueNames, RegistryKeys } from "@byclaw/by-framework";
import {
  RedisCompatKeys,
  patchByFrameworkRedisKeys,
  resolveRedisCompatConfig,
} from "./redis-compat.js";

describe("redis-compat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    patchByFrameworkRedisKeys();
  });

  it("returns cluster config when standalone host is absent", () => {
    vi.stubEnv("REDIS_CLUSTER_HOST", "10.10.168.203:6371,10.10.168.203:6372");
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");

    expect(resolveRedisCompatConfig()).toMatchObject({
      mode: "cluster",
      clusterNodes: [
        { host: "10.10.168.203", port: 6371 },
        { host: "10.10.168.203", port: 6372 },
      ],
    });
  });

  it("keeps standalone env behavior", () => {
    vi.stubEnv("REDIS_HOST", "127.0.0.1");
    vi.stubEnv("REDIS_PORT", "6380");
    vi.stubEnv("REDIS_DATABASE", "2");

    expect(resolveRedisCompatConfig()).toMatchObject({
      mode: "standalone",
      host: "127.0.0.1",
      port: 6380,
      db: 2,
    });
  });

  it("uses hash-tagged v2 keys for framework streams", () => {
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");

    expect(RedisCompatKeys.ctrlStream("AGENT")).toBe(
      "byai_gateway:v2:ctrl:agent_type:AGENT",
    );
    expect(RedisCompatKeys.sessionDataStream("session-1")).toBe(
      "byai_gateway:v2:session:{session-1}:data_stream",
    );
    expect(RedisCompatKeys.capabilityCtrlStream("worker-1")).toBe(
      "byai_gateway:v2:ctrl:capability:{worker-1}",
    );
  });

  it("rejects cluster mode without v2 keys", () => {
    vi.stubEnv("REDIS_CLUSTER_HOST", "10.10.168.203:6371");
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v1");

    expect(() => patchByFrameworkRedisKeys()).toThrow(/REDIS_KEY_SCHEMA_VERSION=v2/);
  });

  it("patches framework queue and registry keys", () => {
    vi.stubEnv("REDIS_CLUSTER_HOST", "10.10.168.203:6371");
    vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");

    patchByFrameworkRedisKeys();

    expect(QueueNames.worker_ctrl_stream("worker-1")).toBe(
      "byai_gateway:v2:ctrl:worker:{worker-1}",
    );
    expect(QueueNames.session_data_stream("session-1")).toBe(
      "byai_gateway:v2:session:{session-1}:data_stream",
    );
    expect(RegistryKeys.known_workers()).toBe("byai_gateway:v2:registry:workers");
  });
});
