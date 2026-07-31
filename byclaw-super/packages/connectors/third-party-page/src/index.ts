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
  UserInteractionResponse,
} from "@byclaw/by-conductor";
import {
  ExecutionDescriptorClient,
  metadataString,
} from "@byclaw/connector-third-party-common";

export const THIRD_PARTY_PAGE_CONNECTOR_ID = "third-party-page";

export interface ThirdPartyPageConnectorOptions {
  descriptors: ExecutionDescriptorClient;
}

type DeferredResponse = {
  promise: Promise<UserInteractionResponse>;
  resolve(response: UserInteractionResponse): void;
};

/** 把 PAGE 类型三方员工转换为持久化 input_required，而不是请求页面 URL。 */
export class ThirdPartyPageConnector implements AgentConnector {
  readonly id = THIRD_PARTY_PAGE_CONNECTOR_ID;
  readonly capabilities: ConnectorCapabilities = {
    streaming: false,
    cancellation: true,
    artifacts: false,
    resumable: true,
    attachments: false,
  };

  readonly #descriptors: ExecutionDescriptorClient;

  constructor(options: ThirdPartyPageConnectorOptions) {
    this.#descriptors = options.descriptors;
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
      expectedIntegrationType: "PAGE",
      signal: context.signal,
    });
    const ref: ExternalExecutionRef = {
      connectorId: this.id,
      executionId: request.delegationId,
      metadata: {
        resourceId: descriptor.resourceId,
        agentId: request.agent.id,
        agentName: request.agent.name,
        sessionId: request.sessionId,
        runId: request.runId,
        task: request.task,
        ...(descriptor.revision !== undefined
          ? { descriptorRevision: descriptor.revision }
          : {}),
      },
    };
    return this.#execution(ref, context.signal, true);
  }

  async resume(
    ref: ExternalExecutionRef,
    context: { signal: AbortSignal; cursor?: string },
  ): Promise<ConnectorExecution> {
    if (ref.connectorId !== this.id) {
      throw new Error(`Cannot resume a different connector: ${ref.connectorId}`);
    }
    return this.#execution(ref, context.signal, false);
  }

  async health(): Promise<ConnectorHealth> {
    return this.#descriptors.health();
  }

  #execution(
    ref: ExternalExecutionRef,
    signal: AbortSignal,
    emitRequest: boolean,
  ): ConnectorExecution {
    const deferred = deferredResponse();
    let cancelled = false;
    const cancel = async () => {
      cancelled = true;
      deferred.resolve({ action: "cancel" });
    };
    const events = pageEvents(ref, signal, deferred, emitRequest, () => cancelled);
    return {
      ref,
      events,
      cancel,
      respondToInput: async (_interactionId, response) => {
        deferred.resolve(response);
      },
    };
  }
}

async function* pageEvents(
  ref: ExternalExecutionRef,
  signal: AbortSignal,
  deferred: DeferredResponse,
  emitRequest: boolean,
  isCancelled: () => boolean,
): AsyncIterable<ConnectorEvent> {
  const metadata = ref.metadata ?? {};
  const interactionId = ref.executionId;
  if (emitRequest) {
    yield {
      type: "input_required",
      interactionId,
      request: {
        kind: "external_page",
        questions: [],
        uiPayload: {
          sessionId: jsonValue(metadata.sessionId),
          runId: jsonValue(metadata.runId),
          delegationId: interactionId,
          agentId: jsonValue(metadata.agentId),
          agentName: jsonValue(metadata.agentName),
          args: {
            input: jsonValue(metadata.task),
          },
        },
      },
      resumeToken: {
        resourceId: jsonValue(metadata.resourceId),
        ...(metadata.descriptorRevision !== undefined
          ? { descriptorRevision: jsonValue(metadata.descriptorRevision) }
          : {}),
      },
    };
  }
  const response = await waitForResponse(deferred.promise, signal);
  if (response.action === "cancel" || isCancelled()) {
    yield {
      type: "failed",
      error: {
        code: "PAGE_INTERACTION_CANCELLED",
        message: "User cancelled the third-party PAGE interaction",
        retryable: false,
      },
    };
    return;
  }
  const output =
    response.action === "skip"
      ? "User skipped the third-party PAGE interaction."
      : response.text || JSON.stringify(response.answers ?? {});
  const result: AgentResult = {
    status: "completed",
    output,
    artifacts: [],
  };
  yield { type: "completed", result };
}

function deferredResponse(): DeferredResponse {
  let settled = false;
  let resolvePromise!: (response: UserInteractionResponse) => void;
  const promise = new Promise<UserInteractionResponse>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(response) {
      if (!settled) {
        settled = true;
        resolvePromise(response);
      }
    },
  };
}

async function waitForResponse(
  promise: Promise<UserInteractionResponse>,
  signal: AbortSignal,
): Promise<UserInteractionResponse> {
  if (signal.aborted) {
    throw abortError(signal.reason);
  }
  return new Promise<UserInteractionResponse>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response);
      },
      reject,
    );
  });
}

function jsonValue(value: JsonValue | undefined): JsonValue {
  return value ?? "";
}

function abortError(reason: unknown): Error {
  const error = new Error(
    reason instanceof Error ? reason.message : "Connector request aborted",
  );
  error.name = "AbortError";
  return error;
}
