import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import { APP_CONFIG_DEFAULTS } from "../config/config-defaults.js";
import { loadConfig } from "../config/index.js";

const required = {
  REDIS_MODE: "standalone",
  REDIS_HOST: "redis.internal",
  REDIS_PORT: "6379",
  REDIS_DATABASE: "0",
  DB_HOST: "postgres.internal",
  DB_PORT: "5432",
  DB_DATABASE: "byclaw",
  DB_SCHEMA: "byai",
  DB_USER: "byclaw",
  DB_PASS: "test-only",
  DB_SSL: "false",
};

describe("应用配置", () => {
  it("默认实例 ID 包含 hostname 和 pid，避免不同 Pod 都使用 pid=1 时碰撞", () => {
    const config = loadConfig(required);

    expect(config.instanceId).toBe(
      `byclaw-super-${hostname()}-${process.pid}`,
    );
    expect(config.database.host).toBe("postgres.internal");
    expect(config.database.maxConnections).toBe(
      APP_CONFIG_DEFAULTS.database.maxConnections,
    );
    expect(config.runLeaseMs).toBe(APP_CONFIG_DEFAULTS.run.leaseMs);
    expect(config.delegationTimeouts).toEqual({
      firstActivityMs: 300_000,
      idleMs: 900_000,
      callbackMs: 0,
    });
    expect(config.openClaw).toEqual({
      cancelConfirmationTimeoutMs: 30_000,
    });
    expect(config.piProvider).toBe(APP_CONFIG_DEFAULTS.pi.provider);
    expect(config.piModel).toBe(APP_CONFIG_DEFAULTS.pi.model);
    expect(config.serviceDiscovery).toMatchObject({
      enabled: true,
      serviceName: "ByclawSuperService",
      protocol: "http",
      host: "byclaw-super.by-service.svc.cluster.local",
      port: 3_000,
      pathPrefix: "/byclawSuper",
      weight: 1,
      heartbeatIntervalMs: 5_000,
    });
  });

  it("解析数据库 idle timeout 和实例 ID", () => {
    const config = loadConfig({
      ...required,
      DB_IDLE_TIMEOUT_MS: "45000",
      BYCLAW_INSTANCE_ID: "instance-a",
    });

    expect(config.database.idleTimeoutMs).toBe(45_000);
    expect(config.instanceId).toBe("instance-a");
  });

  it("OpenGauss 使用 PostgreSQL 协议驱动", () => {
    const config = loadConfig({
      ...required,
      DB_TYPE: "opengauss",
    });

    expect(config.database.host).toBe("postgres.internal");
  });

  it("环境变量优先于代码默认值", () => {
    const config = loadConfig({
      ...required,
      DB_HOST: "postgres.internal",
      DB_PORT: "6432",
      RUN_LEASE_MS: "45000",
      PI_PROVIDER: "volcengine-ark",
      PI_MODEL: "deepseek-test",
      ARK_BASE_URL: "https://ark.example.test/api/v3",
      ARK_API_KEY: "test-only",
      BYCLAW_SUPER_DISCOVERY_HOST: "byclaw-super.internal",
      BYCLAW_SUPER_DISCOVERY_PORT: "3443",
      BYCLAW_SUPER_DISCOVERY_PROTOCOL: "https",
      BYCLAW_SUPER_DISCOVERY_WEIGHT: "3",
      DELEGATION_IDLE_TIMEOUT_MS: "800000",
      DELEGATION_FIRST_ACTIVITY_TIMEOUT_MS: "240000",
      DELEGATION_CALLBACK_TIMEOUT_MS: "600000",
      OPENCLAW_CANCEL_CONFIRM_TIMEOUT_MS: "15000",
    });

    expect(config.database.host).toBe("postgres.internal");
    expect(config.database.port).toBe(6_432);
    expect(config.runLeaseMs).toBe(45_000);
    expect(config.delegationTimeouts).toEqual({
      firstActivityMs: 240_000,
      idleMs: 800_000,
      callbackMs: 600_000,
    });
    expect(config.openClaw).toEqual({
      cancelConfirmationTimeoutMs: 15_000,
    });
    expect(config.piProvider).toBe("volcengine-ark");
    expect(config.piModel).toBe("deepseek-test");
    expect(config.arkBaseUrl).toBe("https://ark.example.test/api/v3");
    expect(config.arkApiKey).toBe("test-only");
    expect(config.serviceDiscovery).toMatchObject({
      host: "byclaw-super.internal",
      port: 3_443,
      protocol: "https",
      weight: 3,
    });
  });

  it("没有基础设施配置时启动配置失败", () => {
    expect(() =>
      loadConfig({}),
    ).toThrow("REDIS_MODE must not be empty");
  });

  it("缺少数据库或 Redis 连接定位时启动配置失败", () => {
    expect(() =>
      loadConfig({ ...required, DB_HOST: undefined }),
    ).toThrow("DB_HOST must not be empty");
    expect(() =>
      loadConfig({ ...required, REDIS_HOST: undefined }),
    ).toThrow("REDIS_HOST must not be empty");
  });

  it("集群 Redis 必须显式提供节点列表", () => {
    expect(() =>
      loadConfig({
        ...required,
        REDIS_MODE: "cluster",
        REDIS_HOST: undefined,
        REDIS_PORT: undefined,
      }),
    ).toThrow("REDIS_CLUSTER_HOST or REDIS_CLUSTER_NODES must be configured");

    const config = loadConfig({
      ...required,
      REDIS_MODE: "cluster",
      REDIS_HOST: undefined,
      REDIS_PORT: undefined,
      REDIS_CLUSTER_HOST: "redis-a.internal:6379,redis-b.internal:6380",
    });
    expect(config.redis.clusterNodes).toEqual([
      { host: "redis-a.internal", port: 6379 },
      { host: "redis-b.internal", port: 6380 },
    ]);
  });

  it("解析三方员工直连安全配置", () => {
    const config = loadConfig({
      ...required,
      THIRD_PARTY_AGENT_ALLOWED_HOSTS:
        "Vendor.EXAMPLE.com, a2a.example.com",
      THIRD_PARTY_AGENT_REQUEST_TIMEOUT_MS: "45000",
    });

    expect(config.thirdPartyAgents).toMatchObject({
      allowedExternalHosts: [
        "vendor.example.com",
        "a2a.example.com",
      ],
      requestTimeoutMs: 45_000,
      allowInsecureExternalHttp: false,
    });
  });
});
