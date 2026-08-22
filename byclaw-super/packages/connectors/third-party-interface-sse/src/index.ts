import type {
  AgentConnector,
  AgentResult,
  ConnectorCapabilities,
  ConnectorEvent,
  ConnectorExecution,
  ConnectorHealth,
  ConnectorRequest,
} from "@byclaw/by-conductor";
import {
  ExecutionDescriptorClient,
  metadataString,
  parseSse,
  safeJsonParse,
} from "@byclaw/connector-third-party-common";

export const THIRD_PARTY_INTERFACE_SSE_CONNECTOR_ID =
  "third-party-interface-sse";

export interface ThirdPartyInterfaceSseConnectorOptions {
  descriptors: ExecutionDescriptorClient;
  fetchImpl?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

/** 直接连接 INTERFACE 类型三方员工，并将厂商 SSE 归一化为 ConnectorEvent。 */
export class ThirdPartyInterfaceSseConnector implements AgentConnector {
  readonly id = THIRD_PARTY_INTERFACE_SSE_CONNECTOR_ID;
  readonly capabilities: ConnectorCapabilities = {
    completionMode: "events",
    streaming: true,
    cancellation: true,
    artifacts: false,
    resumable: false,
    attachments: false,
  };

  readonly #descriptors: ExecutionDescriptorClient;
  readonly #fetch: typeof globalThis.fetch;
  readonly #requestTimeoutMs: number;

  constructor(options: ThirdPartyInterfaceSseConnectorOptions) {
    this.#descriptors = options.descriptors;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 300_000;
  }

  async start(
    request: ConnectorRequest,
    context: { signal: AbortSignal },
  ): Promise<ConnectorExecution> {
    const beyondToken = metadataString(request.metadata, "Beyond-Token");
    const systemCode = metadataString(request.metadata, "System-Code");
    const descriptor = await this.#descriptors.get({
      resourceId: request.agent.execution.targetId,
      beyondToken,
      ...(systemCode ? { systemCode } : {}),
      expectedIntegrationType: "INTERFACE",
      signal: context.signal,
    });
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(context.signal.reason);
    context.signal.addEventListener("abort", forwardAbort, { once: true });
    const cancel = async (reason: string) => {
      controller.abort(new Error(reason));
    };
    return {
      ref: {
        connectorId: this.id,
        executionId: request.delegationId,
        metadata: {
          resourceId: descriptor.resourceId,
          ...(descriptor.revision !== undefined
            ? { descriptorRevision: descriptor.revision }
            : {}),
        },
      },
      events: this.#events(request, descriptor, controller, () =>
        context.signal.removeEventListener("abort", forwardAbort),
      ),
      cancel,
    };
  }

  async health(): Promise<ConnectorHealth> {
    return this.#descriptors.health();
  }

  async *#events(
    request: ConnectorRequest,
    descriptor: Awaited<ReturnType<ExecutionDescriptorClient["get"]>>,
    controller: AbortController,
    cleanup: () => void,
  ): AsyncIterable<ConnectorEvent> {
    let output = "";
    try {
      const connectController = new AbortController();
      const connectTimeout = setTimeout(
        () => connectController.abort(new Error("Third-party INTERFACE connection timed out")),
        this.#requestTimeoutMs,
      );
      let response: Response;
      try {
        response = await this.#fetch(descriptor.endpoint, {
          method: "POST",
          headers: {
            accept: "text/event-stream",
            "content-type": "application/json",
            ...descriptor.headers,
          },
          body: JSON.stringify({
            chatContent: request.task,
            sessionId: request.sessionId,
            chatId: request.delegationId,
            agentId: request.agent.execution.targetId,
            stream: true,
            redList: [],
            blackList: [],
            deepThink: false,
            extParam: {},
            language: "zh-CN",
            histories: [],
            versionType: 1,
          }),
          signal: AbortSignal.any([controller.signal, connectController.signal]),
        });
      } finally {
        clearTimeout(connectTimeout);
      }
      if (!response.ok) {
        yield failed(
          "THIRD_PARTY_HTTP_ERROR",
          `Third-party INTERFACE returned HTTP ${response.status}`,
          response.status >= 500,
        );
        return;
      }
      if (!response.body) {
        yield failed(
          "THIRD_PARTY_EMPTY_STREAM",
          "Third-party INTERFACE returned an empty response body",
          true,
        );
        return;
      }
      for await (const event of parseSse(response.body)) {
        if (event.data.trim() === "[DONE]") {
          yield completed(output);
          return;
        }
        const parsed = safeJsonParse(event.data);
        const error = extractError(parsed);
        if (error) {
          yield failed("THIRD_PARTY_PROTOCOL_ERROR", error, false);
          return;
        }
        const text = extractText(parsed);
        if (text) {
          output += text;
          yield { type: "output_delta", text };
        }
        if (isTerminal(parsed)) {
          yield completed(output);
          return;
        }
        if (!text && parsed !== undefined) {
          // 该 HTTP 流只对应当前委派；无可展示文本的业务帧仍可证明执行活动。
          yield { type: "activity" };
        }
      }
      if (output) {
        yield completed(output);
      } else {
        yield failed(
          "THIRD_PARTY_STREAM_ENDED",
          "Third-party INTERFACE stream ended without output or a terminal event",
          true,
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw abortError(controller.signal.reason);
      }
      yield failed(
        "THIRD_PARTY_REQUEST_FAILED",
        error instanceof Error ? error.message : String(error),
        true,
      );
    } finally {
      cleanup();
    }
  }
}

function completed(output: string): ConnectorEvent {
  const result: AgentResult = {
    status: "completed",
    output,
    artifacts: [],
  };
  return { type: "completed", result };
}

function failed(
  code: string,
  message: string,
  retryable: boolean,
): ConnectorEvent {
  return { type: "failed", error: { code, message, retryable } };
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 3 || !value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (first && typeof first === "object") {
    const delta = (first as Record<string, unknown>).delta;
    if (delta && typeof delta === "object") {
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === "string") {
        return content;
      }
    }
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.data === "string") {
    const nested = safeJsonParse(record.data);
    return nested === undefined
      ? record.data
      : extractText(nested, depth + 1);
  }
  return extractText(record.data, depth + 1);
}

function extractError(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error;
  }
  if (record.error && typeof record.error === "object") {
    const message = (record.error as Record<string, unknown>).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function isTerminal(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.done === true || record.completed === true) {
    return true;
  }
  const choices = Array.isArray(record.choices) ? record.choices : [];
  return choices.some(
    (choice) =>
      choice &&
      typeof choice === "object" &&
      Boolean((choice as Record<string, unknown>).finish_reason),
  );
}

function abortError(reason: unknown): Error {
  const error = new Error(
    reason instanceof Error ? reason.message : "Connector request aborted",
  );
  error.name = "AbortError";
  return error;
}
