import type {
  AgentProfile,
  AgentResult,
  ArtifactRef,
  ExternalExecutionRef,
  JsonValue,
  RunAttachment,
  UserInteractionRequest,
  UserInteractionResponse,
} from "../domain/types.js";

/** 编排层传给 Connector 的完整执行上下文；metadata 只在当前 Run 内短暂使用。 */
export interface ConnectorRequest {
  userCode: string;
  userName?: string;
  sessionId: string;
  runId: string;
  /** 整条 by-framework 父子调用链共用的 trace ID。 */
  traceId?: string;
  delegationId: string;
  agent: AgentProfile;
  task: string;
  expectedOutput?: string;
  /** 本次委派选中的附件；由编排层从当前 Run 的附件集合中按 ID 解析，Connector 只负责透传。 */
  attachments: RunAttachment[];
  /**
   * by-framework 入站 Session 的外部 ID；仅当 Run 来自 by-framework 入站时由编排层从
   * ephemeral metadata 透传过来（与 Beyond-Token 同路径，不持久化）。Connector 据此向子 agent
   * 声明会话工作区，缺失（HTTP 入站）则不附加任何提示。
   */
  externalSessionId?: string;
  /** by-framework 父消息 ID；Connector 应透传以建立外部执行的级联取消关系。 */
  parentMessageId?: string;
  metadata: Record<string, unknown>;
}

/** Connector 对编排层声明的传输能力。 */
export interface ConnectorCapabilities {
  /** 终态来自当前事件流，还是来自独立的持久化回调。 */
  completionMode: "events" | "callback";
  streaming: boolean;
  cancellation: boolean;
  artifacts: boolean;
  resumable: boolean;
  /** 是否支持随委派透传附件；不支持时收到附件会明确报错而非静默丢弃。 */
  attachments: boolean;
}

/** Connector 失败事件的统一错误结构。 */
export interface ConnectorError {
  code: string;
  message: string;
  retryable: boolean;
  /** 该失败是否由 Connector 自身的明确超时边界触发。 */
  timedOut?: boolean;
  details?: Record<string, JsonValue>;
}

/** 不同传输实现都必须转换成的标准事件联合类型。 */
export type ConnectorEvent = (
  | {
      /** 仅表示外部执行仍在活动，不向用户展示。 */
      type: "activity";
    }
  | { type: "progress"; message: string }
  | {
      /** 子 Agent 主动发出的、允许展示给用户的执行过程文本；不是模型隐藏推理。 */
      type: "display_progress";
      text: string;
      sourceMessageId?: string;
    }
  | {
      type: "tool_started";
      callId: string;
      toolName: string;
      title?: string;
      input?: JsonValue;
    }
  | {
      type: "tool_detail";
      callId: string;
      toolName?: string;
      phase: "input" | "output";
      value: JsonValue;
    }
  | {
      type: "tool_completed";
      callId: string;
      toolName?: string;
      title?: string;
      /** 某些 by-framework Worker 把工具结果包装在 3009 的 output 字段中。 */
      output?: JsonValue;
    }
  | {
      type: "tool_failed";
      callId: string;
      toolName?: string;
      title?: string;
      error: string;
      output?: JsonValue;
    }
  | { type: "output_delta"; text: string }
  | { type: "artifact"; artifact: ArtifactRef }
  | {
      type: "input_required";
      interactionId: string;
      request: UserInteractionRequest;
      resumeToken?: Record<string, JsonValue>;
    }
  | { type: "completed"; result: AgentResult }
  | { type: "failed"; error: ConnectorError }
) & {
  /** Connector 自身可恢复的消费位置；保存后才能确认该事件已被编排层处理。 */
  cursor?: string;
};

interface ConnectorExecutionBase {
  ref: ExternalExecutionRef;
  /** 请求外部系统取消本次执行；实现必须保证重复调用安全。 */
  cancel(reason: string): Promise<void>;
  /** 向一个已暂停的外部执行提交用户输入；仅支持人机交互的 Connector 实现。 */
  respondToInput?(
    interactionId: string,
    response: UserInteractionResponse,
    resumeToken?: Record<string, JsonValue>,
  ): Promise<void>;
}

/**
 * 已启动的外部执行。
 *
 * events 模式由当前调用栈消费 Connector 事件直到终态；callback 模式在可靠投递后
 * 立即释放调用栈，终态只允许通过独立回调结算。两种完成模型不能再伪装成同一条事件流。
 */
export type ConnectorExecution = ConnectorExecutionBase &
  (
    | {
        completionMode?: "events";
        events: AsyncIterable<ConnectorEvent>;
      }
    | {
        completionMode: "callback";
        events?: never;
      }
  );

/** Connector 依赖的健康检查结果。 */
export interface ConnectorHealth {
  healthy: boolean;
  message?: string;
  details?: Record<string, JsonValue>;
}

/** 所有外部 Agent 连接方式必须实现的稳定 SPI。 */
export interface AgentConnector {
  readonly id: string;
  readonly capabilities: ConnectorCapabilities;

  /** 启动一次外部 Agent 执行，并返回可持久化引用、规范化事件流和取消句柄。 */
  start(request: ConnectorRequest, context: { signal: AbortSignal }): Promise<ConnectorExecution>;

  /** 从已持久化 externalRef/cursor 重连同一个外部执行，不得再次投递任务。 */
  resume?(
    ref: ExternalExecutionRef,
    context: {
      signal: AbortSignal;
      cursor?: string;
      /** 当前 Run 的临时 metadata；用于重连后继续透传，不写入 externalRef。 */
      metadata?: Record<string, unknown>;
    },
  ): Promise<ConnectorExecution>;

  /** 检查 Connector 自身依赖是否可用；具体目标 Agent 的在线性仍在投递时校验。 */
  health(): Promise<ConnectorHealth>;
}

/** 表示请求引用了尚未在当前进程注册的 Connector。 */
export class ConnectorNotFoundError extends Error {
  /** 使用缺失的 Connector ID 构造可读错误。 */
  constructor(connectorId: string) {
    super(`Connector is not registered: ${connectorId}`);
    this.name = "ConnectorNotFoundError";
  }
}

/** 保存应用启动时注入的 Connector，并作为编排核心唯一的 Connector 查找入口。 */
export class ConnectorRegistry {
  readonly #connectors = new Map<string, AgentConnector>();

  /** 注册 Connector；重复 ID 被视为启动配置错误并立即失败。 */
  register(connector: AgentConnector): void {
    if (this.#connectors.has(connector.id)) {
      throw new Error(`Connector is already registered: ${connector.id}`);
    }
    this.#connectors.set(connector.id, connector);
  }

  /** 按 ID 获取 Connector；不存在时不做隐式降级。 */
  require(connectorId: string): AgentConnector {
    const connector = this.#connectors.get(connectorId);
    if (!connector) {
      throw new ConnectorNotFoundError(connectorId);
    }
    return connector;
  }

  /** 返回当前已注册 Connector 的快照。 */
  list(): AgentConnector[] {
    return [...this.#connectors.values()];
  }

  /** 并行执行全部 Connector 的健康检查，并把异常转换为非健康结果。 */
  async health(): Promise<Record<string, ConnectorHealth>> {
    const entries = await Promise.all(
      this.list().map(async (connector) => {
        try {
          return [connector.id, await connector.health()] as const;
        } catch (error) {
          return [
            connector.id,
            {
              healthy: false,
              message: error instanceof Error ? error.message : String(error),
            },
          ] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
