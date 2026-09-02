import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_INSPECTION_ERROR_CODES,
  AttachmentInspectionError,
  ConnectorNotFoundError,
  ConnectorRegistry,
  DelegationService,
  DelegationSuspendedError,
  InMemoryDelegationRepository,
  InMemoryExecutionCredentialRepository,
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
  type TaskPlanGateway,
  type TaskPlanSnapshot,
} from "../src/index.js";
import { LeaderRunSuspendedError } from "../src/application/run-suspension.js";

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
  it("persists callback completion and completes it idempotently from an external callback", async () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeCallbackConnector(5));
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    let currentTime = 10_000;
    const service = new DelegationService(
      registry,
      delegations,
      events,
      { firstActivityMs: 100, idleMs: 200, callbackMs: 1_000 },
      () => currentTime,
      () => "delegation-suspended",
    );

    await expect(
      service.execute({
        session: {
          id: "session-1",
          owner: { userCode: "user-1" },
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-suspended",
        agents: [agent],
        agentId: agent.id,
        task: "analyze later",
        metadata: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(DelegationSuspendedError);

    expect(await delegations.get("delegation-suspended")).toMatchObject({
      status: "RUNNING",
      externalRef: { executionId: "external" },
      callbackDeadlineAt: 11_000,
    });

    currentTime = 10_500;
    await expect(
      service.execute({
        session: {
          id: "session-1",
          owner: { userCode: "user-1" },
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-suspended",
        agents: [agent],
        agentId: agent.id,
        task: "analyze later",
        metadata: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(DelegationSuspendedError);
    expect(await delegations.get("delegation-suspended")).toMatchObject({
      callbackDeadlineAt: 11_000,
    });

    await expect(
      service.completeFromExternalCallback({
        delegationId: "delegation-suspended",
        status: "COMPLETED",
        finalAnswer: "callback answer",
      }),
    ).resolves.toMatchObject({ outcome: "delegation_settled", runId: "run-suspended" });
    expect(await delegations.get("delegation-suspended")).toMatchObject({
      status: "COMPLETED",
      result: { status: "completed", output: "callback answer" },
    });
    await expect(
      service.completeFromExternalCallback({
        delegationId: "delegation-suspended",
        status: "COMPLETED",
        finalAnswer: "duplicate",
      }),
    ).resolves.toMatchObject({
      outcome: "delegation_already_settled",
      runId: "run-suspended",
      delegationStatus: "COMPLETED",
    });
    expect((await delegations.get("delegation-suspended"))?.result?.output).toBe(
      "callback answer",
    );
  });

  it("persists no callback deadline when the callback timeout is disabled", async () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeCallbackConnector(5));
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(
      registry,
      delegations,
      events,
      { firstActivityMs: 100, idleMs: 200, callbackMs: 0 },
      () => 10_000,
      () => "delegation-without-deadline",
    );

    await expect(
      service.execute({
        session: {
          id: "session-no-callback-timeout",
          owner: { userCode: "user-1" },
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-no-callback-timeout",
        agents: [agent],
        agentId: agent.id,
        task: "long task",
        metadata: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(DelegationSuspendedError);

    expect(await delegations.get("delegation-without-deadline")).not.toHaveProperty(
      "callbackDeadlineAt",
    );
  });

  it("logs delegation lifecycle and redacted child output previews", async () => {
    const registry = new ConnectorRegistry();
    registry.register(
      fakeConnector(async function* () {
        yield { type: "output_delta", text: "token=secret-value partial" };
        yield completed("done");
      }),
    );
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = new DelegationService(
      registry,
      new InMemoryDelegationRepository(),
      new InMemoryRunEventStore(),
      1_000,
      Date.now,
      () => "delegation-observed",
      logger,
    );

    const result = await service.execute({
      session: {
        id: "session-1",
        owner: { userCode: "user-1" },
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-observed",
      agents: [agent],
      agentId: agent.id,
      task: "analyze",
      metadata: { externalSessionId: "external-session-1" },
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("completed");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "delegation_event",
        sessionId: "session-1",
        externalSessionId: "external-session-1",
        connectorEventType: "output_delta",
        contentPreview: "token=[REDACTED] partial",
      }),
      "收到子 Agent 归一化事件",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "delegation_finished",
        status: "COMPLETED",
      }),
      "子 Agent 委派结束",
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret-value");
  });

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
        completionMode: "events",
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
        completionMode: "events",
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
        completionMode: "events",
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
  it("drops queued Leader output as soon as callAgent suspends the Run", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    registry.register(fakeCallbackConnector());
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            try {
              await input.delegate({
                agentId: agent.id,
                task: "analyze later",
              });
            } catch (error) {
              if (!(error instanceof DelegationSuspendedError)) {
                throw error;
              }
              // 模拟 Pi 已经排入异步回调队列、但在 callAgent 挂起后才执行的 token。
              await input.onReasoningDelta?.("late reasoning");
              await input.onDelta("late answer");
              throw new LeaderRunSuspendedError(error.delegationId);
            }
            throw new Error("expected delegation suspension");
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
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(registry, delegations, events, 1_000),
      leaderFactory,
    );

    const run = await service.createSessionRun({
      owner: { userCode: "user-1" },
      message: "delegate",
      agentList: [agent],
    });

    await waitFor(async () => (await service.getRun(run.id))?.status === "WAITING_AGENT");
    const history = await events.list(run.id);
    expect(history.some((event) => event.type === "run.suspended")).toBe(true);
    expect(
      history.some(
        (event) => event.type === "leader.reasoning.delta" || event.type === "leader.delta",
      ),
    ).toBe(false);
    await service.dispose();
  });

  it("preserves complete ephemeral metadata across sequential callback delegations", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    const dispatchedMetadata: Array<Record<string, unknown>> = [];
    registry.register({
      ...fakeCallbackConnector(),
      async start(request) {
        dispatchedMetadata.push(structuredClone(request.metadata));
        return {
          completionMode: "callback",
          ref: {
            connectorId: "fake",
            executionId: `external-${dispatchedMetadata.length}`,
          },
          cancel: async () => undefined,
        };
      },
    });
    let leaderRunCount = 0;
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            leaderRunCount += 1;
            try {
              await input.delegate({
                agentId: agent.id,
                task: leaderRunCount === 1 ? "first task" : "second task",
              });
            } catch (error) {
              if (!(error instanceof DelegationSuspendedError)) {
                throw error;
              }
              throw new LeaderRunSuspendedError(error.delegationId);
            }
            throw new Error("expected delegation suspension");
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
        credentials: new InMemoryExecutionCredentialRepository(),
        queuePollMs: 5,
      },
    );
    service.start();
    const run = await service.createSessionRun({
      owner: { userCode: "user-1" },
      message: "delegate twice",
      agentList: [agent],
      metadata: {
        "Beyond-Token": "token-1",
        "System-Code": "system-1",
        channelExtension: { source: "byclaw-be" },
      },
      executionCredential: { secret: "token-1" },
    });

    await waitFor(() => Promise.resolve(dispatchedMetadata.length === 1));
    const [firstDelegation] = await delegations.listByRun(run.id);
    await service.resumeDelegation({
      delegationId: firstDelegation!.id,
      status: "COMPLETED",
      finalAnswer: "first done",
    });
    await waitFor(() => Promise.resolve(dispatchedMetadata.length === 2));

    expect(dispatchedMetadata).toEqual([
      {
        "Beyond-Token": "token-1",
        "System-Code": "system-1",
        channelExtension: { source: "byclaw-be" },
      },
      {
        "Beyond-Token": "token-1",
        "System-Code": "system-1",
        channelExtension: { source: "byclaw-be" },
      },
    ]);
    await service.cancelRun(run.id, "test complete");
    await service.dispose();
  });

  it("restores complete metadata from credentials when another instance claims the Run", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const queue = new InMemoryRunExecutionQueue();
    const credentials = new InMemoryExecutionCredentialRepository();
    const registry = new ConnectorRegistry();
    const dispatchedMetadata: Array<Record<string, unknown>> = [];
    registry.register({
      ...fakeCallbackConnector(),
      async start(request) {
        dispatchedMetadata.push(structuredClone(request.metadata));
        return {
          completionMode: "callback",
          ref: { connectorId: "fake", executionId: "external-takeover" },
          cancel: async () => undefined,
        };
      },
    });
    const delegationService = new DelegationService(registry, delegations, events, 1_000);
    const idleLeaders: LeaderSessionFactory = {
      create: vi.fn(),
      health: vi.fn(async () => ({ healthy: true })),
    };
    const receivingService = new RunService(
      sessions,
      runs,
      delegations,
      events,
      delegationService,
      idleLeaders,
      Date.now,
      undefined,
      {
        executionQueue: queue,
        credentials,
        instanceId: "receiving-instance",
        maxConcurrentRuns: 0,
      },
    );
    const run = await receivingService.createSessionRun({
      owner: { userCode: "user-1" },
      message: "delegate after takeover",
      agentList: [agent],
      metadata: {
        "Beyond-Token": "token-1",
        "System-Code": "system-1",
        channelExtension: { source: "byclaw-be" },
      },
      executionCredential: { secret: "token-1" },
    });

    const claimingLeaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            try {
              await input.delegate({ agentId: agent.id, task: "claimed task" });
            } catch (error) {
              if (!(error instanceof DelegationSuspendedError)) {
                throw error;
              }
              throw new LeaderRunSuspendedError(error.delegationId);
            }
            throw new Error("expected delegation suspension");
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
    const claimingService = new RunService(
      sessions,
      runs,
      delegations,
      events,
      delegationService,
      claimingLeaders,
      Date.now,
      undefined,
      {
        executionQueue: queue,
        credentials,
        instanceId: "claiming-instance",
        queuePollMs: 5,
      },
    );
    claimingService.start();

    await waitFor(() => Promise.resolve(dispatchedMetadata.length === 1));
    expect(dispatchedMetadata[0]).toEqual({
      "Beyond-Token": "token-1",
      "System-Code": "system-1",
      channelExtension: { source: "byclaw-be" },
    });

    await claimingService.cancelRun(run.id, "test complete");
    await Promise.all([receivingService.dispose(), claimingService.dispose()]);
  });

  it("requeues a WAITING_AGENT Run only after its persisted callback arrives", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    const delegationService = new DelegationService(registry, delegations, events, 1_000);
    const enqueue = vi.fn(async () => undefined);
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      delegationService,
      {
        create: vi.fn(),
        health: vi.fn(async () => ({ healthy: true })),
      },
      Date.now,
      undefined,
      {
        executionQueue: {
          enqueue,
          claimNext: vi.fn(async () => undefined),
          heartbeat: vi.fn(async () => true),
          release: vi.fn(async () => undefined),
        },
      },
    );
    const session = await service.createSession({ owner: { userCode: "user-1" } });
    const waitingRun: Run = {
      id: "run-callback",
      sessionId: session.id,
      input: "analyze",
      attachments: [],
      agentList: [agent],
      status: "WAITING_AGENT",
      baseContextRevision: 0,
      attemptNo: 1,
      executionStage: "CONNECTOR_WAITING",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    await runs.save(waitingRun);
    await delegations.save({
      id: "delegation-callback",
      runId: waitingRun.id,
      agentId: agent.id,
      agentName: agent.name,
      connectorId: agent.execution.connectorId,
      task: "analyze",
      status: "RUNNING",
      externalRef: { connectorId: "fake", executionId: "external-callback" },
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    });
    await events.append({
      timestamp: 2,
      runId: waitingRun.id,
      type: "run.suspended",
      data: { status: "WAITING_AGENT", delegationId: "delegation-callback" },
    });

    await expect(
      service.resumeDelegation({
        delegationId: "delegation-callback",
        status: "COMPLETED",
        finalAnswer: "42",
      }),
    ).resolves.toMatchObject({ outcome: "run_resumed", runId: waitingRun.id, afterEventId: 1 });
    expect(await runs.get(waitingRun.id)).toMatchObject({
      status: "QUEUED",
      executionStage: "CONNECTOR_WAITING",
    });
    expect(enqueue).toHaveBeenCalledOnce();

    await expect(
      service.resumeDelegation({
        delegationId: "delegation-callback",
        status: "COMPLETED",
        finalAnswer: "duplicate",
      }),
    ).resolves.toMatchObject({
      outcome: "delegation_already_settled",
      runId: waitingRun.id,
      delegationStatus: "COMPLETED",
    });
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("polls the persistent callback deadline store and reports retryable sweep failures", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const expireWaitingCallbacks = vi
      .fn<() => Promise<Array<{ runId: string; delegationId: string }>>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue([]);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      {
        create: vi.fn(),
        health: vi.fn(async () => ({ healthy: true })),
      },
      Date.now,
      undefined,
      {
        executionQueue: {
          enqueue: vi.fn(async () => undefined),
          claimNext: vi.fn(async () => undefined),
          heartbeat: vi.fn(async () => true),
          release: vi.fn(async () => undefined),
          expireWaitingCallbacks,
        },
        queuePollMs: 5,
        logger,
      },
    );

    service.start();
    await waitFor(() => Promise.resolve(expireWaitingCallbacks.mock.calls.length > 1));
    await service.dispose();
    expect(expireWaitingCallbacks).toHaveBeenCalledWith({ limit: 100 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "database unavailable" }),
      "扫描子 Agent 回调超时失败",
    );
  });

  it("does not scan or enforce persisted callback deadlines when the timeout is disabled", async () => {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const expireWaitingCallbacks = vi.fn(async () => []);
    const settleWaitingCallback = vi.fn(async () => ({
      outcome: "callback_expired" as const,
      runId: "run-with-legacy-deadline",
    }));
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      {
        create: vi.fn(),
        health: vi.fn(async () => ({ healthy: true })),
      },
      Date.now,
      undefined,
      {
        executionQueue: {
          enqueue: vi.fn(async () => undefined),
          claimNext: vi.fn(async () => undefined),
          heartbeat: vi.fn(async () => true),
          release: vi.fn(async () => undefined),
          expireWaitingCallbacks,
          settleWaitingCallback,
        },
        callbackTimeoutEnabled: false,
        queuePollMs: 5,
      },
    );

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await service.resumeDelegation({
      delegationId: "delegation-with-legacy-deadline",
      status: "COMPLETED",
      finalAnswer: "done",
    });
    await service.dispose();

    expect(expireWaitingCallbacks).not.toHaveBeenCalled();
    expect(settleWaitingCallback).toHaveBeenCalledWith({
      delegationId: "delegation-with-legacy-deadline",
      status: "COMPLETED",
      finalAnswer: "done",
      enforceDeadline: false,
    });
  });

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

  it("exposes the provider error message in downstream model failure events", async () => {
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
        userMessage: "403: sensitive provider response",
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

  it("keeps a native Leader interaction waiting until the user responds", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            const response = await input.askUser({
              toolCallId: "tool-no-timeout",
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
    );
    const session = await service.createSession({ owner: { userCode: "user" } });
    const run = await service.createRun({
      sessionId: session.id,
      message: "持续等待",
      agentList: [],
    });

    await waitFor(async () => (await service.getRun(run.id))?.status === "WAITING_USER");
    const requested = (await events.list(run.id)).find(
      (event) => event.type === "interaction.requested",
    );
    expect(requested?.data).not.toHaveProperty("timeoutMs");
    expect(requested?.data).not.toHaveProperty("deadlineAt");

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await service.getRun(run.id)).toMatchObject({
      status: "WAITING_USER",
    });
    expect(
      (await events.list(run.id)).some((event) => event.type === "run.failed"),
    ).toBe(false);

    await service.respondToInteraction(run.id, String(requested?.data.interactionId), {
      action: "submit",
      text: "稍后的回答",
    });
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect((await service.getRun(run.id))?.finalAnswer).toBe("稍后的回答");
    await service.dispose();
  });

  it("continues a persisted native interaction after a process restart", async () => {
    const receivedMessages: string[] = [];
    const receivedCredentials: string[] = [];
    const restartAttachment: RunAttachment = {
      id: "restart-attachment",
      name: "restart.txt",
      mimeType: "text/plain",
      size: 7,
    };
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            receivedMessages.push(input.message);
            await input.inspectAttachment?.({ attachmentId: restartAttachment.id });
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
      attachments: [restartAttachment],
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
    const storedCredentials = new Map<string, ExecutionCredential>();
    const credentials: ExecutionCredentialRepository = {
      save: async (credential) => {
        storedCredentials.set(credential.runId, structuredClone(credential));
      },
      loadForLease: async ({ runId }) => storedCredentials.get(runId),
      delete: async (runId) => {
        storedCredentials.delete(runId);
      },
    };
    await credentials.save({
      runId: run.id,
      secret: "old-token",
      createdAt: 1,
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
        credentials,
        attachmentResolver: {
          inspect: async ({ attachment, credential, mode }) => {
            receivedCredentials.push(credential);
            return {
              attachmentId: attachment.id,
              name: attachment.name,
              mode,
              text: "resumed",
              truncated: false,
            };
          },
        },
        leaseMs: 1_000,
        queuePollMs: 5,
      },
    );
    service.start();
    expect(receivedMessages).toHaveLength(0);

    await service.respondToInteraction(
      run.id,
      "native-restart-interaction",
      {
        action: "submit",
        text: "恢复后的答案",
      },
      "new-token",
    );
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect(receivedMessages[0]).toContain("原始任务");
    expect(receivedMessages[0]).toContain("恢复后的答案");
    expect(receivedCredentials).toEqual(["new-token"]);
    expect((await service.getRun(run.id))?.finalAnswer).toBe("recovered");
    await service.dispose();
  });

  it("ignores a legacy deadline when recovering a persisted native interaction", async () => {
    let leaderRuns = 0;
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run() {
            leaderRuns += 1;
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
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const queue = new InMemoryRunExecutionQueue();
    const session: Session = {
      id: "session-native-legacy-deadline",
      owner: { userCode: "user-1" },
      sessionContext: { schemaVersion: 1 },
      sessionContextVersion: 1,
      contextRevision: 0,
      createdAt: 100,
      updatedAt: 100,
    };
    const run: Run = {
      id: "run-native-legacy-deadline",
      sessionId: session.id,
      input: "原始任务",
      thinkingLevel: "off",
      agentList: [],
      status: "WAITING_USER",
      baseContextRevision: 0,
      attemptNo: 1,
      executionStage: "USER_INTERACTION_WAITING",
      version: 2,
      createdAt: 100,
      updatedAt: 100,
    };
    await sessions.save(session);
    await runs.save(run);
    await events.append({
      timestamp: 100,
      runId: run.id,
      type: "interaction.requested",
      data: {
        interactionId: "native-legacy-deadline-interaction",
        source: "leader",
        timeoutMs: 100,
        deadlineAt: 200,
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
      () => 10_000,
      undefined,
      {
        executionQueue: queue,
        leaseMs: 1_000,
        queuePollMs: 5,
      },
    );

    service.start();
    await waitFor(async () => (await service.getRun(run.id))?.status === "WAITING_USER");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(leaderRuns).toBe(0);
    expect((await service.getRun(run.id))?.status).toBe("WAITING_USER");
    await service.respondToInteraction(run.id, "native-legacy-deadline-interaction", {
      action: "submit",
      text: "继续执行",
    });
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect(leaderRuns).toBe(1);
    expect((await service.getRun(run.id))?.finalAnswer).toBe("unexpected");
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

describe("RunService task plan completion guard", () => {
  function taskPlanSnapshot(
    status: TaskPlanSnapshot["status"],
    version = 1,
  ): TaskPlanSnapshot {
    return {
      planId: "plan-1",
      version,
      title: "完成复杂任务",
      status,
      sessionId: "external-session-1",
      messageId: "message-1",
      sourceRuntime: "BYCLAW_SUPER",
      sourceRunId: "run-1",
      tasks: [
        {
          taskId: "task-1",
          position: 1,
          title: "执行任务",
          status:
            status === "ACTIVE"
              ? "IN_PROGRESS"
              : status === "FAILED"
                ? "FAILED"
                : "COMPLETED",
        },
      ],
    };
  }

  function createTaskPlanService(
    leaderRun: (input: LeaderRunInput) => Promise<{ text: string }>,
    taskPlans: TaskPlanGateway,
    connector?: AgentConnector,
  ) {
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const registry = new ConnectorRegistry();
    if (connector) {
      registry.register(connector);
    }
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          run: leaderRun,
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
      new DelegationService(
        registry,
        delegations,
        events,
        1_000,
      ),
      leaders,
      undefined,
      undefined,
      { taskPlans },
    );
    return { events, service };
  }

  async function createTaskPlanRun(
    service: RunService,
    agentList: AgentProfile[] = [],
  ) {
    return service.createSessionRun({
      owner: { userCode: "user-1" },
      message: "完成一个复杂任务",
      agentList,
      ingressContext: {
        externalSessionId: "external-session-1",
        parentMessageId: "message-1",
      },
      metadata: { "Beyond-Token": "secret-token" },
    });
  }

  it("continues the Leader until the active plan reaches a terminal status", async () => {
    const active = taskPlanSnapshot("ACTIVE");
    const completedPlan = taskPlanSnapshot("COMPLETED", 2);
    const taskPlans: TaskPlanGateway = {
      loadActive: vi.fn(async () => active),
      command: vi.fn(async () => ({ ok: true, plan: completedPlan })),
      cancel: vi.fn(async () => undefined),
    };
    const messages: string[] = [];
    const { events, service } = createTaskPlanService(async (input) => {
      messages.push(input.message);
      if (messages.length === 1) {
        await input.onDelta("不应提前展示");
        return { text: "过早结束" };
      }
      await input.updateTaskPlan!({
        toolCallId: "finish-plan",
        command: {
          action: "complete_current",
        },
      });
      await input.onDelta("最终回答");
      return { text: "任务已经完成" };
    }, taskPlans);

    const run = await createTaskPlanRun(service);
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");

    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain("task plan is still active");
    expect(taskPlans.command).toHaveBeenCalledOnce();
    expect((await service.getRun(run.id))?.finalAnswer).toBe("任务已经完成");
    expect(
      (await events.list(run.id))
        .filter(({ type }) => type === "leader.delta")
        .map(({ data }) => data),
    ).toEqual([{ text: "最终回答" }]);
    await service.dispose();
  });

  it("fails closed when the authoritative task plan cannot be loaded", async () => {
    const taskPlans: TaskPlanGateway = {
      loadActive: vi.fn(async () => {
        throw new Error("BE unavailable");
      }),
      command: vi.fn(async () => ({ ok: true, plan: taskPlanSnapshot("FAILED", 2) })),
      cancel: vi.fn(async () => undefined),
    };
    const leaderRun = vi.fn(async () => ({ text: "不应执行" }));
    const { service } = createTaskPlanService(leaderRun, taskPlans);

    const run = await createTaskPlanRun(service);
    await waitFor(async () => (await service.getRun(run.id))?.status === "FAILED");

    expect(leaderRun).not.toHaveBeenCalled();
    expect((await service.getRun(run.id))?.error).toContain(
      "Unable to load the authoritative task plan",
    );
    await service.dispose();
  });

  it("keeps delegation independent from task-plan status updates", async () => {
    let currentPlan: TaskPlanSnapshot = {
      ...taskPlanSnapshot("ACTIVE"),
      tasks: [
        {
          taskId: "task-1",
          position: 1,
          title: "调度数字员工",
          status: "IN_PROGRESS",
        },
      ],
    };
    const taskPlans: TaskPlanGateway = {
      loadActive: vi.fn(async () => currentPlan),
      command: vi.fn(async ({ command }) => {
        if (command.action !== "complete_current") {
          throw new Error("expected complete_current command");
        }
        const nextTasks = currentPlan.tasks.map((task) => ({
          ...task,
          status: "COMPLETED" as const,
        }));
        currentPlan = {
          ...currentPlan,
          version: currentPlan.version + 1,
          status: "COMPLETED",
          tasks: nextTasks,
        };
        return { ok: true, plan: currentPlan };
      }),
      cancel: vi.fn(async () => undefined),
    };
    const connector = fakeConnector(async function* () {
      yield completed("任务完成");
    });
    const { service } = createTaskPlanService(async (input) => {
      const result = await input.delegate({
        agentId: agent.id,
        task: "执行当前任务",
      });
      expect(result.status).toBe("completed");
      expect(taskPlans.command).not.toHaveBeenCalled();
      await input.updateTaskPlan!({
        toolCallId: "plan-complete-current-task",
        command: {
          action: "complete_current",
        },
      });
      return { text: "任务已经完成" };
    }, taskPlans, connector);

    const run = await createTaskPlanRun(service, [agent]);
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");

    expect(taskPlans.command).toHaveBeenCalledOnce();
    expect(taskPlans.command).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "plan-complete-current-task",
        command: { action: "complete_current" },
      }),
    );
    const delegation = (await service.getRunDetails(run.id))?.delegations[0];
    expect(delegation).toMatchObject({ status: "COMPLETED" });
    expect(delegation).not.toHaveProperty("taskPosition");
    await service.dispose();
  });

  it("fails instead of reporting success when the Leader repeatedly ignores an active plan", async () => {
    const taskPlans: TaskPlanGateway = {
      loadActive: vi.fn(async () => taskPlanSnapshot("ACTIVE")),
      command: vi.fn(async () => ({ ok: true, plan: taskPlanSnapshot("FAILED", 2) })),
      cancel: vi.fn(async () => undefined),
    };
    const leaderRun = vi.fn(async () => ({ text: "仍然过早结束" }));
    const { events, service } = createTaskPlanService(leaderRun, taskPlans);

    const run = await createTaskPlanRun(service);
    await waitFor(async () => (await service.getRun(run.id))?.status === "FAILED");

    expect(leaderRun).toHaveBeenCalledTimes(4);
    expect((await service.getRun(run.id))?.status).toBe("FAILED");
    expect(taskPlans.command).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          action: "fail_current",
          statusReason: expect.objectContaining({ code: "RUN_FAILED" }),
        }),
      }),
    );
    expect((await events.list(run.id)).some(({ type }) => type === "run.completed")).toBe(false);
    await service.dispose();
  });

  it("requires the task-plan tool to record a delegation failure", async () => {
    let currentPlan: TaskPlanSnapshot = {
      ...taskPlanSnapshot("ACTIVE"),
      tasks: [
        {
          taskId: "task-1",
          position: 1,
          title: "调度数字员工",
          status: "IN_PROGRESS",
        },
      ],
    };
    const taskPlans: TaskPlanGateway = {
      loadActive: vi.fn(async () => currentPlan),
      command: vi.fn(async ({ command }) => {
        if (command.action !== "fail_current") {
          throw new Error("expected fail_current command");
        }
        const nextTasks = currentPlan.tasks.map((task) => ({
          ...task,
          status: "FAILED" as const,
          ...(command.statusReason ? { statusReason: command.statusReason } : {}),
        }));
        currentPlan = {
          ...currentPlan,
          version: currentPlan.version + 1,
          status: "FAILED",
          tasks: nextTasks,
        };
        return { ok: true, plan: currentPlan };
      }),
      cancel: vi.fn(async () => undefined),
    };
    const connector = fakeConnector(async function* () {
      yield {
        type: "failed",
        error: {
          code: "DIGITAL_EMPLOYEE_UNAVAILABLE",
          message: "employee unavailable",
          retryable: false,
        },
      };
    });
    const { service } = createTaskPlanService(async (input) => {
      const result = await input.delegate({
        agentId: agent.id,
        task: "调度数字员工执行任务",
      });
      expect(result.status).toBe("failed");
      expect(taskPlans.command).not.toHaveBeenCalled();
      await input.updateTaskPlan!({
        toolCallId: "plan-fail-delegated-task",
        command: {
          action: "fail_current",
          statusReason: {
            code: "DIGITAL_EMPLOYEE_UNAVAILABLE",
            message: "employee unavailable",
          },
        },
      });
      return { text: "数字员工调度失败，任务未完成" };
    }, taskPlans, connector);

    const run = await createTaskPlanRun(service, [agent]);
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");

    expect(taskPlans.command).toHaveBeenCalledOnce();
    expect(taskPlans.command).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "plan-fail-delegated-task",
        command: expect.objectContaining({
          action: "fail_current",
          statusReason: {
            code: "DIGITAL_EMPLOYEE_UNAVAILABLE",
            message: "employee unavailable",
          },
        }),
      }),
    );
    expect(currentPlan.status).toBe("FAILED");
    expect(currentPlan.tasks[0]?.status).toBe("FAILED");
    await service.dispose();
  });

  it("does not update task-plan status while restoring a callback delegation", async () => {
    let currentPlan: TaskPlanSnapshot = {
      ...taskPlanSnapshot("ACTIVE"),
      tasks: [
        {
          taskId: "task-1",
          position: 1,
          title: "等待数字员工回调",
          status: "IN_PROGRESS",
        },
      ],
    };
    const taskPlans: TaskPlanGateway = {
      loadActive: vi.fn(async () => currentPlan),
      command: vi.fn(async ({ command }) => {
        if (command.action !== "fail_current") {
          throw new Error("expected fail_current command");
        }
        const nextTasks = currentPlan.tasks.map((task) => ({
          ...task,
          status: "FAILED" as const,
          ...(command.statusReason ? { statusReason: command.statusReason } : {}),
        }));
        currentPlan = {
          ...currentPlan,
          version: currentPlan.version + 1,
          status: "FAILED",
          tasks: nextTasks,
        };
        return { ok: true, plan: currentPlan };
      }),
      cancel: vi.fn(async () => undefined),
    };
    let leaderAttempt = 0;
    const { service } = createTaskPlanService(async (input) => {
      leaderAttempt += 1;
      if (leaderAttempt === 1) {
        try {
          await input.delegate({
            agentId: agent.id,
            task: "异步执行数字员工任务",
          });
        } catch (error) {
          if (error instanceof DelegationSuspendedError) {
            throw new LeaderRunSuspendedError(error.delegationId);
          }
          throw error;
        }
        throw new Error("expected callback delegation to suspend");
      }
      expect(input.message).toContain("trusted platform callback");
      expect(taskPlans.command).not.toHaveBeenCalled();
      await input.updateTaskPlan!({
        toolCallId: "plan-fail-callback-task",
        command: {
          action: "fail_current",
          statusReason: {
            code: "DIGITAL_EMPLOYEE_UNAVAILABLE",
            message: "digital employee unavailable",
          },
        },
      });
      return { text: "数字员工失败，任务已收口" };
    }, taskPlans, fakeCallbackConnector());

    const run = await createTaskPlanRun(service, [agent]);
    await waitFor(async () => (await service.getRun(run.id))?.status === "WAITING_AGENT");
    const delegation = (await service.getRunDetails(run.id))?.delegations[0];
    expect(delegation).toMatchObject({ status: "RUNNING" });
    expect(delegation).not.toHaveProperty("taskPosition");

    await expect(
      service.resumeDelegation({
        delegationId: delegation!.id,
        status: "FAILED",
        finalAnswer: "digital employee unavailable",
      }),
    ).resolves.toMatchObject({ outcome: "run_resumed", runId: run.id });
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");

    expect(taskPlans.command).toHaveBeenCalledOnce();
    expect(taskPlans.command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        idempotencyKey: "plan-fail-callback-task",
        command: expect.objectContaining({
          action: "fail_current",
          statusReason: {
            code: "DIGITAL_EMPLOYEE_UNAVAILABLE",
            message: "digital employee unavailable",
          },
        }),
      }),
    );
    expect(currentPlan.status).toBe("FAILED");
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
      executionCredential: { secret: "lease-secret" },
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
      completionMode: "events",
      streaming: true,
      cancellation: true,
      artifacts: false,
      resumable: false,
      attachments: true,
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

function fakeCallbackConnector(resumeDelayMs = 0): AgentConnector {
  return {
    id: "fake",
    capabilities: {
      completionMode: "callback",
      streaming: false,
      cancellation: true,
      artifacts: false,
      resumable: true,
      attachments: true,
    },
    async start() {
      return {
        completionMode: "callback",
        ref: { connectorId: "fake", executionId: "external" },
        cancel: async () => undefined,
      };
    },
    async resume(ref) {
      if (resumeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, resumeDelayMs));
      }
      return {
        completionMode: "callback",
        ref,
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
