import type {
  AgentConnector,
  AgentResult,
  ArtifactRef,
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
  validateExternalUrl,
} from "@byclaw/connector-third-party-common";

export const THIRD_PARTY_A2A_CONNECTOR_ID = "third-party-a2a";

export interface ThirdPartyA2aConnectorOptions {
  descriptors: ExecutionDescriptorClient;
  fetchImpl?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  allowInsecureExternalHttp?: boolean;
  allowedExternalHosts?: readonly string[];
}

/** 通过 A2A Agent Card 和 message/stream 直接连接三方数字员工。 */
export class ThirdPartyA2aConnector implements AgentConnector {
  readonly id = THIRD_PARTY_A2A_CONNECTOR_ID;
  readonly capabilities: ConnectorCapabilities = {
    streaming: true,
    cancellation: true,
    artifacts: true,
    resumable: false,
    attachments: true,
  };

  readonly #descriptors: ExecutionDescriptorClient;
  readonly #fetch: typeof globalThis.fetch;
  readonly #requestTimeoutMs: number;
  readonly #allowInsecureExternalHttp: boolean;
  readonly #allowedExternalHosts: ReadonlySet<string>;

  constructor(options: ThirdPartyA2aConnectorOptions) {
    this.#descriptors = options.descriptors;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 300_000;
    this.#allowInsecureExternalHttp =
      options.allowInsecureExternalHttp ?? false;
    this.#allowedExternalHosts = new Set(
      (options.allowedExternalHosts ?? [])
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
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
      expectedIntegrationType: "A2A",
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
    const artifacts: ArtifactRef[] = [];
    try {
      const cardResponse = await this.#fetch(descriptor.endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...descriptor.headers,
        },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(this.#requestTimeoutMs),
        ]),
      });
      if (!cardResponse.ok) {
        yield failed(
          "A2A_CARD_HTTP_ERROR",
          `A2A Agent Card returned HTTP ${cardResponse.status}`,
          cardResponse.status >= 500,
        );
        return;
      }
      const card = record(await cardResponse.json());
      const rpcValue =
        stringValue(card?.url) ||
        stringValue(record(card?.interfaces)?.url) ||
        stringValue(record(card?.endpoint)?.url);
      if (!rpcValue) {
        yield failed(
          "A2A_CARD_INVALID",
          "A2A Agent Card does not contain an RPC URL",
          false,
        );
        return;
      }
      const rpcUrl = inheritSafeQuery(
        descriptor.endpoint,
        rpcValue,
        this.#allowInsecureExternalHttp,
        this.#allowedExternalHosts,
      );
      const connectController = new AbortController();
      const connectTimeout = setTimeout(
        () => connectController.abort(new Error("A2A streaming connection timed out")),
        this.#requestTimeoutMs,
      );
      let response: Response;
      try {
        response = await this.#fetch(rpcUrl, {
          method: "POST",
          headers: {
            accept: "text/event-stream",
            "content-type": "application/json",
            ...descriptor.headers,
          },
          body: JSON.stringify(buildJsonRpcRequest(request)),
          signal: AbortSignal.any([controller.signal, connectController.signal]),
        });
      } finally {
        clearTimeout(connectTimeout);
      }
      if (!response.ok) {
        yield failed(
          "A2A_RPC_HTTP_ERROR",
          `A2A message/stream returned HTTP ${response.status}`,
          response.status >= 500,
        );
        return;
      }
      if (!response.body) {
        yield failed(
          "A2A_EMPTY_STREAM",
          "A2A message/stream returned an empty response body",
          true,
        );
        return;
      }
      for await (const sse of parseSse(response.body)) {
        if (sse.data.trim() === "[DONE]") {
          yield completed(output, artifacts);
          return;
        }
        const parsed = safeJsonParse(sse.data);
        const rpc = record(parsed);
        const rpcError = record(rpc?.error);
        if (rpcError) {
          yield failed(
            "A2A_JSON_RPC_ERROR",
            stringValue(rpcError.message) || "A2A JSON-RPC error",
            false,
          );
          return;
        }
        const result = record(rpc?.result) ?? rpc;
        if (!result) {
          continue;
        }
        const kind = inferKind(result);
        if (kind === "message") {
          const text = extractPartsText(result.parts);
          if (text) {
            output += text;
            yield { type: "output_delta", text };
          }
          continue;
        }
        if (kind === "task") {
          const message =
            extractPartsText(record(result.status)?.message) ||
            extractTaskHistory(result);
          if (message) {
            yield { type: "progress", message };
          }
          continue;
        }
        if (kind === "status-update") {
          const status = record(result.status);
          const state = stringValue(status?.state).toLowerCase();
          const message = extractPartsText(status?.message);
          if (message) {
            if (isFailedState(state)) {
              yield failed("A2A_TASK_FAILED", message, false);
              return;
            }
            if (isCompletedState(state)) {
              if (message && !output.endsWith(message)) {
                output += message;
                yield { type: "output_delta", text: message };
              }
              yield completed(output, artifacts);
              return;
            }
            yield { type: "progress", message };
          } else if (isFailedState(state)) {
            yield failed(
              "A2A_TASK_FAILED",
              `A2A task entered ${state || "failed"} state`,
              false,
            );
            return;
          } else if (isCompletedState(state)) {
            yield completed(output, artifacts);
            return;
          } else {
            yield { type: "activity" };
          }
          continue;
        }
        if (kind === "artifact-update") {
          const artifact = toArtifact(result.artifact);
          if (artifact) {
            artifacts.push(artifact);
            yield { type: "artifact", artifact };
          }
          continue;
        }
        yield { type: "activity" };
      }
      if (output || artifacts.length > 0) {
        yield completed(output, artifacts);
      } else {
        yield failed(
          "A2A_STREAM_ENDED",
          "A2A stream ended without output or a terminal event",
          true,
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw abortError(controller.signal.reason);
      }
      yield failed(
        "A2A_REQUEST_FAILED",
        error instanceof Error ? error.message : String(error),
        true,
      );
    } finally {
      cleanup();
    }
  }
}

function buildJsonRpcRequest(request: ConnectorRequest): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [
    { kind: "text", text: request.task },
  ];
  for (const attachment of request.attachments) {
    if (!attachment.url) {
      throw new Error(
        `A2A attachment requires a remotely accessible URL: ${attachment.id}`,
      );
    }
    parts.push({
      kind: "file",
      file: {
        uri: attachment.url,
        name: attachment.name,
        ...(attachment.mediaType
          ? { mimeType: attachment.mediaType }
          : {}),
      },
    });
  }
  return {
    jsonrpc: "2.0",
    id: request.delegationId,
    method: "message/stream",
    params: {
      message: {
        kind: "message",
        role: "user",
        messageId: request.delegationId,
        contextId: request.sessionId,
        parts,
        metadata: {
          runId: request.runId,
          delegationId: request.delegationId,
        },
      },
    },
  };
}

function inheritSafeQuery(
  cardUrlValue: string,
  rpcUrlValue: string,
  allowInsecureHttp: boolean,
  allowedHosts: ReadonlySet<string>,
): string {
  const cardUrl = validateExternalUrl(cardUrlValue, {
    allowInsecureHttp,
    allowedHosts,
  });
  const rpcUrl = validateExternalUrl(new URL(rpcUrlValue, cardUrl).toString(), {
    allowInsecureHttp,
    allowedHosts,
  });
  if (cardUrl.origin === rpcUrl.origin) {
    for (const [name, value] of cardUrl.searchParams) {
      if (!rpcUrl.searchParams.has(name)) {
        rpcUrl.searchParams.append(name, value);
      }
    }
  }
  return rpcUrl.toString();
}

function inferKind(value: Record<string, unknown>): string {
  const declared = stringValue(value.kind).toLowerCase();
  if (declared) {
    return declared;
  }
  if (value.artifact) {
    return "artifact-update";
  }
  if (value.status) {
    return "status-update";
  }
  if (value.parts && value.role) {
    return "message";
  }
  if (value.history) {
    return "task";
  }
  return "";
}

function extractPartsText(value: unknown): string {
  const message = record(value);
  const parts = Array.isArray(value)
    ? value
    : Array.isArray(message?.parts)
      ? message.parts
      : [];
  return parts
    .map((part) => {
      const item = record(part);
      return stringValue(item?.text);
    })
    .filter(Boolean)
    .join("");
}

function extractTaskHistory(value: Record<string, unknown>): string {
  const history = Array.isArray(value.history) ? value.history : [];
  return history
    .map((item) => extractPartsText(record(item)?.parts ?? item))
    .filter(Boolean)
    .join("\n");
}

function toArtifact(value: unknown): ArtifactRef | undefined {
  const artifact = record(value);
  if (!artifact) {
    return undefined;
  }
  const id = stringValue(artifact.artifactId) || stringValue(artifact.id);
  const uri =
    stringValue(artifact.uri) ||
    stringValue(record(artifact.file)?.uri);
  if (!id || !uri) {
    return undefined;
  }
  return {
    id,
    uri,
    ...(stringValue(artifact.name)
      ? { name: stringValue(artifact.name) }
      : {}),
    ...(stringValue(artifact.mimeType)
      ? { mimeType: stringValue(artifact.mimeType) }
      : {}),
  };
}

function completed(
  output: string,
  artifacts: ArtifactRef[],
): ConnectorEvent {
  const result: AgentResult = {
    status: "completed",
    output,
    artifacts,
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

function isFailedState(state: string): boolean {
  return ["failed", "canceled", "cancelled", "rejected"].includes(state);
}

function isCompletedState(state: string): boolean {
  return ["completed", "succeeded", "done"].includes(state);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function abortError(reason: unknown): Error {
  const error = new Error(
    reason instanceof Error ? reason.message : "Connector request aborted",
  );
  error.name = "AbortError";
  return error;
}
