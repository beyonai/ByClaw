import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  RunService,
  type LeaderSessionFactory,
} from "@byclaw/by-conductor";
import type { BeyondTokenVerifier } from "../auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "../byclaw-be-agent-catalog.js";
import { RunIngressService } from "../run-ingress-service.js";
import { buildHttpApp } from "../server/app.js";

const apps: Awaited<ReturnType<typeof buildHttpApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Session / Run HTTP/SSE API", () => {
  it("creates a Session with its first Run and streams SSE without leaking the token", async () => {
    const service = createService();
    const verifyBeyondToken = vi.fn(async () => ({ userCode: "user" }));
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await createApp(service, verifyBeyondToken, agentCatalog);

    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { message: "hello" },
    });

    expect(created.statusCode).toBe(202);
    expect(verifyBeyondToken).toHaveBeenCalledWith({ token: "very-secret-token" });
    expect(agentCatalog.listAuthorizedAgents).toHaveBeenCalledWith({
      beyondToken: "very-secret-token",
    });
    const response = created.json<{
      sessionId: string;
      runId: string;
      eventsUrl: string;
    }>();
    expect(response.eventsUrl).toBe(`/v1/runs/${response.runId}/events`);
    expect((await service.getRun(response.runId))?.sessionId).toBe(response.sessionId);
    expect(JSON.stringify(await service.getRun(response.runId))).not.toContain(
      "very-secret-token",
    );
    expect(created.body).not.toContain("very-secret-token");

    const sse = await app.inject({
      method: "GET",
      url: response.eventsUrl,
      headers: { "Beyond-Token": "very-secret-token" },
    });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers["content-type"]).toContain("text/event-stream");
    expect(sse.body).toContain("event: reasoningLogStart");
    expect(sse.body).toContain("event: answerStart");
    expect(sse.body).toContain("event: answerDelta");
    expect(sse.body).toContain("event: answerEnd");
    expect(sse.body).toContain("event: appStreamResponse");
    expect(sse.body).toContain('"content":"answer:"');
    expect(sse.body).toContain('"content":"hello"');
    expect(sse.body).not.toContain("very-secret-token");

    const replay = await app.inject({
      method: "GET",
      url: response.eventsUrl,
      headers: { "Beyond-Token": "very-secret-token", "Last-Event-ID": "2" },
    });
    expect(replay.body).not.toContain("id: 1\n");
    expect(replay.body).not.toContain("id: 2\n");

    const snapshot = await app.inject({
      method: "GET",
      url: `/v1/runs/${response.runId}`,
      headers: { "Beyond-Token": "very-secret-token" },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({
      runId: response.runId,
      sessionId: response.sessionId,
      status: "COMPLETED",
    });
    await service.dispose();
  });

  it("appends Runs to one Session while keeping another Session isolated", async () => {
    const service = createService();
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await createApp(service, undefined, agentCatalog);

    const first = await createSession(app, "owner-token", "first");
    const secondResponse = await app.inject({
      method: "POST",
      url: `/v1/sessions/${first.sessionId}/runs`,
      headers: { "Beyond-Token": "owner-token" },
      payload: { message: "second" },
    });
    const second = secondResponse.json<{ sessionId: string; runId: string }>();
    const other = await createSession(app, "owner-token", "other session");

    expect(secondResponse.statusCode).toBe(202);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.runId).not.toBe(first.runId);
    expect(other.sessionId).not.toBe(first.sessionId);
    expect((await service.getRun(first.runId))?.sessionId).toBe(first.sessionId);
    expect((await service.getRun(second.runId))?.sessionId).toBe(first.sessionId);
    expect((await service.getRun(other.runId))?.sessionId).toBe(other.sessionId);
    expect(agentCatalog.listAuthorizedAgents).toHaveBeenCalledTimes(3);
    await service.dispose();
  });

  it("returns the same 404 for missing and cross-user Session/Run resources", async () => {
    const service = createService();
    const verifyBeyondToken: BeyondTokenVerifier = async ({ token }) => ({
      userCode: token === "b-token" ? "user-b" : "user-a",
    });
    const app = await createApp(service, verifyBeyondToken);
    const owned = await createSession(app, "a-token", "A_ONLY_SECRET");

    const appendForeign = await app.inject({
      method: "POST",
      url: `/v1/sessions/${owned.sessionId}/runs`,
      headers: { "Beyond-Token": "b-token" },
      payload: { message: "steal" },
    });
    const appendMissing = await app.inject({
      method: "POST",
      url: "/v1/sessions/missing-session/runs",
      headers: { "Beyond-Token": "b-token" },
      payload: { message: "missing" },
    });
    const queryForeign = await app.inject({
      method: "GET",
      url: `/v1/runs/${owned.runId}`,
      headers: { "Beyond-Token": "b-token" },
    });
    const queryMissing = await app.inject({
      method: "GET",
      url: "/v1/runs/missing-run",
      headers: { "Beyond-Token": "b-token" },
    });
    const streamForeign = await app.inject({
      method: "GET",
      url: `/v1/runs/${owned.runId}/events`,
      headers: { "Beyond-Token": "b-token" },
    });
    const cancelForeign = await app.inject({
      method: "POST",
      url: `/v1/runs/${owned.runId}/cancel`,
      headers: { "Beyond-Token": "b-token" },
    });

    for (const response of [
      appendForeign,
      appendMissing,
      queryForeign,
      queryMissing,
      streamForeign,
      cancelForeign,
    ]) {
      expect(response.statusCode).toBe(404);
    }
    expect(streamForeign.headers["content-type"]).not.toContain("text/event-stream");
    expect((await service.getRun(owned.runId))?.status).toBe("COMPLETED");
    await service.dispose();
  });

  it("does not use System-Code as a Session owner boundary in V1", async () => {
    const service = createService();
    const app = await createApp(service);
    const owned = await createSession(app, "owner-token", "first", "system-a");

    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${owned.sessionId}/runs`,
      headers: {
        "Beyond-Token": "owner-token",
        "System-Code": "system-b",
      },
      payload: { message: "cross namespace" },
    });

    expect(response.statusCode).toBe(202);
    await service.dispose();
  });

  it("requires Beyond-Token and reports readiness failure", async () => {
    const service = createService();
    const app = await createApp(service, undefined, undefined, false);

    const missingToken = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { message: "hello" },
    });
    expect(missingToken.statusCode).toBe(401);
    expect(missingToken.json()).toMatchObject({ resultCode: 401, type: 1 });
    expect((await app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
    await service.dispose();
  });

  it("rejects caller-owned fields and removes the old Conversation API", async () => {
    const service = createService();
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await createApp(service, undefined, agentCatalog);

    const forged = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: {
        message: "hello",
        userCode: "forged-user",
        agentList: [],
        conversationId: "old-id",
      },
    });
    const oldApi = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { message: "hello" },
    });

    expect(forged.statusCode).toBe(400);
    expect(oldApi.statusCode).toBe(404);
    expect(agentCatalog.listAuthorizedAgents).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("requires Beyond-Token when subscribing to a Run", async () => {
    const service = createService();
    const app = await createApp(service);
    const run = await createSession(app, "very-secret-token", "hello");

    const response = await app.inject({
      method: "GET",
      url: `/v1/runs/${run.runId}/events`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ resultCode: 401, type: 1 });
    await service.dispose();
  });
});

async function createApp(
  service: RunService,
  verifyBeyondToken: BeyondTokenVerifier = async () => ({ userCode: "user" }),
  agentCatalog: AuthorizedAgentCatalog = { listAuthorizedAgents: async () => [] },
  ready = true,
) {
  const app = await buildHttpApp({
    runService: service,
    corsOrigin: true,
    runIngress: new RunIngressService(service, verifyBeyondToken, agentCatalog),
    readiness: async () => ({
      ready,
      pi: ready ? { healthy: true } : { healthy: false, message: "no model" },
      connectors: {},
      worker: { enabled: false, healthy: true },
    }),
  });
  apps.push(app);
  return app;
}

async function createSession(
  app: Awaited<ReturnType<typeof buildHttpApp>>,
  token: string,
  message: string,
  systemCode?: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      "Beyond-Token": token,
      ...(systemCode ? { "System-Code": systemCode } : {}),
    },
    payload: { message },
  });
  expect(response.statusCode).toBe(202);
  return response.json<{ sessionId: string; runId: string; eventsUrl: string }>();
}

/** 创建使用内存 Port 和假 Leader 的测试编排服务。 */
function createService(): RunService {
  const sessions = new InMemorySessionRepository();
  const runs = new InMemoryRunRepository(sessions);
  const delegations = new InMemoryDelegationRepository();
  const events = new InMemoryRunEventStore();
  const registry = new ConnectorRegistry();
  const delegationService = new DelegationService(registry, delegations, events, 1_000);
  const leaders: LeaderSessionFactory = {
    async create() {
      return {
        contextRevision: 0,
        async run(input) {
          await input.onDelta("answer:");
          await input.onDelta(input.message);
          return { text: `answer:${input.message}` };
        },
        async abort() {},
        checkpoint() {
          return undefined;
        },
        markCommitted() {},
        dispose() {},
      };
    },
    async health() {
      return { healthy: true, model: "fake/model" };
    },
  };
  return new RunService(
    sessions,
    runs,
    delegations,
    events,
    delegationService,
    leaders,
  );
}
