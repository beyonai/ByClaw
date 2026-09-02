import {
  AgentState,
  GatewayClient,
  WorkerRegistry,
  createRedis,
  type RedisConnectionConfig,
} from "@byclaw/by-framework";
import {
  callAgent as frameworkCallAgent,
  createRedisCallAgentDeps,
} from "@byclaw/by-framework/dist/dispatch/dispatch_ask_agent.js";
import type {
  AgentConnector,
  ConnectorCapabilities,
  ConnectorExecution,
  ConnectorHealth,
  ConnectorRequest,
  ExternalExecutionRef,
  JsonValue,
  RunAttachment,
} from "@byclaw/by-conductor";

type RedisClient = ReturnType<typeof createRedis>;
type GatewayClientLike = Pick<GatewayClient, "cancelTask">;

export interface ByFrameworkCallAgentInput {
  sessionId: string;
  traceId: string;
  sourceAgentType: string;
  defaultParentMessageId: string;
  targetAgentType: string;
  content: unknown;
  extraPayload?: Readonly<Record<string, unknown>>;
  waitForReply?: boolean;
  userCode?: string;
  userName?: string;
  metadata?: Readonly<Record<string, unknown>>;
  messageId?: string;
  parentMessageId?: string;
  routePolicy?: "FAIL_FAST" | "SEND_ANYWAY" | "WAKE_AND_WAIT" | "WAKE_AND_QUEUE" | "QUEUE_ONLY";
  availabilityTimeoutMs?: number;
}

export interface ByFrameworkCallAgentResult {
  status: string;
  messageId: string;
  parentMessageId?: string;
  targetAgentType: string;
  error?: string;
  error_code?: string;
}

export interface ByFrameworkConnectorOptions {
  connectorId: string;
  targetAgentTypeResolver: (request: ConnectorRequest) => string;
  redisOptions?: RedisConnectionConfig;
  redis?: RedisClient;
  gatewayClient?: GatewayClientLike;
  callAgent?: (input: ByFrameworkCallAgentInput) => Promise<ByFrameworkCallAgentResult>;
  sourceAgentType?: string;
  logger?: ByFrameworkConnectorLogger;
}

export interface ByFrameworkConnectorLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

/** 使用 callAgent 发布任务；终态由 BY_SUPER Worker 的 ResumeCommand 独立恢复 Run。 */
export class ByFrameworkConnector implements AgentConnector {
  readonly id: string;
  readonly capabilities: ConnectorCapabilities = {
    completionMode: "callback",
    streaming: false,
    cancellation: true,
    artifacts: false,
    resumable: true,
    attachments: true,
  };

  readonly #redis: RedisClient;
  readonly #client: GatewayClientLike;
  readonly #ownsRedis: boolean;
  readonly #callAgent: (input: ByFrameworkCallAgentInput) => Promise<ByFrameworkCallAgentResult>;
  readonly #sourceAgentType: string;
  readonly #targetAgentTypeResolver: (request: ConnectorRequest) => string;
  readonly #logger: ByFrameworkConnectorLogger | undefined;

  constructor(options: ByFrameworkConnectorOptions) {
    this.id = options.connectorId;
    this.#targetAgentTypeResolver = options.targetAgentTypeResolver;
    this.#redis = options.redis ?? createRedis(options.redisOptions);
    this.#ownsRedis = !options.redis;
    const registry = new WorkerRegistry(this.#redis);
    this.#client = options.gatewayClient ?? new GatewayClient(registry, this.#redis);
    this.#callAgent =
      options.callAgent ??
      ((input) => frameworkCallAgent(createRedisCallAgentDeps({ redis: this.#redis, registry }), input));
    this.#sourceAgentType = options.sourceAgentType ?? "BY_SUPER";
    this.#logger = options.logger;
  }

  async start(
    request: ConnectorRequest,
    context: { signal: AbortSignal },
  ): Promise<ConnectorExecution> {
    context.signal.throwIfAborted();
    const childSessionId =
      request.externalSessionId ??
      ["maestro", request.userCode, request.sessionId, request.runId, request.delegationId].join(
        ":",
      );
    const traceId = request.traceId ?? request.runId;
    const targetAgentType = this.#targetAgentTypeResolver(request);
    // Delegation 根节点由 BY_SUPER 展示；子请求必须使用独立 messageId，避免与根节点
    // orderId 冲突，同时通过 parentMessageId 把下游思考、工具和输出挂到根节点下。
    const childRequestMessageId = `${request.delegationId}:request`;
    const metadata: Record<string, unknown> = {
      ...request.metadata,
      parent_run_id: request.runId,
      delegation_id: request.delegationId,
      delegated_agent_id: request.agent.id,
      delegated_agent_name: request.agent.name,
      delegated_agent_type: targetAgentType,
      ...(request.parentMessageId
        ? { caller_parent_message_id: request.parentMessageId }
        : {}),
    };
    const extraPayload: Record<string, unknown> = {
      agent_id: request.agent.execution.targetId,
      agent_name: request.agent.name,
      ...(request.agent.code ? { agent_code: request.agent.code } : {}),
    };
    const dispatchFields = {
      component: "byclaw-super",
      stage: "child_agent_dispatch",
      connectorId: this.id,
      runId: request.runId,
      sessionId: request.sessionId,
      delegationId: request.delegationId,
      agentId: request.agent.id,
      agentName: request.agent.name,
      sourceAgentType: this.#sourceAgentType,
      targetAgentType,
      childSessionId,
      messageId: childRequestMessageId,
      traceId,
    };
    const dispatchStartedAt = Date.now();
    let response: ByFrameworkCallAgentResult;
    try {
      this.#logger?.info(dispatchFields, "准备通过 by-framework callAgent 调度子 Agent");
      response = await this.#callAgent({
        sessionId: childSessionId,
        traceId,
        sourceAgentType: this.#sourceAgentType,
        defaultParentMessageId: request.delegationId,
        targetAgentType,
        content: buildByFrameworkContent(
          withSessionWorkspaceReminder(request.task, request.externalSessionId, request.attachments),
          request.attachments,
        ),
        extraPayload,
        waitForReply: true,
        userCode: request.userCode,
        ...(request.userName ? { userName: request.userName } : {}),
        metadata,
        messageId: childRequestMessageId,
        parentMessageId: request.delegationId,
        routePolicy: "WAKE_AND_WAIT",
        availabilityTimeoutMs: 60000,
      });
    } catch (error) {
      this.#logger?.error(
        { ...dispatchFields, durationMs: Date.now() - dispatchStartedAt, error: errorMessage(error) },
        "调用 by-framework callAgent 异常",
      );
      throw error;
    }
    if (response.status === AgentState.FAILED) {
      throw new Error(
        `by-framework callAgent failed${response.error_code ? ` (${response.error_code})` : ""}: ${
          response.error ?? response.status
        }`,
      );
    }
    this.#logger?.info(
      {
        ...dispatchFields,
        durationMs: Date.now() - dispatchStartedAt,
        frameworkStatus: response.status,
        frameworkMessageId: response.messageId,
      },
      "by-framework callAgent 已受理子 Agent 调度",
    );

    const cancel = this.#createCancel(response.messageId, childSessionId, targetAgentType);
    const ref: ExternalExecutionRef = {
      connectorId: this.id,
      executionId: response.messageId,
      metadata: {
        childSessionId,
        messageId: response.messageId,
        traceId,
        targetAgentType,
        userCode: request.userCode,
        sessionId: request.sessionId,
        delegationId: request.delegationId,
        ...(request.externalSessionId ? { externalSessionId: request.externalSessionId } : {}),
      },
    };
    return {
      ref,
      completionMode: "callback",
      cancel,
    };
  }

  async resume(
    ref: ExternalExecutionRef,
    context: { signal: AbortSignal },
  ): Promise<ConnectorExecution> {
    context.signal.throwIfAborted();
    const metadata = ref.metadata ?? {};
    const childSessionId = stringMetadata(metadata, "childSessionId");
    const targetAgentType = stringMetadata(metadata, "targetAgentType");
    if (!childSessionId || !targetAgentType) {
      throw new Error("by-framework externalRef is missing childSessionId or targetAgentType");
    }
    return {
      ref,
      completionMode: "callback",
      cancel: this.#createCancel(ref.executionId, childSessionId, targetAgentType),
    };
  }

  async health(): Promise<ConnectorHealth> {
    try {
      const response = await this.#redis.ping();
      return {
        healthy: response === "PONG",
        message:
          response === "PONG" ? "Redis is reachable" : `Unexpected Redis response: ${response}`,
      };
    } catch (error) {
      return { healthy: false, message: errorMessage(error) };
    }
  }

  async close(): Promise<void> {
    if (this.#ownsRedis && this.#redis.status !== "end") {
      await this.#redis.quit();
    }
  }

  #createCancel(
    messageId: string,
    sessionId: string,
    targetAgentType: string,
  ): (reason: string) => Promise<void> {
    let cancelPromise: Promise<void> | undefined;
    return async (reason: string): Promise<void> => {
      cancelPromise ??= (async () => {
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
            `by-framework cancellation failed: status=${response.status}, error=${
              response.error ?? "unknown"
            }`,
          );
        }
      })();
      await cancelPromise;
    };
  }
}

function stringMetadata(metadata: Record<string, JsonValue>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { RedisConnectionConfig } from "@byclaw/by-framework";

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

function sessionWorkspaceReadPaths(attachments: readonly RunAttachment[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const attachment of attachments) {
    const objectKey = attachment.path?.trim();
    if (!objectKey || !objectKey.startsWith("/.sessions/") || objectKey.includes("..")) {
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

function buildByFrameworkContent(
  task: string,
  attachments: readonly RunAttachment[],
): unknown {
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
  ];
}

function toByFrameworkFiles(attachments: readonly RunAttachment[]): Record<string, unknown>[] {
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
