import type { ResourceContext } from "./types.js";

export type BaiyingEnhanceLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

/** Enable channel / trace debug logs for the whole baiying-enhance extension. */
export function baiyingEnhanceDebugEnabled(): boolean {
  const v = process.env.BAIYING_ENHANCE_DEBUG ?? process.env.BAIYING_CALL_DEBUG;
  if (v === undefined || v === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  const t = String(v).trim();
  return t;
}

/**
 * Prints `channel-session-id` and `channel-trace-id` when
 * `BAIYING_ENHANCE_DEBUG=1` or `BAIYING_CALL_DEBUG=1`.
 *
 * Reads from explicit args and from `resource_context` / `openclaw_mcp_headers`.
 */
export function logChannelDebug(
  tag: string,
  input: {
    resourceContext?: ResourceContext;
    channelSessionId?: unknown;
    channelTraceId?: unknown;
    logger?: BaiyingEnhanceLogger;
  },
): void {
  if (!baiyingEnhanceDebugEnabled()) return;

  const rc = input.resourceContext;
  let sessionId = str(input.channelSessionId);
  let traceId = str(input.channelTraceId);

  if (rc) {
    if (!sessionId) sessionId = str(rc.channel_session_id);
    if (!traceId) traceId = str(rc.channel_trace_id);
    const forward = rc.openclaw_mcp_headers;
    if (forward && typeof forward === "object" && !Array.isArray(forward)) {
      const h = forward as Record<string, unknown>;
      if (!sessionId) {
        sessionId =
          str(h["X-Session-Id"]) ||
          str(h["x-session-id"]) ||
          str(h["channel-session-id"]);
      }
      if (!traceId) {
        traceId =
          str(h["channel-trace-id"]) ||
          str(h["Channel-Trace-Id"]) ||
          str(h["x-channel-trace-id"]);
      }
    }
  }

  writeInfo(
    input.logger,
    `[baiying-enhance debug] ${tag} channel-session-id=${sessionId || "<empty>"} channel-trace-id=${traceId || "<empty>"}`,
  );
}

const SENSITIVE_KEY_PATTERN =
  /(^|[-_])(authorization|cookie|token|secret|password|passwd|api[-_]?key|access[-_]?key|beyond[-_]?token)([-_]|$)/i;

function writeInfo(logger: BaiyingEnhanceLogger | undefined, message: string): void {
  if (logger?.info) {
    logger.info(message);
    return;
  }
  console.warn(message);
}

function redactString(value: string): string {
  if (!value) return value;
  if (value.length <= 8) return "<redacted>";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "<max-depth>";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = typeof item === "string" ? redactString(item) : "<redacted>";
      continue;
    }
    out[key] = sanitizeForLog(item, depth + 1);
  }
  return out;
}

function stableStringify(value: unknown): string {
  const text = JSON.stringify(sanitizeForLog(value));
  if (!text) {
    return "";
  }
  const maxLen = 12_000;
  return text.length > maxLen ? `${text.slice(0, maxLen)}...(truncated ${text.length - maxLen} chars)` : text;
}

export function logBaiyingRequest(
  logger: BaiyingEnhanceLogger | undefined,
  stage: string,
  payload: Record<string, unknown>,
): void {
  writeInfo(logger, `[baiying-enhance request] ${stage} ${stableStringify(payload)}`);
}
