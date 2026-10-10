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
  const apply = vi.fn(async () => undefined);
  const groupNameCheck = vi.fn(async () => ({ exists: false }));
  const services = {
    commands: { execute },
    mirror: { apply },
    history: { detail: vi.fn(async () => ({ sessionId: "30" })), groupNameCheck },
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
  return { app, execute, apply, verify, groupNameCheck };
}
const headers = { "x-enterprise-id": "10", "x-tenant-generation": "7", "x-actor-user-id": "20" };
describe("protected tenant HTTP", () => {
  it("checks group names using the trusted actor and rejects foreign tenants", async () => {
    const s = setup();
    const response = await s.app.inject({
      method: "POST",
      url: "/internal/v1/group-chats/name-check",
      headers,
      payload: { name: "Team", actor: "21" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ exists: false });
    expect(s.groupNameCheck).toHaveBeenCalledWith("20", "Team");
    const denied = await s.app.inject({
      method: "POST",
      url: "/internal/v1/group-chats/name-check",
      headers: { ...headers, "x-enterprise-id": "11" },
      payload: { name: "Team" },
    });
    expect(denied.statusCode).toBe(403);
    expect(s.groupNameCheck).toHaveBeenCalledOnce();
  });
  it("accepts a scoped feedback command at the existing message boundary", async () => {
    const s = setup();
    const response = await s.app.inject({
      method: "POST",
      url: "/internal/v1/sessions/30/messages/40/feedback",
      headers,
      payload: command({
        operation: "UPDATE_FEEDBACK" as any,
        payload: {
          messageId: "40",
          type: "praise",
          mode: "reaction",
        },
      }),
    });
    expect(response.statusCode).toBe(200);
  });
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
  it("authenticates the explicit HTTP mode with a bearer or forwarded token", () => {
    const httpConfig = {
      ...config,
      transport: "http" as const,
      internalToken: "test-internal-token",
    };
    expect(() =>
      authenticate({ headers: { authorization: "Bearer wrong" } } as any, httpConfig),
    ).toThrow("UNAUTHORIZED");
    expect(() =>
      authenticate({ headers: { authorization: "Bearer test-internal-token" } } as any, httpConfig),
    ).not.toThrow();
    expect(() =>
      authenticate(
        { headers: { "x-byclaw-internal-token": "test-internal-token" } } as any,
        httpConfig,
      ),
    ).not.toThrow();
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
  it("commits a tenant chat input through the authenticated REST boundary", async () => {
    const s = setup();
    const payload = {
      sessionId: "30",
      clientRequestId: "turn-1",
      runId: "run-1",
      traceId: "trace-1",
      userMessageId: "101",
      answerMessageId: "102",
      eventId: "event-1",
      sourceStreamId: null,
      childOrdinal: 0,
      eventSeq: "0",
      eventType: "INPUT",
      payload: { id: "101", userId: "20", messageContent: "你好" },
    };
    const response = await s.app.inject({
      method: "POST",
      url: "/internal/v1/chat/mirror",
      headers,
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ eventId: "event-1", committed: true });
    expect(s.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "10",
        generation: "7",
        payloadHash: expect.any(String),
      }),
    );
    const denied = await s.app.inject({
      method: "POST",
      url: "/internal/v1/chat/mirror",
      headers,
      payload: { ...payload, eventId: "event-2", payload: { ...payload.payload, userId: "21" } },
    });
    expect(denied.statusCode).toBe(404);
    expect(s.apply).toHaveBeenCalledOnce();
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
