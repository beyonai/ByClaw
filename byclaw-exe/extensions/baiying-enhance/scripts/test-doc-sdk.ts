/**
 * End-to-end smoke test for the DOC resource via the SDK backend.
 *
 * What it does:
 *   1. Sync call  — send via SDK + poll until final, then dump ALL session
 *      data stream events that appeared AFTER our ack (using Redis stream ids
 *      bounded by `accepted_at_ms`). Aggregates `answerDelta*` style event
 *      content plus terminal content so we can show the real answer.
 *   2. Async call — send via SDK only (executeDoc returns immediately), then
 *      this script polls the session data stream using the same logic until
 *      it sees a terminal event for our ack, and prints the aggregated answer.
 *
 * Why we can't just filter by trace_id/message_id:
 *   The worker reply events reuse the caller session_id but often carry their
 *   OWN trace_id / message_id (worker-generated). pollDocResult matches by
 *   session_id and only optionally by trace_id when both sides are non-empty.
 *   To scope the dump to "this request", we use `accepted_at_ms` from the ack
 *   as the lower bound for the Redis stream id (`(<ms>-0`).
 *
 * Run:
 *   pnpm tsx scripts/test-doc-sdk.ts
 */

import { createRedis, QueueNames } from "@byclaw/by-framework";
import { BaiyingExecutor } from "../src/executor/executor.js";
import type { Capability, Dict, ExecutorResponse } from "../src/executor/types.js";
import { isRecord } from "../src/executor/types.js";
import { executeDoc } from "../src/executor/resource-types/doc.js";
import { readRedisConfig } from "../src/executor/doc-shared.js";

const AGENT_ID = "10025189";
const SESSION_ID = "10045717";
const USER_CODE = "0027024710";
const QUERY = "我帮从知识库查询下亦庄的政策内容，我要研究下企业发展的战略如何规划制定";

if (!process.env.USER_CODE) process.env.USER_CODE = USER_CODE;
if (!process.env.BAIYING_DOC_SYNC_TIMEOUT_SEC) {
  process.env.BAIYING_DOC_SYNC_TIMEOUT_SEC = "120";
}

function buildDocCapability(): Capability {
  return {
    id: `baiying_${AGENT_ID}`,
    type: "capability",
    source: "baiying",
    name: `KG_DOC ${AGENT_ID}`,
    description: "DOC smoke test",
    resource_type: "KG_DOC",
    metadata: { resource_id: AGENT_ID },
    _discovery_source: "integration_test",
    doc: { dataset_id: AGENT_ID },
  };
}

// ---------------------------------------------------------------------------
// Stream parsing
// ---------------------------------------------------------------------------

type DumpedEvent = {
  stream_id: string;
  ts: number;
  event_type: string;
  source_agent_type: string;
  message_id: string;
  trace_id: string;
  content: string;
  state_msg: string;
};

function parseEvent(streamId: string, rawFields: string[]): DumpedEvent | null {
  const map: Record<string, string> = {};
  for (let i = 0; i + 1 < rawFields.length; i += 2) {
    map[rawFields[i]] = rawFields[i + 1];
  }
  const raw = map.data;
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  // The envelope can either be the DataMessage itself or wrap it under `.data`.
  const msg: Dict =
    "event_type" in parsed
      ? parsed
      : isRecord(parsed.data) && "event_type" in parsed.data
        ? (parsed.data as Dict)
        : parsed;

  const inner = isRecord(msg.data) ? (msg.data as Dict) : undefined;
  let content = "";
  if (inner) {
    content =
      typeof inner.content === "string"
        ? inner.content
        : typeof inner.text === "string"
          ? inner.text
          : typeof inner.message === "string"
            ? (inner.message as string)
            : "";
    if (!content && Array.isArray(inner.choices)) {
      const parts: string[] = [];
      for (const ch of inner.choices) {
        if (!isRecord(ch)) continue;
        const delta = ch.delta;
        if (isRecord(delta) && typeof delta.content === "string") {
          parts.push(delta.content);
        }
      }
      content = parts.join("");
    }
  }

  return {
    stream_id: streamId,
    ts: typeof msg.timestamp === "number" ? (msg.timestamp as number) : 0,
    event_type: String(msg.event_type ?? ""),
    source_agent_type: String(msg.source_agent_type ?? ""),
    message_id: String(msg.message_id ?? ""),
    trace_id: String(msg.trace_id ?? ""),
    content,
    state_msg: String(msg.state_msg ?? ""),
  };
}

async function xrangeSessionAfter(
  sessionId: string,
  sinceMs: number,
): Promise<DumpedEvent[]> {
  const cfg = readRedisConfig();
  const redis = createRedis({
    host: cfg.host,
    port: cfg.port,
    db: cfg.db,
    username: cfg.username,
    password: cfg.password,
  });
  try {
    const streamName = QueueNames.session_data_stream(sessionId);
    // Redis stream IDs are "<msTs>-<seq>". An exclusive lower bound is "(<id>"
    // (requires Redis 6.2+); fall back to inclusive "<ms>-0" otherwise.
    const startId = `${sinceMs}-0`;
    const rows = (await redis.xrange(streamName, startId, "+", "COUNT", 500)) as Array<
      [string, string[]]
    >;
    const events: DumpedEvent[] = [];
    for (const [streamId, fields] of rows) {
      const ev = parseEvent(streamId, fields);
      if (!ev) continue;
      events.push(ev);
    }
    return events;
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

function isTerminal(ev: DumpedEvent): { final: boolean; errored: boolean } {
  const et = ev.event_type.toLowerCase();
  const sm = ev.state_msg.toLowerCase();
  if (et.includes("error") || et.includes("fail") || sm.includes("异常") || sm.includes("失败")) {
    return { final: true, errored: true };
  }
  if (
    [
      "app_stream_response",
      "appstreamresponse",
      "final",
      "done",
      "complete",
      "completed",
    ].some((t) => et.includes(t))
  ) {
    return { final: true, errored: false };
  }
  if (["完成", "已完成", "done", "complete", "completed", "finished", "结束"].some((t) => sm.includes(t))) {
    return { final: true, errored: false };
  }
  return { final: false, errored: false };
}

function summarize(events: DumpedEvent[]): {
  aggregated: string;
  eventTypes: Record<string, number>;
  terminal?: DumpedEvent;
} {
  const eventTypes: Record<string, number> = {};
  let terminal: DumpedEvent | undefined;
  const deltaParts: string[] = [];
  for (const ev of events) {
    eventTypes[ev.event_type] = (eventTypes[ev.event_type] ?? 0) + 1;
    if (ev.content && ev.event_type.toLowerCase().includes("answerdelta")) {
      deltaParts.push(ev.content);
    }
    const { final } = isTerminal(ev);
    if (final) terminal = ev;
  }
  const termText = terminal?.content ?? "";
  // If the terminal carries final content and deltas were present, prefer the
  // larger of "concat deltas" vs "terminal text" (some workers repeat full
  // answer at terminal; others stream deltas and terminal is empty).
  const delta = deltaParts.join("");
  const aggregated = delta.length > termText.length ? delta : termText || delta;
  return { aggregated, eventTypes, terminal };
}

async function waitForTerminal(
  sessionId: string,
  sinceMs: number,
  timeoutSec: number,
): Promise<{ events: DumpedEvent[]; terminal?: DumpedEvent }> {
  const start = Date.now();
  let events: DumpedEvent[] = [];
  let terminal: DumpedEvent | undefined;
  while ((Date.now() - start) / 1000 <= timeoutSec) {
    events = await xrangeSessionAfter(sessionId, sinceMs);
    terminal = summarize(events).terminal;
    if (terminal) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { events, terminal };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function preview(text: string, max = 800): string {
  if (!text) return "<empty>";
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…(+${trimmed.length - max}chars)` : trimmed;
}

async function runSync(): Promise<{ result: ExecutorResponse; sinceMs: number }> {
  console.log("\n========================================");
  console.log("[sync] starting (streaming enabled)…");
  console.log("========================================");
  const sinceMs = Date.now();
  const t0 = Date.now();

  // Record every delta that arrives. The OpenClaw `AgentToolUpdateCallback`
  // convention is "full accumulated state per update"; we mimic that here.
  let deltaCount = 0;
  let topupCount = 0;
  let lastPreviewAt = 0;
  let lastAccumulatedLen = 0;
  const deltaTimestamps: number[] = [];

  const result = await executeDoc({
    capability: buildDocCapability(),
    parameters: {
      query: QUERY,
      agent_id: AGENT_ID,
      session_id: SESSION_ID,
      doc_backend: "sdk",
      doc_call_mode: "sync",
    },
    onDelta: (chunk, accumulated, eventType) => {
      const now = Date.now();
      deltaTimestamps.push(now);
      lastAccumulatedLen = accumulated.length;
      // chunk="" is the terminal-event top-up (full aggregated text).
      if (chunk === "") {
        topupCount += 1;
        console.log(
          `[sync][stream] TOP-UP (total=${accumulated.length}b, event=${eventType}) — ` +
            `UI now reflects final complete answer.`,
        );
        return;
      }
      deltaCount += 1;
      if (now - lastPreviewAt >= 2000) {
        console.log(
          `[sync][stream] #${deltaCount} +${chunk.length}b (total=${accumulated.length}b) ` +
            `event=${eventType} snippet="${chunk.replace(/\s+/g, " ").slice(0, 60)}${chunk.length > 60 ? "…" : ""}"`,
        );
        lastPreviewAt = now;
      }
    },
  });

  // Inter-arrival latency histogram (rough — tells us if XREAD-BLOCK actually
  // gives us realtime streaming vs batched bursts).
  const gaps: number[] = [];
  for (let i = 1; i < deltaTimestamps.length; i += 1) {
    gaps.push(deltaTimestamps[i] - deltaTimestamps[i - 1]);
  }
  const p50 = percentile(gaps, 0.5);
  const p95 = percentile(gaps, 0.95);
  const max = gaps.length ? Math.max(...gaps) : 0;
  console.log(
    `[sync] elapsed ${Date.now() - t0} ms (success=${result.success}) ` +
      `deltas=${deltaCount} topups=${topupCount} final_accumulated_chars=${lastAccumulatedLen} ` +
      `delta_gap_p50=${p50}ms p95=${p95}ms max=${max}ms`,
  );
  if (result.success) {
    const data = isRecord((result as Dict).data) ? ((result as Dict).data as Dict) : undefined;
    const poll = isRecord(data?.poll) ? (data!.poll as Dict) : undefined;
    const deltaLen = typeof poll?.delta_text === "string" ? (poll.delta_text as string).length : -1;
    const termLen = typeof poll?.terminal_text === "string" ? (poll.terminal_text as string).length : -1;
    const aggLen = typeof poll?.text === "string" ? (poll.text as string).length : -1;
    console.log(
      `[sync] lengths: delta_text=${deltaLen}b terminal_text=${termLen}b aggregated(poll.text)=${aggLen}b`,
    );
  }
  return { result, sinceMs };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function runAsync(): Promise<{ result: ExecutorResponse; sinceMs: number }> {
  console.log("\n========================================");
  console.log("[async] starting…");
  console.log("========================================");
  const sinceMs = Date.now();
  const t0 = Date.now();
  const result = await executeDoc({
    capability: buildDocCapability(),
    parameters: {
      query: QUERY,
      agent_id: AGENT_ID,
      session_id: SESSION_ID,
      doc_backend: "sdk",
      doc_call_mode: "async",
    },
  });
  console.log(`[async] elapsed ${Date.now() - t0} ms (success=${result.success})`);
  if (result.success) {
    const data = isRecord((result as Dict).data) ? ((result as Dict).data as Dict) : undefined;
    console.log(
      `[async] ack: message_id=${String(data?.message_id)} trace_id=${String(data?.trace_id)} ` +
        `session_id=${String(data?.session_id)} target_worker_id=${String(data?.target_worker_id)}`,
    );
  }
  return { result, sinceMs };
}

function printReport(label: string, events: DumpedEvent[]): void {
  const { aggregated, eventTypes, terminal } = summarize(events);
  console.log(`[${label}] events in session stream after ack: ${events.length}`);
  console.log(`[${label}] event_type counts: ${JSON.stringify(eventTypes)}`);
  if (terminal) {
    console.log(
      `[${label}] terminal: ${terminal.event_type} @ ${terminal.stream_id} source=${terminal.source_agent_type}`,
    );
  } else {
    console.log(`[${label}] terminal: <not found>`);
  }
  console.log(`[${label}] aggregated answer length: ${aggregated.length}`);
  console.log(`[${label}] aggregated answer:\n---`);
  console.log(preview(aggregated, 2000));
  console.log("---");
}

async function main(): Promise<void> {
  void new BaiyingExecutor({ resourcesDir: "/tmp/baiying-doc-smoke-nonexistent" });

  console.log(
    `[config] agent_id=${AGENT_ID} session_id=${SESSION_ID} user_code=${USER_CODE}\n` +
      `[config] redis=${process.env.REDIS_HOST ?? "(default 10.10.168.204)"}:${process.env.REDIS_PORT ?? "6379"}`,
  );

  // ---- Sync ----
  const { result: syncResult, sinceMs: syncSince } = await runSync();
  if (syncResult.success) {
    const data = isRecord((syncResult as Dict).data) ? ((syncResult as Dict).data as Dict) : undefined;
    const poll = isRecord(data?.poll) ? (data!.poll as Dict) : undefined;
    console.log(`[sync] poll.text (terminal event only): ${JSON.stringify(poll?.text ?? "")}`);
  }
  const syncEvents = await xrangeSessionAfter(SESSION_ID, syncSince);
  printReport("sync", syncEvents);

  // ---- Async ----
  const { result: asyncResult, sinceMs: asyncSince } = await runAsync();
  if (asyncResult.success) {
    console.log("[async] waiting for terminal event on session stream (up to 60s)…");
    const { events, terminal } = await waitForTerminal(SESSION_ID, asyncSince, 60);
    if (!terminal) {
      console.log("[async] ✘ no terminal event within timeout; dumping what we have:");
    }
    printReport("async", events);
  } else {
    console.log("[async] send failed, skipping wait");
  }
}

main()
  .then(() => {
    console.log("\n✔ smoke test finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n✘ smoke test failed:", err);
    process.exit(1);
  });
