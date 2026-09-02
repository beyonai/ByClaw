import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  status: "wait",
  connect: vi.fn(async () => {}),
  on: vi.fn(),
  get: vi.fn(),
  hget: vi.fn(),
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

import { createManagePermissionStore } from "./manage-permission-store.js";

describe("createManagePermissionStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = "wait";
    redis.connect.mockImplementation(async () => {
      redis.status = "ready";
    });
    vi.stubEnv("USER_CODE", "user-1");
  });

  it("resolves userId from SHARE_BFM_USER_CODE_{USER_CODE}", async () => {
    redis.get.mockResolvedValueOnce(" 123 ");
    const store = createManagePermissionStore();

    await expect(store.resolveUserId()).resolves.toBe("123");
    expect(redis.get).toHaveBeenCalledWith("SHARE_BFM_USER_CODE_user-1");
  });

  it("returns empty userId when USER_CODE is not set", async () => {
    vi.stubEnv("USER_CODE", "");
    const store = createManagePermissionStore();

    await expect(store.resolveUserId()).resolves.toBe("");
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("reports management permission when the Hash field exists", async () => {
    redis.hget.mockResolvedValueOnce("DIG_EMPLOYEE");
    const store = createManagePermissionStore();

    await expect(store.hasManagePermission("123", "456")).resolves.toBe(true);
    expect(redis.hget).toHaveBeenCalledWith("USER:RESOURCES:MANAGE:123", "456");
  });

  it("reports no management permission when the Hash field is missing", async () => {
    redis.hget.mockResolvedValueOnce(null);
    const store = createManagePermissionStore();

    await expect(store.hasManagePermission("123", "456")).resolves.toBe(false);
  });

  it("fails closed to false (not thrown) on Redis errors for hasManagePermission", async () => {
    redis.hget.mockRejectedValueOnce(new Error("transport failed"));
    const store = createManagePermissionStore();

    await expect(store.hasManagePermission("123", "456")).resolves.toBe(false);
  });

  it("reports global manager only when the marker key is exactly '1'", async () => {
    redis.get.mockResolvedValueOnce("1");
    const store = createManagePermissionStore();

    await expect(store.isGlobalManager("123")).resolves.toBe(true);
    expect(redis.get).toHaveBeenCalledWith("USER:IS_GLOBAL_RESOURCE_MANAGER:123");
  });

  it("reports not a global manager when the marker key is absent", async () => {
    redis.get.mockResolvedValueOnce(null);
    const store = createManagePermissionStore();

    await expect(store.isGlobalManager("123")).resolves.toBe(false);
  });

  it("returns false rather than throwing when Redis connection config is missing", async () => {
    const { hasRedisConnectionConfig } = await import("../../shared/src/redis-compat.js");
    vi.mocked(hasRedisConnectionConfig).mockReturnValueOnce(false);
    const store = createManagePermissionStore();

    await expect(store.hasManagePermission("123", "456")).resolves.toBe(false);
    await expect(store.isGlobalManager("123")).resolves.toBe(false);
  });
});
