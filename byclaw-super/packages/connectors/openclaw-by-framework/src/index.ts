import {
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
} from "@byclaw/by-conductor";

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

type DataMessage = {
  trace_id?: string;
  session_id?: string;
  event_type?: string;
  state_msg?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
};

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
      content: request.task,
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
    };
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
        if (
          message.event_type === EventType.REASONING_LOG_START ||
          message.event_type === EventType.REASONING_LOG_DELTA ||
          message.event_type === EventType.REASONING_LOG_END
        ) {
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

function refString(ref: ExternalExecutionRef, key: string): string {
  const value = ref.metadata?.[key];
  return typeof value === "string" ? value : "";
}

/** 从 metadata 中安全读取非空字符串，避免把非字符串凭证传给 by-framework。 */
function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value ? value : undefined;
}

/** 把任意中止原因规范化为 Error，便于上游按统一异常路径处理。 */
function abortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(typeof reason === "string" ? reason : "Operation aborted");
  error.name = "AbortError";
  return error;
}

/** 判断未知 JSON 值是否为普通键值对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 容错解析 Redis Stream 中的 by-framework 数据消息。 */
function parseDataMessage(raw: string): DataMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? (value as DataMessage) : undefined;
  } catch {
    return undefined;
  }
}

/** 从 OpenAI 兼容的流式 choices 结构中提取文本增量。 */
function extractContent(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return "";
  }
  const first = data.choices[0];
  if (!isRecord(first) || !isRecord(first.delta)) {
    return "";
  }
  return typeof first.delta.content === "string" ? first.delta.content : "";
}

/** 按 metadata、状态消息、内容的优先级提取可读错误。 */
function extractError(message: DataMessage): string {
  const metadataError = message.metadata?.error;
  if (typeof metadataError === "string" && metadataError) {
    return metadataError;
  }
  if (message.state_msg) {
    return message.state_msg;
  }
  return extractContent(message.data) || "OpenClaw execution failed";
}

/** 把 ioredis 的 XREAD 嵌套返回值展平为消息 ID 与 data 字段。 */
function parseXreadRows(rows: unknown): Array<{ id: string; data: string }> {
  if (!Array.isArray(rows)) {
    return [];
  }
  const result: Array<{ id: string; data: string }> = [];
  for (const streamRow of rows) {
    if (!Array.isArray(streamRow) || !Array.isArray(streamRow[1])) {
      continue;
    }
    for (const item of streamRow[1]) {
      if (!Array.isArray(item) || typeof item[0] !== "string" || !Array.isArray(item[1])) {
        continue;
      }
      const fields = item[1];
      const dataIndex = fields.indexOf("data");
      const data = dataIndex >= 0 ? fields[dataIndex + 1] : undefined;
      if (typeof data === "string") {
        result.push({ id: item[0], data });
      }
    }
  }
  return result;
}

export type { RedisConnectionConfig } from "@byclaw/by-framework";
