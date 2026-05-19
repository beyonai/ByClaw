import type { Dict, ExecutorFailure } from "./types.js";
import { isRecord } from "./types.js";
import { makeError, authError } from "./errors.js";

export type HttpResult = {
  response: Response;
  status: number;
};

/**
 * Wrapper around global fetch that never throws for HTTP errors.
 * Mirrors the behavior of `_post_json` in the Python executor.
 */
export async function postJson(params: {
  url: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ response: Response; bodyText: string } | { error: ExecutorFailure }> {
  const controller = new AbortController();
  const cleanupTimer = setTimeout(() => controller.abort(new Error("request timed out")), params.timeoutMs);
  const externalSignal = params.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });
    }
  }
  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(params.payload ?? {}),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(cleanupTimer);
    return { error: makeError("REQUEST_FAILED", err instanceof Error ? err.message : String(err)) };
  }
  const bodyText = await response.text().catch(() => "");
  clearTimeout(cleanupTimer);

  if (response.status === 401 || response.status === 403) {
    return { error: authError(bodyText.slice(0, 200)) };
  }
  return { response, bodyText };
}

export async function postMultipartForm(params: {
  url: string;
  formData: FormData;
  headers: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ response: Response; bodyText: string } | { error: ExecutorFailure }> {
  const controller = new AbortController();
  const cleanupTimer = setTimeout(() => controller.abort(new Error("request timed out")), params.timeoutMs);
  const externalSignal = params.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });
    }
  }
  const requestHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers)) {
    if (k.toLowerCase() === "content-type") continue;
    requestHeaders[k] = v;
  }
  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      headers: requestHeaders,
      body: params.formData,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(cleanupTimer);
    return { error: makeError("REQUEST_FAILED", err instanceof Error ? err.message : String(err)) };
  }
  const bodyText = await response.text().catch(() => "");
  clearTimeout(cleanupTimer);

  if (response.status === 401 || response.status === 403) {
    return { error: authError(bodyText.slice(0, 200)) };
  }
  return { response, bodyText };
}

/** Tries to parse a response body as JSON; returns `null` on failure. */
export function tryParseJson(text: string): Dict | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Mirror of `_extract_jsonrpc_payload`.
 * Handles both `application/json` and `text/event-stream` responses.
 */
export function extractJsonRpcPayload(response: Response, bodyText: string): Dict | null {
  const text = bodyText ?? "";
  if (!text.trim()) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (isRecord(parsed)) return parsed;
      } catch {
        // ignore malformed line
      }
    }
    return null;
  }

  return tryParseJson(text);
}

/**
 * Issue a streaming POST and iterate SSE `data:` lines.
 * Mirror of `_parse_sse` + `response.iter_lines()`.
 */
export async function readSseEvents(params: {
  url: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
  onEventStream?: (data: Dict) => void;
}): Promise<{ response: Response; events: Dict[]; bodyPreview: string } | { error: ExecutorFailure }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request timed out")), params.timeoutMs);
  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify(params.payload ?? {}),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      error: makeError(
        "AGENT_REQUEST_FAILED",
        err instanceof Error ? err.message : String(err),
      ),
    };
  }

  const previewChunks: string[] = [];
  if (response.status === 401 || response.status === 403) {
    clearTimeout(timer);
    const text = await response.text().catch(() => "");
    return { error: authError(text.slice(0, 200)) };
  }
  if (!response.ok) {
    clearTimeout(timer);
    const text = await response.text().catch(() => "");
    return {
      error: makeError("AGENT_REQUEST_FAILED", `HTTP ${response.status}: ${text.slice(0, 200)}`),
    };
  }

  const events: Dict[] = [];
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  if (!response.body) {
    clearTimeout(timer);
    const text = await response.text().catch(() => "");
    return { response, events, bodyPreview: text.slice(0, 500) };
  }

  const { onEventStream } = params;

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (previewChunks.join("").length < 4096) {
        previewChunks.push(chunk);
      }
      buffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        if (line.startsWith("data:")) {
          const data = line.slice("data:".length).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (isRecord(parsed)) {
              events.push(parsed);
              onEventStream?.(parsed);
            }
          } catch {
            // ignore malformed line
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  // flush trailing line if any
  if (buffer) {
    const line = buffer.replace(/\r$/, "");
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          const parsed = JSON.parse(data);
          if (isRecord(parsed)) {
            events.push(parsed);
            onEventStream?.(parsed);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return { response, events, bodyPreview: previewChunks.join("").slice(0, 500) };
}
