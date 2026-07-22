import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemoryThreadRepository,
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

describe("Run HTTP/SSE API", () => {
  it("creates a Run and streams ByClaw-compatible SSE without leaking the token", async () => {
    const service = createService();
    const verifyBeyondToken = vi.fn(async () => ({ userCode: "user" }));
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await buildHttpApp({
      runService: service,
      corsOrigin: true,
      runIngress: createRunIngress(service, verifyBeyondToken, agentCatalog),
      readiness: async () => ({
        ready: true,
        pi: { healthy: true },
        connectors: {},
        worker: { enabled: false, healthy: true },
      }),
    });
    apps.push(app);
    const runResponse = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { message: "hello" },
    });
    expect(runResponse.statusCode).toBe(202);
    expect(verifyBeyondToken).toHaveBeenCalledWith({
      token: "very-secret-token",
    });
    expect(agentCatalog.listAuthorizedAgents).toHaveBeenCalledWith({
      beyondToken: "very-secret-token",
    });
    const run = runResponse.json<{ runId: string; eventsUrl: string }>();
    expect(run.eventsUrl).toBe(`/v1/runs/${run.runId}/events`);
    expect(runResponse.body).not.toContain("very-secret-token");

    const sseResponse = await app.inject({
      method: "GET",
      url: run.eventsUrl,
      headers: { "Beyond-Token": "very-secret-token" },
    });
    expect(sseResponse.statusCode).toBe(200);
    expect(sseResponse.headers["content-type"]).toContain("text/event-stream");
    expect(sseResponse.body).toContain("event: reasoningLogStart");
    expect(sseResponse.body).toContain("event: answerStart");
    expect(sseResponse.body).toContain("event: answerDelta");
    expect(sseResponse.body).toContain("event: answerEnd");
    expect(sseResponse.body).toContain("event: appStreamResponse");
    expect(sseResponse.body).toContain('"content":"answer:"');
    expect(sseResponse.body).toContain('"content":"hello"');
    expect(sseResponse.body).not.toContain("very-secret-token");

    const replayResponse = await app.inject({
      method: "GET",
      url: run.eventsUrl,
      headers: { "Beyond-Token": "very-secret-token", "Last-Event-ID": "2" },
    });
    expect(replayResponse.body).not.toContain("id: 1\n");
    expect(replayResponse.body).not.toContain("id: 2\n");
    expect((await app.inject({ method: "POST", url: "/v1/threads" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/runs/${run.runId}` })).statusCode).toBe(404);
    await service.dispose();
  });

  it("requires Beyond-Token and reports readiness failure", async () => {
    const service = createService();
    const app = await buildHttpApp({
      runService: service,
      corsOrigin: true,
      runIngress: createRunIngress(service),
      readiness: async () => ({
        ready: false,
        pi: { healthy: false, message: "no model" },
        connectors: {},
        worker: { enabled: false, healthy: true },
      }),
    });
    apps.push(app);
    const missingToken = await app.inject({
      method: "POST",
      url: "/v1/runs",
      payload: { message: "hello" },
    });
    expect(missingToken.statusCode).toBe(401);
    expect(missingToken.json()).toMatchObject({
      resultCode: 401,
      type: 1,
    });
    expect((await app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
    await service.dispose();
  });

  it("rejects userCode and agentList supplied by the caller", async () => {
    const service = createService();
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await buildHttpApp({
      runService: service,
      corsOrigin: true,
      runIngress: createRunIngress(service, undefined, agentCatalog),
      readiness: async () => ({
        ready: true,
        pi: { healthy: true },
        connectors: {},
        worker: { enabled: false, healthy: true },
      }),
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { message: "hello", userCode: "forged-user", agentList: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(agentCatalog.listAuthorizedAgents).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("requires Beyond-Token when subscribing to a Run", async () => {
    const service = createService();
    const app = await buildHttpApp({
      runService: service,
      corsOrigin: true,
      runIngress: createRunIngress(service),
      readiness: async () => ({
        ready: true,
        pi: { healthy: true },
        connectors: {},
        worker: { enabled: false, healthy: true },
      }),
    });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { message: "hello" },
    });
    const run = created.json<{ eventsUrl: string }>();

    const response = await app.inject({ method: "GET", url: run.eventsUrl });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ resultCode: 401, type: 1 });
    await service.dispose();
  });
});

/** 为 HTTP 测试组装与生产相同的统一 Run 入口。 */
function createRunIngress(
  service: RunService,
  verifyBeyondToken: BeyondTokenVerifier = async () => ({ userCode: "user" }),
  agentCatalog: AuthorizedAgentCatalog = { listAuthorizedAgents: async () => [] },
): RunIngressService {
  return new RunIngressService(service, verifyBeyondToken, agentCatalog);
}

/** 创建使用内存 Port 和假 Leader 的测试编排服务。 */
function createService(): RunService {
  const threads = new InMemoryThreadRepository();
  const runs = new InMemoryRunRepository();
  const delegations = new InMemoryDelegationRepository();
  const events = new InMemoryRunEventStore();
  const registry = new ConnectorRegistry();
  const delegationService = new DelegationService(registry, delegations, events, 1_000);
  const leaders: LeaderSessionFactory = {
    async create() {
      return {
        async run(input) {
          await input.onDelta("answer:");
          await input.onDelta(input.message);
          return { text: `answer:${input.message}` };
        },
        async abort() {},
        dispose() {},
      };
    },
    async health() {
      return { healthy: true, model: "fake/model" };
    },
  };
  return new RunService(
    threads,
    runs,
    delegations,
    events,
    delegationService,
    leaders,
  );
}
