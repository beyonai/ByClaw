import { randomUUID } from "node:crypto";
import type { ConnectorExecution, ConnectorRequest } from "../ports/connectors.js";
import { ConnectorRegistry } from "../ports/connectors.js";
import type {
  DelegationRepository,
  RunEventStore,
  RunExecutionClaim,
} from "../ports/repositories.js";
import type {
  AgentProfile,
  AgentResult,
  ArtifactRef,
  Delegation,
  DelegationStatus,
  JsonValue,
  RunAttachment,
  Session,
  UserInteractionRequest,
  UserInteractionResponse,
} from "../domain/types.js";
import { TERMINAL_DELEGATION_STATUSES } from "../domain/types.js";

/** 表示 Leader 请求了本次 Run 授权快照之外的 Agent。 */
export class UnauthorizedAgentError extends Error {
  /** 保留非法 Agent ID，便于调用方定位模型产生的错误工具参数。 */
  constructor(agentId: string) {
    super(`Agent is not present in the authorized snapshot: ${agentId}`);
    this.name = "UnauthorizedAgentError";
  }
}

export interface ExecuteDelegationInput {
  session: Session;
  runId: string;
  agents: AgentProfile[];
  agentId: string;
  task: string;
  expectedOutput?: string;
  /** 本次委派选中的附件；由编排层从当前 Run 的附件集合按 ID 解析后注入。 */
  attachments?: readonly RunAttachment[];
  metadata: Record<string, unknown>;
  signal: AbortSignal;
  leaseClaim?: RunExecutionClaim;
  /** SYNTHESIZING 恢复时允许复用本 Run 已完成且参数相同的委派结果。 */
  reuseCompleted?: boolean;
  onInputRequired?(
    interactionId: string,
    request: UserInteractionRequest,
  ): Promise<void> | void;
  onInputResolved?(interactionId: string): Promise<void> | void;
}

type ActiveExecution = {
  execution: ConnectorExecution;
  cancelPromise?: Promise<void>;
};

type ActiveInteraction = {
  runId: string;
  respond(response: UserInteractionResponse): Promise<void>;
};

/**
 * 负责一次 Agent 委派从授权校验到终态落库的完整生命周期。
 * Connector 的传输细节会在这里被归一化，Leader 只看到统一的 AgentResult。
 */
export class DelegationService {
  readonly #active = new Map<string, Map<string, ActiveExecution>>();
  readonly #claims = new Map<string, RunExecutionClaim>();
  readonly #interactions = new Map<string, ActiveInteraction>();

  /** 注入 Connector 注册表、持久化 Port 以及可替换的时间和 ID 实现。 */
  constructor(
    private readonly connectors: ConnectorRegistry,
    private readonly delegations: DelegationRepository,
    private readonly events: RunEventStore,
    private readonly timeoutMs = 900_000,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
  ) {}

  /**
   * 执行一次委派，聚合流式输出并处理成功、失败、超时和上游取消。
   * 工具真正执行前会再次从 Run 的 Agent 快照中校验授权，防止模型越权。
   */
  async execute(input: ExecuteDelegationInput): Promise<AgentResult> {
    // AbortSignal 不会为“注册监听前已经发生”的取消补发事件。先在任何持久化或
    // Connector 投递之前拒绝，避免已停止的 Run 仍创建并启动新委派。
    input.signal.throwIfAborted();
    const agent = input.agents.find((candidate) => candidate.id === input.agentId);
    if (!agent) {
      throw new UnauthorizedAgentError(input.agentId);
    }

    const connector = this.connectors.require(agent.execution.connectorId);
    if (
      input.attachments &&
      input.attachments.length > 0 &&
      !connector.capabilities.attachments
    ) {
      // 连接器不支持附件时明确报错，绝不静默降级为纯文本委派。
      throw new Error(
        `ATTACHMENTS_UNSUPPORTED: connector ${connector.id} cannot forward attachments`,
      );
    }
    const historical = await this.delegations.listByRun(input.runId);
    input.signal.throwIfAborted();
    if (input.reuseCompleted) {
      const completed = historical
        .slice()
        .reverse()
        .find(
          (candidate) =>
            candidate.status === "COMPLETED" &&
            candidate.result &&
            candidate.agentId === agent.id &&
            candidate.task === input.task &&
            candidate.expectedOutput === input.expectedOutput,
        );
      if (completed?.result) {
        return structuredClone(completed.result);
      }
    }
    if (input.leaseClaim) {
      this.#claims.set(input.runId, input.leaseClaim);
    }
    const existing = historical
      .reverse()
      .find(
        (candidate) =>
          !TERMINAL_DELEGATION_STATUSES.has(candidate.status) &&
          candidate.agentId === agent.id &&
          candidate.task === input.task &&
          candidate.expectedOutput === input.expectedOutput,
      );
    const delegationId = existing?.id ?? this.createId();
    const resuming = Boolean(existing?.externalRef);
    let delegation: Delegation =
      existing ?? {
        id: delegationId,
        runId: input.runId,
        agentId: agent.id,
        agentName: agent.name,
        connectorId: connector.id,
        task: input.task,
        ...(input.expectedOutput ? { expectedOutput: input.expectedOutput } : {}),
        status: "QUEUED",
        version: 0,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
    if (!existing) {
      try {
        await this.#saveDelegationWithEvent(delegation, {
          timestamp: this.now(),
          runId: input.runId,
          type: "delegation.started",
          data: {
            delegationId,
            agentId: agent.id,
            agentName: agent.name,
            connectorId: connector.id,
            task: input.task,
            ...(input.expectedOutput
              ? { expectedOutput: input.expectedOutput }
              : {}),
            ...(input.attachments?.length
              ? {
                  attachments: input.attachments.map((attachment) => ({
                    id: attachment.id,
                    name: attachment.name,
                    ...(attachment.mediaType
                      ? { mediaType: attachment.mediaType }
                      : {}),
                  })),
                }
              : {}),
          },
        });
      } catch (error) {
        if (this.#claims.get(input.runId) === input.leaseClaim) {
          this.#claims.delete(input.runId);
        }
        throw error;
      }
    }

    // list/save 期间也可能发生取消。此时委派记录已经存在，但尚未向外部系统
    // 投递；直接收敛为 CANCELLED，不能继续调用 Connector。
    if (input.signal.aborted) {
      try {
        return await this.#finishAborted(delegation, false);
      } finally {
        if (this.#claims.get(input.runId) === input.leaseClaim) {
          this.#claims.delete(input.runId);
        }
      }
    }

    const controller = new AbortController();
    let timedOut = false;
    let execution: ConnectorExecution | undefined;
    // 将 Run 或工具级取消转发到当前委派的独立控制器。
    const forwardAbort = () => controller.abort(input.signal.reason);
    input.signal.addEventListener("abort", forwardAbort, { once: true });
    // 关闭检查 aborted 与注册监听之间的竞态窗口。
    if (input.signal.aborted) {
      forwardAbort();
    }
    // 外部执行超时不包含等待用户作答的时间；恢复输入后重新开始计时。
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`Delegation timed out after ${this.timeoutMs}ms`));
        if (execution) {
          void this.#cancelExecution(
            input.runId,
            delegationId,
            execution,
            "delegation timeout",
          ).catch(() => undefined);
        }
      }, this.timeoutMs);
    };
    const pauseTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
    };
    armTimeout();

    try {
      if (controller.signal.aborted) {
        return await this.#finishAborted(delegation, false);
      }
      if (resuming) {
        if (!connector.resume || !delegation.externalRef) {
          throw new Error(`Connector does not support persisted resume: ${connector.id}`);
        }
        execution = await connector.resume(delegation.externalRef, {
          signal: controller.signal,
          metadata: input.metadata,
          ...(delegation.connectorCursor
            ? { cursor: delegation.connectorCursor }
            : {}),
        });
      } else {
        const externalSessionId = optionalMetadataString(input.metadata, "externalSessionId");
        const parentMessageId = optionalMetadataString(input.metadata, "parentMessageId");
        const request: ConnectorRequest = {
          userCode: input.session.owner.userCode,
          ...(input.session.owner.userName ? { userName: input.session.owner.userName } : {}),
          sessionId: input.session.id,
          runId: input.runId,
          delegationId,
          agent,
          task: input.task,
          attachments: [...(input.attachments ?? [])],
          ...(input.expectedOutput ? { expectedOutput: input.expectedOutput } : {}),
          ...(externalSessionId ? { externalSessionId } : {}),
          ...(parentMessageId ? { parentMessageId } : {}),
          metadata: input.metadata,
        };
        execution = await connector.start(request, { signal: controller.signal });
      }
      // Connector 一旦返回便立即纳入 Run 级取消，避免 externalRef 落库期间出现取消盲区。
      this.#track(input.runId, delegationId, execution);
      if (controller.signal.aborted) {
        await this.#cancelExecution(
          input.runId,
          delegationId,
          execution,
          timedOut ? "delegation timeout" : "run cancelled",
        );
        return await this.#finishAborted(delegation, timedOut);
      }

      if (!resuming) {
        delegation = {
          ...delegation,
          status: "RUNNING",
          version: delegation.version + 1,
          externalRef: execution.ref,
          startedAt: this.now(),
          updatedAt: this.now(),
        };
        await this.#saveDelegation(delegation);
      }
      let output = delegation.partialOutput ?? "";
      const artifacts: ArtifactRef[] = [];
      let pendingInteractionId: string | undefined;
      const registerInteraction = async (
        interactionId: string,
        request: UserInteractionRequest,
        resumeToken: Record<string, JsonValue> | undefined,
        requestedEventId: number,
      ) => {
        pendingInteractionId = interactionId;
        pauseTimeout();
        await input.onInputRequired?.(interactionId, request);
        this.#interactions.set(interactionId, {
          runId: input.runId,
          respond: async (response) => {
            if (!execution?.respondToInput) {
              throw new Error(`Connector does not support user-input resume: ${connector.id}`);
            }
            await execution.respondToInput(interactionId, response, resumeToken);
            pendingInteractionId = undefined;
            delegation = {
              ...delegation,
              status: "RUNNING",
              version: delegation.version + 1,
              updatedAt: this.now(),
            };
            await this.#saveDelegation(delegation);
            armTimeout();
            await input.onInputResolved?.(interactionId);
          },
        });
        void this.#waitForInteractionResponse(
          input.runId,
          interactionId,
          requestedEventId,
          controller.signal,
        )
          .then(async (response) => {
            const active = this.#interactions.get(interactionId);
            if (active?.runId !== input.runId) {
              return;
            }
            this.#interactions.delete(interactionId);
            await active.respond(response);
          })
          .catch(() => undefined);
      };

      if (resuming && delegation.status === "WAITING_USER") {
        const interactionHistory = await this.events.list(input.runId);
        const requested = interactionHistory
          .slice()
          .reverse()
          .find(
            (candidate) =>
              candidate.type === "interaction.requested" &&
              candidate.data.delegationId === delegationId,
          );
        if (requested) {
          const interactionId = String(requested.data.interactionId);
          const request = interactionRequestFromEvent(requested.data.request);
          const resumeToken = jsonRecord(requested.data.resumeToken);
          await registerInteraction(
            interactionId,
            request,
            resumeToken,
            requested.eventId,
          );
        }
      }

      for await (const event of execution.events) {
        if (controller.signal.aborted) {
          return await this.#finishAborted(delegation, timedOut);
        }
        if (pendingInteractionId && event.type !== "input_required") {
          const interactionId = pendingInteractionId;
          pendingInteractionId = undefined;
          this.#interactions.delete(interactionId);
          delegation = {
            ...delegation,
            status: "RUNNING",
            version: delegation.version + 1,
            updatedAt: this.now(),
          };
          await this.#saveDelegation(delegation);
          await this.#appendEvent({
            timestamp: this.now(),
            runId: input.runId,
            type: "interaction.responded",
            data: {
              interactionId,
              delegationId,
              action: "submit",
              responseSource: "external_resume",
            },
          });
          await input.onInputResolved?.(interactionId);
        }
        if (event.type === "input_required") {
          delegation = {
            ...delegation,
            status: "WAITING_USER",
            ...(event.cursor ? { connectorCursor: event.cursor } : {}),
            version: delegation.version + 1,
            updatedAt: this.now(),
          };
          const requestedEvent = await this.#saveDelegationWithEvent(delegation, {
            timestamp: this.now(),
            runId: input.runId,
            type: "interaction.requested",
            data: {
              interactionId: event.interactionId,
              delegationId,
              source: "by-framework",
              request: event.request as unknown as JsonValue,
              ...(event.resumeToken
                ? { resumeToken: event.resumeToken as unknown as JsonValue }
                : {}),
            },
          });
          await registerInteraction(
            event.interactionId,
            event.request,
            event.resumeToken,
            requestedEvent.eventId,
          );
          continue;
        }
        if (event.type === "output_delta") {
          output += event.text;
          delegation = await this.#checkpointProgressWithEvent(
            delegation,
            output,
            event.cursor,
            {
              timestamp: this.now(),
              runId: input.runId,
              type: "delegation.output.delta",
              data: {
                delegationId,
                agentId: agent.id,
                agentName: agent.name,
                text: event.text,
              },
            },
          );
          continue;
        }
        if (event.type === "artifact") {
          artifacts.push(event.artifact);
          delegation = await this.#checkpointProgress(
            delegation,
            output,
            event.cursor,
          );
          continue;
        }
        if (event.type === "progress") {
          delegation = await this.#checkpointProgress(
            delegation,
            output,
            event.cursor,
          );
          await this.#appendEvent({
            timestamp: this.now(),
            runId: input.runId,
            type: "delegation.progress",
            data: { delegationId, agentId: agent.id, message: event.message },
          });
          continue;
        }
        if (event.type === "completed") {
          const completedOutput = event.result.output || output;
          if (!output && completedOutput) {
            // 某些 Connector 只在终态给出完整答案，没有流式 output_delta。
            // 将终态正文补成持久 delta，保证所有子 Agent 输出都能独立通过 SSE 展示。
            output = completedOutput;
            delegation = await this.#checkpointProgressWithEvent(
              delegation,
              output,
              event.cursor,
              {
                timestamp: this.now(),
                runId: input.runId,
                type: "delegation.output.delta",
                data: {
                  delegationId,
                  agentId: agent.id,
                  agentName: agent.name,
                  text: completedOutput,
                },
              },
            );
          } else {
            delegation = await this.#checkpointProgress(
              delegation,
              output,
              event.cursor,
            );
          }
          const result: AgentResult = {
            ...event.result,
            // 累计输出包含崩溃前 partialOutput 和恢复后的尾段；终态结果可能只含尾段。
            output: output || event.result.output,
            artifacts: event.result.artifacts.length > 0 ? event.result.artifacts : artifacts,
          };
          await this.#finish(delegation, "COMPLETED", result);
          return result;
        }
        const eventTimedOut = event.error.timedOut === true;
        const result: AgentResult = {
          status: eventTimedOut ? "timed_out" : "failed",
          output,
          artifacts,
          error: event.error.message,
        };
        await this.#finish(
          delegation,
          eventTimedOut ? "TIMED_OUT" : "FAILED",
          result,
        );
        return result;
      }

      const result: AgentResult = {
        status: "failed",
        output,
        artifacts,
        error: "Connector event stream ended without a terminal event",
      };
      await this.#finish(delegation, "FAILED", result);
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        if (execution) {
          await this.#cancelExecution(
            input.runId,
            delegationId,
            execution,
            timedOut ? "delegation timeout" : "run cancelled",
          );
        }
        return await this.#finishAborted(delegation, timedOut);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (execution) {
        // externalRef/cursor 无法可靠持久化时停止外部任务，避免留下无人接管的执行。
        await this.#cancelExecution(
          input.runId,
          delegationId,
          execution,
          "delegation persistence or stream failed",
        ).catch(() => undefined);
      }
      // 保存 externalRef 或 cursor 失败时，本地 version 可能领先数据库；以真相源版本收敛终态。
      delegation = (await this.delegations.get(delegationId)) ?? delegation;
      if (
        TERMINAL_DELEGATION_STATUSES.has(delegation.status) &&
        delegation.result
      ) {
        return structuredClone(delegation.result);
      }
      const result: AgentResult = {
        status: "failed",
        output: delegation.partialOutput ?? "",
        artifacts: [],
        error: message,
      };
      await this.#finish(delegation, "FAILED", result);
      return result;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      input.signal.removeEventListener("abort", forwardAbort);
      this.#untrack(input.runId, delegationId);
      for (const [interactionId, interaction] of this.#interactions) {
        if (interaction.runId === input.runId) {
          this.#interactions.delete(interactionId);
        }
      }
      if (this.#claims.get(input.runId) === input.leaseClaim) {
        this.#claims.delete(input.runId);
      }
    }
  }

  /** 响应一个由 Connector 发起且仍在等待的用户交互。 */
  async respondToInteraction(
    runId: string,
    interactionId: string,
    response: UserInteractionResponse,
  ): Promise<boolean> {
    const history = await this.events.list(runId);
    const requested = history
      .slice()
      .reverse()
      .find(
        (event) =>
          event.type === "interaction.requested" &&
          event.data.interactionId === interactionId &&
          typeof event.data.delegationId === "string",
      );
    const alreadyResponded = history.some(
      (event) =>
        event.type === "interaction.responded" &&
        event.data.interactionId === interactionId &&
        (!requested || event.eventId > requested.eventId),
    );
    if (!requested || alreadyResponded) {
      return false;
    }
    await this.#appendEvent({
      timestamp: this.now(),
      runId,
      type: "interaction.responded",
      data: {
        interactionId,
        delegationId: String(requested.data.delegationId),
        action: response.action,
        ...(response.answers ? { answers: response.answers } : {}),
        ...(response.text ? { text: response.text } : {}),
      },
    });
    const active = this.#interactions.get(interactionId);
    if (active?.runId === runId) {
      this.#interactions.delete(interactionId);
      await active.respond(response);
    }
    return true;
  }

  async #waitForInteractionResponse(
    runId: string,
    interactionId: string,
    afterEventId: number,
    signal: AbortSignal,
  ): Promise<UserInteractionResponse> {
    for await (const event of this.events.stream(runId, afterEventId, signal)) {
      if (
        event.type === "interaction.responded" &&
        event.data.interactionId === interactionId
      ) {
        return responseFromEvent(event.data);
      }
    }
    throw new Error(`Interaction event stream ended: ${interactionId}`);
  }

  /** 每确认一个 Connector cursor 就保存累计输出，resume 后不会重复或丢失前缀。 */
  async #checkpointProgress(
    delegation: Delegation,
    partialOutput: string,
    cursor: string | undefined,
  ): Promise<Delegation> {
    if (!cursor && partialOutput === (delegation.partialOutput ?? "")) {
      return delegation;
    }
    const updated: Delegation = {
      ...delegation,
      partialOutput,
      ...(cursor ? { connectorCursor: cursor } : {}),
      version: delegation.version + 1,
      updatedAt: this.now(),
    };
    await this.#saveDelegation(updated);
    return updated;
  }

  /**
   * 原子保存累计输出/cursor 与本次文本增量事件，使 SSE 回放和 Connector resume
   * 使用同一个数据库提交边界。
   */
  async #checkpointProgressWithEvent(
    delegation: Delegation,
    partialOutput: string,
    cursor: string | undefined,
    event: Parameters<RunEventStore["append"]>[0],
  ): Promise<Delegation> {
    const updated: Delegation = {
      ...delegation,
      partialOutput,
      ...(cursor ? { connectorCursor: cursor } : {}),
      version: delegation.version + 1,
      updatedAt: this.now(),
    };
    await this.#saveDelegationWithEvent(updated, event);
    return updated;
  }

  /** 取消指定 Run 当前所有活动委派；全部尝试后统一报告未能停止的外部执行。 */
  async cancelRun(runId: string, reason = "run cancelled"): Promise<void> {
    const activeById = this.#active.get(runId) ?? new Map<string, ActiveExecution>();
    const active = [...activeById.entries()];
    const persisted = await this.delegations.listByRun(runId);
    const recoverable = persisted.filter(
      (delegation) =>
        !TERMINAL_DELEGATION_STATUSES.has(delegation.status) &&
        delegation.externalRef &&
        !activeById.has(delegation.id),
    );
    const results = await Promise.allSettled(
      [
        ...active.map(([delegationId, item]) =>
          this.#cancelExecution(runId, delegationId, item.execution, reason),
        ),
        ...recoverable.map(async (delegation) => {
          const connector = this.connectors.require(delegation.connectorId);
          if (!connector.resume || !delegation.externalRef) {
            throw new Error(
              `Connector cannot resume persisted cancellation: ${delegation.connectorId}`,
            );
          }
          const execution = await connector.resume(delegation.externalRef, {
            signal: new AbortController().signal,
            ...(delegation.connectorCursor
              ? { cursor: delegation.connectorCursor }
              : {}),
          });
          this.#track(runId, delegation.id, execution);
          try {
            await this.#cancelExecution(
              runId,
              delegation.id,
              execution,
              reason,
            );
          } finally {
            this.#untrack(runId, delegation.id);
          }
        }),
      ],
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to cancel ${failures.length} active delegation(s) for Run ${runId}`,
      );
    }
  }

  /** 记录活动 Connector 执行，供 Run 级取消统一查找。 */
  #track(runId: string, delegationId: string, execution: ConnectorExecution): void {
    const items = this.#active.get(runId) ?? new Map<string, ActiveExecution>();
    items.set(delegationId, { execution });
    this.#active.set(runId, items);
  }

  /** 从活动表中移除已经结束的委派，并清理空的 Run 分组。 */
  #untrack(runId: string, delegationId: string): void {
    const items = this.#active.get(runId);
    items?.delete(delegationId);
    if (items?.size === 0) {
      this.#active.delete(runId);
    }
  }

  /**
   * 幂等地触发 Connector 取消；并发取消请求共享同一个 Promise，避免重复调用外部系统。
   */
  async #cancelExecution(
    runId: string,
    delegationId: string,
    execution: ConnectorExecution,
    reason: string,
  ): Promise<void> {
    const item = this.#active.get(runId)?.get(delegationId);
    if (item?.cancelPromise) {
      return item.cancelPromise;
    }
    const promise = execution.cancel(reason);
    if (item) {
      item.cancelPromise = promise;
    }
    try {
      await promise;
    } catch (error) {
      if (item?.cancelPromise === promise) {
        delete item.cancelPromise;
      }
      throw error;
    }
  }

  /** 将 AbortSignal 的中止原因转换为取消或超时结果，并统一完成委派。 */
  async #finishAborted(
    delegation: Delegation,
    timedOut: boolean,
  ): Promise<AgentResult> {
    const result: AgentResult = {
      status: timedOut ? "timed_out" : "cancelled",
      output: delegation.partialOutput ?? "",
      artifacts: [],
      error: timedOut ? `Delegation timed out after ${this.timeoutMs}ms` : "Delegation cancelled",
    };
    await this.#finish(delegation, timedOut ? "TIMED_OUT" : "CANCELLED", result);
    return result;
  }

  /** 保存委派终态并写入面向上层的简化事件，不暴露 Connector 原始推理内容。 */
  async #finish(
    delegation: Delegation,
    status: DelegationStatus,
    result: AgentResult,
  ): Promise<void> {
    const finished: Delegation = {
      ...delegation,
      status,
      version: delegation.version + 1,
      result,
      ...(result.error ? { error: result.error } : {}),
      updatedAt: this.now(),
      finishedAt: this.now(),
    };
    await this.#saveDelegationWithEvent(finished, {
      timestamp: this.now(),
      runId: delegation.runId,
      type: status === "COMPLETED" ? "delegation.completed" : "delegation.failed",
      data: {
        delegationId: delegation.id,
        agentId: delegation.agentId,
        ...(delegation.agentName ? { agentName: delegation.agentName } : {}),
        status,
        artifactCount: result.artifacts.length,
        resultStatus: result.status,
        ...(result.error ? { error: result.error } : {}),
      },
    });
  }

  /** 持久化实现将委派快照与事件放在同一事务，内存实现保持简单回退。 */
  async #saveDelegationWithEvent(
    delegation: Delegation,
    event: Parameters<RunEventStore["append"]>[0],
  ): Promise<import("../domain/types.js").RunEvent> {
    const claim = this.#claims.get(delegation.runId);
    if (this.delegations.saveWithEvent) {
      return this.delegations.saveWithEvent(delegation, event, claim);
    }
    await this.delegations.save(delegation, claim);
    return this.#appendEvent(event);
  }

  async #saveDelegation(delegation: Delegation): Promise<void> {
    await this.delegations.save(
      delegation,
      this.#claims.get(delegation.runId),
    );
  }

  async #appendEvent(
    event: Parameters<RunEventStore["append"]>[0],
  ): Promise<import("../domain/types.js").RunEvent> {
    const claim = this.#claims.get(event.runId);
    if (claim && this.events.appendForClaim) {
      return this.events.appendForClaim(event, claim);
    }
    return this.events.append(event);
  }
}

function responseFromEvent(
  data: Record<string, JsonValue>,
): UserInteractionResponse {
  const action =
    data.action === "skip" || data.action === "cancel" ? data.action : "submit";
  const answers =
    data.answers && typeof data.answers === "object" && !Array.isArray(data.answers)
      ? data.answers
      : undefined;
  return {
    action,
    ...(answers ? { answers } : {}),
    ...(typeof data.text === "string" ? { text: data.text } : {}),
  };
}

function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function interactionRequestFromEvent(value: JsonValue | undefined): UserInteractionRequest {
  const request = jsonRecord(value);
  if (!request) {
    throw new Error("Persisted interaction request is invalid");
  }
  return request as unknown as UserInteractionRequest;
}

/** 从 Run 级 ephemeral metadata 读出非空字符串值（externalSessionId 随 Beyond-Token 同路径透传）。 */
function optionalMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
