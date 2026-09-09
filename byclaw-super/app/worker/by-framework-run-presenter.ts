import type { RunEvent } from "@byclaw/by-conductor";
import {
  EventType,
  type GatewayDataEmitter,
  SseReasonMessageType,
  type AgentContext,
} from "@byclaw/by-framework";
import {
  agentReadyTitle,
  delegationFailureUserMessage,
  protocolMessage,
  recordValue,
  stringData,
} from "./by-framework-protocol.js";

export type WorkerProtocolEmitter = Pick<GatewayDataEmitter, "emitChunk" | "emitEvent">;

/**
 * 只负责 BY_SUPER 自己拥有的前端消息：就绪/思考、Delegation 状态卡和用户交互。
 * 子 Agent 的思考、工具和正文由子 Agent 直接写入消息流，本类不做二次投影。
 */
export class ByFrameworkRunPresenter {
  readonly #agentType: string;
  readonly #emitter: WorkerProtocolEmitter;

  constructor(agentType: string, emitter: WorkerProtocolEmitter) {
    this.#agentType = agentType;
    this.#emitter = emitter;
  }

  /** 初次执行中，这些事件需要打开 Super 的思考区域。Resume 更新不重新打开。 */
  opensReasoning(event: RunEvent): boolean {
    return event.type === "delegation.started" || isLeaderInteraction(event);
  }

  /** 映射 Super 负责的结构化事件；其余子 Agent 活动一律忽略。 */
  async forwardOwnedEvent(event: RunEvent, context: AgentContext): Promise<void> {
    if (event.type === "delegation.started") {
      await this.#emitDelegationStatus(event, context, "_START_");
      return;
    }
    if (event.type === "delegation.completed") {
      await this.#emitDelegationStatus(event, context, "_DONE_");
      return;
    }
    if (event.type === "delegation.failed") {
      await this.#emitDelegationStatus(event, context, "_ERROR_");
      return;
    }
    if (isLeaderInteraction(event)) {
      await this.#emitInteraction(event, context);
    }
  }

  async emitReadyTitle(
    runId: string,
    context: AgentContext,
    agentName: string,
    locale?: string,
  ): Promise<void> {
    await this.#emitter.emitChunk(
      context.sessionId,
      context.traceId,
      agentReadyTitle(agentName, locale),
      {
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: SseReasonMessageType.think_title,
        sourceAgentType: this.#agentType,
        messageId: `${runId}:ready`,
        parentMessageId: "-1",
        metadata: { parent_run_id: runId },
      },
    );
  }

  async emitReasoning(
    runId: string,
    context: AgentContext,
    messageId: string,
    content: string,
    eventType: EventType,
  ): Promise<void> {
    await this.#emitter.emitChunk(context.sessionId, context.traceId, content, {
      eventType,
      contentType: SseReasonMessageType.think_text,
      sourceAgentType: this.#agentType,
      messageId,
      parentMessageId: "-1",
      metadata: { parent_run_id: runId },
    });
  }

  async #emitDelegationStatus(
    event: RunEvent,
    context: AgentContext,
    status: "_START_" | "_DONE_" | "_ERROR_",
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    if (!delegationId) {
      return;
    }
    const agentId = stringData(event.data.agentId);
    const agentName = stringData(event.data.agentName);
    const displayName = agentName || agentId;
    const displayPrefix = displayName ? `${displayName} ` : "";
    const failureReason = stringData(event.data.error);
    const failureStage = stringData(event.data.failureStage);
    const content =
      status === "_START_"
        ? `${displayPrefix}数字员工正在处理`
        : status === "_DONE_"
          ? `${displayPrefix}数字员工处理完成`
          : delegationFailureUserMessage({
              agentName,
              agentId,
              reason: failureReason,
              stage: failureStage,
            });

    await this.#emitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId: delegationId,
      parentMessageId: "-1",
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content,
        contentType: "3009",
        orderId: delegationId,
        parentOrderId: "-1",
        objectType: "tool_call",
        status,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
        ...(agentId ? { delegated_agent_id: agentId } : {}),
        ...(agentName ? { delegated_agent_name: agentName } : {}),
      },
    });

    if (status === "_START_") {
      await this.#emitDelegationInput(event, context, delegationId, agentId, agentName);
    }
  }

  /** 把调度参数作为根状态卡的静态子节点展示，避免改变原有 Delegation 树的生命周期语义。 */
  async #emitDelegationInput(
    event: RunEvent,
    context: AgentContext,
    delegationId: string,
    agentId: string,
    agentName: string,
  ): Promise<void> {
    const task = stringData(event.data.task);
    const expectedOutput = stringData(event.data.expectedOutput);
    const attachments = delegationAttachments(event.data.attachments);
    const displayName = agentName || agentId;
    const messageId = `${delegationId}:dispatch-input`;
    const card = {
      title: "发送给数字员工的指令",
      ...(displayName ? { description: `目标：${displayName}` } : {}),
      input: {
        ...(agentId ? { agentId } : {}),
        ...(agentName ? { agentName } : {}),
        ...(task ? { instruction: task } : {}),
        ...(expectedOutput ? { expectedOutput } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      status: "_DONE_",
    };

    await this.#emitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId,
      parentMessageId: delegationId,
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content: JSON.stringify(card),
        contentType: "3015",
        orderId: messageId,
        parentOrderId: delegationId,
        objectType: "tool_call",
        status: "_DONE_",
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
        delegation_input: true,
        ...(agentId ? { delegated_agent_id: agentId } : {}),
        ...(agentName ? { delegated_agent_name: agentName } : {}),
      },
    });
  }

  /** Super 自己发起的用户交互仍由 Super 展示；子 Agent 交互由子 Agent 自己发送。 */
  async #emitInteraction(event: RunEvent, context: AgentContext): Promise<void> {
    const interactionId = stringData(event.data.interactionId);
    const request = recordValue(event.data.request);
    const questions = Array.isArray(request?.questions) ? request.questions : [];

    await this.#emitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId: interactionId,
      parentMessageId: "-1",
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content: JSON.stringify({ questions }),
        contentType: "3014",
        orderId: interactionId,
        parentOrderId: "-1",
        role: "assistant",
      }),
      metadata: {
        parent_run_id: event.runId,
        interaction_id: interactionId,
        questions,
        tool_name: "AskUserQuestion",
      },
    });
  }
}

/** 只把已持久化的附件展示字段带入调度卡，不暴露路径、URL 或传输元数据。 */
function delegationAttachments(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const attachment = recordValue(item);
    if (!attachment) {
      return [];
    }
    const id = stringData(attachment.id);
    const name = stringData(attachment.name);
    const mediaType = stringData(attachment.mediaType);
    if (!id && !name && !mediaType) {
      return [];
    }
    return [
      {
        ...(id ? { id } : {}),
        ...(name ? { name } : {}),
        ...(mediaType ? { mediaType } : {}),
      },
    ];
  });
}

function isLeaderInteraction(event: RunEvent): boolean {
  return event.type === "interaction.requested" && stringData(event.data.source) === "leader";
}
