import type { Dict } from "./types.js";
import { isRecord } from "./types.js";

type FetchLike = typeof fetch;

type Pending = {
  resolve: (value: Dict) => void;
  reject: (reason: unknown) => void;
};

function normalizeId(id: unknown): string {
  return String(id ?? "");
}

function parseJsonRpcMessages(value: unknown): Dict[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as Dict[];
  }
  if (isRecord(value)) return [value as Dict];
  return [];
}

export async function runLegacySseJsonRpcSequence(params: {
  sseUrl: string;
  headers: Record<string, string>;
  requests: Array<{ payload: Dict; expectResponse: boolean }>;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<{ responses: Dict[]; endpointUrl: string }> {
  const fetchFn = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("legacy sse timeout")), params.timeoutMs);
  const pending = new Map<string, Pending>();
  const inbox = new Map<string, Dict>();
  let endpointUrl = "";
  let endpointResolve: ((url: string) => void) | null = null;
  let endpointReject: ((reason: unknown) => void) | null = null;
  const endpointReady = new Promise<string>((resolve, reject) => {
    endpointResolve = resolve;
    endpointReject = reject;
  });

  const failAll = (reason: unknown): void => {
    for (const item of pending.values()) {
      item.reject(reason);
    }
    pending.clear();
    endpointReject?.(reason);
  };

  const dispatchMessage = (msg: Dict): void => {
    const id = normalizeId(msg.id);
    if (!id) return;
    const waiter = pending.get(id);
    if (waiter) {
      pending.delete(id);
      waiter.resolve(msg);
      return;
    }
    inbox.set(id, msg);
  };

  const sseRes = await fetchFn(params.sseUrl, {
    method: "GET",
    headers: {
      ...params.headers,
      Accept: "text/event-stream",
    },
    signal: controller.signal,
  });
  if (!sseRes.ok || !sseRes.body) {
    clearTimeout(timer);
    throw new Error(`legacy sse connect failed: HTTP ${sseRes.status}`);
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const streamTask = (async () => {
    let buffer = "";
    let currentEvent = "";
    let dataLines: string[] = [];
    const flushEvent = (): void => {
      if (dataLines.length === 0) {
        currentEvent = "";
        return;
      }
      const data = dataLines.join("\n").trim();
      dataLines = [];
      const eventName = currentEvent.trim().toLowerCase();
      currentEvent = "";
      if (!data) return;

      if ((eventName === "endpoint" || eventName === "") && !endpointUrl) {
        if (data.startsWith("http://") || data.startsWith("https://") || data.startsWith("/")) {
          endpointUrl = data.startsWith("http://") || data.startsWith("https://")
            ? data
            : new URL(data, params.sseUrl).toString();
          endpointResolve?.(endpointUrl);
        }
      }

      for (const msg of parseJsonRpcMessages((() => {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      })())) {
        dispatchMessage(msg);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = -1;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) {
          flushEvent();
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }
    if (buffer.trim() || dataLines.length > 0) {
      if (buffer.trim()) {
        const line = buffer.replace(/\r$/, "");
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      flushEvent();
    }
    if (!endpointUrl) {
      throw new Error("legacy sse endpoint event not received");
    }
  })();

  try {
    const endpoint = await endpointReady;
    const responses: Dict[] = [];

    for (const req of params.requests) {
      const postRes = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          ...params.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.payload ?? {}),
        signal: controller.signal,
      });
      if (postRes.status >= 400) {
        throw new Error(`legacy sse POST failed: HTTP ${postRes.status}`);
      }
      if (!req.expectResponse) continue;
      const reqId = normalizeId(req.payload.id);
      if (!reqId) continue;

      if (inbox.has(reqId)) {
        responses.push(inbox.get(reqId)!);
        inbox.delete(reqId);
        continue;
      }
      const next = await new Promise<Dict>((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
      });
      responses.push(next);
    }
    return { responses, endpointUrl: endpoint };
  } finally {
    controller.abort();
    await streamTask.catch((err) => {
      failAll(err);
    });
    clearTimeout(timer);
    reader.releaseLock();
  }
}
