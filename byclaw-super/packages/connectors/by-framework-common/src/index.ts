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
} from "./by-framework-codec.js";

type RedisClient = ReturnType<typeof createRedis>;
type GatewayClientLike = Pick<GatewayClient, "sendMessage" | "cancelTask">;
type WorkerRegistryLike = Pick<WorkerRegistry, "getExecutionByMessageId">;

const TERMINAL_EXECUTION_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface ByFrameworkConnectorOptions {
  connectorId: string;
  targetAgentTypeResolver: (request: ConnectorRequest) => string;
  redisOptions?: RedisConnectionConfig;
  redis?: RedisClient;
  gatewayClient?: GatewayClientLike;
  registry?: WorkerRegistryLike;
  readBlockMs?: number;
  sourceAgentType?: string;
  firstEventTimeoutMs?: number;
  cancelConfirmationTimeoutMs?: number;
}

/**
 * 通过 by-framework Gateway/Redis 协议连接目标 Worker。
 * 该类只负责传输适配，授权、超时和业务状态由 by-conductor 处理。
 */
export class ByFrameworkConnector implements AgentConnector {
  readonly id: string;
  readonly capabilities: ConnectorCapabilities = {
    streaming: true,
    cancellation: true,
    artifacts: false,
    resumable: true,
    attachments: true,
  };

  readonly #redis: RedisClient;
  readonly #client: GatewayClientLike;
  readonly #registry: WorkerRegistryLike | undefined;
  readonly #ownsRedis: boolean;
  readonly #readBlockMs: number;
  readonly #sourceAgentType: string;
  readonly #firstEventTimeoutMs: number;
  readonly #cancelConfirmationTimeoutMs: number;
  readonly #targetAgentTypeResolver: (request: ConnectorRequest) => string;

  /** 可注入 Redis 和 GatewayClient 以支持测试；缺省时创建并持有真实连接。 */
  constructor(options: ByFrameworkConnectorOptions) {
    this.id = options.connectorId;
    this.#targetAgentTypeResolver = options.targetAgentTypeResolver;
    this.#redis = options.redis ?? createRedis(options.redisOptions);
    this.#ownsRedis = !options.redis;
    if (options.gatewayClient) {
      this.#registry = options.registry;
      this.#client = options.gatewayClient;
    } else {
      const registry = new WorkerRegistry(this.#redis);
      this.#registry = registry;
      this.#client = new GatewayClient(registry, this.#redis);
    }
    this.#readBlockMs = options.readBlockMs ?? 1_000;
    this.#sourceAgentType = options.sourceAgentType ?? "BY_SUPER";
    this.#firstEventTimeoutMs = options.firstEventTimeoutMs ?? 300_000;
    this.#cancelConfirmationTimeoutMs =
      options.cancelConfirmationTimeoutMs ?? 30_000;
  }

  /**
   * 为一次委派创建隔离子会话并投递 by-framework 任务。
   * 返回的执行引用不包含 Beyond-Token，可安全写入后续持久化实现。
   */
  async start(
    request: ConnectorRequest,
    context: { signal: AbortSignal },
  ): Promise<ConnectorExecution> {
    if (context.signal.aborted) {
      throw abortError(context.signal.reason);
    }
    // by-framework 入站任务必须沿用 BE 传入的 sessionId。该值同时决定被调用
    // Agent 的会话空间目录；若继续使用 maestro:* 子会话，会错误落到
    // /by/.sessions/maestro:.../。HTTP 等非 by-framework 入口仍保留隔离子会话。
    const childSessionId =
      request.externalSessionId ??
      [
        "maestro",
        request.userCode,
        request.sessionId,
        request.runId,
        request.delegationId,
      ].join(":");
    const targetAgentType = this.#targetAgentTypeResolver(request);
    const extraPayload: Record<string, unknown> = {
      agent_id: request.agent.execution.targetId,
      agent_name: request.agent.name,
    };
    if (request.agent.code) {
      extraPayload.agent_code = request.agent.code;
    }
    const metadata: Record<string, unknown> = {
      ...request.metadata,
      parent_run_id: request.runId,
      delegation_id: request.delegationId,
    };
    const params: SendMessageParams = {
      sourceAgentType: this.#sourceAgentType,
      targetAgentType,
      sessionId: childSessionId,
      // 有附件时构造与 byclaw-be 一致的 {text, files} 内容；无附件保持纯字符串。
      // by-framework 入站 Run 在投递内容末尾声明会话工作区、指明附件在工作区内的读取路径，
      // 并提示子 agent 落盘位置；该后缀只进入 wire payload，request.task 本身不变
      //（它是委派幂等/恢复的匹配键）。
      content: buildByFrameworkContent(
        withSessionWorkspaceReminder(
          request.task,
          request.externalSessionId,
          request.attachments,
        ),
        request.attachments,
      ),
      userCode: request.userCode,
      ...(request.userName ? { userName: request.userName } : {}),
      requireOnlineWorker: true,
      extraPayload,
      metadata,
      // 稳定 ID 让外部执行记录可按 Delegation 定位；真正重连仍走 resume，不重复 send。
      messageId: request.delegationId,
      traceId: request.delegationId,
      ...(request.parentMessageId
        ? { parentMessageId: request.parentMessageId }
        : {}),
    };
    const response = await this.#client.sendMessage(params);
    if (!response.success) {
      throw new Error(
        `by-framework dispatch failed${response.error_code ? ` (${response.error_code})` : ""}: ${response.error ?? response.status}`,
      );
    }

    const cancel = this.#createCancel(
      response.message_id,
      childSessionId,
      targetAgentType,
    );
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
        this.#resumeUserInput(
          ref,
          interactionId,
          response,
          resumeToken,
          request.metadata,
        ),
    };
  }

  /** 使用已保存的 child session、message 和 trace 从 cursor 后继续消费。 */
  async resume(
    ref: ExternalExecutionRef,
    context: {
      signal: AbortSignal;
      cursor?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ConnectorExecution> {
    if (ref.connectorId !== this.id) {
      throw new Error(`Cannot resume a different connector: ${ref.connectorId}`);
    }
    const childSessionId = refString(ref, "childSessionId");
    const messageId = refString(ref, "messageId");
    const traceId = refString(ref, "traceId") || ref.executionId;
    const targetAgentType = refString(ref, "targetAgentType");
    if (!childSessionId || !messageId || !traceId || !targetAgentType) {
      throw new Error("by-framework external execution reference is incomplete");
    }
    const cancel = this.#createCancel(messageId, childSessionId, targetAgentType);
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
        this.#resumeUserInput(
          ref,
          interactionId,
          response,
          resumeToken,
          context.metadata,
        ),
    };
  }

  /** 把统一用户响应映射回 by-framework 的 RESUME 控制消息。 */
  async #resumeUserInput(
    ref: ExternalExecutionRef,
    interactionId: string,
    response: UserInteractionResponse,
    resumeToken?: Record<string, JsonValue>,
    forwardedMetadata?: Record<string, unknown>,
  ): Promise<void> {
    const childSessionId = refString(ref, "childSessionId");
    const targetAgentType =
      jsonString(resumeToken?.sourceAgentType) || refString(ref, "targetAgentType");
    const traceId = jsonString(resumeToken?.traceId) || refString(ref, "traceId");
    const messageId = jsonString(resumeToken?.messageId) || interactionId;
    if (!childSessionId || !targetAgentType) {
      throw new Error("by-framework resume reference is incomplete");
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
      routePolicy: "WAKE_AND_WAIT",
      sessionId: childSessionId,
      content,
      messageId,
      traceId,
      userCode: refString(ref, "userCode"),
      parentMessageId: jsonString(resumeToken?.parentMessageId),
      metadata: {
        ...(forwardedMetadata ?? {}),
        interaction_id: interactionId,
        ...(response.answers ? { user_answers: response.answers } : {}),
      },
      extraPayload: {
        status: response.action === "cancel" ? "CANCELLED" : "RESUMED",
        reply_data: response.answers ?? response.text ?? null,
      },
    });
    if (!result.success) {
      throw new Error(`by-framework user-input resume failed: ${result.error ?? result.status}`);
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

  /** 创建幂等取消句柄，并确认 by-framework 中的外部 execution 已离开运行态。 */
  #createCancel(
    messageId: string,
    sessionId: string,
    targetAgentType: string,
  ): (reason: string) => Promise<void> {
    let cancelPromise: Promise<void> | undefined;
    return async (reason: string): Promise<void> => {
      cancelPromise ??= this.#cancelAndConfirm(
        messageId,
        sessionId,
        targetAgentType,
        reason,
      );
      await cancelPromise;
    };
  }

  /** 校验取消受理结果；生产路径继续轮询 execution 终态，避免把请求受理误当成已停止。 */
  async #cancelAndConfirm(
    messageId: string,
    sessionId: string,
    targetAgentType: string,
    reason: string,
  ): Promise<void> {
    const response = await this.#client.cancelTask({
      messageId,
      sessionId,
      targetAgentType,
      reason,
      requestedBy: "byclaw-super",
      cancelMode: "force",
    });
    if (response.status === "ALREADY_FINISHED") {
      return;
    }
    if (!response.success || response.status !== "CANCEL_REQUESTED") {
      throw new Error(
        `by-framework cancellation failed: status=${response.status}, error=${response.error ?? "unknown"}`,
      );
    }
    if (!this.#registry) {
      return;
    }

    const deadline = Date.now() + this.#cancelConfirmationTimeoutMs;
    while (Date.now() < deadline) {
      const execution = await this.#registry.getExecutionByMessageId(
        messageId,
        sessionId,
      );
      const status = String(execution?.status ?? "");
      if (TERMINAL_EXECUTION_STATUSES.has(status)) {
        return;
      }
      await delay(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    throw new Error(
      `by-framework cancellation was not confirmed within ${this.#cancelConfirmationTimeoutMs}ms`,
    );
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
    let firstEventReceived = false;
    const firstEventDeadline = Date.now() + this.#firstEventTimeoutMs;
    while (!signal.aborted) {
      if (!firstEventReceived && Date.now() >= firstEventDeadline) {
        const reason = `by-framework first event timed out after ${this.#firstEventTimeoutMs}ms`;
        let cancellationError: string | undefined;
        try {
          await cancel(reason);
        } catch (error) {
          cancellationError = error instanceof Error ? error.message : String(error);
        }
        yield {
          type: "failed",
          error: {
            code: "OPENCLAW_FIRST_EVENT_TIMEOUT",
            message: cancellationError ? `${reason}; ${cancellationError}` : reason,
            retryable: true,
            timedOut: true,
          },
        };
        return;
      }
      const blockMs = firstEventReceived
        ? this.#readBlockMs
        : Math.min(
            this.#readBlockMs,
            Math.max(1, firstEventDeadline - Date.now()),
          );
      const rows = await this.#redis.xread(
        "COUNT",
        50,
        "BLOCK",
        blockMs,
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
        firstEventReceived = true;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export type { RedisConnectionConfig } from "@byclaw/by-framework";

/**
 * 仅对 by-framework 入站 Run（externalSessionId 存在）在 task 末尾追加会话工作区提示。
 * 该后缀只进入投递内容，不回写 request.task，保证委派的幂等/恢复匹配不受影响。
 */
function withSessionWorkspaceReminder(
  task: string,
  externalSessionId: string | undefined,
  attachments: readonly RunAttachment[],
): string {
  if (!externalSessionId) {
    return task;
  }
  const workspace = `/by/.sessions/${externalSessionId}/`;
  const readPaths = sessionWorkspaceReadPaths(attachments);
  if (readPaths.length === 0) {
    return `${task}\n\nYour session workspace is \`${workspace}\`. If you produce any files, place them under this session workspace.`;
  }
  const lines = [
    `Your session workspace is \`${workspace}\`.`,
    "Files attached to this task are available in this workspace for reading:",
    ...readPaths.map((path) => `- \`${path}\``),
    "If you produce any files, place them under this session workspace.",
  ];
  return `${task}\n\n${lines.join("\n")}`;
}

/**
 * 列出附件在沙箱会话工作区内的读取路径。BE 投递的 `filePath`（= attachment.path）
 * 是对象存储 key，形如 `/.sessions/<sessionId>/<file>`（前导 /、不含 `..`）；沙箱将其
 * 挂在 `/by` 下，故读取路径 = `/by` + 该 key。非会话工作区 key 一律忽略。仅向子 agent
 * 提示读取位置。
 */
function sessionWorkspaceReadPaths(
  attachments: readonly RunAttachment[],
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const attachment of attachments) {
    const objectKey = attachment.path?.trim();
    if (
      !objectKey ||
      !objectKey.startsWith("/.sessions/") ||
      objectKey.includes("..")
    ) {
      continue;
    }
    const readPath = `/by${objectKey}`;
    if (!seen.has(readPath)) {
      seen.add(readPath);
      paths.push(readPath);
    }
  }
  return paths;
}

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
