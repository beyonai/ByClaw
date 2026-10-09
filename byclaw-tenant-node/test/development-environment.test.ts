import { describe, expect, it, vi } from "vitest";
vi.mock("../src/development/certificates.js", () => ({
  ensureDevelopmentCertificates: vi.fn(() => ({
    certFile: "/local/node.crt",
    keyFile: "/local/node.key",
    caFile: "/local/ca.crt",
  })),
}));
import { prepareDevelopmentEnvironment } from "../src/development/environment.js";

describe("development defaults", () => {
  it("replaces container placeholders with local paths and loopback listening", () => {
    const env: NodeJS.ProcessEnv = {
      TLS_CERT_FILE: "/run/secrets/node.crt",
      TLS_KEY_FILE: "/run/secrets/node.key",
      TLS_CA_FILE: "/run/secrets/ca.crt",
      NODE_STATE_DIR: "/var/lib/byclaw-tenant",
      HOST: "0.0.0.0",
      ADVERTISE_HOST: "node.example.test",
    };
    prepareDevelopmentEnvironment(env);
    expect(env.TLS_CERT_FILE).toBe("/local/node.crt");
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.ADVERTISE_HOST).toBe("localhost");
    expect(env.NODE_STATE_DIR).toContain("/byclaw-tenant-node/.tenant-state");
  });
  it("preserves explicitly configured certificates and dependency settings", () => {
    const env: NodeJS.ProcessEnv = {
      TLS_CERT_FILE: "/custom/node.crt",
      TLS_KEY_FILE: "/custom/node.key",
      TLS_CA_FILE: "/custom/ca.crt",
      NODE_STATE_DIR: "/custom/state",
      HOST: "192.0.2.1",
      ADVERTISE_HOST: "node.local",
      REDIS_HOST: "redis.local",
    };
    const original = { ...env };
    prepareDevelopmentEnvironment(env);
    expect(env).toEqual(original);
  });
});
