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
};
describe("fixed tenant configuration", () => {
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
  ])("requires %s", (key) => {
    expect(() => readConfig({ ...env, [key]: "" })).toThrow();
  });
  it("rejects plain HTTP unless explicitly selected", () => {
    expect(() => readConfig({ ...env, KMS_DECRYPT_URL: "http://kms" })).toThrow();
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
