import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const required = {
  DB_USER: "byclaw",
  DB_PASS: "test-only",
  KMS_ADAPTER_MODULE: "@company/test-kms-adapter",
  KMS_KEY_ID: "test-key",
};

describe("应用配置", () => {
  it("默认实例 ID 包含 hostname 和 pid，避免不同 Pod 都使用 pid=1 时碰撞", () => {
    const config = loadConfig(required);

    expect(config.instanceId).toBe(
      `byclaw-super-${hostname()}-${process.pid}`,
    );
  });

  it("解析数据库 idle timeout 和执行凭证清理周期", () => {
    const config = loadConfig({
      ...required,
      DB_IDLE_TIMEOUT_MS: "45000",
      RUN_CREDENTIAL_CLEANUP_INTERVAL_MS: "120000",
      BYCLAW_INSTANCE_ID: "instance-a",
    });

    expect(config.database.idleTimeoutMs).toBe(45_000);
    expect(config.runCredentialCleanupIntervalMs).toBe(120_000);
    expect(config.instanceId).toBe("instance-a");
  });

  it("没有数据库账号或 KMS adapter 时启动配置失败", () => {
    expect(() =>
      loadConfig({
        KMS_ADAPTER_MODULE: required.KMS_ADAPTER_MODULE,
        KMS_KEY_ID: required.KMS_KEY_ID,
      }),
    ).toThrow("DB_USER must not be empty");
    expect(() =>
      loadConfig({
        DB_USER: required.DB_USER,
        DB_PASS: required.DB_PASS,
      }),
    ).toThrow("KMS_ADAPTER_MODULE must not be empty");
  });
});
