import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_INSPECTION_ERROR_CODES,
  AttachmentInspectionError,
  ConnectorNotFoundError,
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunExecutionQueue,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  RunService,
  UnauthorizedAgentError,
  type AgentConnector,
  type AgentProfile,
  type AttachmentInspection,
  type AttachmentResolver,
  type ConnectorEvent,
  type ExecutionCredential,
  type ExternalExecutionRef,
  type ExecutionCredentialRepository,
  type GroupChatContextV1,
  type LeaderRunInput,
  type LeaderSession,
  type LeaderSessionFactory,
  type MaterializedAttachment,
  type Run,
  type RunAttachment,
  type Session,
} from "../src/index.js";

const agent: AgentProfile = {
  id: "1001",
  code: "analyst",
  name: "Analyst",
  description: "Analyzes data",
  execution: { connectorId: "fake", targetId: "1001" },
};

describe("ConnectorRegistry", () => {
  it("registers, requires and health-checks connectors", async () => {
    const registry = new ConnectorRegistry();
    const connector = fakeConnector(async function* () {
      yield completed("ok");
    });
    registry.register(connector);

    expect(registry.require("fake")).toBe(connector);
    expect((await registry.health()).fake).toEqual({ healthy: true });
    expect(() => registry.register(connector)).toThrow("already registered");
    expect(() => registry.require("missing")).toThrow(ConnectorNotFoundError);
  });
});

describe("DelegationService", () => {
  it("does not dispatch a connector after its signal was already aborted", async () => {
    const start = vi.fn();
    const registry = new ConnectorRegistry();
    registry.register({
      ...fakeConnector(async function* () {}),
      start,
    });
    const delegations = new InMemoryDelegationRepository();
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      1_000,
    );
    const controller = new AbortController();
    controller.abort(new Error("user cancelled"));

    await expect(
      service.execute({
        session: {
          id: "session-1",
          owner: { userCode: "user-1" },
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-pre-cancelled",
        agents: [agent],
        agentId: agent.id,
        task: "must not start",
        metadata: {},
        signal: controller.signal,
      }),
    ).rejects.toThrow("user cancelled");

    expect(start).not.toHaveBeenCalled();
    expect(await delegations.listByRun("run-pre-cancelled")).toEqual([]);
  });

  it("does not dispatch a connector when cancellation races with delegation lookup", async () => {
    const controller = new AbortController();
    const start = vi.fn();
    const registry = new ConnectorRegistry();
    registry.register({
      ...fakeConnector(async function* () {}),
      start,
    });
    class CancellingDelegationRepository extends InMemoryDelegationRepository {
      override async listByRun(runId: string) {
        controller.abort(new Error("cancelled during lookup"));
        return super.listByRun(runId);
      }
    }
    const delegations = new CancellingDelegationRepository();
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      1_000,
      Date.now,
      () => "delegation-race",
    );

    await expect(
      service.execute({
        session: {
          id: "session-1",
          owner: { userCode: "user-1" },
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-cancelled-during-lookup",
        agents: [agent],
        agentId: agent.id,
        task: "must not start",
        metadata: {},
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled during lookup");

    expect(start).not.toHaveBeenCalled();
    expect(await delegations.get("delegation-race")).toBeUndefined();
  });

  it("cancels an external execution when the Run stops during connector start", async () => {
    let resolveStartEntered!: () => void;
    const startEntered = new Promise<void>((resolve) => {
      resolveStartEntered = resolve;
    });
    let releaseStart!: () => void;
    const startRelease = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const cancel = vi.fn(async () => undefined);
    const registry = new ConnectorRegistry();
    registry.register({
      ...fakeConnector(async function* () {}),
      async start() {
        resolveStartEntered();
        await startRelease;
        return {
          ref: { connectorId: "fake", executionId: "external-start-race" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {})(),
          cancel,
        };
      },
    });
    const delegations = new InMemoryDelegationRepository();
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      1_000,
    );
    const controller = new AbortController();
    const execution = service.execute({
      session: {
        id: "session-1",
        owner: { userCode: "user-1" },
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-cancelled-during-start",
      agents: [agent],
      agentId: agent.id,
      task: "cancel while dispatching",
      metadata: {},
      signal: controller.signal,
    });
    await startEntered;

    controller.abort(new Error("user cancelled during connector start"));
    releaseStart();
    const result = await execution;

    expect(result.status).toBe("cancelled");
    expect(cancel).toHaveBeenCalledWith("run cancelled");
    expect((await delegations.listByRun("run-cancelled-during-start"))[0]?.status).toBe(
      "CANCELLED",
    );
  });

  it("validates authorization and aggregates normalized output", async () => {
    const registry = new ConnectorRegistry();
    const start = vi.fn(async () => ({
      ref: { connectorId: "fake", executionId: "external-1" },
      events: (async function* (): AsyncIterable<ConnectorEvent> {
        yield {
          type: "display_progress",
          text: "正在分析",
          sourceMessageId: "reason-1",
        };
        yield {
          type: "tool_started",
          callId: "call-1",
          toolName: "read",
          title: "调用工具：read",
        };
        yield {
          type: "tool_detail",
          callId: "call-1",
          toolName: "read",
          phase: "input",
          value: { path: "/tmp/data" },
        };
        yield {
          type: "tool_completed",
          callId: "call-1",
          toolName: "read",
          output: "file contents",
        };
        yield { type: "output_delta", text: "hello " };
        yield { type: "output_delta", text: "world" };
        yield completed("");
      })(),
      cancel: vi.fn(async () => undefined),
    }));
    const connector = fakeConnector(async function* () {});
    registry.register({
      ...connector,
      capabilities: { ...connector.capabilities, attachments: true },
      start,
    });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events, 1_000);
    const session = {
      id: "session-1",
      owner: {
        userCode: "user-1",
      },
      createdAt: 1,
      updatedAt: 1,
    };

    const result = await service.execute({
      session,
      runId: "run-1",
      agents: [agent],
      agentId: "1001",
      task: "analyze",
      expectedOutput: "structured summary",
      attachments: [
        {
          id: "attachment-1",
          name: "sales.csv",
          mediaType: "text/csv",
          provenance: "by-framework",
        },
      ],
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: "completed", output: "hello world" });
    expect(start).toHaveBeenCalledOnce();
    const stored = (await delegations.listByRun("run-1"))[0];
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.agentName).toBe("Analyst");
    const storedEvents = await events.list("run-1");
    expect(storedEvents.map((event) => event.type)).toEqual([
      "delegation.started",
      "delegation.display.progress",
      "delegation.tool.started",
      "delegation.tool.detail",
      "delegation.tool.completed",
      "delegation.output.delta",
      "delegation.output.delta",
      "delegation.completed",
    ]);
    const startedEvent = storedEvents.find((e) => e.type === "delegation.started");
    expect(startedEvent?.data).toMatchObject({
      delegationId: stored?.id,
      connectorId: "fake",
      task: "analyze",
      expectedOutput: "structured summary",
      attachments: [{ id: "attachment-1", name: "sales.csv", mediaType: "text/csv" }],
    });
    expect(
      storedEvents
        .filter((event) => event.type === "delegation.output.delta")
        .map((event) => event.data.text),
    ).toEqual(["hello ", "world"]);
    expect(
      storedEvents.find((event) => event.type === "delegation.tool.started")?.data,
    ).toMatchObject({
      delegationId: stored?.id,
      agentId: "1001",
      agentName: "Analyst",
      callId: "call-1",
      toolName: "read",
    });
    expect(
      storedEvents.find((event) => event.type === "delegation.tool.detail")?.data,
    ).toMatchObject({
      callId: "call-1",
      phase: "input",
      value: { path: "/tmp/data" },
    });
    expect(
      storedEvents.find((event) => event.type === "delegation.tool.completed")?.data,
    ).toMatchObject({
      callId: "call-1",
      toolName: "read",
      output: "file contents",
    });
    const completedEvent = storedEvents.find((e) => e.type === "delegation.completed");
    expect(completedEvent?.data).toMatchObject({
      delegationId: stored?.id,
      agentId: "1001",
      agentName: "Analyst",
      status: "COMPLETED",
      artifactCount: 0,
      resultStatus: "completed",
    });

    await expect(
      service.execute({
        session,
        runId: "run-2",
        agents: [agent],
        agentId: "not-authorized",
        task: "do something",
        metadata: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedAgentError);
    expect(start).toHaveBeenCalledOnce();
  });

  it("counts artifacts and carries agentName on terminal events", async () => {
    const registry = new ConnectorRegistry();
    const artifact = {
      id: "a-1",
      name: "report.csv",
      uri: "file://report.csv",
      mimeType: "text/csv",
    };
    registry.register({
      ...fakeConnector(async function* () {
        yield { type: "artifact", artifact };
        yield completed("done");
      }),
    });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events, 1_000);
    await service.execute({
      session: { id: "s", owner: { userCode: "u" }, createdAt: 1, updatedAt: 1 },
      runId: "run-art",
      agents: [agent],
      agentId: "1001",
      task: "t",
      metadata: {},
      signal: new AbortController().signal,
    });

    const completedEvent = (await events.list("run-art")).find(
      (e) => e.type === "delegation.completed",
    );
    expect(completedEvent?.data).toMatchObject({ agentName: "Analyst", artifactCount: 1 });
    expect((await delegations.listByRun("run-art"))[0]?.result?.artifacts).toHaveLength(1);
  });

  it("persists an input request and resumes the same connector execution", async () => {
    const registry = new ConnectorRegistry();
    let releaseInput!: () => void;
    const inputAnswered = new Promise<void>((resolve) => {
      releaseInput = resolve;
    });
    const respondToInput = vi.fn(async () => releaseInput());
    registry.register({
      ...fakeConnector(async function* () {}),
      async start() {
        return {
          ref: { connectorId: "fake", executionId: "external-input" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {
            yield {
              type: "input_required",
              interactionId: "interaction-1",
              request: {
                questions: [
                  {
                    header: "环境",
                    question: "部署到哪个环境？",
                    options: [
                      { label: "测试", description: "测试环境" },
                      { label: "生产", description: "生产环境" },
                    ],
                  },
                ],
              },
            };
            await inputAnswered;
            yield completed("deployed");
          })(),
          cancel: vi.fn(async () => undefined),
          respondToInput,
        };
      },
    });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events, 1_000);
    const execution = service.execute({
      session: {
        id: "session-input",
        owner: { userCode: "user-1" },
        contextRevision: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-input",
      agents: [agent],
      agentId: agent.id,
      task: "deploy",
      metadata: {},
      signal: new AbortController().signal,
    });
    await waitFor(async () =>
      (await events.list("run-input")).some((event) => event.type === "interaction.requested"),
    );
    expect((await delegations.listByRun("run-input"))[0]?.status).toBe("WAITING_USER");

    const responderOnAnotherInstance = new DelegationService(registry, delegations, events, 1_000);
    await expect(
      responderOnAnotherInstance.respondToInteraction("run-input", "interaction-1", {
        action: "submit",
        text: "生产环境",
      }),
    ).resolves.toBe(true);
    await expect(execution).resolves.toMatchObject({
      status: "completed",
      output: "deployed",
    });
    expect(respondToInput).toHaveBeenCalledWith(
      "interaction-1",
      { action: "submit", text: "生产环境" },
      undefined,
    );
    expect((await events.list("run-input")).map((event) => event.type)).toContain(
      "interaction.responded",
    );
  });

  it("replays a persisted interaction response after the delegation process restarts", async () => {
    const registry = new ConnectorRegistry();
    let releaseResume!: () => void;
    const resumedInput = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    const respondToInput = vi.fn(async () => releaseResume());
    registry.register({
      ...fakeConnector(async function* () {}),
      capabilities: {
        streaming: true,
        cancellation: true,
        artifacts: false,
        resumable: true,
      },
      resume: vi.fn(async () => ({
        ref: { connectorId: "fake", executionId: "external-restart" },
        events: (async function* (): AsyncIterable<ConnectorEvent> {
          await resumedInput;
          yield completed("resumed");
        })(),
        cancel: vi.fn(async () => undefined),
        respondToInput,
      })),
    });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    await delegations.save({
      id: "delegation-restart",
      runId: "run-restart",
      agentId: agent.id,
      agentName: agent.name,
      connectorId: "fake",
      task: "restart me",
      status: "WAITING_USER",
      externalRef: { connectorId: "fake", executionId: "external-restart" },
      connectorCursor: "cursor-1",
      version: 2,
      createdAt: 1,
      updatedAt: 2,
    });
    const requested = await events.append({
      timestamp: 2,
      runId: "run-restart",
      type: "interaction.requested",
      data: {
        interactionId: "interaction-restart",
        delegationId: "delegation-restart",
        source: "by-framework",
        request: { questions: [] },
        resumeToken: { messageId: "resume-message" },
      },
    });
    await events.append({
      timestamp: 3,
      runId: "run-restart",
      type: "interaction.responded",
      data: {
        interactionId: "interaction-restart",
        delegationId: "delegation-restart",
        action: "submit",
        text: "继续",
      },
    });
    expect(requested.eventId).toBe(1);
    const service = new DelegationService(registry, delegations, events, 1_000);

    await expect(
      service.execute({
        session: {
          id: "session-restart",
          owner: { userCode: "user-1" },
          contextRevision: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-restart",
        agents: [agent],
        agentId: agent.id,
        task: "restart me",
        metadata: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: "completed", output: "resumed" });
    expect(respondToInput).toHaveBeenCalledWith(
      "interaction-restart",
      { action: "submit", text: "继续" },
      { messageId: "resume-message" },
    );
  });

  it("times out and cancels a connector execution", async () => {
    const registry = new ConnectorRegistry();
    const cancel = vi.fn(async () => undefined);
    registry.register({
      ...fakeConnector(async function* () {}),
      async start(_request, context) {
        return {
          ref: { connectorId: "fake", executionId: "external-timeout" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {
            await new Promise<void>((resolve) => {
              context.signal.addEventListener("abort", () => resolve(), { once: true });
            });
            throw context.signal.reason;
          })(),
          cancel,
        };
      },
    });
    const delegations = new InMemoryDelegationRepository();
    const service = new DelegationService(registry, delegations, new InMemoryRunEventStore(), 10);
    const result = await service.execute({
      session: {
        id: "session-1",
        owner: {
          userCode: "user-1",
        },
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-timeout",
      agents: [agent],
      agentId: agent.id,
      task: "wait forever",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("timed_out");
    expect(cancel).toHaveBeenCalledOnce();
    expect((await delegations.listByRun("run-timeout"))[0]?.status).toBe("TIMED_OUT");
  });

  it("renews the idle deadline for activity from any connector", async () => {
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector(async function* () {
        for (let index = 0; index < 3; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 8));
          yield { type: "activity", cursor: `${index + 1}-0` };
        }
        yield completed("long task done");
      }),
    );
    const delegations = new InMemoryDelegationRepository();
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      { firstActivityMs: 20, idleMs: 20 },
    );

    const result = await service.execute({
      session: {
        id: "session-1",
        owner: { userCode: "user-1" },
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-sliding-timeout",
      agents: [agent],
      agentId: agent.id,
      task: "keep working",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: "completed", output: "long task done" });
    expect((await delegations.listByRun("run-sliding-timeout"))[0]?.lastActivityAt)
      .toBeTypeOf("number");
  });

  it("maps a connector first-event timeout to a timed-out delegation", async () => {
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector(async function* () {
        yield {
          type: "failed",
          error: {
            code: "OPENCLAW_FIRST_EVENT_TIMEOUT",
            message: "OpenClaw first event timed out",
            retryable: true,
            timedOut: true,
          },
        };
      }),
    );
    const delegations = new InMemoryDelegationRepository();
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      1_000,
    );

    const result = await service.execute({
      session: {
        id: "session-1",
        owner: { userCode: "user-1" },
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-first-event-timeout",
      agents: [agent],
      agentId: agent.id,
      task: "wait for first event",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("timed_out");
    expect((await delegations.listByRun("run-first-event-timeout"))[0]?.status).toBe("TIMED_OUT");
  });

  it("reports active delegation cancellation failures", async () => {
    const registry = new ConnectorRegistry();
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const controller = new AbortController();
    registry.register({
      ...fakeConnector(async function* () {}),
      async start(_request, context) {
        return {
          ref: { connectorId: "fake", executionId: "external-cancel-failure" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {
            resolveStarted?.();
            await new Promise<void>((resolve) => {
              context.signal.addEventListener("abort", () => resolve(), {
                once: true,
              });
            });
            throw context.signal.reason;
          })(),
          cancel: vi.fn(async () => {
            throw new Error("downstream cancellation failed");
          }),
        };
      },
    });
    const service = new DelegationService(
      registry,
      new InMemoryDelegationRepository(),
      new InMemoryRunEventStore(),
      1_000,
    );
    const execution = service
      .execute({
        session: {
          id: "session-1",
          owner: { userCode: "user-1" },
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-cancel-failure",
        agents: [agent],
        agentId: agent.id,
        task: "cancel me",
        metadata: {},
        signal: controller.signal,
      })
      .catch((error: unknown) => error);
    await started;

    await expect(service.cancelRun("run-cancel-failure", "user cancelled")).rejects.toThrow(
      "Failed to cancel 1 active delegation",
    );

    controller.abort(new Error("user cancelled"));
    await execution;
  });

  it("cancels a persisted delegation after the active execution is lost", async () => {
    const registry = new ConnectorRegistry();
    const cancel = vi.fn(async () => undefined);
    const resume = vi.fn(async () => ({
      ref: { connectorId: "fake", executionId: "external-persisted" },
      events: (async function* (): AsyncIterable<ConnectorEvent> {})(),
      cancel,
    }));
    registry.register({
      ...fakeConnector(async function* () {}),
      capabilities: {
        streaming: true,
        cancellation: true,
        artifacts: false,
        resumable: true,
        attachments: false,
      },
      resume,
    });
    const delegations = new InMemoryDelegationRepository();
    await delegations.save({
      id: "delegation-persisted",
      runId: "run-persisted",
      agentId: agent.id,
      connectorId: "fake",
      task: "cancel after restart",
      status: "RUNNING",
      externalRef: {
        connectorId: "fake",
        executionId: "external-persisted",
      },
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      1_000,
    );

    await service.cancelRun("run-persisted", "user cancelled");

    expect(resume).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("user cancelled");
  });

  it("resumes a persisted delegation from its cursor and partial output", async () => {
    const registry = new ConnectorRegistry();
    const start = vi.fn();
    const resume = vi.fn(async (_ref: ExternalExecutionRef, context: { cursor?: string }) => ({
      ref: { connectorId: "fake", executionId: "external-resume" },
      events: (async function* (): AsyncIterable<ConnectorEvent> {
        yield { type: "output_delta", text: "world", cursor: "2-0" };
        yield { ...completed("world"), cursor: "3-0" };
      })(),
      cancel: vi.fn(async () => undefined),
    }));
    registry.register({
      ...fakeConnector(async function* () {}),
      start,
      resume,
      capabilities: {
        streaming: true,
        cancellation: true,
        artifacts: false,
        resumable: true,
      },
    });
    const delegations = new InMemoryDelegationRepository();
    await delegations.save({
      id: "delegation-resume",
      runId: "run-resume",
      agentId: agent.id,
      connectorId: "fake",
      task: "resume me",
      status: "RUNNING",
      externalRef: { connectorId: "fake", executionId: "external-resume" },
      connectorCursor: "1-0",
      partialOutput: "hello ",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      1_000,
    );

    const result = await service.execute({
      session: {
        id: "session-resume",
        owner: { userCode: "user-1" },
        contextRevision: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-resume",
      agents: [agent],
      agentId: agent.id,
      task: "resume me",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result.output).toBe("hello world");
    expect(start).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "external-resume" }),
      expect.objectContaining({ cursor: "1-0" }),
    );
    expect((await delegations.get("delegation-resume"))?.connectorCursor).toBe("3-0");
  });

  it("externalRef 落库前宕机时复用原 delegationId 作为稳定投递键", async () => {
    const registry = new ConnectorRegistry();
    const start = vi.fn(async () => ({
      ref: { connectorId: "fake", executionId: "delegation-stable" },
      events: (async function* (): AsyncIterable<ConnectorEvent> {
        yield completed("done");
      })(),
      cancel: vi.fn(async () => undefined),
    }));
    registry.register({ ...fakeConnector(async function* () {}), start });
    const delegations = new InMemoryDelegationRepository();
    await delegations.save({
      id: "delegation-stable",
      runId: "run-stable",
      agentId: agent.id,
      connectorId: "fake",
      task: "stable dispatch",
      status: "QUEUED",
      version: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events);

    await service.execute({
      session: {
        id: "session-stable",
        owner: { userCode: "user-1" },
        contextRevision: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-stable",
      agents: [agent],
      agentId: agent.id,
      task: "stable dispatch",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ delegationId: "delegation-stable" }),
      expect.anything(),
    );
    expect(await delegations.listByRun("run-stable")).toHaveLength(1);
    expect((await events.list("run-stable")).map((event) => event.type)).toEqual([
      "delegation.output.delta",
      "delegation.completed",
    ]);
  });
});

describe("RunService", () => {
  it("stores Leader reasoning separately from visible answer deltas", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            await input.onReasoningDelta?.('The user said "hello"');
            await input.onDelta("你好！");
            return { text: "你好！" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true, model: "fake/model" };
      },
    };
    const { events, service } = createRunService(leaderFactory);

    const run = await service.createSessionRun({
      owner: { userCode: "first-user" },
      message: "hello",
      agentList: [],
    });

    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    const outputEvents = (await events.list(run.id)).filter((event) =>
      event.type.startsWith("leader."),
    );
    expect(outputEvents).toMatchObject([
      { type: "leader.reasoning.delta", data: { text: 'The user said "hello"' } },
      { type: "leader.delta", data: { text: "你好！" } },
    ]);
    expect((await service.getRun(run.id))?.finalAnswer).toBe("你好！");
    await service.dispose();
  });

  it("marks an empty Leader answer as failed instead of silently completing", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run() {
            return { text: "" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const { service } = createRunService(leaderFactory);

    const run = await service.createSessionRun({
      owner: { userCode: "first-user" },
      message: "must-answer",
      agentList: [],
    });

    await waitFor(async () => (await service.getRun(run.id))?.status === "FAILED");
    expect(await service.getRun(run.id)).toMatchObject({
      status: "FAILED",
      error: "Leader returned an empty response",
    });
    await service.dispose();
  });

  it("adds a safe user message to downstream model failure events", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run() {
            throw new Error("Leader model call failed: 403: sensitive provider response");
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const { events, service } = createRunService(leaderFactory);
    const run = await service.createSessionRun({
      owner: { userCode: "first-user" },
      message: "trigger-model-error",
      agentList: [],
    });

    await waitFor(async () => (await service.getRun(run.id))?.status === "FAILED");
    expect((await service.getRun(run.id))?.error).toContain("sensitive provider response");
    expect((await events.list(run.id)).at(-1)).toMatchObject({
      type: "run.failed",
      data: {
        status: "FAILED",
        error: "Leader model call failed: 403: sensitive provider response",
        userMessage: "下游模型调用异常，请切换模型或者联系管理员",
      },
    });
    await service.dispose();
  });

  it("passes Agent catalog unavailability to the Leader without injecting a direct answer", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { events, service } = createRunService(leaderFactory);
    const catalogError = "ByClaw BE discover request failed: fetch failed";

    const run = await service.createSessionRun({
      owner: { userCode: "first-user" },
      message: "continue-anyway",
      agentList: [],
      ingressContext: { agentCatalogError: catalogError },
    });

    await waitFor(() => leaderFactory.started.includes("continue-anyway"));
    expect(
      (await events.list(run.id))
        .filter((event) => event.type === "leader.delta")
        .map((event) => event.data.text),
    ).toEqual(["continue-anyway:delta"]);
    expect(leaderFactory.authorizedAgentsUnavailable).toEqual([true]);

    leaderFactory.release("continue-anyway", "done");
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect((await service.getRun(run.id))?.finalAnswer).toBe("done");
    await service.dispose();
  });

  it("原子入口创建首个 Session、Run 和 run.created 事件", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { events, service } = createRunService(leaderFactory);

    const run = await service.createSessionRun({
      owner: { userCode: "first-user" },
      context: { locale: "zh-CN", timezone: "Asia/Shanghai" },
      message: "first-message",
      thinkingLevel: "high",
      agentList: [],
      ingressContext: {
        externalSessionId: "11034160",
        groupChat: groupChatContext(),
        groupChatFingerprint: "frozen-fingerprint",
      },
    });

    expect(run.thinkingLevel).toBe("high");
    expect(await service.getOwnedSession(run.sessionId, { userCode: "first-user" })).toBeDefined();
    expect(await service.getOwnedRun(run.id, { userCode: "another-user" })).toBeUndefined();
    expect((await events.list(run.id))[0]).toMatchObject({
      type: "run.created",
      data: { status: "QUEUED" },
    });
    await waitFor(() => leaderFactory.started.includes("first-message"));
    expect(leaderFactory.thinkingLevels).toEqual(["high"]);
    expect(leaderFactory.sessionContexts).toEqual([
      {
        schemaVersion: 1,
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      },
    ]);
    expect(leaderFactory.currentTimes[0]).toEqual(expect.any(Number));
    expect(leaderFactory.groupChatContexts).toEqual([groupChatContext()]);
    expect(leaderFactory.externalSessionIds).toEqual(["11034160"]);
    expect((await service.getRun(run.id))?.ingressContext).toEqual({
      externalSessionId: "11034160",
      groupChat: groupChatContext(),
      groupChatFingerprint: "frozen-fingerprint",
    });
    leaderFactory.release("first-message", "done");
    await service.dispose();
  });

  it("pauses a native Leader tool call until the user responds", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            const response = await input.askUser({
              toolCallId: "tool-1",
              questions: [
                {
                  header: "实现方式",
                  question: "请选择实现方式",
                  options: [
                    { label: "方案 A", description: "保持现状" },
                    { label: "方案 B", description: "采用新方案" },
                  ],
                },
              ],
            });
            return { text: response.text ?? "no answer" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const { events, service } = createRunService(leaderFactory);
    const session = await service.createSession({ owner: { userCode: "user" } });
    const run = await service.createRun({
      sessionId: session.id,
      message: "需要澄清",
      agentList: [],
    });
    await waitFor(async () =>
      (await events.list(run.id)).some((event) => event.type === "interaction.requested"),
    );
    const requested = (await events.list(run.id)).find(
      (event) => event.type === "interaction.requested",
    );
    const interactionId = String(requested?.data.interactionId);
    expect((await service.getRun(run.id))?.status).toBe("WAITING_USER");
    expect(requested?.data).toMatchObject({
      source: "leader",
      request: {
        uiPayload: {
          formStatus: 0,
          humanTool: true,
        },
      },
    });

    await service.respondToInteraction(run.id, interactionId, {
      action: "submit",
      text: "方案 B",
    });
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect((await service.getRun(run.id))?.finalAnswer).toBe("方案 B");
    expect((await events.list(run.id)).map((event) => event.type)).toContain(
      "interaction.responded",
    );
    await service.dispose();
  });

  it("continues a persisted native interaction after a process restart", async () => {
    const receivedMessages: string[] = [];
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            receivedMessages.push(input.message);
            return { text: "recovered" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const queue = new InMemoryRunExecutionQueue();
    const session: Session = {
      id: "session-native-restart",
      owner: { userCode: "user-1" },
      sessionContext: { schemaVersion: 1 },
      sessionContextVersion: 1,
      contextRevision: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const run: Run = {
      id: "run-native-restart",
      sessionId: session.id,
      input: "原始任务",
      thinkingLevel: "off",
      agentList: [],
      status: "WAITING_USER",
      baseContextRevision: 0,
      attemptNo: 1,
      executionStage: "USER_INTERACTION_WAITING",
      version: 2,
      createdAt: 1,
      updatedAt: 2,
    };
    await sessions.save(session);
    await runs.save(run);
    await events.append({
      timestamp: 2,
      runId: run.id,
      type: "interaction.requested",
      data: {
        interactionId: "native-restart-interaction",
        source: "leader",
        request: { questions: [] },
      },
    });
    await queue.enqueue(run);
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      leaderFactory,
      Date.now,
      undefined,
      {
        executionQueue: queue,
        leaseMs: 1_000,
        queuePollMs: 5,
      },
    );
    service.start();
    expect(receivedMessages).toHaveLength(0);

    await service.respondToInteraction(run.id, "native-restart-interaction", {
      action: "submit",
      text: "恢复后的答案",
    });
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect(receivedMessages[0]).toContain("原始任务");
    expect(receivedMessages[0]).toContain("恢复后的答案");
    expect((await service.getRun(run.id))?.finalAnswer).toBe("recovered");
    await service.dispose();
  });

  it("rejects a user response after the waiting Run is cancelled", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            await input.askUser({
              toolCallId: "tool-cancel",
              questions: [
                {
                  header: "确认",
                  question: "是否继续？",
                  options: [
                    { label: "继续", description: "继续执行" },
                    { label: "停止", description: "停止执行" },
                  ],
                },
              ],
            });
            return { text: "unexpected" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const { events, service } = createRunService(leaderFactory);
    const session = await service.createSession({ owner: { userCode: "user" } });
    const run = await service.createRun({
      sessionId: session.id,
      message: "等待后取消",
      agentList: [],
    });
    await waitFor(async () =>
      (await events.list(run.id)).some((event) => event.type === "interaction.requested"),
    );
    const requested = (await events.list(run.id)).find(
      (event) => event.type === "interaction.requested",
    );
    await service.cancelRun(run.id, "user cancelled");
    await waitFor(async () => (await service.getRun(run.id))?.status === "CANCELLED");

    await expect(
      service.respondToInteraction(run.id, String(requested?.data.interactionId), {
        action: "submit",
        text: "太晚了",
      }),
    ).rejects.toThrow("Run is already terminal:");
    expect(
      (await events.list(run.id)).filter((event) => event.type === "interaction.responded"),
    ).toHaveLength(0);
    await service.dispose();
  });

  it("does not let a waiting interaction consume persistent execution capacity", async () => {
    const started: string[] = [];
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            started.push(input.message);
            if (input.message === "waiting") {
              await input.askUser({
                toolCallId: "tool-capacity",
                questions: [
                  {
                    header: "确认",
                    question: "是否继续？",
                    options: [
                      { label: "继续", description: "继续执行" },
                      { label: "停止", description: "停止执行" },
                    ],
                  },
                ],
              });
            }
            return { text: `${input.message}:done` };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      leaderFactory,
      Date.now,
      undefined,
      {
        executionQueue: new InMemoryRunExecutionQueue(),
        maxConcurrentRuns: 1,
        queuePollMs: 5,
      },
    );
    service.start();
    const firstSession = await service.createSession({
      owner: { userCode: "first" },
    });
    const secondSession = await service.createSession({
      owner: { userCode: "second" },
    });
    const first = await service.createRun({
      sessionId: firstSession.id,
      message: "waiting",
      agentList: [],
    });
    await service.createRun({
      sessionId: secondSession.id,
      message: "second",
      agentList: [],
    });
    await waitFor(async () =>
      (await events.list(first.id)).some((event) => event.type === "interaction.requested"),
    );

    await waitFor(() => started.includes("second"));
    expect(started).toContain("waiting");
    expect(started).toContain("second");
    await service.cancelRun(first.id, "test cleanup");
    await service.dispose();
  });

  it("启动持久队列时会定期清理过期的执行凭证", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const credentials: ExecutionCredentialRepository = {
      save: vi.fn(async () => undefined),
      loadForLease: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      deleteExpired: vi.fn(async () => 0),
    };
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      leaderFactory,
      Date.now,
      undefined,
      {
        executionQueue: new InMemoryRunExecutionQueue(),
        credentials,
        credentialCleanupIntervalMs: 5,
      },
    );

    service.start();
    await waitFor(() => vi.mocked(credentials.deleteExpired).mock.calls.length >= 2);
    await service.dispose();

    expect(credentials.deleteExpired).toHaveBeenCalled();
  });

  it("serializes runs per session and cancels queued work", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const session = await service.createSession({
      owner: { userCode: "user" },
    });
    const first = await service.createRun({
      sessionId: session.id,
      message: "first",
      agentList: [],
    });
    const second = await service.createRun({
      sessionId: session.id,
      message: "second",
      agentList: [],
    });

    await waitFor(() => leaderFactory.started.includes("first"));
    expect(leaderFactory.started).toEqual(["first"]);
    const cancelled = await service.cancelRun(second.id);
    expect(cancelled?.status).toBe("CANCELLED");

    leaderFactory.release("first", "first answer");
    await waitFor(async () => (await service.getRun(first.id))?.status === "COMPLETED");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(leaderFactory.started).toEqual(["first"]);
    expect(leaderFactory.createdSessionIds).toEqual([session.id]);
    expect((await service.getRun(second.id))?.status).toBe("CANCELLED");
    await service.dispose();
  });

  it("allows different sessions to run concurrently", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const [one, two] = await Promise.all([
      service.createSession({
        owner: { userCode: "one" },
      }),
      service.createSession({
        owner: { userCode: "two" },
      }),
    ]);
    await Promise.all([
      service.createRun({ sessionId: one.id, message: "one", agentList: [] }),
      service.createRun({ sessionId: two.id, message: "two", agentList: [] }),
    ]);

    await waitFor(() => leaderFactory.started.length === 2);
    expect(new Set(leaderFactory.started)).toEqual(new Set(["one", "two"]));
    expect(new Set(leaderFactory.createdSessionIds)).toEqual(new Set([one.id, two.id]));
    leaderFactory.release("one", "done");
    leaderFactory.release("two", "done");
    await service.dispose();
  });

  it("aborts an active Leader run", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const session = await service.createSession({
      owner: { userCode: "user" },
    });
    const run = await service.createRun({
      sessionId: session.id,
      message: "cancel-me",
      agentList: [],
    });
    await waitFor(() => leaderFactory.started.includes("cancel-me"));

    const cancelled = await service.cancelRun(run.id);

    expect(cancelled?.status).toBe("CANCELLED");
    expect(leaderFactory.aborted).toBe(1);
    await service.dispose();
  });

  it("propagates Run cancellation when a delegation supplies its own signal", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    let resolveConnectorStarted!: () => void;
    const connectorStarted = new Promise<void>((resolve) => {
      resolveConnectorStarted = resolve;
    });
    let connectorSignal: AbortSignal | undefined;
    let connectorParentMessageId: string | undefined;
    registry.register({
      ...fakeConnector(async function* () {}),
      async start(request, context) {
        connectorSignal = context.signal;
        connectorParentMessageId = request.parentMessageId;
        resolveConnectorStarted();
        return {
          ref: { connectorId: "fake", executionId: "external-own-signal" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {
            await new Promise<void>((resolve) => {
              if (context.signal.aborted) {
                resolve();
                return;
              }
              context.signal.addEventListener("abort", () => resolve(), {
                once: true,
              });
            });
            throw context.signal.reason;
          })(),
          cancel: vi.fn(async () => undefined),
        };
      },
    });
    const delegationService = new DelegationService(registry, delegations, events, 1_000);
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          run: async (input) => {
            const toolController = new AbortController();
            const result = await input.delegate({
              agentId: agent.id,
              task: "wait for cancellation",
              signal: toolController.signal,
            });
            return { text: result.output || result.status };
          },
          abort: async () => undefined,
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const service = new RunService(sessions, runs, delegations, events, delegationService, leaders);
    const session = await service.createSession({
      owner: { userCode: "user" },
    });
    const run = await service.createRun({
      sessionId: session.id,
      message: "delegate and cancel",
      agentList: [agent],
      ingressContext: { parentMessageId: "gateway-parent-message" },
    });
    await connectorStarted;

    const cancelled = await service.cancelRun(run.id);

    expect(cancelled?.status).toBe("CANCELLED");
    expect(connectorSignal).toBeDefined();
    expect(connectorSignal!.aborted).toBe(true);
    expect(connectorParentMessageId).toBe("gateway-parent-message");
    await service.dispose();
  });

  it("keeps a Run cancelling when downstream cancellation fails", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const delegationService = {
      cancelRun: vi.fn(async () => {
        throw new Error("downstream cancellation failed");
      }),
    };
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      delegationService as never,
      leaderFactory,
    );
    const session = await service.createSession({
      owner: { userCode: "user" },
    });
    const run = await service.createRun({
      sessionId: session.id,
      message: "cancel-failure",
      agentList: [],
    });
    await waitFor(() => leaderFactory.started.includes("cancel-failure"));

    await expect(service.cancelRun(run.id)).rejects.toThrow("downstream cancellation failed");
    await waitFor(async () => (await service.getRun(run.id))?.status === "CANCELLING");

    expect((await service.getRun(run.id))?.status).toBe("CANCELLING");
    await service.dispose();
  });
});

describe("RunService inspectAttachment 接线", () => {
  const attachmentA: RunAttachment = {
    id: "123",
    name: "a.txt",
    mediaType: "text/plain",
    size: 5,
    provenance: "http",
  };

  /** 组装带附件 Resolver 的 RunService，并捕获 Leader 收到的运行输入。 */
  function createInspectHarness(resolver?: AttachmentResolver) {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector(async function* () {
        yield completed("ok");
      }),
    );
    const delegationService = new DelegationService(registry, delegations, events, 1_000);
    const captured: { input?: LeaderRunInput } = {};
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          run: async (leaderInput: LeaderRunInput) => {
            captured.input = leaderInput;
            return { text: "done" };
          },
          abort: async () => undefined,
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      delegationService,
      leaders,
      undefined,
      undefined,
      resolver ? { attachmentResolver: resolver } : {},
    );
    return { captured, service };
  }

  /** 启动一个携带附件与凭证的 Run 并等待完成，返回捕获的 Leader 输入。 */
  async function runWithAttachments(
    harness: ReturnType<typeof createInspectHarness>,
    metadata?: Record<string, unknown>,
  ) {
    const session = await harness.service.createSession({
      owner: { userCode: "user-1" },
    });
    const run = await harness.service.createRun({
      sessionId: session.id,
      message: "read it",
      agentList: [],
      attachments: [attachmentA],
      ...(metadata ? { metadata } : {}),
    });
    await waitFor(async () => {
      const current = await harness.service.getRun(run.id);
      return current?.status === "COMPLETED";
    });
    expect(harness.captured.input).toBeDefined();
    return { input: harness.captured.input!, session, run };
  }

  it("注入 Resolver 时 Leader 输入携带附件与 inspectAttachment 回调", async () => {
    const inspect = vi.fn(
      async (
        args: Parameters<AttachmentResolver["inspect"]>[0],
      ): Promise<AttachmentInspection> => ({
        attachmentId: args.attachment.id,
        name: args.attachment.name,
        mode: args.mode,
        text: "bounded",
        truncated: false,
      }),
    );
    const harness = createInspectHarness({ inspect });
    const { input, session } = await runWithAttachments(harness, {
      "Beyond-Token": "token-1",
    });

    expect(input.attachments).toEqual([attachmentA]);
    expect(input.inspectAttachment).toBeDefined();
    const inspection = await input.inspectAttachment!({ attachmentId: "123" });
    expect(inspection.text).toBe("bounded");
    expect(inspect).toHaveBeenCalledOnce();
    const call = inspect.mock.calls[0]![0];
    expect(call.attachment).toEqual(attachmentA);
    expect(call.principal).toEqual(session.owner);
    expect(call.credential).toBe("token-1");
    expect(call.mode).toBe("text");
    await harness.service.dispose();
  });

  it("Resolver 支持 materialize 时注入 downloadAttachment 并固定解析本轮附件", async () => {
    const inspect = vi.fn() as unknown as AttachmentResolver["inspect"];
    const materialize = vi.fn(
      async (
        args: Parameters<NonNullable<AttachmentResolver["materialize"]>>[0],
      ): Promise<MaterializedAttachment> => ({
        attachmentId: args.attachment.id,
        name: args.attachment.name,
        byteSize: 5,
        relativePath: "attachments/123/a.txt",
      }),
    );
    const harness = createInspectHarness({ inspect, materialize });
    const { input, session } = await runWithAttachments(harness, {
      "Beyond-Token": "token-1",
    });

    expect(input.downloadAttachment).toBeDefined();
    const downloaded = await input.downloadAttachment!({
      attachmentId: "123",
      destinationDirectory: "/isolated/session",
    });
    expect(downloaded.relativePath).toBe("attachments/123/a.txt");
    expect(materialize).toHaveBeenCalledOnce();
    const call = materialize.mock.calls[0]![0];
    expect(call.attachment).toEqual(attachmentA);
    expect(call.principal).toEqual(session.owner);
    expect(call.credential).toBe("token-1");
    expect(call.destinationDirectory).toBe("/isolated/session");
    await harness.service.dispose();
  });

  it("显式 mode 透传给 Resolver", async () => {
    const inspect = vi.fn(
      async (
        args: Parameters<AttachmentResolver["inspect"]>[0],
      ): Promise<AttachmentInspection> => ({
        attachmentId: args.attachment.id,
        name: args.attachment.name,
        mode: args.mode,
        truncated: false,
      }),
    );
    const harness = createInspectHarness({ inspect });
    const { input } = await runWithAttachments(harness, {
      "Beyond-Token": "token-1",
    });
    await input.inspectAttachment!({ attachmentId: "123", mode: "structure" });
    expect(inspect.mock.calls[0]![0].mode).toBe("structure");
    await harness.service.dispose();
  });

  it("attachmentId 不在本轮附件集合时拒绝且不触达 Resolver", async () => {
    const inspect = vi.fn() as unknown as AttachmentResolver["inspect"];
    const harness = createInspectHarness({ inspect });
    const { input } = await runWithAttachments(harness, {
      "Beyond-Token": "token-1",
    });
    await expect(input.inspectAttachment!({ attachmentId: "not-in-run" })).rejects.toMatchObject({
      name: "AttachmentInspectionError",
      code: ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND,
    });
    expect(inspect).not.toHaveBeenCalled();
    await harness.service.dispose();
  });

  it("缺少 Beyond-Token 凭证时返回 CREDENTIAL_MISSING", async () => {
    const inspect = vi.fn() as unknown as AttachmentResolver["inspect"];
    const harness = createInspectHarness({ inspect });
    const { input } = await runWithAttachments(harness);
    await expect(input.inspectAttachment!({ attachmentId: "123" })).rejects.toMatchObject({
      name: "AttachmentInspectionError",
      code: ATTACHMENT_INSPECTION_ERROR_CODES.CREDENTIAL_MISSING,
    });
    expect(inspect).not.toHaveBeenCalled();
    await harness.service.dispose();
  });

  it("未注入 Resolver 时 inspectAttachment 不暴露", async () => {
    const harness = createInspectHarness();
    const { input } = await runWithAttachments(harness, {
      "Beyond-Token": "token-1",
    });
    expect(input.attachments).toEqual([attachmentA]);
    expect(input.inspectAttachment).toBeUndefined();
    await harness.service.dispose();
  });

  it("接管路径从凭证仓库恢复 Beyond-Token，附件解析可基于持久 Run 重做", async () => {
    const inspect = vi.fn(
      async (
        args: Parameters<AttachmentResolver["inspect"]>[0],
      ): Promise<AttachmentInspection> => ({
        attachmentId: args.attachment.id,
        name: args.attachment.name,
        mode: args.mode,
        text: "resumed",
        truncated: false,
      }),
    );
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector(async function* () {
        yield completed("ok");
      }),
    );
    const stored = new Map<string, ExecutionCredential>();
    const credentials: ExecutionCredentialRepository = {
      save: async (credential) => {
        stored.set(credential.runId, credential);
      },
      loadForLease: async ({ runId }) => stored.get(runId),
      delete: async (runId) => {
        stored.delete(runId);
      },
      deleteExpired: async () => 0,
    };
    const captured: { input?: LeaderRunInput } = {};
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          run: async (leaderInput: LeaderRunInput) => {
            captured.input = leaderInput;
            return { text: "done" };
          },
          abort: async () => undefined,
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(registry, delegations, events, 1_000),
      leaders,
      Date.now,
      undefined,
      {
        executionQueue: new InMemoryRunExecutionQueue(),
        credentials,
        attachmentResolver: { inspect },
        queuePollMs: 5,
        instanceId: "takeover-instance",
      },
    );
    const session = await service.createSession({
      owner: { userCode: "user-9" },
    });
    // 不传 metadata：模拟另一实例接管，内存中没有 ephemeral Beyond-Token，
    // 执行路径必须经 credentials.loadForLease 恢复凭证。
    const run = await service.createRun({
      sessionId: session.id,
      message: "takeover",
      agentList: [],
      attachments: [attachmentA],
      executionCredential: { secret: "lease-secret", expiresAt: Date.now() + 60_000 },
    });

    service.start();
    await waitFor(async () => {
      const current = await service.getRun(run.id);
      return current?.status === "COMPLETED";
    });

    const input = captured.input!;
    expect(input.attachments).toEqual([attachmentA]);
    const inspection = await input.inspectAttachment!({ attachmentId: "123" });
    expect(inspection.text).toBe("resumed");
    expect(inspect.mock.calls[0]![0].credential).toBe("lease-secret");
    await service.dispose();
  });
});

function createRunService(leaders: LeaderSessionFactory) {
  const sessions = new InMemorySessionRepository();
  const runs = new InMemoryRunRepository(sessions);
  const delegations = new InMemoryDelegationRepository();
  const events = new InMemoryRunEventStore();
  const registry = new ConnectorRegistry();
  registry.register(
    fakeConnector(async function* () {
      yield completed("ok");
    }),
  );
  const delegationService = new DelegationService(registry, delegations, events, 1_000);
  return {
    events,
    service: new RunService(sessions, runs, delegations, events, delegationService, leaders),
  };
}

class ControlledLeaderFactory implements LeaderSessionFactory {
  readonly started: string[] = [];
  readonly thinkingLevels: LeaderRunInput["thinkingLevel"][] = [];
  readonly sessionContexts: LeaderRunInput["sessionContext"][] = [];
  readonly currentTimes: number[] = [];
  readonly externalSessionIds: Array<string | undefined> = [];
  readonly groupChatContexts: Array<GroupChatContextV1 | undefined> = [];
  readonly authorizedAgentsUnavailable: Array<boolean | undefined> = [];
  readonly createdSessionIds: string[] = [];
  aborted = 0;
  readonly #releases = new Map<string, (value: string) => void>();

  async create(sessionId: string): Promise<LeaderSession> {
    this.createdSessionIds.push(sessionId);
    return {
      contextRevision: 0,
      run: async (input: LeaderRunInput) => {
        this.started.push(input.message);
        this.thinkingLevels.push(input.thinkingLevel);
        this.sessionContexts.push(input.sessionContext);
        this.currentTimes.push(input.currentTime);
        this.externalSessionIds.push(input.externalSessionId);
        this.groupChatContexts.push(input.groupChatContext);
        this.authorizedAgentsUnavailable.push(input.authorizedAgentsUnavailable);
        await input.onDelta(`${input.message}:delta`);
        const text = await new Promise<string>((resolve, reject) => {
          this.#releases.set(input.message, resolve);
          input.signal.addEventListener(
            "abort",
            () => reject(input.signal.reason ?? new Error("aborted")),
            { once: true },
          );
        });
        return { text };
      },
      abort: async () => {
        this.aborted += 1;
      },
      checkpoint: () => undefined,
      markCommitted: () => undefined,
      dispose: () => undefined,
    };
  }

  async health() {
    return { healthy: true, model: "fake/model" };
  }

  release(message: string, text: string): void {
    const release = this.#releases.get(message);
    if (!release) {
      throw new Error(`Run has not started: ${message}`);
    }
    release(text);
  }
}

function groupChatContext(): GroupChatContextV1 {
  return {
    schemaVersion: "byclaw.group-chat-context/v1",
    conversationKey: "conversation-1",
    snapshot: {
      beforeMessageId: "message-2",
      generatedAt: 1_000,
    },
    messages: [
      {
        messageId: "message-1",
        sequence: 1,
        createdAt: 100,
        role: "assistant",
        speaker: {
          type: "agent",
          agentId: "agent-a",
          agentName: "Agent A",
        },
        content: "A 的结论",
      },
    ],
    truncation: {
      truncated: false,
      omittedMessageCount: 0,
    },
  };
}

function fakeConnector(events: () => AsyncIterable<ConnectorEvent>): AgentConnector {
  return {
    id: "fake",
    capabilities: {
      streaming: true,
      cancellation: true,
      artifacts: false,
      resumable: false,
    },
    async start() {
      return {
        ref: { connectorId: "fake", executionId: "external" },
        events: events(),
        cancel: async () => undefined,
      };
    },
    async health() {
      return { healthy: true };
    },
  };
}

function completed(output: string): ConnectorEvent {
  return {
    type: "completed",
    result: { status: "completed", output, artifacts: [] },
  };
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
