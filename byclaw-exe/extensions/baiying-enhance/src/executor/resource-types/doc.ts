import type { Capability, Dict, ExecutorResponse, ResourceContext } from "../types.js";
import { asString, isRecord } from "../types.js";
import type { AuthContext } from "../auth.js";
import { applyEnvAuthOverrides, mergeAuthHeaders, normalizeCustomHeaders } from "../auth.js";
import { makeError } from "../errors.js";
import { postJson, tryParseJson } from "../http.js";
import {
  diagnoseTraceInSessionStreams,
  docAsyncDefaults,
  docCallMode,
  docRouteMode,
  resolveDocChannelTraceId,
  docSyncIntervalSec,
  docSyncTimeoutSec,
  pollDocResult,
  resolveDocSessionId,
  type DocAsyncSendParams,
  type DocDeltaCallback,
  getCommonGatewayMetadata,
} from "../doc-shared.js";
import { executeDocViaSdk } from "../doc-gateway.js";
import { executeViaCallAgent } from "../call-agent.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "../debug-channel.js";
// Raw ioredis fallback. Only imported from here — this module is the only
// place that should reference `doc-redis.ts`, and only when the caller has
// explicitly opted into `BAIYING_DOC_BACKEND=raw`.
import { createRedisClient, sendDocAsyncMessage } from "../doc-redis.js";
import type Redis from "ioredis";

/** Which backend sends + polls the DOC ASK_AGENT command. */
export type DocBackend = "raw" | "sdk";

/**
 * Resolve the DOC backend at call time. Precedence:
 *   1. `parameters.doc_backend`
 *   2. `BAIYING_DOC_BACKEND` env var
 *   3. default `"sdk"` (via `@byclaw/by-framework`). Set to `"raw"` to fall back
 *      to the hand-rolled ioredis path in `doc-redis.ts`.
 */
export function resolveDocBackend(parameters: Dict): DocBackend {
  const raw =
    asString(parameters.doc_backend) ||
    (process.env.BAIYING_DOC_BACKEND ?? "").trim();
  const lowered = raw.toLowerCase();
  if (lowered === "raw") return "raw";
  if (lowered === "sdk") return "sdk";
  return "sdk";
}

/**
 * Mirror of `BaiYingExecutor._execute_doc`.
 *
 * Top-level flow:
 *   1. Validate the DOC capability + required parameters (`query`, `agent_id`).
 *   2. Resolve send parameters (route mode, target agent type / worker id, tenant).
 *   3. Pick the backend (`sdk` default, `raw` on opt-in).
 *   4. Delegate the entire send + poll to the backend-specific handler:
 *      - `sdk` → `executeDocViaSdk` (see `doc-gateway.ts`); both sync and
 *        async modes are handled end-to-end through the gateway SDK.
 *      - `raw` → `executeDocViaRaw` (below); preserves the original pure
 *        ioredis implementation so it keeps working as a fallback.
 */
export async function executeDoc(params: {
  capability: Capability;
  parameters: Dict;
  authContext: AuthContext;
  session?: string;
  /** Override the backend selection; if omitted, `resolveDocBackend` is used. */
  backend?: DocBackend;
  /** Testing hook for the raw backend: injects a custom ioredis client factory. */
  redisClientFactory?: () => Redis;
  /**
   * Progressive streaming hook. Forwarded to both SDK and raw backends;
   * invoked for every `answerDelta` event in sync call mode.
   */
  onDelta?: DocDeltaCallback;
  /** Cancellation signal for long-running sync polls. */
  signal?: AbortSignal;
  logger?: BaiyingEnhanceLogger;
}): Promise<ExecutorResponse> {
  const { capability } = params;
  const docInfo = isRecord(capability.doc) ? (capability.doc as Dict) : {};
  const datasetId = docInfo.dataset_id;
  if (!datasetId) {
    return makeError("DATASET_ID_NOT_FOUND", "Dataset ID not found");
  }

  const query = asString(params.parameters.query);
  const systemCode = asString(capability.metadata?.system_code).toUpperCase();
  const useKnowledgeApi = systemCode === "WHALE_AGENT";
  const useCallAgent = !useKnowledgeApi;
  const agentId = asString(params.parameters.agent_id);
  const missing: string[] = [];
  if (!query) missing.push("query");
  if (missing.length > 0) {
    return makeError("INVALID_PARAMETERS", `文档检索需要参数: ${missing.join(", ")}`, {
      target: {
        resource_id: capability.metadata?.resource_id,
        resource_type: capability.resource_type,
      },
      input_schema: {
        type: "object",
        required: useCallAgent || useKnowledgeApi ? ["query"] : ["query", "agent_id"],
        properties: {
          query: { type: "string" },
          agent_id: { type: "string" },
        },
      },
      missing_required_fields: missing,
    });
  }
  if (useKnowledgeApi) {
    return executeDocViaKnowledgeApi({
      capability,
      parameters: params.parameters,
      datasetId: String(datasetId),
      query,
      authContext: params.authContext,
      session: params.session,
      logger: params.logger,
      signal: params.signal,
    });
  }
  if (useCallAgent) {
    return executeDatasetDocViaCallAgent({
      capability,
      parameters: params.parameters,
      datasetId: String(datasetId),
      query,
      onDelta: params.onDelta,
      signal: params.signal,
      logger: params.logger,
    });
  }

  const defaults = docAsyncDefaults();
  const targetAgentType = asString(params.parameters.target_agent_type) || defaults.target_agent_type;
  const targetWorkerId = asString(params.parameters.target_worker_id) || defaults.target_worker_id;
  const tenantId = asString(params.parameters.tenant_id) || defaults.tenant_id;
  if (!targetAgentType || !targetWorkerId) {
    return makeError(
      "DOC_ASYNC_ROUTE_INVALID",
      "DOC async route is missing target_agent_type or target_worker_id",
    );
  }

  const sessionId = resolveDocSessionId(params.parameters, String(datasetId));
  const channelTraceId = resolveDocChannelTraceId(params.parameters);
  const routeMode = docRouteMode(params.parameters);
  const callMode = docCallMode(params.parameters);
  const backend: DocBackend = params.backend ?? resolveDocBackend(params.parameters);

  const sendParams: DocAsyncSendParams = {
    content: query,
    sessionId,
    targetAgentType,
    targetWorkerId,
    tenantId,
    extraPayload: {
      agent_id: agentId,
      ...(channelTraceId ? { "channel-trace-id": channelTraceId } : {}),
    },
    routeMode,
    channelTraceId,
    parentMessageId: params.parameters.tool_call_id as string,
    metadata: getCommonGatewayMetadata(params.parameters),
  };

  const syncTimeoutSec = docSyncTimeoutSec(params.parameters);
  const syncIntervalSec = docSyncIntervalSec(params.parameters);

  logBaiyingRequest(params.logger, "doc.dispatch", {
    resource_id: capability.metadata?.resource_id,
    resource_type: capability.resource_type,
    dataset_id: datasetId,
    backend,
    call_mode: callMode,
    route_mode: routeMode,
    sync_timeout_sec: syncTimeoutSec,
    sync_interval_sec: syncIntervalSec,
    parameters: params.parameters,
    send_params: sendParams,
  });

  if (backend === "sdk") {
    return executeDocViaSdk({
      capability,
      datasetId: String(datasetId),
      callMode,
      sendParams,
      syncTimeoutSec,
      syncIntervalSec,
      onDelta: params.onDelta,
      signal: params.signal,
    });
  }

  return executeDocViaRaw({
    capability,
    datasetId: String(datasetId),
    callMode,
    sendParams,
    syncTimeoutSec,
    syncIntervalSec,
    redisClientFactory: params.redisClientFactory,
    onDelta: params.onDelta,
    signal: params.signal,
  });
}

async function executeDatasetDocViaCallAgent(input: {
  capability: Capability;
  parameters: Dict;
  datasetId: string;
  query: string;
  onDelta?: DocDeltaCallback;
  signal?: AbortSignal;
  logger?: BaiyingEnhanceLogger;
}): Promise<ExecutorResponse> {
  const sessionId = resolveDocSessionId(input.parameters, input.datasetId);
  const channelTraceId = resolveDocChannelTraceId(input.parameters);
  const traceId = channelTraceId || `${sessionId}-${Date.now()}`;
  const defaultKbId = asString(input.capability.metadata?.resource_code) || input.datasetId;
  const callKbIds = stringList(input.parameters.call_kb_ids, [defaultKbId]);
  const agentId = asString(input.parameters.agent_id);
  const callMode = docCallMode(input.parameters);
  const syncTimeoutSec = docSyncTimeoutSec(input.parameters);
  const syncIntervalSec = docSyncIntervalSec(input.parameters);
  const targetAgentType =
    asString(input.parameters.target_agent_type) ||
    (process.env.BAIYING_DATASET_TARGET_AGENT_TYPE ?? "BYCLAW_QA").trim() ||
    "BYCLAW_QA";

  const payload: Dict = {
    call_kb_ids: callKbIds,
    agent_id: agentId,
  };
  if (channelTraceId) {
    payload["channel-trace-id"] = channelTraceId;
  }
  const metadata = getCommonGatewayMetadata(input.parameters);
  if (channelTraceId) {
    metadata["channel-trace-id"] = channelTraceId;
  }

  return executeViaCallAgent({
    capability: input.capability,
    content: input.query,
    payload,
    sessionId,
    traceId,
    targetAgentType,
    callMode,
    syncTimeoutSec,
    syncIntervalSec,
    responseType: "doc_call_agent",
    target: {
      resource_id: input.capability.metadata?.resource_id,
      dataset_id: input.datasetId,
      target_agent_type: targetAgentType,
      call_kb_ids: callKbIds,
      system_code: input.capability.metadata?.system_code,
    },
    metadata,
    onDelta: input.onDelta,
    signal: input.signal,
    logger: input.logger,
    parentMessageId: input.parameters.tool_call_id as string,
  });
}

type ExecuteDocViaKnowledgeApiInput = {
  capability: Capability;
  parameters: Dict;
  datasetId: string;
  query: string;
  authContext: AuthContext;
  session?: string;
  logger?: BaiyingEnhanceLogger;
  signal?: AbortSignal;
};

async function executeDocViaKnowledgeApi(
  input: ExecuteDocViaKnowledgeApiInput,
): Promise<ExecutorResponse> {
  let domainUrl =
    asString(input.capability.metadata?.domain_url) ||
    asString(input.parameters.doc_domain_url) ||
    asString(input.parameters.knowledge_base_url) ||
    (process.env.BAIYING_DOC_KNOWLEDGE_BASE_URL ?? "").trim();
  if (!domainUrl) {
    return makeError(
      "DOC_SEARCH_URL_NOT_FOUND",
      "WHALE_AGENT DOC 缺少 domain_url（元数据或 doc/ 快照中 domainURL / openapiSchema.servers），无法调用知识检索接口",
    );
  }
  const base = domainUrl.replace(/\/+$/, "");
  const url = `${base}/byclaw/file/api/v1/knowledge-items/search`;
  const knCodeListRaw = Array.isArray(input.parameters.knCodeList)
    ? (input.parameters.knCodeList as unknown[])
    : [];
  const knCodeList = knCodeListRaw
    .map((item) => (item == null ? "" : String(item).trim()))
    .filter(Boolean);
  if (knCodeList.length === 0) {
    const defaultKnCode = asString(input.capability.metadata?.resource_code) || input.datasetId;
    knCodeList.push(defaultKnCode);
  }
  const payload: Dict = {
    query: input.query,
    knCodeList,
  };
  for (const key of ["topK", "pageIndex", "pageSize", "similarity", "searchMode", "fileTypeList"] as const) {
    if (input.parameters[key] !== undefined) {
      payload[key] = input.parameters[key];
    }
  }

  const { request_headers } = getCommonGatewayMetadata(input.parameters);
  const { headers } = mergeAuthHeaders({
    baseHeaders: { "Content-Type": "application/json", "User-Agent": "OpenClaw/1.0" },
    authContext: input.authContext,
    session: input.session,
  });
  Object.assign(headers, normalizeCustomHeaders(input.capability.metadata?.default_headers));
  applyEnvAuthOverrides(headers);
  if (request_headers) {
    Object.assign(headers, request_headers);
  }

  logBaiyingRequest(input.logger, "doc.knowledge_search", {
    resource_id: input.capability.metadata?.resource_id,
    resource_type: input.capability.resource_type,
    url,
    payload,
    headers,
  });
  const result = await postJson({
    url,
    payload,
    headers,
    timeoutMs: 30_000,
    signal: input.signal,
  });
  if ("error" in result) return result.error;
  const parsed = tryParseJson(result.bodyText);
  return {
    success: true,
    type: "doc_search",
    status: "completed",
    backend: "knowledge_api",
    data: parsed ?? result.bodyText,
    target: {
      resource_id: input.capability.metadata?.resource_id,
      dataset_id: input.datasetId,
      kn_code: knCodeList[0],
      system_code: input.capability.metadata?.system_code,
    },
  };
}

// ---------------------------------------------------------------------------
// Raw ioredis backend (kept for back-compat; default is "sdk").
// ---------------------------------------------------------------------------

type ExecuteDocViaRawInput = {
  capability: Capability;
  datasetId: string;
  callMode: "sync" | "async";
  sendParams: DocAsyncSendParams;
  syncTimeoutSec: number;
  syncIntervalSec: number;
  redisClientFactory?: () => Redis;
  onDelta?: DocDeltaCallback;
  signal?: AbortSignal;
};

async function executeDocViaRaw(input: ExecuteDocViaRawInput): Promise<ExecutorResponse> {
  const client = (input.redisClientFactory ?? createRedisClient)();
  try {
    try {
      await client.connect();
    } catch (err) {
      return makeError("DOC_SYNC_CONNECT_FAILED", err instanceof Error ? err.message : String(err));
    }

    const sendRes = await sendDocAsyncMessage(client, input.sendParams);
    if (sendRes.error) return sendRes.error;
    const ack = sendRes.ack!;

    if (input.callMode === "async") {
      return {
        success: true,
        type: "doc_async",
        status: "running",
        backend: "raw",
        data: ack,
        target: buildTarget(input),
      };
    }

    const poll = await pollDocResult({
      redis: client,
      sessionId: input.sendParams.sessionId,
      traceId: ack.trace_id,
      messageId: ack.message_id,
      timeoutSec: input.syncTimeoutSec,
      intervalSec: input.syncIntervalSec,
      sinceMs: ack.accepted_at_ms,
      onDelta: input.onDelta,
      signal: input.signal,
    });

    if (!poll.success) {
      let diagnosis: unknown;
      if (poll.event_type === "timeout") {
        diagnosis = await diagnoseTraceInSessionStreams({
          redis: client,
          traceId: ack.trace_id,
        }).catch(() => undefined);
      }
      return makeError("DOC_SYNC_FAILED", poll.text || "DOC sync call failed", {
        type: "doc_sync",
        status: "failed",
        backend: "raw",
        data: { ack, poll: diagnosis !== undefined ? { ...poll, diagnosis } : poll },
        target: buildTarget(input),
      });
    }

    return {
      success: true,
      status: "completed",
      backend: "raw",
      data: { poll },
      type: "doc_sync",
      target: buildTarget(input),
    };
  } finally {
    await client.quit().catch(() => undefined);
  }
}

function buildTarget(input: ExecuteDocViaRawInput): Dict {
  return {
    resource_id: input.capability.metadata?.resource_id,
    dataset_id: input.datasetId,
    target_agent_type: input.sendParams.targetAgentType,
    target_worker_id: input.sendParams.targetWorkerId,
    route_mode: input.sendParams.routeMode,
  };
}

function stringList(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value) ? value : [];
  const values = raw
    .map((item) => (item == null ? "" : String(item).trim()))
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}
