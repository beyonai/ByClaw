import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRedisRuntimeUpdateGate,
  createRuntimeUpdateQueue,
  RuntimeUpdateDeferredError,
} from "../../shared/src/redis-runtime-update-gate.js";

// Opt in against a disposable local Redis, never a configured business instance.
const socket = process.env.RUNTIME_UPDATE_TEST_SOCKET;
const integration = socket ? describe : describe.skip;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

integration("runtime update Lua against an isolated Redis", () => {
  let redis: Redis;
  const cleanup: string[][] = [];
  const makeGate = (idleMs = 3_000) => {
    const gate = createRedisRuntimeUpdateGate({ redis, scope: `test-${randomUUID()}`, idleMs });
    cleanup.push(gate.keys);
    return gate;
  };
  const makeIdle = async (gate: ReturnType<typeof makeGate>) => {
    await gate.pending("__initialize_test_gate");
    await redis.hset(gate.keys[0], "idleSince", String(Date.now() - 3_100));
  };
  beforeAll(async () => {
    redis = new Redis({ path: socket!, lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
  });
  afterEach(async () => { for (const keys of cleanup.splice(0)) await redis.del(...keys); });
  afterAll(async () => { await redis?.quit(); });

  it("does not touch config during model/tool work, then waits three continuous idle seconds", async () => {
    const gate = makeGate();
    const write = vi.fn(async () => undefined);
    const queue = createRuntimeUpdateQueue({ gate });
    queue.register("agents", write);
    const model = await gate.acquireExecution();
    const tool = await gate.acquireExecution();
    await queue.enqueue("agents");
    await queue.drain();
    expect(write).not.toHaveBeenCalled();
    await model.release();
    await queue.drain();
    expect(write).not.toHaveBeenCalled();
    await tool.release();
    await queue.drain();
    expect(write).not.toHaveBeenCalled();
    await sleep(3_050);
    await queue.drain();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("new execution resets the idle window, and parallel claims cannot both acquire ownership", async () => {
    const gate = makeGate();
    await gate.enqueue("agents", {});
    await makeIdle(gate);
    const task = await gate.acquireExecution();
    expect(await gate.claim("agents")).toBeNull();
    await task.release();
    expect(await gate.claim("agents")).toBeNull();
    await makeIdle(gate);
    const second = createRedisRuntimeUpdateGate({ redis, scope: gate.keys[0].split("{")[1].split("}")[0] });
    const claims = await Promise.all([gate.claim("agents"), second.claim("agents")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    let admitted = false;
    const entering = second.acquireExecution().then((lease) => { admitted = true; return lease; });
    await sleep(70);
    expect(admitted).toBe(false);
    await gate.finish("agents", claim);
    await (await entering).release();
  });

  it("retains an aborted request until its original tool or dispatch actually settles", async () => {
    const gate = makeGate();
    const abort = new AbortController();
    const task = await gate.acquireExecution({ signal: abort.signal });
    const releaseOriginalDispatch = task.retain();
    await gate.enqueue("agents", {});
    abort.abort();
    await task.release();
    await makeIdle(gate);
    expect(await gate.claim("agents")).toBeNull();
    expect(await redis.scard(gate.keys[1])).toBe(1);
    await releaseOriginalDispatch();
    expect(await gate.claim("agents")).toBeNull();
    await makeIdle(gate);
    const claim = await gate.claim("agents");
    expect(claim).not.toBeNull();
    await gate.finish("agents", claim!);
  });

  it("keeps reload pending without applying it or blocking admission", async () => {
    const gate = makeGate();
    const queue = createRuntimeUpdateQueue({ gate });
    const handler = vi.fn(async () => { throw new RuntimeUpdateDeferredError("thinkingProviderIds changed"); });
    queue.register("agents", handler);
    await queue.enqueue("agents", { deletedSourceKeys: ["42"] });
    await makeIdle(gate);
    await queue.drain();
    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(1);
    const pending = await gate.pending("agents");
    expect(pending).toMatchObject({ blocked: true, error: "thinkingProviderIds changed" });
    const next = await gate.acquireExecution();
    await next.release();
  });

  it("merges delete/auth requests and preserves events arriving during an update", async () => {
    const gate = makeGate();
    await gate.enqueue("agents", { deletedSourceKeys: ["1"], fullWorkspaceReseed: true });
    await gate.enqueue("agents", { deletedSourceKeys: ["1", "2"], fullWorkspaceReseed: false });
    await makeIdle(gate);
    const claim = (await gate.claim("agents"))!;
    expect(claim.payload).toMatchObject({ deletedSourceKeys: ["1", "2"], fullWorkspaceReseed: true });
    await gate.enqueue("agents", { deletedSourceKeys: ["3"] });
    await gate.finish("agents", claim);
    const newer = (await gate.claim("agents"))!;
    expect(newer.payload.deletedSourceKeys).toEqual(["1", "2", "3"]);
    expect(newer.revision).toBeGreaterThan(claim.revision);
    await gate.finish("agents", newer);
    expect(await gate.pending("agents")).toBeNull();
  });

  it("keeps an update lock when Redis fails rather than admitting work on an expired TTL", async () => {
    const gate = makeGate();
    await gate.enqueue("agents", {});
    await makeIdle(gate);
    const claim = (await gate.claim("agents"))!;
    expect(await redis.pttl(gate.keys[0])).toBe(-1);
    const wrongOwner = { ...claim, owner: "different-owner" };
    await expect(gate.finish("agents", wrongOwner)).rejects.toThrow("ownership lost");
    const abort = new AbortController();
    const waiting = gate.acquireExecution({ signal: abort.signal });
    abort.abort(new Error("cancel waiting"));
    await expect(waiting).rejects.toThrow("cancel waiting");
    await gate.finish("agents", claim);
  });

  it("stop waits for an applying update rather than closing its resources mid-write", async () => {
    const gate = makeGate();
    const queue = createRuntimeUpdateQueue({ gate });
    let finish!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    queue.register("agents", async () => { started(); await new Promise<void>((resolve) => { finish = resolve; }); });
    await makeIdle(gate);
    const applied = queue.applyNow("agents");
    await began;
    let stopped = false;
    const stop = queue.stop().then(() => { stopped = true; });
    await sleep(10);
    expect(stopped).toBe(false);
    finish();
    await applied;
    await stop;
  });

  it("preserves pending across process generations while isolating crashed execution tokens", async () => {
    const scope = `test-${randomUUID()}`;
    const old = createRedisRuntimeUpdateGate({ redis, scope, generation: "old" });
    const current = createRedisRuntimeUpdateGate({ redis, scope, generation: "new" });
    cleanup.push(old.keys, current.keys);
    const task = await old.acquireExecution();
    await old.enqueue("agents", { deletedSourceKeys: ["42"] });
    expect(await current.pending("agents")).toMatchObject({ payload: { deletedSourceKeys: ["42"] } });
    await redis.hset(current.keys[0], "idleSince", String(Date.now() - 3_100));
    const claim = await current.claim("agents");
    expect(claim?.payload.deletedSourceKeys).toEqual(["42"]);
    await current.finish("agents", claim!);
    await task.release();
  });

  it.each(["state", "executions"])("fails closed if Redis loses the %s key during a task", async (lost) => {
    const gate = makeGate();
    const task = await gate.acquireExecution();
    await gate.enqueue("agents", {});
    await redis.del(gate.keys[lost === "state" ? 0 : 1]);
    await expect(gate.claim("agents")).rejects.toThrow("state lost");
    await expect(gate.acquireExecution()).rejects.toThrow("state lost");
    await expect(task.release()).rejects.toThrow("state lost");
  });

  it("retries FINISH after its response is lost without repeating the handler", async () => {
    const gate = makeGate();
    const finish = vi.fn(async (...args: Parameters<typeof gate.finish>) => {
      await gate.finish(...args);
      if (finish.mock.calls.length === 1) throw new Error("response lost");
    });
    const queue = createRuntimeUpdateQueue({ gate: { ...gate, finish } });
    const write = vi.fn(async () => undefined);
    queue.register("agents", write);
    await queue.enqueue("agents");
    await makeIdle(gate);
    await expect(queue.drain()).rejects.toThrow("response lost");
    await queue.drain();
    expect(finish).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
    await (await gate.acquireExecution()).release();
    await queue.stop();
  });

  it("stop tracks applyNow before enqueue resolves and prevents a late handler", async () => {
    const gate = makeGate();
    let complete!: () => void;
    const blockedEnqueue = new Promise<void>((resolve) => { complete = resolve; });
    const queue = createRuntimeUpdateQueue({ gate: { ...gate, enqueue: async (key, payload) => {
      await blockedEnqueue;
      await gate.enqueue(key, payload);
    } } });
    const write = vi.fn(async () => undefined);
    queue.register("agents", write);
    await makeIdle(gate);
    const applying = queue.applyNow("agents");
    let stopped = false;
    const stopping = queue.stop().then(() => { stopped = true; });
    await sleep(10);
    expect(stopped).toBe(false);
    complete();
    expect(await applying).toBe("pending");
    await stopping;
    expect(write).not.toHaveBeenCalled();
    expect(await gate.pending("agents")).not.toBeNull();
    await expect(queue.applyNow("agents")).rejects.toThrow("stopping");
  });

  it("keeps a newer FINISH retry when a parallel old acknowledgement arrives late", async () => {
    const gate = makeGate();
    let acknowledgeOld!: () => void;
    const lateAck = new Promise<void>((resolve) => { acknowledgeOld = resolve; });
    let startedOldRetry!: () => void;
    const oldRetry = new Promise<void>((resolve) => { startedOldRetry = resolve; });
    const finish = vi.fn(async (...args: Parameters<typeof gate.finish>) => {
      const attempt = finish.mock.calls.length;
      if (attempt === 4) throw new Error("new finish unavailable");
      await gate.finish(...args);
      if (attempt === 1) throw new Error("old response lost");
      if (attempt === 2) { startedOldRetry(); await lateAck; }
    });
    const queue = createRuntimeUpdateQueue({ gate: { ...gate, finish } });
    const write = vi.fn(async () => undefined);
    queue.register("agents", write);
    await makeIdle(gate);
    await expect(queue.applyNow("agents")).rejects.toThrow("old response lost");
    const draining = queue.drain();
    await oldRetry;
    await expect(queue.applyNow("agents")).rejects.toThrow("new finish unavailable");
    acknowledgeOld();
    await draining;
    await queue.drain();
    expect(write).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(5);
    expect(await redis.hget(gate.keys[0], "owner")).toBeNull();
    await queue.stop();
  });
});
