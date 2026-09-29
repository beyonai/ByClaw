import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type HttpServices } from "../src/interfaces/http/app.js";
import { authenticate } from "../src/interfaces/http/auth.js";
import { command, config, task } from "./fixtures.js";
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup(ready = true) {
  const execute = vi.fn(async () => ({ committed: true }));
  const services = {
    commands: { execute },
    history: { detail: vi.fn(async () => ({ sessionId: "30" })) },
    sessions: {},
    schema: { accept: vi.fn(async () => ({ status: "PENDING" })) },
    connected: () => true,
    ready: () => ready,
    provisioned: () => true,
    schemaState: () => ({ verified: true, observedVersion: "S1", auditedVersion: "S1" }),
    health: () => ({ businessReady: ready }),
  } as unknown as HttpServices;
  const verify = vi.fn();
  const app = createApp(config, services, {}, { verifyClient: verify, logger: false });
  apps.push(app);
  return { app, execute, verify };
}
const headers = { "x-enterprise-id": "10", "x-tenant-generation": "7", "x-actor-user-id": "20" };
describe("protected tenant HTTP", () => {
  it("exposes liveness before database availability", async () => {
    const s = setup(false);
    const response = await s.app.inject({ url: "/internal/v1/health/live" });
    expect(response.statusCode).toBe(200);
    expect(s.verify).not.toHaveBeenCalled();
  });
  it("checks client certificate authorization and identity", () => {
    expect(() => authenticate({ raw: { socket: { authorized: false } } } as any, config)).toThrow(
      "UNAUTHORIZED",
    );
    expect(() =>
      authenticate(
        {
          raw: {
            socket: { authorized: true, getPeerCertificate: () => ({ subject: { CN: "wrong" } }) },
          },
        } as any,
        config,
      ),
    ).toThrow("CLIENT_IDENTITY_MISMATCH");
  });
  it("rejects foreign enterprise and generation headers", async () => {
    const s = setup();
    expect(
      (
        await s.app.inject({
          url: "/internal/v1/health/ready",
          headers: { ...headers, "x-enterprise-id": "11" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.app.inject({
          url: "/internal/v1/health/ready",
          headers: { ...headers, "x-tenant-generation": "8" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("keeps business blocked in ADMIN_ONLY while schema reads work", async () => {
    const s = setup(false);
    expect((await s.app.inject({ url: "/internal/v1/group-chats/30", headers })).statusCode).toBe(
      503,
    );
    const schema = await s.app.inject({ url: "/internal/v1/schema", headers });
    expect(schema.statusCode).toBe(200);
    expect(schema.json().observedVersion).toBe("S1");
  });
  it("separates provisioning readiness from business readiness", async () => {
    const s = setup(false),
      response = await s.app.inject({ url: "/internal/v1/health/ready", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ready: true, businessReady: false, generation: "7" });
  });
  it("binds commands to the trusted actor and route", async () => {
    const s = setup();
    const response = await s.app.inject({
      method: "POST",
      url: "/internal/v1/sessions",
      headers,
      payload: command(),
    });
    expect(response.statusCode).toBe(200);
    expect(s.execute).toHaveBeenCalledOnce();
    const denied = await s.app.inject({
      method: "PATCH",
      url: "/internal/v1/sessions/31",
      headers,
      payload: command({ operation: "UPDATE_SESSION" }),
    });
    expect(denied.statusCode).toBe(409);
    expect(s.execute).toHaveBeenCalledOnce();
  });
  it("removes raw SQL/bootstrap and mutable message routes", async () => {
    const s = setup();
    for (const url of [
      "/internal/v1/bootstrap/database",
      "/internal/v1/init",
      "/internal/v1/commits/old",
    ])
      expect(
        (
          await s.app.inject({
            method: "POST",
            url,
            headers,
            payload: { sql: "DROP DATABASE tenant" },
          })
        ).statusCode,
      ).toBe(404);
  });
  it("accepts a JSON multipart field and ZIP bytes as the specified upload", async () => {
    const s = setup(false),
      t = task(),
      boundary = "tenant-test";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="task"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(t)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="bundle"; filename="tenant.zip"\r\nContent-Type: application/zip\r\n\r\nzip-bytes\r\n--${boundary}--\r\n`,
    );
    const response = await s.app.inject({
      method: "POST",
      url: "/internal/v1/schema-tasks",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "idempotency-key": `${t.auditId}:1`,
      },
      payload,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ auditId: t.auditId, status: "PENDING" });
  });
});
