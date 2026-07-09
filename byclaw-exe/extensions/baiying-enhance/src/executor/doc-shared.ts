/**
 * Shared DOC utilities used by BOTH the SDK default path (`doc-gateway.ts`)
 * and the raw ioredis fallback (`doc-redis.ts`).
 *
 * Anything in here must be backend-neutral:
 *   - Types describing a DOC async request / ack / poll result
 *   - Parameter parsing helpers (call mode, route mode, timeouts, session id)
 *   - Redis env-var config + polling + diagnosis (works against any `Redis`
 *     client the caller supplies — the SDK passes its SDK-built client, the
 *     raw fallback passes its own `new Redis(...)`)
 *
 * By moving these out of `doc-redis.ts` we make the canonical default path
 * (`doc-gateway.ts`) completely independent of the raw fallback.
 */

import type { Dict, ResourceContext } from "./types.js";
import { asString, isRecord } from "./types.js";
import { extractOpenclawMcpForwardHeaders } from "./capability-builder.js";
import { resolveChannelRequestContextBySessionKey } from "../channel-session-resolve.js";

// `readRedisConfig` / `pollDocResult` / `diagnoseTraceInSessionStreams` and the
// delta-callback / poll-result / redis-config types moved to `@byclaw/shared`
// (the call-agent delegation closure). Re-export them so existing baiying-enhance
// importers keep working from this module path.
export {
  readRedisConfig,
  pollDocResult,
  diagnoseTraceInSessionStreams,
  type RedisConfig,
  type DocDeltaCallback,
  type DocPollResult,
} from "../../../shared/src/call-agent-doc.js";

function normalizeLangfuseTraceId(value: unknown): string {
  const text = asString(value);
  return /^[0-9a-f]{32}$/i.test(text) && !/^0+$/i.test(text) ? text.toLowerCase() : "";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocAsyncSendParams = {
  content: string;
  sessionId: string;
  channelTraceId?: string;
  targetAgentType: string;
  targetWorkerId: string;
  tenantId: string;
  extraPayload: Dict;
  routeMode: "agent_type" | "worker" | "capability";
  parentMessageId: string;
  metadata?: Dict;
};

export type DocAsyncAck = {
  message_id: string;
  trace_id: string;
  session_id: string;
  target_agent_type: string;
  target_worker_id: string;
  tenant_id: string;
  stream_name: string;
  route_mode: string;
  redis_msgid: string;
  accepted_at_ms: number;
};

export type DocAsyncDefaults = {
  target_agent_type: string;
  target_worker_id: string;
  tenant_id: string;
  agent_id: string;
};

// ---------------------------------------------------------------------------
// Parameter parsing
// ---------------------------------------------------------------------------

export function docAsyncDefaults(): DocAsyncDefaults {
  return {
    target_agent_type: (process.env.BAIYING_DOC_TARGET_AGENT_TYPE ?? "instant-search-agent").trim(),
    target_worker_id: (process.env.BAIYING_DOC_TARGET_WORKER_ID ?? "instant-search-worker-1").trim(),
    tenant_id: (process.env.BAIYING_DOC_TENANT_ID ?? "local-test").trim(),
    agent_id: (process.env.BAIYING_DOC_AGENT_ID ?? "10025189").trim(),
  };
}

/**
 * Resolve DOC call mode:
 *   - `sync`  (default) — send + poll until a final event, return the answer
 *   - `async`           — send only, return the ack immediately; completion
 *     is pushed in via HTTP `/doc-async/complete` or other callers of
 *     `docAsyncState.complete` / `fail`.
 *
 * Precedence: parameters.doc_call_mode → BAIYING_DOC_CALL_MODE env var → default.
 */
export function docCallMode(parameters: Dict): "sync" | "async" {
  const raw =
    String(parameters.doc_call_mode ?? process.env.BAIYING_DOC_CALL_MODE ?? "sync")
      .trim()
      .toLowerCase();
  return raw === "async" ? "async" : "sync";
}

export function docRouteMode(parameters: Dict): "agent_type" | "worker" | "capability" {
  const mode = String(parameters.doc_route_mode ?? process.env.BAIYING_DOC_ROUTE_MODE ?? "agent_type")
    .trim()
    .toLowerCase();
  if (mode === "agent_type" || mode === "worker" || mode === "capability") {
    return mode;
  }
  return "agent_type";
}

export function docSyncTimeoutSec(parameters: Dict): number {
  const raw = parameters.doc_timeout_sec ?? process.env.BAIYING_DOC_SYNC_TIMEOUT_SEC ?? "600";
  const value = Number.parseInt(String(raw), 10);
  const safe = Number.isFinite(value) ? value : 45;
  return Math.max(3, Math.min(safe, 600));
}

export function docSyncIntervalSec(parameters: Dict): number {
  const raw = parameters.doc_interval_sec ?? process.env.BAIYING_DOC_SYNC_INTERVAL_SEC ?? "1.5";
  const value = Number.parseFloat(String(raw));
  const safe = Number.isFinite(value) ? value : 1.5;
  return Math.max(0.2, Math.min(safe, 10.0));
}

/** Mirror of `_resolve_doc_session_id`. */
export function resolveDocSessionId(requestPayload: Dict, datasetId: unknown): string {
  const topLevel = isRecord(requestPayload) ? asString(requestPayload.session_id) : "";
  if (topLevel) return topLevel;
  const resourceContext: ResourceContext = isRecord(requestPayload)
    ? (isRecord(requestPayload.resource_context) ? (requestPayload.resource_context as ResourceContext) : {})
    : {};
  const forward = extractOpenclawMcpForwardHeaders(resourceContext);
  const headerSid = (forward["X-Session-Id"] ?? forward["x-session-id"] ?? "").trim();
  if (headerSid) return headerSid;
  const channelSid = asString(resourceContext.channel_session_id);
  if (channelSid) return channelSid;
  const envSid = (process.env.BAIYING_SESSION ?? "").trim();
  if (envSid) return envSid;
  return `doc-${datasetId}-${Date.now()}`;
}

/** Resolve channel trace id passthrough for DOC requests. */
export function resolveDocChannelTraceId(requestPayload: Dict): string {
  const topLevel = isRecord(requestPayload)
    ? asString(requestPayload.channel_trace_id) || asString(requestPayload.trace_id)
    : "";
  if (topLevel) return topLevel;
  const resourceContext: ResourceContext = isRecord(requestPayload)
    ? (isRecord(requestPayload.resource_context) ? (requestPayload.resource_context as ResourceContext) : {})
    : {};
  const forward = extractOpenclawMcpForwardHeaders(resourceContext);
  const headerTraceId =
    (forward["channel-trace-id"] ??
      forward["Channel-Trace-Id"] ??
      forward["x-channel-trace-id"] ??
      forward["X-Channel-Trace-Id"] ??
      "").trim();
  if (headerTraceId) return headerTraceId;
  const channelTraceId = asString(resourceContext.channel_trace_id);
  if (channelTraceId) return channelTraceId;
  return "";
}

export function resolveLangfuseParentObservationId(requestPayload: Dict): string {
  const topLevel = isRecord(requestPayload)
    ? asString(requestPayload.langfuseParentObservationId) ||
      asString(requestPayload.langfuse_parent_observation_id)
    : "";
  if (topLevel) return topLevel;
  const resourceContext: ResourceContext = isRecord(requestPayload)
    ? (isRecord(requestPayload.resource_context) ? (requestPayload.resource_context as ResourceContext) : {})
    : {};
  return (
    asString(resourceContext.langfuse_parent_observation_id) ||
    asString(resourceContext.langfuseParentObservationId)
  );
}

export function resolveLangfuseTraceId(requestPayload: Dict): string {
  const topLevel = isRecord(requestPayload)
    ? asString(requestPayload.langfuseTraceId) || asString(requestPayload.langfuse_trace_id)
    : "";
  if (topLevel) return normalizeLangfuseTraceId(topLevel) || topLevel;
  const resourceContext: ResourceContext = isRecord(requestPayload)
    ? (isRecord(requestPayload.resource_context) ? (requestPayload.resource_context as ResourceContext) : {})
    : {};
  const resourceTraceId = asString(resourceContext.langfuse_trace_id) || asString(resourceContext.langfuseTraceId);
  if (resourceTraceId) return normalizeLangfuseTraceId(resourceTraceId) || resourceTraceId;
  return normalizeLangfuseTraceId(resolveDocChannelTraceId(requestPayload));
}

export function getCommonGatewayMetadata(parameters: Dict): Dict {
  const resourceContext: ResourceContext = isRecord(parameters)
    ? (isRecord(parameters.resource_context) ? (parameters.resource_context as ResourceContext) : {})
    : {};
  const sessionKey =
    asString(parameters.session_key) ||
    asString(parameters.requester_session_key) ||
    asString(resourceContext.session_key) ||
    asString(resourceContext.requester_session_key);
  const sharedContext = resolveChannelRequestContextBySessionKey(sessionKey);
  const sharedFields =
    sharedContext?.fields &&
    typeof sharedContext.fields === "object" &&
    !Array.isArray(sharedContext.fields)
      ? (sharedContext.fields as Dict)
      : {};
  const requestHeaders =
    sharedFields.request_headers &&
    typeof sharedFields.request_headers === "object" &&
    !Array.isArray(sharedFields.request_headers)
      ? (sharedFields.request_headers as Dict)
      : {};
  const language =
    asString(resourceContext.language) ||
    asString(sharedFields.language);
  const beyondToken =
    asString(resourceContext.beyondToken) ||
    asString(requestHeaders["Beyond-Token"]) ||
    asString(sharedFields.beyondToken);
  /** Omit empty `Beyond-Token` so callers merging `request_headers` after `applyEnvAuthOverrides` do not wipe `BEYOND_TOKEN` from env. */
  const request_headers: Dict = {};
  if (beyondToken) {
    request_headers["Beyond-Token"] = beyondToken;
  }
  return {
    "channel-trace-id": asString(sharedContext?.traceId),
    "language": language,
    request_headers,
  };
}
