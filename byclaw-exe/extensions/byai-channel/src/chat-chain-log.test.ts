import { describe, expect, it, vi } from "vitest";
import { GatewayDataEmitter } from "@byclaw/by-framework";
import { chatChainLog, observeEmitterRedis } from "./chat-chain-log.js";

function fixture(replies: unknown = [[null, "123-0"], [null, 1]], failure?: Error) {
  const commands: unknown[][] = [];
  const pipeline = {
    get length() { return commands.length; },
    xadd(...args: unknown[]) { commands.push(["xadd", ...args]); return this; },
    expire(...args: unknown[]) { commands.push(["expire", ...args]); return this; },
    async exec() { if (failure) throw failure; return replies; },
  };
  const redis = { pipeline: () => pipeline, marker: "original", method() { return this.marker; } };
  const log = { info: vi.fn(), warn: vi.fn() };
  return { commands, pipeline, redis, log, observed: observeEmitterRedis(redis, log) };
}
const event = { event_type: "appStreamResponse", trace_id: "lane", session_id: "session", metadata: { requestId: "root" }, data: { secret: "never-log" } };

describe("chat delivery checkpoints", () => {
  it("observes actual SDK XADD replies and preserves commands and return values", async () => {
    const f = fixture();
    const emitter = new GatewayDataEmitter(f.observed as never, { sourceAgentType: "test" });
    await emitter.emitEvent({ sessionId: "session", traceId: "lane", eventType: "appStreamResponse" as never, metadata: { requestId: "root" } });
    expect(f.commands.map((cmd) => cmd[0])).toEqual(["xadd", "expire"]);
    const entry = JSON.parse(f.log.info.mock.calls[0][0].slice("chat_chain ".length));
    expect(entry).toMatchObject({ stage: "channel.final_written", requestId: "root", streamId: "123-0", result: "ok" });
    expect(f.observed.method()).toBe("original");
  });
  it("does not report success for pipeline per-command failures or change SDK semantics", async () => {
    const replies = [[new Error("secret"), null], [null, 1]];
    const f = fixture(replies);
    const result = await f.observed.pipeline().xadd("key", "*", "data", JSON.stringify(event)).expire("key", 60).exec();
    expect(result).toBe(replies);
    expect(f.log.info).not.toHaveBeenCalled();
    expect(f.log.warn.mock.calls[0][0]).toContain('"result":"failed"');
    expect(f.log.warn.mock.calls[0][0]).not.toContain("secret");
  });
  it("preserves connection errors and isolates a throwing logger", async () => {
    const error = new Error("connection failed");
    const f = fixture(undefined, error);
    f.log.warn.mockImplementation(() => { throw new Error("logger failed"); });
    await expect(f.observed.pipeline().xadd("key", "*", "data", JSON.stringify(event)).exec()).rejects.toBe(error);
  });
  it("does not log deltas or non-whitelisted fields", async () => {
    const f = fixture();
    await f.observed.pipeline().xadd("key", "*", "data", JSON.stringify({ ...event, event_type: "reasoningLogDelta" })).exec();
    expect(f.log.info).not.toHaveBeenCalled();
    chatChainLog(f.log, "worker.received", { requestId: "root", prompt: "never-log", token: "never-log" });
    expect(f.log.info.mock.calls[0][0]).not.toContain("never-log");
  });
});
