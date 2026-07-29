/**
 * Trimmed subset of baiying-enhance's `executor/doc-shared.ts`, containing only
 * the pieces `executeViaCallAgent` depends on:
 *   - Redis env-var config (`readRedisConfig`)
 *   - session-stream polling (`pollDocResult`) + trace diagnosis
 *     (`diagnoseTraceInSessionStreams`)
 *   - the delta-callback / poll-result / redis-config types
 *
 * The gateway-metadata / doc-session-id helpers stay in baiying-enhance because
 * they pull in `capability-builder` + `channel-session-resolve`, which the
 * call-agent path does not need.
 */

import type { Dict } from "./executor-types.js";
import { asString, isRecord } from "./executor-types.js";
import {
  byFrameworkRedisKeys,
  readRedisConfig,
  scanRedisKeys,
  sessionDataStreamScanPattern,
  type RedisClient,
  type RedisConnectionConfig,
} from "./redis-compat.js";

export { readRedisConfig };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options read from env only; unset keys are omitted (library defaults apply). */
export type RedisConfig = RedisConnectionConfig;

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
  matched_stream_id?: string;
  stream_name: string;
};

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
 * for its CTRL-stream consumers. Advances a cursor `lastId` across calls so
 * each event is seen exactly once, and caps the BLOCK at `blockMs` so the
 * abort signal is checked between short blocking reads.
 *
 * Aggregation + streaming semantics:
 * - Each `answerDelta` event triggers `onDelta(chunk, accumulated, eventType)`.
 * - When the terminal event arrives with content beyond the delta stream, one
 *   final `onDelta` is emitted with the full aggregated text so the UI's last
 *   frame matches the tool's returned `text`.
 *
 * Filtering: must match `sessionId`; `traceId` / `messageId` are matched
 * loosely (only skip when both sides are non-empty and differ). `sinceMs`
 * bounds the initial cursor so we ignore events from prior requests on the
 * same session.
 */
export async function pollDocResult(params: {
  redis: RedisClient;
  sessionId: string;
  traceId: string;
  messageId: string;
  timeoutSec?: number;
  intervalSec?: number;
  sinceMs?: number;
  streamName?: string;
  onDelta?: DocDeltaCallback;
  signal?: AbortSignal;
  postTerminalDrainMs?: number;
  toolCallId?: string;
}): Promise<DocPollResult> {
  const start = Date.now();
  const streamName = params.streamName ?? byFrameworkRedisKeys.sessionDataStream(params.sessionId);
  // Redis XREAD lower bound is EXCLUSIVE. Start just before sinceMs so events
  // emitted at the same millisecond as our ack are still observed.
  let lastId = `${Math.max(0, (params.sinceMs ?? 0) - 1)}-0`;
  const blockMs = Math.max(200, Math.min(Math.round((params.intervalSec ?? 1.5) * 1000), 5000));
  const drainMs = params.postTerminalDrainMs ?? 1500;
  const deltaParts: string[] = [];

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

    if (!terminalSeen && params.timeoutSec !== undefined && (Date.now() - start) / 1000 > params.timeoutSec) break;
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

    void sawAnyEventThisBatch;
    void terminalMsg;
  }

  const delta = deltaParts.join("");

  if (!terminalSeen) {
    return {
      success: false,
      event_type: params.signal?.aborted ? "aborted" : "timeout",
      text: delta || `轮询超时，${params.timeoutSec}s 内未收到 final/error 事件`,
      stream_name: streamName,
    };
  }

  const aggregatedText = terminalText || delta;

  // Top-up onDelta: if the final aggregated text differs from what the delta
  // stream pushed, emit one last full-text update so the UI's final frame
  // matches the returned `text`.
  if (aggregatedText && aggregatedText !== delta) {
    await emitDelta("", aggregatedText, terminalEventType);
  }

  return {
    success: !terminalIsError,
    event_type: terminalEventType,
    text: aggregatedText,
    matched_stream_id: terminalStreamId,
    stream_name: streamName,
  };
}

/** Mirror of `_diagnose_trace_in_session_streams`. */
export async function diagnoseTraceInSessionStreams(params: {
  redis: RedisClient;
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
  try {
    const keys = await scanRedisKeys(params.redis, sessionDataStreamScanPattern(), 300);
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
