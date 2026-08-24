import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentCapabilityCompileError,
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  RunService,
  type AgentCapabilityCardRepository,
  type AgentCapabilityCompiler,
  type AgentConnector,
  type AgentProfile,
  type ConnectorEvent,
  type LeaderSessionFactory,
} from "@byclaw/by-conductor";
import type { BeyondTokenVerifier } from "../auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "../business/agent-catalog.js";
import { RunIngressService } from "../ingress/run-ingress-service.js";
import { buildHttpApp } from "../server/app.js";

const apps: Awaited<ReturnType<typeof buildHttpApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Session / Run HTTP/SSE API", () => {
  it("compiles an authenticated Agent capability card without creating a Run", async () => {
    const service = createService();
    const verifyBeyondToken = vi.fn(async () => ({ userCode: "creator" }));
    const compile = vi.fn(async () => capabilityCardResult());
    const app = await createApp(
      service,
      verifyBeyondToken,
      { listAuthorizedAgents: async () => [] },
      true,
      { compile },
    );

    const response = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/agent-capability-cards/compile",
      headers: { "Beyond-Token": "creator-token" },
      payload: {
        locale: "zh-CN",
        agent: {
          name: "经营分析助手",
          description: "分析经营数据",
          skills: [{ code: "sql", name: "SQL 查询" }],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(verifyBeyondToken).toHaveBeenCalledWith({ token: "creator-token" });
    expect(compile).toHaveBeenCalledWith({
      locale: "zh-CN",
      agent: {
        name: "经营分析助手",
        description: "分析经营数据",
        skills: [{ code: "sql", name: "SQL 查询" }],
      },
    });
    expect(response.json()).toMatchObject({
      schemaVersion: "byclaw.agent-capability-card/v1",
      routingText: "经营数据分析 Agent",
    });
    expect(await service.getRunDetails("missing")).toBeUndefined();
    await service.dispose();
  });

  it("requires authentication for capability card compilation", async () => {
    const service = createService();
    const compile = vi.fn(async () => capabilityCardResult());
    const app = await createApp(
      service,
      async () => ({ userCode: "creator" }),
      { listAuthorizedAgents: async () => [] },
      true,
      { compile },
    );

    const response = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/agent-capability-cards/compile",
      payload: {
        agent: {
          name: "经营分析助手",
          description: "分析经营数据",
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(compile).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("returns 422 when capability source information is insufficient", async () => {
    const service = createService();
    const app = await createApp(
      service,
      async () => ({ userCode: "creator" }),
      { listAuthorizedAgents: async () => [] },
      true,
      {
        compile: async () => {
          throw new AgentCapabilityCompileError(
            "At least one capability source is required",
            422,
          );
        },
      },
    );

    const response = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/agent-capability-cards/compile",
      headers: { "Beyond-Token": "creator-token" },
      payload: { agent: { name: "万能助手" } },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: "At least one capability source is required",
    });
    await service.dispose();
  });

  it("compiles and persists an authorized Agent capability card", async () => {
    const service = createService();
    const compile = vi.fn(async () => capabilityCardResult());
    const upsert = vi.fn<AgentCapabilityCardRepository["upsert"]>(
      async () => undefined,
    );
    const app = await createApp(
      service,
      async () => ({ userCode: "creator" }),
      {
        listAuthorizedAgents: async () => [
          {
            id: "10093429",
            code: "BYAI_DIG_EMPLOYEE_10093429",
            name: "自-文章创作助手",
            execution: {
              connectorId: "openclaw",
              targetId: "10093429",
            },
          },
        ],
      },
      true,
      { compile },
      { upsert },
    );

    const response = await app.inject({
      method: "PUT",
      url: "/byclawSuper/v1/agents/10093429/capability-card",
      headers: {
        "Beyond-Token": "creator-token",
        "System-Code": "BYAI",
      },
      payload: {
        locale: "zh-CN",
        sourceVersion: "1784776346288",
        agent: {
          code: "BYAI_DIG_EMPLOYEE_10093429",
          name: "自-文章创作助手",
          description: "负责文章创作、修改和校验",
          skills: [
            {
              code: "by-web-search",
              name: "联网搜索",
              description: "检索并核验实时信息",
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(compile).toHaveBeenCalledWith({
      locale: "zh-CN",
      agent: {
        code: "BYAI_DIG_EMPLOYEE_10093429",
        name: "自-文章创作助手",
        description: "负责文章创作、修改和校验",
        skills: [
          {
            code: "by-web-search",
            name: "联网搜索",
            description: "检索并核验实时信息",
          },
        ],
      },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        systemCode: "BYAI",
        agentId: "10093429",
        agentCode: "BYAI_DIG_EMPLOYEE_10093429",
        agentName: "自-文章创作助手",
        sourceVersion: "1784776346288",
        compiled: capabilityCardResult(),
        now: expect.any(Number),
      }),
    );
    expect(response.json()).toMatchObject({
      systemCode: "BYAI",
      agentId: "10093429",
      sourceVersion: "1784776346288",
      schemaVersion: "byclaw.agent-capability-card/v1",
    });
    await service.dispose();
  });

  it("does not compile or persist a capability card for an unauthorized Agent", async () => {
    const service = createService();
    const compile = vi.fn(async () => capabilityCardResult());
    const upsert = vi.fn<AgentCapabilityCardRepository["upsert"]>(
      async () => undefined,
    );
    const app = await createApp(
      service,
      async () => ({ userCode: "creator" }),
      { listAuthorizedAgents: async () => [] },
      true,
      { compile },
      { upsert },
    );

    const response = await app.inject({
      method: "PUT",
      url: "/byclawSuper/v1/agents/10093429/capability-card",
      headers: {
        "Beyond-Token": "creator-token",
        "System-Code": "BYAI",
      },
      payload: {
        agent: {
          name: "自-文章创作助手",
          description: "负责文章创作",
        },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(compile).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("creates a Session with its first Run and streams SSE without leaking the token", async () => {
    const service = createService();
    const verifyBeyondToken = vi.fn(async () => ({ userCode: "user" }));
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await createApp(service, verifyBeyondToken, agentCatalog);

    const created = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
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
    expect(response.eventsUrl).toBe(`/byclawSuper/v1/runs/${response.runId}/events`);
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
      url: `/byclawSuper/v1/runs/${response.runId}`,
      headers: { "Beyond-Token": "very-secret-token" },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({
      runId: response.runId,
      sessionId: response.sessionId,
      status: "COMPLETED",
      delegations: [],
    });
    await service.dispose();
  });

  it("accepts attachment references and reports attachmentCount", async () => {
    const service = createService();
    const verifyBeyondToken = vi.fn(async () => ({ userCode: "user" }));
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await createApp(service, verifyBeyondToken, agentCatalog);

    const created = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: {
        message: "总结这份报告",
        attachments: [
          {
            id: "123",
            name: "report.pdf",
            mediaType: "application/pdf",
            size: 245_760,
          },
        ],
      },
    });
    expect(created.statusCode).toBe(202);
    const body = created.json<{ runId: string; attachmentCount: number }>();
    expect(body.attachmentCount).toBe(1);
    const run = await service.getRun(body.runId);
    expect(run?.attachments).toEqual([
      {
        id: "123",
        name: "report.pdf",
        mediaType: "application/pdf",
        size: 245_760,
        provenance: "http",
      },
    ]);
    await service.dispose();
  });

  it("creates a Run from attachments only using the stable default prompt", async () => {
    const service = createService();
    const app = await createApp(
      service,
      async () => ({ userCode: "user" }),
      { listAuthorizedAgents: async () => [] },
    );
    const created = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { attachments: [{ id: "a", name: "note.txt" }] },
    });
    expect(created.statusCode).toBe(202);
    const run = await service.getRun(
      created.json<{ runId: string }>().runId,
    );
    expect(run?.input).toBe("请处理本次上传的附件");
    expect(run?.attachments).toHaveLength(1);
    await service.dispose();
  });

  it("rejects empty message and attachments with 400", async () => {
    const service = createService();
    const app = await createApp(
      service,
      async () => ({ userCode: "user" }),
      { listAuthorizedAgents: async () => [] },
    );
    const created = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: {},
    });
    expect(created.statusCode).toBe(400);
    await service.dispose();
  });

  it("rejects attachment carrying url or path (HTTP locator policy)", async () => {
    const service = createService();
    const app = await createApp(
      service,
      async () => ({ userCode: "user" }),
      { listAuthorizedAgents: async () => [] },
    );
    const rejected = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: {
        message: "x",
        attachments: [{ id: "a", name: "n", url: "https://evil/x" }],
      },
    });
    expect(rejected.statusCode).toBe(400);
    await service.dispose();
  });

  it("accepts a per-Run thinkingLevel and rejects unsupported values", async () => {
    const service = createService();
    const app = await createApp(service);

    const created = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "token" },
      payload: { message: "think deeply", thinkingLevel: "high" },
    });
    expect(created.statusCode).toBe(202);
    const { runId } = created.json<{ runId: string }>();
    expect(await service.getRun(runId)).toMatchObject({
      input: "think deeply",
      thinkingLevel: "high",
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "token" },
      payload: { message: "invalid", thinkingLevel: "unlimited" },
    });
    expect(invalid.statusCode).toBe(400);
    await service.dispose();
  });

  it("returns delegation results in the run snapshot without leaking internals", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    const agent: AgentProfile = {
      id: "agent-1",
      name: "数据助理",
      execution: { connectorId: "fake", targetId: "agent-1" },
    };
    const connector: AgentConnector = {
      id: "fake",
      capabilities: {
        completionMode: "events",
        streaming: true,
        cancellation: true,
        artifacts: true,
        resumable: false,
      },
      async start() {
        return {
          ref: { connectorId: "fake", executionId: "ext-1" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {
            yield { type: "output_delta", text: "partial answer" };
            yield {
              type: "completed",
              result: {
                status: "completed",
                output: "final answer",
                artifacts: [
                  {
                    id: "art-1",
                    name: "r.csv",
                    uri: "file://r.csv",
                    mimeType: "text/csv",
                  },
                ],
              },
            };
          })(),
          cancel: async () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    registry.register(connector);
    const delegationService = new DelegationService(registry, delegations, events, 1_000);
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            const res = await input.delegate({
              toolCallId: "delegate-http",
              agentId: "agent-1",
              task: "do it",
            });
            await input.onDelta("summary");
            return { text: `summary:${res.output}` };
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
    let now = 1_000_000;
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      delegationService,
      leaders,
      () => ++now,
    );
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => [agent]) };
    const app = await createApp(service, undefined, agentCatalog);

    const owned = await createSession(app, "very-secret-token", "hi");
    await waitFor(async () => (await service.getRun(owned.runId))?.status === "COMPLETED");

    const snapshot = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/runs/${owned.runId}`,
      headers: { "Beyond-Token": "very-secret-token" },
    });
    expect(snapshot.statusCode).toBe(200);
    const body = snapshot.json();
    expect(body.delegations).toHaveLength(1);
    expect(body.delegations[0]).toMatchObject({
      agentId: "agent-1",
      agentName: "数据助理",
      status: "COMPLETED",
      output: "partial answer",
      artifactCount: 1,
      truncated: false,
    });
    expect(body.delegations[0].artifacts).toHaveLength(1);
    // 不泄露内部传输、原始 task 或凭证字段
    for (const key of ["connectorId", "externalRef", "task", "expectedOutput"]) {
      expect(body.delegations[0]).not.toHaveProperty(key);
    }
    expect(snapshot.body).not.toContain("very-secret-token");

    const sse = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/runs/${owned.runId}/events`,
      headers: { "Beyond-Token": "very-secret-token" },
    });
    expect(sse.statusCode).toBe(200);
    expect(sse.body).toContain("event: subAgentStart");
    expect(sse.body).toContain("event: subAgentOutputDelta");
    expect(sse.body).toContain("event: subAgentEnd");
    expect(sse.body).toContain('"messageId":"');
    expect(sse.body).toContain('"queryMessageId":"');
    expect(sse.body).toContain('"content":"partial answer"');
    expect(sse.body).not.toContain("very-secret-token");
    await service.dispose();
  });

  it("appends Runs to one Session while keeping another Session isolated", async () => {
    const service = createService();
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await createApp(service, undefined, agentCatalog);

    const first = await createSession(app, "owner-token", "first");
    const secondResponse = await app.inject({
      method: "POST",
      url: `/byclawSuper/v1/sessions/${first.sessionId}/runs`,
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

  it("returns paginated Session messages from Run inputs and final answers", async () => {
    const service = createService();
    const app = await createApp(service);
    const first = await createSession(app, "owner-token", "first");
    const secondResponse = await app.inject({
      method: "POST",
      url: `/byclawSuper/v1/sessions/${first.sessionId}/runs`,
      headers: { "Beyond-Token": "owner-token" },
      payload: { message: "second" },
    });
    const thirdResponse = await app.inject({
      method: "POST",
      url: `/byclawSuper/v1/sessions/${first.sessionId}/runs`,
      headers: { "Beyond-Token": "owner-token" },
      payload: { message: "third" },
    });
    const second = secondResponse.json<{ runId: string }>();
    const third = thirdResponse.json<{ runId: string }>();
    await waitFor(async () =>
      (
        await Promise.all(
          [first.runId, second.runId, third.runId].map(
            async (runId) =>
              (await service.getRun(runId))?.status === "COMPLETED",
          ),
        )
      ).every(Boolean),
    );

    const latestResponse = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/sessions/${first.sessionId}/messages?limit=2`,
      headers: { "Beyond-Token": "owner-token" },
    });
    expect(latestResponse.statusCode).toBe(200);
    const latest = latestResponse.json<{
      sessionId: string;
      items: Array<{
        runId: string;
        role: "user" | "assistant";
        content: string;
        runStatus: string;
      }>;
      nextCursor: string | null;
    }>();
    expect(latest.sessionId).toBe(first.sessionId);
    expect(latest.items.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "answer:second" },
      { role: "user", content: "third" },
      { role: "assistant", content: "answer:third" },
    ]);
    expect(latest.items.every((item) => item.runStatus === "COMPLETED")).toBe(true);
    expect(latest.nextCursor).toEqual(expect.any(String));

    const olderResponse = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/sessions/${first.sessionId}/messages?limit=2&before=${encodeURIComponent(
        latest.nextCursor ?? "",
      )}`,
      headers: { "Beyond-Token": "owner-token" },
    });
    expect(olderResponse.statusCode).toBe(200);
    expect(olderResponse.json()).toMatchObject({
      sessionId: first.sessionId,
      items: [
        { runId: first.runId, role: "user", content: "first" },
        {
          runId: first.runId,
          role: "assistant",
          content: "answer:first",
        },
      ],
      nextCursor: null,
    });
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
      url: `/byclawSuper/v1/sessions/${owned.sessionId}/runs`,
      headers: { "Beyond-Token": "b-token" },
      payload: { message: "steal" },
    });
    const appendMissing = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions/missing-session/runs",
      headers: { "Beyond-Token": "b-token" },
      payload: { message: "missing" },
    });
    const queryForeign = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/runs/${owned.runId}`,
      headers: { "Beyond-Token": "b-token" },
    });
    const queryMissing = await app.inject({
      method: "GET",
      url: "/byclawSuper/v1/runs/missing-run",
      headers: { "Beyond-Token": "b-token" },
    });
    const streamForeign = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/runs/${owned.runId}/events`,
      headers: { "Beyond-Token": "b-token" },
    });
    const cancelForeign = await app.inject({
      method: "POST",
      url: `/byclawSuper/v1/runs/${owned.runId}/cancel`,
      headers: { "Beyond-Token": "b-token" },
    });
    const historyForeign = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/sessions/${owned.sessionId}/messages`,
      headers: { "Beyond-Token": "b-token" },
    });

    for (const response of [
      appendForeign,
      appendMissing,
      queryForeign,
      queryMissing,
      streamForeign,
      cancelForeign,
      historyForeign,
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
      url: `/byclawSuper/v1/sessions/${owned.sessionId}/runs`,
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
      url: "/byclawSuper/v1/sessions",
      payload: { message: "hello" },
    });
    const missingHistoryToken = await app.inject({
      method: "GET",
      url: "/byclawSuper/v1/sessions/missing/messages",
    });
    expect(missingToken.statusCode).toBe(401);
    expect(missingToken.json()).toMatchObject({ resultCode: 401, type: 1 });
    expect(missingHistoryToken.statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/byclawSuper/ready" })).statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
    expect((await app.inject({ method: "POST", url: "/v1/sessions" })).statusCode).toBe(404);
    await service.dispose();
  });

  it("rejects caller-owned fields and removes the old Conversation API", async () => {
    const service = createService();
    const agentCatalog = { listAuthorizedAgents: vi.fn(async () => []) };
    const app = await createApp(service, undefined, agentCatalog);

    const forged = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
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
      url: "/byclawSuper/v1/runs",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: { message: "hello" },
    });

    expect(forged.statusCode).toBe(400);
    expect(oldApi.statusCode).toBe(404);
    expect(agentCatalog.listAuthorizedAgents).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("stores normalized Session context when the Session is created", async () => {
    const service = createService();
    const app = await createApp(service);

    const created = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: {
        message: "你好",
        context: {
          locale: "ZH-hans-cn",
          timezone: "asia/shanghai",
        },
      },
    });

    expect(created.statusCode).toBe(202);
    const { sessionId } = created.json<{ sessionId: string }>();
    await expect(service.getSession(sessionId)).resolves.toMatchObject({
      sessionContext: {
        schemaVersion: 1,
        locale: "zh-Hans-CN",
        timezone: "Asia/Shanghai",
      },
      sessionContextVersion: 1,
      contextRevision: 0,
    });
    await service.dispose();
  });

  it("rejects an invalid Session timezone", async () => {
    const service = createService();
    const app = await createApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/byclawSuper/v1/sessions",
      headers: { "Beyond-Token": "very-secret-token" },
      payload: {
        message: "hello",
        context: { timezone: "Mars/Olympus" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringMatching(/timezone/) });
    await service.dispose();
  });

  it("requires Beyond-Token when subscribing to a Run", async () => {
    const service = createService();
    const app = await createApp(service);
    const run = await createSession(app, "very-secret-token", "hello");

    const response = await app.inject({
      method: "GET",
      url: `/byclawSuper/v1/runs/${run.runId}/events`,
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
  capabilityCompiler: AgentCapabilityCompiler = {
    compile: async () => capabilityCardResult(),
  },
  capabilityCards: AgentCapabilityCardRepository = {
    upsert: async () => undefined,
  },
) {
  const app = await buildHttpApp({
    capabilityCards,
    capabilityCompiler,
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

function capabilityCardResult() {
  return {
    schemaVersion: "byclaw.agent-capability-card/v1" as const,
    generatorVersion: "1.0.0" as const,
    sourceFingerprint: `sha256:${"a".repeat(64)}`,
    card: {
      summary: "分析经营数据",
      capabilities: ["经营数据分析"],
      bestFor: ["分析经营指标"],
      requires: ["指标"],
      delivers: ["分析结论"],
      limitations: [],
      keywords: ["经营分析", "指标分析", "数据分析"],
    },
    routingText: "经营数据分析 Agent",
    quality: {
      confidence: "medium" as const,
      missingInformation: [],
      warnings: [],
    },
  };
}

async function createSession(
  app: Awaited<ReturnType<typeof buildHttpApp>>,
  token: string,
  message: string,
  systemCode?: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/byclawSuper/v1/sessions",
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
  let now = 1_000_000;
  return new RunService(
    sessions,
    runs,
    delegations,
    events,
    delegationService,
    leaders,
    () => ++now,
  );
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for HTTP test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
