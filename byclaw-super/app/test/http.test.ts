import { afterEach, describe, expect, it } from "vitest";
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
import { buildHttpApp } from "../server/app.js";

const apps: Awaited<ReturnType<typeof buildHttpApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Thread/Run HTTP API", () => {
  it("creates a run, exposes status and replays SSE without leaking the token", async () => {
    const service = createService();
    const app = await buildHttpApp({
      runService: service,
      corsOrigin: true,
      readiness: async () => ({ ready: true, pi: { healthy: true }, connectors: {} }),
    });
    apps.push(app);
    const threadResponse = await app.inject({
      method: "POST",
      url: "/v1/threads",
      payload: { tenantId: "tenant", userCode: "user" },
    });
    expect(threadResponse.statusCode).toBe(201);
    const thread = threadResponse.json<{ id: string }>();
    const runResponse = await app.inject({
      method: "POST",
      url: `/v1/threads/${thread.id}/runs`,
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { message: "hello", agentList: [] },
    });
    expect(runResponse.statusCode).toBe(202);
    const run = runResponse.json<{ runId: string; eventsUrl: string }>();
    await waitFor(async () => {
      const response = await app.inject({ method: "GET", url: `/v1/runs/${run.runId}` });
      return response.json<{ run: { status: string } }>().run.status === "COMPLETED";
    });

    const statusResponse = await app.inject({ method: "GET", url: `/v1/runs/${run.runId}` });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().run).toMatchObject({
      status: "COMPLETED",
      finalAnswer: "answer:hello",
    });
    expect(statusResponse.body).not.toContain("very-secret-token");

    const sseResponse = await app.inject({ method: "GET", url: run.eventsUrl });
    expect(sseResponse.statusCode).toBe(200);
    expect(sseResponse.headers["content-type"]).toContain("text/event-stream");
    expect(sseResponse.body).toContain("event: leader.delta");
    expect(sseResponse.body).toContain("event: run.completed");
    expect(sseResponse.body).not.toContain("very-secret-token");

    const replayResponse = await app.inject({
      method: "GET",
      url: run.eventsUrl,
      headers: { "Last-Event-ID": "2" },
    });
    expect(replayResponse.body).not.toContain("id: 1\n");
    expect(replayResponse.body).not.toContain("id: 2\n");
    await service.dispose();
  });

  it("validates input and reports readiness failure", async () => {
    const service = createService();
    const app = await buildHttpApp({
      runService: service,
      corsOrigin: true,
      readiness: async () => ({
        ready: false,
        pi: { healthy: false, message: "no model" },
        connectors: {},
      }),
    });
    apps.push(app);
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/threads",
      payload: { tenantId: "", userCode: "user" },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
    await service.dispose();
  });
});

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

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
