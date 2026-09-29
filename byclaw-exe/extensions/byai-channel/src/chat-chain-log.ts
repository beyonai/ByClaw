import os from "node:os";

type Logger = { info?: (text: string) => void; warn?: (text: string) => void };
const instance = `${os.hostname()}:${process.pid}`;
const allowed = new Set(["requestId", "sessionId", "traceId", "runId", "streamId", "durationMs", "errorType", "phase", "reason", "pendingOutbound", "delegatedWork"]);
export function chatChainLog(log: Logger | undefined, stage: string, fields: Record<string, unknown>, result = "ok") {
  try {
    const entry: Record<string, unknown> = { time: Date.now(), service: "channel", instance, stage, result };
    for (const [key, value] of Object.entries(fields)) {
      if (allowed.has(key) && value != null) entry[key] = String(value).replace(/[\r\n\t]/g, "_").slice(0, 160);
    }
    const text = `chat_chain ${JSON.stringify(entry)}`;
    if (result === "ok") log?.info?.(text);
    else log?.warn?.(text);
  } catch { /* Diagnostics must never affect message delivery. */ }
}

/** Observe SDK pipeline replies without replacing commands or changing their result/error semantics.
 * Only the emitter receives this facade; the blocking consumer uses the original client.
 */
export function observeEmitterRedis<T extends object>(redis: T, log: Logger | undefined): T {
  return new Proxy(redis, {
    get(target, property) {
      if (property !== "pipeline") {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) => {
        const pipeline = (target as any).pipeline(...args);
        const terminals: { index: number; event: any }[] = [];
        const facade: any = new Proxy(pipeline, {
          get(pipe, name) {
            if (name === "exec") return async (...execArgs: unknown[]) => {
              const started = performance.now();
              const report = (replies: any, error?: unknown) => {
                for (const { index, event } of terminals) {
                  const reply = replies?.[index];
                  const failure = error || reply?.[0];
                  chatChainLog(log, "channel.final_written", {
                    requestId: event.metadata?.requestId || event.trace_id,
                    sessionId: event.session_id, traceId: event.trace_id,
                    streamId: !failure ? reply?.[1] : undefined,
                    durationMs: Math.round(performance.now() - started),
                    errorType: failure instanceof Error ? failure.name : undefined,
                  }, !failure && typeof reply?.[1] === "string" ? "ok" : "failed");
                }
              };
              try { const replies = await pipe.exec(...execArgs); report(replies); return replies; }
              catch (error) { report(undefined, error); throw error; }
            };
            const value = Reflect.get(pipe, name, pipe);
            if (typeof value !== "function") return value;
            return (...commandArgs: unknown[]) => {
              if (name === "xadd") {
                try {
                  const raw = commandArgs[3];
                  if (typeof raw === "string" && (raw.includes("appStreamResponse") || raw.includes('"error"'))) {
                    const event = JSON.parse(raw);
                    if (["appStreamResponse", "error"].includes(event.event_type)) terminals.push({ index: pipe.length, event });
                  }
                } catch { /* The SDK owns validation. */ }
              }
              const result = value.apply(pipe, commandArgs);
              return result === pipe ? facade : result;
            };
          },
        });
        return facade;
      };
    },
  });
}
