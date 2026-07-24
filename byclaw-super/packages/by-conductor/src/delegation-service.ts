import { randomUUID } from "node:crypto";
import type { ConnectorExecution, ConnectorRequest } from "./connectors.js";
import { ConnectorRegistry } from "./connectors.js";
import type {
  DelegationRepository,
  RunEventStore,
  RunExecutionClaim,
} from "./repositories.js";
import type {
  AgentProfile,
  AgentResult,
  ArtifactRef,
  Delegation,
  DelegationStatus,
  Session,
} from "./types.js";
import { TERMINAL_DELEGATION_STATUSES } from "./types.js";

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
  metadata: Record<string, unknown>;
  signal: AbortSignal;
  leaseClaim?: RunExecutionClaim;
  /** SYNTHESIZING 恢复时允许复用本 Run 已完成且参数相同的委派结果。 */
  reuseCompleted?: boolean;
}

type ActiveExecution = {
  execution: ConnectorExecution;
  cancelPromise?: Promise<void>;
};

/**
 * 负责一次 Agent 委派从授权校验到终态落库的完整生命周期。
 * Connector 的传输细节会在这里被归一化，Leader 只看到统一的 AgentResult。
 */
export class DelegationService {
  readonly #active = new Map<string, Map<string, ActiveExecution>>();
  readonly #claims = new Map<string, RunExecutionClaim>();

  /** 注入 Connector 注册表、持久化 Port 以及可替换的时间和 ID 实现。 */
  constructor(
    private readonly connectors: ConnectorRegistry,
    private readonly delegations: DelegationRepository,
    private readonly events: RunEventStore,
    private readonly timeoutMs = 1_800_000,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
  ) {}

  /**
   * 执行一次委派，聚合流式输出并处理成功、失败、超时和上游取消。
   * 工具真正执行前会再次从 Run 的 Agent 快照中校验授权，防止模型越权。
   */
  async execute(input: ExecuteDelegationInput): Promise<AgentResult> {
    const agent = input.agents.find((candidate) => candidate.id === input.agentId);
    if (!agent) {
      throw new UnauthorizedAgentError(input.agentId);
    }

    const connector = this.connectors.require(agent.execution.connectorId);
    const historical = await this.delegations.listByRun(input.runId);
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
          },
        });
      } catch (error) {
        if (this.#claims.get(input.runId) === input.leaseClaim) {
          this.#claims.delete(input.runId);
        }
        throw error;
      }
    }

    const controller = new AbortController();
    let timedOut = false;
    let execution: ConnectorExecution | undefined;
    // 将 Run 或工具级取消转发到当前委派的独立控制器。
    const forwardAbort = () => controller.abort(input.signal.reason);
    input.signal.addEventListener("abort", forwardAbort, { once: true });
    // 超时与用户取消共用 AbortSignal，但保留 timedOut 以生成准确终态。
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Delegation timed out after ${this.timeoutMs}ms`));
      if (execution) {
        void this.#cancelExecution(input.runId, delegationId, execution, "delegation timeout");
      }
    }, this.timeoutMs);

    try {
      if (resuming) {
        if (!connector.resume || !delegation.externalRef) {
          throw new Error(`Connector does not support persisted resume: ${connector.id}`);
        }
        execution = await connector.resume(delegation.externalRef, {
          signal: controller.signal,
          ...(delegation.connectorCursor
            ? { cursor: delegation.connectorCursor }
            : {}),
        });
      } else {
        const request: ConnectorRequest = {
          userCode: input.session.owner.userCode,
          ...(input.session.owner.userName ? { userName: input.session.owner.userName } : {}),
          sessionId: input.session.id,
          runId: input.runId,
          delegationId,
          agent,
          task: input.task,
          ...(input.expectedOutput ? { expectedOutput: input.expectedOutput } : {}),
          metadata: input.metadata,
        };
        execution = await connector.start(request, { signal: controller.signal });
      }
      if (controller.signal.aborted) {
        await execution.cancel(timedOut ? "delegation timeout" : "run cancelled");
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
      this.#track(input.runId, delegationId, execution);

      let output = delegation.partialOutput ?? "";
      const artifacts: ArtifactRef[] = [];
      for await (const event of execution.events) {
        if (controller.signal.aborted) {
          return await this.#finishAborted(delegation, timedOut);
        }
        if (event.type === "output_delta") {
          output += event.text;
          delegation = await this.#checkpointProgress(
            delegation,
            output,
            event.cursor,
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
          delegation = await this.#checkpointProgress(
            delegation,
            output,
            event.cursor,
          );
          const result: AgentResult = {
            ...event.result,
            output: output || event.result.output,
            artifacts: event.result.artifacts.length > 0 ? event.result.artifacts : artifacts,
          };
          await this.#finish(delegation, "COMPLETED", result);
          return result;
        }
        const result: AgentResult = {
          status: "failed",
          output,
          artifacts,
          error: event.error.message,
        };
        await this.#finish(delegation, "FAILED", result);
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
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", forwardAbort);
      this.#untrack(input.runId, delegationId);
      if (this.#claims.get(input.runId) === input.leaseClaim) {
        this.#claims.delete(input.runId);
      }
    }
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

  /** 取消指定 Run 当前所有活动委派；单个取消失败不会阻止其他委派被取消。 */
  async cancelRun(runId: string, reason = "run cancelled"): Promise<void> {
    const active = [...(this.#active.get(runId)?.entries() ?? [])];
    await Promise.allSettled(
      active.map(([delegationId, item]) =>
        this.#cancelExecution(runId, delegationId, item.execution, reason),
      ),
    );
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
    await promise;
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
        status,
        ...(result.error ? { error: result.error } : {}),
      },
    });
  }

  /** 持久化实现将委派快照与事件放在同一事务，内存实现保持简单回退。 */
  async #saveDelegationWithEvent(
    delegation: Delegation,
    event: Parameters<RunEventStore["append"]>[0],
  ): Promise<void> {
    const claim = this.#claims.get(delegation.runId);
    if (this.delegations.saveWithEvent) {
      await this.delegations.saveWithEvent(delegation, event, claim);
      return;
    }
    await this.delegations.save(delegation, claim);
    await this.#appendEvent(event);
  }

  async #saveDelegation(delegation: Delegation): Promise<void> {
    await this.delegations.save(
      delegation,
      this.#claims.get(delegation.runId),
    );
  }

  async #appendEvent(
    event: Parameters<RunEventStore["append"]>[0],
  ): Promise<void> {
    const claim = this.#claims.get(event.runId);
    if (claim && this.events.appendForClaim) {
      await this.events.appendForClaim(event, claim);
      return;
    }
    await this.events.append(event);
  }
}
