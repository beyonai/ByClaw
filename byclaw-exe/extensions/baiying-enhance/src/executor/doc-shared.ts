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

import type { Redis } from "ioredis";
import type { Dict, ResourceContext } from "./types.js";
import { asString, isRecord } from "./types.js";
import { extractOpenclawMcpForwardHeaders } from "./capability-builder.js";
import { resolveChannelRequestContextBySessionKey } from "../channel-session-resolve.js";

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

/** Options read from env only; unset keys are omitted (library defaults apply). */
export type RedisConfig = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  db?: number;
};

/**
 * Streaming callback invoked once for every `answerDelta` event observed
 * during polling. `accumulated` is the concatenation of all delta chunks
 * seen so far (consumers that need incremental display should prefer this
 * over `chunk`). `eventType` is the raw event_type string from the source
 * message (e.g. `"answerDelta"` variants), kept in case consumers want to
 * differentiate sub-streams.
 */
export type DocDeltaCallback = (
  chunk: string,
  accumulated: string,
  eventType: string,
) => void | Promise<void>;

export type DocPollResult = {
  success: boolean;
  event_type: string;
  /**
   * Aggregated answer text: prefers the concatenation of `answerDelta` events'
   * content over the terminal event's standalone text, because workers
   * typically stream the real answer as many `answerDelta` chunks and the
   * terminal `appStreamResponse` only carries a short marker (e.g. a file
   * path to a saved report). Falls back to the terminal content if no deltas
   * were observed.
   */
  text: string;
  /** Terminal event's own content (kept for diagnostics). */
  terminal_text?: string;
  /** Concatenation of all `answerDelta` events observed during polling. */
  delta_text?: string;
  raw_message?: Dict;
  matched_stream_id?: string;
  stream_name: string;
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


export function readRedisConfig(): RedisConfig {
  const config: RedisConfig = {};
  const host = (process.env.REDIS_HOST ?? "").trim();
  if (host) config.host = host;

  const portRaw = (process.env.REDIS_PORT ?? "").trim();
  if (portRaw) {
    const n = Number.parseInt(portRaw, 10);
    if (Number.isFinite(n)) config.port = n;
  }

  const username = (process.env.REDIS_USERNAME ?? "").trim();
  if (username) config.username = username;

  const password = process.env.REDIS_PASSWORD;
  if (password !== undefined && password !== "") {
    config.password = password;
  }

  const dbRaw = (process.env.REDIS_DATABASE ?? "").trim();
  if (dbRaw) {
    const n = Number.parseInt(dbRaw, 10);
    if (Number.isFinite(n)) config.db = n;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Stream parsing helpers (internal)
// ---------------------------------------------------------------------------

function fieldsToRecord(fields: unknown): Record<string, string> {
  const record: Record<string, string> = {};
  if (!Array.isArray(fields)) return record;
  for (let i = 0; i + 1 < fields.length; i += 2) {
    record[String(fields[i])] = String(fields[i + 1]);
  }
  return record;
}

function extractDocDataMessage(rawData: string): Dict | null {
  if (!rawData || !rawData.trim()) return null;
  try {
    const parsed = JSON.parse(rawData);
    if (!isRecord(parsed)) return null;
    if ("event_type" in parsed && "session_id" in parsed) {
      return parsed;
    }
    const nested = parsed.data;
    if (isRecord(nested) && "event_type" in nested && "session_id" in nested) {
      return nested;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the raw answer text from a `DataMessage.data` payload.
 *
 * IMPORTANT: we return content VERBATIM — no `.trim()` — because workers
 * commonly split answers across many `answerDelta` chunks where whitespace
 * (`"\n\n"`, `"  "`, etc.) carries formatting intent (paragraph breaks,
 * Markdown list indentation). Trimming would silently drop those chunks and
 * produce a shorter, mis-formatted aggregate.
 */
function extractDocTextFromData(data: unknown): string {
  if (!isRecord(data)) return "";
  const directContent = typeof data.content === "string" ? data.content : "";
  if (directContent) return directContent;
  const directText = typeof data.text === "string" ? data.text : "";
  if (directText) return directText;
  const directMessage = typeof data.message === "string" ? data.message : "";
  if (directMessage) return directMessage;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const chunks: string[] = [];
  for (const choice of choices) {
    if (!isRecord(choice)) continue;
    const delta = choice.delta;
    if (!isRecord(delta)) continue;
    const txt = typeof delta.content === "string" ? delta.content : "";
    if (txt) chunks.push(txt);
  }
  return chunks.join("");
}

function isDocFinalEvent(eventType: string, stateMsg = ""): { isFinal: boolean; isError: boolean } {
  const et = String(eventType ?? "").trim().toLowerCase();
  const sm = String(stateMsg ?? "").trim().toLowerCase();
  if (et.includes("error") || et.includes("fail") || sm.includes("异常") || sm.includes("失败")) {
    return { isFinal: true, isError: true };
  }
  if ([ "finalanswer"].some((token) => et.includes(token))) {
    return { isFinal: true, isError: false };
  }
  return { isFinal: false, isError: false };
}

// ---------------------------------------------------------------------------
// Session-stream polling + trace diagnosis
// ---------------------------------------------------------------------------

/**
 * Subscribe to a session data stream until a terminal event appears.
 *
 * Uses Redis `XREAD BLOCK <intervalMs> STREAMS <key> <lastId>` — the same
 * blocking-read primitive the gateway SDK's `WorkerRunner` uses internally
 * for its CTRL-stream consumers (the SDK itself does NOT expose a data-stream
 * subscriber; `GatewayDataEmitter` only writes). Advantages over the previous
 * `xrange + setTimeout` polling:
 * - **Near-zero latency**: every `answerDelta` chunk reaches `onDelta` as
 *   soon as the worker `xadd`s it (typically within the block's jitter, not
 *   after a fixed 1.5 s interval).
 * - **No duplicated work**: we advance a cursor `lastId` across calls, so
 *   each event is seen exactly once with no per-iteration dedupe set needed.
 * - **Tight cancellation**: the BLOCK is capped at `blockMs`, so the abort
 *   signal is checked between short blocking reads.
 *
 * Aggregation + streaming semantics:
 * - Each `answerDelta` event triggers `onDelta(chunk, accumulated, eventType)`
 *   so upstream tools (e.g. `baiying_call`) can forward to OpenClaw's
 *   `AgentToolUpdateCallback` in real time.
 * - When the terminal event arrives, if its content contains text that the
 *   delta stream did not cover (typical for workers that append a final
 *   marker like `"报告已保存到：/qa/*.md"`), one final `onDelta` is emitted
 *   with the full aggregated text so the UI's last frame matches the tool's
 *   returned `text`.
 *
 * Filtering: must match `sessionId`; `traceId` / `messageId` are matched
 * loosely (only skip when both sides are non-empty and differ) because
 * workers assign fresh ids on reply events. `sinceMs` bounds the initial
 * cursor to `"${sinceMs}-0"` so we ignore events from prior requests on the
 * same session.
 */
export async function pollDocResult(params: {
  redis: Redis;
  sessionId: string;
  traceId: string;
  messageId: string;
  timeoutSec: number;
  /**
   * XREAD BLOCK timeout (seconds). Also used as the abort-check cadence.
   * Defaults to 1.5 s to balance latency and responsiveness.
   */
  intervalSec: number;
  /** Accept events with stream id >= `${sinceMs}-0`. Defaults to epoch 0. */
  sinceMs?: number;
  /**
   * Override the stream name. Defaults to `byai_gateway:session:<sid>:data_stream`.
   * The SDK-backed path passes `QueueNames.session_data_stream(sid)` to keep
   * its key names in sync with the gateway SDK constants.
   */
  streamName?: string;
  /**
   * Progressive streaming hook — called once for every `answerDelta` event
   * as it arrives, plus once more with the final aggregated text when the
   * terminal event contributes content beyond the delta stream.
   */
  onDelta?: DocDeltaCallback;
  /** Cancellation signal. Polling stops and returns early when aborted. */
  signal?: AbortSignal;
  /**
   * After the terminal event is seen, keep draining the stream for this many
   * milliseconds to catch trailing `answerDelta` chunks that workers may
   * publish AFTER the terminal marker (e.g. a `"报告已保存到：/qa/*.md"`
   * suffix that is written only once the report file is flushed to disk).
   * Defaults to 1500ms.
   */
  postTerminalDrainMs?: number;
}): Promise<DocPollResult> {
  const start = Date.now();
  const streamName = params.streamName ?? `byai_gateway:session:${params.sessionId}:data_stream`;
  // Redis XREAD lower bound is EXCLUSIVE. Start just before sinceMs so events
  // emitted at the same millisecond as our ack are still observed.
  let lastId = `${Math.max(0, (params.sinceMs ?? 0) - 1)}-0`;
  const blockMs = Math.max(200, Math.min(Math.round(params.intervalSec * 1000), 5000));
  const drainMs = params.postTerminalDrainMs ?? 1500;
  const deltaParts: string[] = [];
  let latestDeltaText = "";

  // Terminal state captured when we first see a final event; we keep
  // draining the stream after this to pick up trailing deltas.
  let terminalSeen = false;
  let terminalIsError = false;
  let terminalEventType = "";
  let terminalText = "";
  let terminalMsg: Dict | undefined;
  let terminalStreamId = "";
  let drainStart = 0;

  async function emitDelta(chunk: string, accumulated: string, eventType: string) {
    if (!params.onDelta) return;
    try {
      await params.onDelta(chunk, accumulated, eventType);
    } catch {
      // streaming callback errors must never abort the poll
    }
  }

  const xread = (readBlockMs: number) =>
    (params.redis as unknown as {
      xread(...args: Array<string | number>): Promise<unknown>;
    })
      .xread("BLOCK", readBlockMs, "COUNT", 500, "STREAMS", streamName, lastId)
      .catch(() => null);

  while (true) {
    if (params.signal?.aborted) break;

    // Outer termination conditions:
    //   1. Sync timeout reached and terminal never seen → return timeout.
    //   2. Terminal seen AND drainMs elapsed with no new events in the last
    //      XREAD → return success with whatever we have.
    if (!terminalSeen && (Date.now() - start) / 1000 > params.timeoutSec) break;
    if (terminalSeen && Date.now() - drainStart >= drainMs) break;

    const readBlockMs = terminalSeen
      ? Math.min(blockMs, Math.max(50, drainMs - (Date.now() - drainStart)))
      : blockMs;

    const reply = await xread(readBlockMs);
    if (!reply) {
      // No new events within BLOCK. If draining after terminal, we're done.
      if (terminalSeen) break;
      continue;
    }

    const streams = reply as Array<[string, Array<[string, string[]]>]>;
    let sawAnyEventThisBatch = false;
    for (const [, entries] of streams) {
      for (const [streamId, fields] of entries) {
        lastId = String(streamId);
        sawAnyEventThisBatch = true;

        const fieldRecord = fieldsToRecord(fields);
        const rawData = fieldRecord.data ?? "";
        if (!rawData) continue;
        const msg = extractDocDataMessage(rawData);
        if (!msg) continue;
        if (asString(msg.session_id) !== params.sessionId) continue;
        const msgTraceId = asString(msg.trace_id);
        if (params.traceId && msgTraceId && msgTraceId !== params.traceId) continue;
        const msgMessageId = asString(msg.message_id);
        if (params.messageId && msgMessageId && msgMessageId !== params.messageId) continue;

        const eventType = asString(msg.event_type);
        const stateMsg = asString(msg.state_msg);
        const eventText = extractDocTextFromData(msg.data) || stateMsg;
        if (eventType.toLowerCase().includes("answerdelta") && eventText) {
          deltaParts.push(eventText);
          latestDeltaText = eventText;
          await emitDelta(eventText, deltaParts.join(""), eventType);
          continue;
        }
        const { isFinal, isError } = isDocFinalEvent(eventType, stateMsg);
        if (!isFinal) continue;
        if (terminalSeen) continue; // ignore additional terminals while draining

        terminalSeen = true;
        terminalIsError = isError;
        terminalEventType = eventType;
        terminalText = eventText;
        terminalMsg = msg;
        terminalStreamId = String(streamId);
        drainStart = Date.now();
      }
    }

    // If drain started and this batch also had trailing events, keep looping;
    // otherwise let the outer `while` condition decide.
    void sawAnyEventThisBatch;
  }

  const delta = deltaParts.join("");

  if (!terminalSeen) {
    return {
      success: false,
      event_type: params.signal?.aborted ? "aborted" : "timeout",
      text: delta || `轮询超时，${params.timeoutSec}s 内未收到 final/error 事件`,
      delta_text: delta,
      stream_name: streamName,
    };
  }

  const aggregatedText =
    delta.length >= terminalText.length
      ? delta || terminalText || latestDeltaText
      : terminalText;

  // Top-up onDelta: if the final aggregated text differs from what the delta
  // stream pushed (e.g. terminal carries extra content, or worker published
  // trailing delta AFTER terminal), emit one last full-text update so the
  // UI's final frame matches the returned `text`.
  if (aggregatedText && aggregatedText !== delta) {
    await emitDelta("", aggregatedText, terminalEventType);
  }

  return {
    success: !terminalIsError,
    event_type: terminalEventType,
    text: aggregatedText,
    terminal_text: terminalText,
    delta_text: delta,
    raw_message: terminalMsg,
    matched_stream_id: terminalStreamId,
    stream_name: streamName,
  };
}

/** Mirror of `_diagnose_trace_in_session_streams`. */
export async function diagnoseTraceInSessionStreams(params: {
  redis: Redis;
  traceId: string;
  limitStreams?: number;
  eachStreamRows?: number;
}): Promise<{
  matched: boolean;
  trace_id?: string;
  reason?: string;
  scanned_stream_count?: number;
  matched_streams?: Array<{ stream_name: string; stream_id: string }>;
}> {
  if (!params.traceId) return { matched: false, reason: "trace_id empty" };
  const limitStreams = params.limitStreams ?? 300;
  const eachStreamRows = params.eachStreamRows ?? 20;
  const matched: Array<{ stream_name: string; stream_id: string }> = [];
  let scanned = 0;
  let cursor = "0";
  try {
    do {
      const scan = (await params.redis.scan(
        cursor,
        "MATCH",
        "byai_gateway:session:*:data_stream",
        "COUNT",
        "300",
      )) as [string, string[]];
      cursor = String(scan?.[0] ?? "0");
      const keys = Array.isArray(scan?.[1]) ? (scan[1] as string[]) : [];
      for (const key of keys) {
        scanned += 1;
        if (scanned > limitStreams) break;
        let rows: Array<[string, string[]]> = [];
        try {
          rows = (await params.redis.xrevrange(key, "+", "-", "COUNT", eachStreamRows)) as Array<
            [string, string[]]
          >;
        } catch {
          continue;
        }
        for (const [streamId, fields] of rows) {
          const fieldRecord = fieldsToRecord(fields);
          const rawData = fieldRecord.data ?? "";
          if (!rawData) continue;
          const msg = extractDocDataMessage(rawData);
          if (!msg) continue;
          if (asString(msg.trace_id) === params.traceId) {
            matched.push({ stream_name: key, stream_id: String(streamId) });
            break;
          }
        }
      }
    } while (cursor !== "0" && scanned <= limitStreams);
  } catch (e) {
    return {
      matched: false,
      reason: `scan_iter failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return {
    matched: matched.length > 0,
    trace_id: params.traceId,
    scanned_stream_count: scanned,
    matched_streams: matched,
  };
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
