import {
  ActionType,
  EventType,
  GatewayClient,
  QueueNames,
  WorkerRegistry,
  createRedis,
  type RedisConnectionConfig,
  type SendMessageParams,
} from "@byclaw/by-framework";
import type {
  AgentConnector,
  AgentResult,
  ConnectorCapabilities,
  ConnectorEvent,
  ConnectorExecution,
  ConnectorHealth,
  ConnectorRequest,
  ExternalExecutionRef,
  JsonValue,
  RunAttachment,
  UserInteractionResponse,
} from "@byclaw/by-conductor";
import {
  abortError,
  extractContent,
  extractError,
  extractUserInput,
  jsonString,
  parseDataMessage,
  parseXreadRows,
  refString,
  stringMetadata,
} from "./by-framework-codec.js";

export const OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID = "openclaw-by-framework";

type RedisClient = ReturnType<typeof createRedis>;
type GatewayClientLike = Pick<GatewayClient, "sendMessage" | "cancelTask">;

export interface OpenClawConnectorOptions {
  redisOptions?: RedisConnectionConfig;
  redis?: RedisClient;
  gatewayClient?: GatewayClientLike;
  readBlockMs?: number;
  sourceAgentType?: string;
}

/**
 * 通过 by-framework Gateway/Redis 协议连接 OpenClaw Worker。
 * 该类只负责传输适配，授权、超时和业务状态由 by-conductor 处理。
 */
export class OpenClawByFrameworkConnector implements AgentConnector {
  readonly id = OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID;
  readonly capabilities: ConnectorCapabilities = {
    streaming: true,
    cancellation: true,
    artifacts: false,
    resumable: true,
    attachments: true,
  };

  readonly #redis: RedisClient;
  readonly #client: GatewayClientLike;
  readonly #ownsRedis: boolean;
  readonly #readBlockMs: number;
  readonly #sourceAgentType: string;

  /** 可注入 Redis 和 GatewayClient 以支持测试；缺省时创建并持有真实连接。 */
  constructor(options: OpenClawConnectorOptions = {}) {
    this.#redis = options.redis ?? createRedis(options.redisOptions);
    this.#ownsRedis = !options.redis;
    this.#client =
      options.gatewayClient ?? new GatewayClient(new WorkerRegistry(this.#redis), this.#redis);
    this.#readBlockMs = options.readBlockMs ?? 1_000;
    this.#sourceAgentType = options.sourceAgentType ?? "BY_SUPER";
  }

  /**
   * 为一次委派创建隔离子会话并投递 OpenClaw 任务。
   * 返回的执行引用不包含 Beyond-Token，可安全写入后续持久化实现。
   */
  async start(
    request: ConnectorRequest,
    context: { signal: AbortSignal },
  ): Promise<ConnectorExecution> {
    if (context.signal.aborted) {
      throw abortError(context.signal.reason);
    }
    const childSessionId = [
      "maestro",
      request.userCode,
      request.sessionId,
      request.runId,
      request.delegationId,
    ].join(":");
    const targetAgentType = `BYCLAW_EXE_${request.userCode}`;
    const beyondToken = stringMetadata(request.metadata, "Beyond-Token");
    const extraPayload: Record<string, unknown> = {
      agent_id: request.agent.execution.targetId,
      agent_name: request.agent.name,
    };
    if (request.agent.code) {
      extraPayload.agent_code = request.agent.code;
    }
    const metadata: Record<string, unknown> = {
      parent_run_id: request.runId,
      delegation_id: request.delegationId,
    };
    if (beyondToken) {
      metadata["Beyond-Token"] = beyondToken;
    }
    const params: SendMessageParams = {
      sourceAgentType: this.#sourceAgentType,
      targetAgentType,
      sessionId: childSessionId,
      // 有附件时构造与 byclaw-be 一致的 {text, files} 内容；无附件保持纯字符串。
      content: buildByFrameworkContent(request.task, request.attachments),
      userCode: request.userCode,
      ...(request.userName ? { userName: request.userName } : {}),
      requireOnlineWorker: true,
      extraPayload,
      metadata,
      // 稳定 ID 让外部执行记录可按 Delegation 定位；真正重连仍走 resume，不重复 send。
      messageId: request.delegationId,
      traceId: request.delegationId,
    };
    const response = await this.#client.sendMessage(params);
    if (!response.success) {
      throw new Error(
        `OpenClaw dispatch failed${response.error_code ? ` (${response.error_code})` : ""}: ${response.error ?? response.status}`,
      );
    }

    let cancelPromise: Promise<void> | undefined;
    // 缓存取消 Promise，使用户取消、超时和 AbortSignal 竞争时只发送一次请求。
    const cancel = async (reason: string): Promise<void> => {
      if (!cancelPromise) {
        cancelPromise = this.#client
          .cancelTask({
            messageId: response.message_id,
            sessionId: childSessionId,
            targetAgentType,
            reason,
            requestedBy: "byclaw-super",
            cancelMode: "graceful",
          })
          .then(() => undefined);
      }
      await cancelPromise;
    };
    if (context.signal.aborted) {
      await cancel("aborted before event stream started");
      throw abortError(context.signal.reason);
    }

    const ref: ExternalExecutionRef = {
      connectorId: this.id,
      executionId: response.trace_id,
      metadata: {
        childSessionId,
        messageId: response.message_id,
        traceId: response.trace_id,
        targetAgentType,
        userCode: request.userCode,
      },
    };
    return {
      ref,
      events: this.#readEvents(
        childSessionId,
        response.trace_id,
        "0-0",
        context.signal,
        cancel,
      ),
      cancel,
      respondToInput: (interactionId, response, resumeToken) =>
        this.#resumeUserInput(ref, interactionId, response, resumeToken),
    };
  }

  /** 使用已保存的 child session、message 和 trace 从 cursor 后继续消费。 */
  async resume(
    ref: ExternalExecutionRef,
    context: { signal: AbortSignal; cursor?: string },
  ): Promise<ConnectorExecution> {
    if (ref.connectorId !== this.id) {
      throw new Error(`Cannot resume a different connector: ${ref.connectorId}`);
    }
    const childSessionId = refString(ref, "childSessionId");
    const messageId = refString(ref, "messageId");
    const traceId = refString(ref, "traceId") || ref.executionId;
    const targetAgentType = refString(ref, "targetAgentType");
    if (!childSessionId || !messageId || !traceId || !targetAgentType) {
      throw new Error("OpenClaw external execution reference is incomplete");
    }
    let cancelPromise: Promise<void> | undefined;
    const cancel = async (reason: string): Promise<void> => {
      cancelPromise ??= this.#client
        .cancelTask({
          messageId,
          sessionId: childSessionId,
          targetAgentType,
          reason,
          requestedBy: "byclaw-super",
          cancelMode: "graceful",
        })
        .then(() => undefined);
      await cancelPromise;
    };
    return {
      ref,
      events: this.#readEvents(
        childSessionId,
        traceId,
        context.cursor ?? "0-0",
        context.signal,
        cancel,
      ),
      cancel,
      respondToInput: (interactionId, response, resumeToken) =>
        this.#resumeUserInput(ref, interactionId, response, resumeToken),
    };
  }

  /** 把统一用户响应映射回 by-framework 的 RESUME 控制消息。 */
  async #resumeUserInput(
    ref: ExternalExecutionRef,
    interactionId: string,
    response: UserInteractionResponse,
    resumeToken?: Record<string, JsonValue>,
  ): Promise<void> {
    const childSessionId = refString(ref, "childSessionId");
    const targetAgentType =
      jsonString(resumeToken?.sourceAgentType) || refString(ref, "targetAgentType");
    const traceId = jsonString(resumeToken?.traceId) || refString(ref, "traceId");
    const messageId = jsonString(resumeToken?.messageId) || interactionId;
    if (!childSessionId || !targetAgentType) {
      throw new Error("OpenClaw resume reference is incomplete");
    }
    const content =
      response.action === "submit"
        ? response.text || JSON.stringify(response.answers ?? {})
        : response.action === "skip"
          ? "User skipped this question."
          : "User cancelled this interaction.";
    const result = await this.#client.sendMessage({
      actionType: ActionType.RESUME,
      sourceAgentType: this.#sourceAgentType,
      targetAgentType,
      sessionId: childSessionId,
      content,
      messageId,
      traceId,
      userCode: refString(ref, "userCode"),
      parentMessageId: jsonString(resumeToken?.parentMessageId),
      metadata: {
        interaction_id: interactionId,
        ...(response.answers ? { user_answers: response.answers } : {}),
      },
      extraPayload: {
        status: response.action === "cancel" ? "CANCELLED" : "RESUMED",
        reply_data: response.answers ?? response.text ?? null,
      },
    });
    if (!result.success) {
      throw new Error(`OpenClaw user-input resume failed: ${result.error ?? result.status}`);
    }
  }

  /** 检查 Connector 所依赖的 Redis 是否可达。 */
  async health(): Promise<ConnectorHealth> {
    try {
      const response = await this.#redis.ping();
      return {
        healthy: response === "PONG",
        message: response === "PONG" ? "Redis is reachable" : `Unexpected Redis response: ${response}`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 仅关闭本 Connector 自己创建的 Redis 连接，不处置外部注入的共享连接。 */
  async close(): Promise<void> {
    if (this.#ownsRedis && this.#redis.status !== "end") {
      await this.#redis.quit();
    }
  }

  /**
   * 从独立会话 Stream 持续读取事件，过滤其他 trace 和 reasoning 事件，
   * 再映射成与具体传输无关的 ConnectorEvent。
   */
  async *#readEvents(
    sessionId: string,
    traceId: string,
    startCursor: string,
    signal: AbortSignal,
    cancel: (reason: string) => Promise<void>,
  ): AsyncIterable<ConnectorEvent> {
    const stream = QueueNames.session_data_stream(sessionId);
    let cursor = startCursor;
    let output = "";
    while (!signal.aborted) {
      const rows = await this.#redis.xread(
        "COUNT",
        50,
        "BLOCK",
        this.#readBlockMs,
        "STREAMS",
        stream,
        cursor,
      );
      for (const entry of parseXreadRows(rows)) {
        cursor = entry.id;
        const message = parseDataMessage(entry.data);
        if (!message || (message.trace_id && message.trace_id !== traceId)) {
          continue;
        }
        if (message.event_type === EventType.ANSWER_DELTA) {
          const text = extractContent(message.data);
          if (text) {
            output += text;
            yield { type: "output_delta", text, cursor };
          }
          continue;
        }
        if (message.event_type === EventType.FINAL_ANSWER) {
          const finalAnswer = extractContent(message.data);
          if (!finalAnswer) {
            continue;
          }
          // by-framework 的 Worker 即使没有主动 emitChunk，也会在终态发送 finalAnswer。
          // 已收到流式前缀时只补齐缺失后缀，避免把完整终态答案重复追加一遍。
          if (!output) {
            output = finalAnswer;
            yield { type: "output_delta", text: finalAnswer, cursor };
          } else if (finalAnswer.startsWith(output) && finalAnswer.length > output.length) {
            const suffix = finalAnswer.slice(output.length);
            output = finalAnswer;
            yield { type: "output_delta", text: suffix, cursor };
          } else if (finalAnswer !== output) {
            // 终态内容与流式内容不具备前缀关系时，以终态为最终快照；
            // 不发送会造成客户端重复拼接的 delta，Run 终态详情会返回该权威结果。
            output = finalAnswer;
          }
          continue;
        }
        if (
          message.event_type === EventType.REASONING_LOG_START ||
          message.event_type === EventType.REASONING_LOG_END
        ) {
          continue;
        }
        if (message.event_type === EventType.REASONING_LOG_DELTA) {
          const input = extractUserInput(message);
          if (input) {
            yield {
              type: "input_required",
              interactionId: input.interactionId,
              request: input.request,
              resumeToken: input.resumeToken,
              cursor,
            };
          }
          continue;
        }
        if (message.event_type === EventType.APP_STREAM_RESPONSE) {
          const result: AgentResult = {
            status: "completed",
            output,
            artifacts: [],
          };
          yield { type: "completed", result, cursor };
          return;
        }
        if (message.event_type === "error") {
          yield {
            type: "failed",
            cursor,
            error: {
              code: "OPENCLAW_ERROR",
              message: extractError(message),
              retryable: false,
            },
          };
          return;
        }
      }
    }
    await cancel("connector event stream aborted").catch(() => undefined);
    throw abortError(signal.reason);
  }
}

export type { RedisConnectionConfig } from "@byclaw/by-framework";

/**
 * 按 byclaw-be 兼容结构构造投递内容：无附件时为纯字符串；
 * 有附件时为 `[{role:"user", content:{text, files}}]`。
 *
 * by-framework SDK 的 `MessageFile` 类型（数字 fileId、枚举 fileType）比 byclaw-be 实际
 * 线缆格式（字符串 fileId、mimetype 等）更窄；sendMessage 只做 JSON 序列化，故按 byclaw-be
 * 线缆格式构造后安全断言回 SDK 类型。
 */
function buildByFrameworkContent(
  task: string,
  attachments: readonly RunAttachment[],
): SendMessageParams["content"] {
  if (attachments.length === 0) {
    return task;
  }
  return [
    {
      role: "user",
      content: {
        text: task,
        files: toByFrameworkFiles(attachments),
      },
    },
  ] as unknown as SendMessageParams["content"];
}

/**
 * 把 RunAttachment 映射回 byclaw-be 的 MessageFileDto 字段（白名单）。
 * 不生成 fileIp；Beyond-Token 不混入文件对象，仍只走 metadata。
 */
function toByFrameworkFiles(
  attachments: readonly RunAttachment[],
): Record<string, unknown>[] {
  return attachments.map((attachment) => ({
    fileId: attachment.id,
    fileName: attachment.name,
    ...(attachment.mediaType ? { fileType: attachment.mediaType } : {}),
    ...(attachment.size !== undefined ? { fileSize: attachment.size } : {}),
    ...(attachment.url ? { fileUrl: attachment.url } : {}),
    ...(attachment.path ? { filePath: attachment.path } : {}),
    ...(attachment.datasetId ? { datasetId: attachment.datasetId } : {}),
    ...(attachment.sourceType ? { sourceType: attachment.sourceType } : {}),
    ...(attachment.useType ? { useType: attachment.useType } : {}),
  }));
}
