import { describe, expect, it, vi } from "vitest";
import { hostname } from "node:os";
import { readConfig } from "../src/config.js";
import {
  readTenantSnapshot,
  connectionFields,
} from "../src/infrastructure/connection/redis-config.js";
import {
  credentialEnvelope,
  decryptPassword,
} from "../src/infrastructure/connection/kms-decryptor.js";
import { snapshot } from "./fixtures.js";
const env = {
  ENTERPRISE_ID: "10",
  TENANT_ID: "10",
  TENANT_GENERATION: "7",
  DB_SANDBOX_RECORD_ID: "80",
  ADVERTISE_HOST: "node",
  NODE_STATE_DIR: "/state",
  BE_INTERNAL_URL: "https://be/byaiService",
  KMS_DECRYPT_URL: "https://kms/decrypt",
  BE_CLIENT_IDENTITY: "be",
  TLS_CERT_FILE: "/cert",
  TLS_KEY_FILE: "/key",
  TLS_CA_FILE: "/ca",
  REDIS_HOST: "redis",
  REDIS_PORT: "6379",
  REDIS_DATABASE: "0",
  REDIS_USERNAME: "tenant",
  REDIS_PASSWORD: "test",
  REDIS_TLS: "true",
  INTERNAL_API_TOKEN: "test-internal-token",
};
describe("fixed tenant configuration", () => {
  it("accepts cluster-only configuration and gives REDIS_CLUSTER_HOST precedence", () => {
    const cluster = readConfig({
      ...env,
      REDIS_HOST: undefined,
      REDIS_MODE: "standalone",
      REDIS_CLUSTER_HOST: "redis-a:6379, redis-b:6380",
      REDIS_KEY_SCHEMA_VERSION: "v2",
    });
    expect(cluster.redis).toMatchObject({
      mode: "cluster",
      db: 0,
      clusterNodes: [
        { host: "redis-a", port: 6379 },
        { host: "redis-b", port: 6380 },
      ],
    });
    expect(cluster.redis.host).toBeUndefined();
    expect(readConfig(env).redis.mode).toBe("standalone");
  });
  it.each(["sentinel", "cluser", ""])("rejects unsupported Redis mode %s", (mode) => {
    expect(() => readConfig({ ...env, REDIS_MODE: mode })).toThrow("Invalid REDIS_MODE");
  });
  it.each([
    undefined,
    "",
    "redis",
    "redis:0",
    "redis:65536",
    "redis:abc",
    "redis:6379oops",
    ":6379",
    "redis:6379,",
    "redis host:6379",
  ])("rejects invalid cluster nodes %s", (nodes) => {
    expect(() =>
      readConfig({
        ...env,
        REDIS_MODE: "cluster",
        REDIS_CLUSTER_HOST: nodes,
        REDIS_KEY_SCHEMA_VERSION: "v2",
      }),
    ).toThrow();
  });
  it("requires Cluster schema v2 and database zero", () => {
    const cluster = { ...env, REDIS_CLUSTER_HOST: "redis:6379" };
    expect(readConfig(cluster).redis.mode).toBe("cluster");
    expect(() =>
      readConfig({ ...env, REDIS_MODE: "cluster", REDIS_CLUSTER_NODES: "redis:6379" }),
    ).toThrow("REDIS_KEY_SCHEMA_VERSION=v2");
    expect(() => readConfig({ ...cluster, REDIS_KEY_SCHEMA_VERSION: "v1" })).toThrow(
      "REDIS_KEY_SCHEMA_VERSION=v2",
    );
    expect(() =>
      readConfig({ ...cluster, REDIS_KEY_SCHEMA_VERSION: "v2", REDIS_DATABASE: "1" }),
    ).toThrow("REDIS_DATABASE=0");
    expect(() => readConfig({ ...env, REDIS_HOST: undefined })).toThrow("REDIS_HOST");
  });

  it("defaults the shared quota reader to an environment-independent key and ALLOW on Redis failure", () => {
    expect(readConfig(env).quota).toEqual({
      keyPrefix: "byclaw:shared:quota:v1:",
      failurePolicy: "ALLOW",
    });
    expect(
      readConfig({ ...env, QUOTA_REDIS_KEY_PREFIX: "quota:", QUOTA_REDIS_FAILURE_POLICY: "REJECT" })
        .quota,
    ).toEqual({ keyPrefix: "quota:", failurePolicy: "REJECT" });
    expect(() => readConfig({ ...env, QUOTA_REDIS_FAILURE_POLICY: "ignore" })).toThrow(
      "Invalid QUOTA_REDIS_FAILURE_POLICY",
    );
    expect(() => readConfig({ ...env, QUOTA_REDIS_KEY_PREFIX: "" })).toThrow(
      "Invalid QUOTA_REDIS_KEY_PREFIX",
    );
  });
  it.each([undefined, "", "host.containers.internal"])(
    "advertises Kubernetes Pod IP instead of an unresolvable hostname when launch host is %s",
    (advertiseHost) => {
      expect(
        readConfig({ ...env, ADVERTISE_HOST: advertiseHost, POD_IP: "10.42.2.25" }).advertiseHost,
      ).toBe("10.42.2.25");
    },
  );
  it("preserves an explicitly configured advertise address in Kubernetes", () => {
    expect(readConfig({ ...env, POD_IP: "10.42.2.25" }).advertiseHost).toBe("node");
  });
  it.each([undefined, "", "host.containers.internal"])(
    "advertises its own container hostname when the launch host is %s",
    (advertiseHost) => {
      expect(readConfig({ ...env, ADVERTISE_HOST: advertiseHost }).advertiseHost).toBe(hostname());
    },
  );
  it("uses separate Redis fields and requires matching IDs", () => {
    expect(readConfig(env).enterpriseId).toBe("10");
    expect(readConfig(env).advertiseHost).toBe("node");
    expect(() => readConfig({ ...env, TENANT_ID: "11" })).toThrow();
  });
  it.each([
    "ENTERPRISE_ID",
    "TENANT_GENERATION",
    "DB_SANDBOX_RECORD_ID",
    "REDIS_USERNAME",
    "TLS_KEY_FILE",
    "INTERNAL_API_TOKEN",
  ])("requires %s", (key) => {
    expect(() => readConfig({ ...env, [key]: "" })).toThrow();
  });
  it("rejects plain HTTP unless explicitly selected", () => {
    expect(() => readConfig({ ...env, KMS_DECRYPT_URL: "http://kms" })).toThrow();
  });
  it("preserves the BE callback token with HTTPS and still requires client certificates", () => {
    const config = readConfig(env);
    expect(config.internalToken).toBe("test-internal-token");
    expect(config.transport).toBe("https");
    expect(config.tls?.certFile).toBe("/cert");
    expect(() => readConfig({ ...env, INTERNAL_API_TOKEN: "   " })).toThrow(
      "Missing configuration: INTERNAL_API_TOKEN",
    );
  });
  it("allows explicitly selected HTTP with an internal token and plain Redis", () => {
    const { TLS_CERT_FILE, TLS_KEY_FILE, TLS_CA_FILE, BE_CLIENT_IDENTITY, ...withoutTls } = env;
    const local = readConfig({
      ...withoutTls,
      INTERNAL_TRANSPORT: "http",
      INTERNAL_API_TOKEN: "test-internal-token",
      BE_INTERNAL_URL: "http://be/byaiService",
      KMS_DECRYPT_URL: "http://be/byaiService/internal/v1/tenantKms/decrypt",
      REDIS_TLS: "false",
    });
    expect(local.transport).toBe("http");
    expect(local.internalToken).toBe("test-internal-token");
    expect(local.tls).toBeUndefined();
    expect(local.redis.tls).toBeUndefined();
  });
  it("reads all eight connection fields in one HMGET", async () => {
    const hmget = vi.fn(async () => [
      "db",
      "5432",
      "byclaw_t_10",
      "bc_t_10_admin",
      "encrypted",
      "80",
      "1",
      JSON.stringify({
        generation: "7",
        fencingToken: "9",
        status: "READY",
        leaseUntil: new Date().toISOString(),
      }),
    ]);
    expect((await readTenantSnapshot({ hmget } as any, "10")).database).toBe("byclaw_t_10");
    expect(hmget).toHaveBeenCalledExactlyOnceWith("TENANT_CONFIG_10", ...connectionFields);
  });
  it("rejects missing fields and malformed state", async () => {
    await expect(readTenantSnapshot({ hmget: async () => [] } as any, "10")).rejects.toThrow(
      "TENANT_CONFIG_MISSING",
    );
    await expect(
      readTenantSnapshot(
        {
          hmget: async () => ["db", "5432", "byclaw_t_10", "bc_t_10_admin", "x", "80", "1", "null"],
        } as any,
        "10",
      ),
    ).rejects.toThrow("INVALID_PROVISION_STATE");
  });
});
describe("KMS credential boundary", () => {
  const envelope = {
    alg: "SM4-GCM",
    keyId: "tenant10/v1",
    nonce: Buffer.alloc(12).toString("base64"),
    tag: Buffer.alloc(16).toString("base64"),
    ciphertext: Buffer.from("encrypted").toString("base64"),
  };
  it("validates nonce/tag and binds tenant AAD", async () => {
    const json = vi.fn(async () => ({
      plaintext: Buffer.from("test-password").toString("base64"),
    }));
    expect(
      await decryptPassword(
        { json } as any,
        "https://kms/decrypt",
        snapshot({ passwordEnvelope: JSON.stringify(envelope) }),
      ),
    ).toBe("test-password");
    expect(json.mock.calls[0]).toEqual([
      "https://kms/decrypt",
      "POST",
      {
        enterpriseId: "10",
        databaseName: "byclaw_t_10",
        aad: Buffer.from("byclaw:tenant-db:v1:10:byclaw_t_10").toString("base64"),
        envelope,
      },
    ]);
  });
  it("rejects alternate algorithms and truncated authentication tag", () => {
    expect(() => credentialEnvelope(JSON.stringify({ ...envelope, alg: "SM4-ECB" }))).toThrow();
    expect(() => credentialEnvelope(JSON.stringify({ ...envelope, tag: "AA==" }))).toThrow();
  });
});
