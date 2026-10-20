import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";
import { createRedisClient, hasRedisConnectionConfig, readRedisConfig, type RedisClient } from "./redis-compat.js";

export const RUNTIME_UPDATE_IDLE_MS = 3_000;

export type RuntimeUpdatePayload = {
  fullWorkspaceReseed?: boolean;
  deletedSourceKeys?: string[];
  sessionId?: string;
  reason?: string;
};
export type RuntimeUpdateClaim = { owner: string; revision: number; payload: RuntimeUpdatePayload };
export type RuntimeExecutionLease = { release: () => Promise<void>; retain: () => () => Promise<void> };
export interface RuntimeUpdateGate {
  enqueue(key: string, payload: RuntimeUpdatePayload): Promise<void>;
  claim(key: string): Promise<RuntimeUpdateClaim | null>;
  finish(key: string, claim: RuntimeUpdateClaim, error?: { reason: string; blocked: boolean }): Promise<void>;
}
type Logger = { info?: (message: string) => void; warn?: (message: string) => void };

/** Deferred jobs remain in Redis; their old config must not be written. */
export class RuntimeUpdateDeferredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeUpdateDeferredError";
  }
}

const UPDATE_CONTEXT = new AsyncLocalStorage<boolean>();
export function isRuntimeUpdateApplying(): boolean {
  return UPDATE_CONTEXT.getStore() === true;
}
export function runRuntimeUpdateContext<T>(run: () => Promise<T>): Promise<T> {
  return UPDATE_CONTEXT.run(true, run);
}

// Pending survives a gateway restart. Live tokens belong to one process
// incarnation, so a crashed process never makes its replacement look busy.
export function resolveRuntimeUpdateScope(): string {
  const worker = process.env.BYAI_WORKER_ID?.trim() || `byai-channel-worker-${process.env.USER_CODE?.trim() || "unknown"}:${hostname()}`;
  return createHash("sha256").update(worker).digest("hex").slice(0, 32);
}
const PROCESS_GENERATION = `${process.pid}-${performance.timeOrigin}`;

const REDIS_TIME = `local t = redis.call('TIME'); local now = t[1] * 1000 + math.floor(t[2] / 1000)`;
const INITIALIZE = `
${REDIS_TIME}
if redis.call('EXISTS', KEYS[1]) == 0 then
  if redis.call('SCARD', KEYS[2]) ~= 0 then return redis.error_reply('Runtime execution state lost; maintenance required') end
  redis.call('HSET', KEYS[1], 'initialized', '1', 'active', '0', 'idleSince', now)
end
return 1`;
// Never reinitialize a gate after its first operation. Losing either key must
// fail closed, including Redis eviction/restart with ongoing model/tool work.
const CHECK_STATE = `
if redis.call('HGET', KEYS[1], 'initialized') ~= '1' or
  tonumber(redis.call('HGET', KEYS[1], 'active')) ~= redis.call('SCARD', KEYS[2]) then
  return redis.error_reply('Runtime execution state lost; maintenance required')
end`;
const ENTER = `
${CHECK_STATE}
if redis.call('HGET', KEYS[1], 'owner') then return 0 end
if redis.call('SADD', KEYS[2], ARGV[1]) == 1 then redis.call('HINCRBY', KEYS[1], 'active', 1) end
redis.call('HDEL', KEYS[1], 'idleSince')
return 1`;
const LEAVE = `
${CHECK_STATE}
${REDIS_TIME}
if redis.call('SREM', KEYS[2], ARGV[1]) == 1 then
  if redis.call('HINCRBY', KEYS[1], 'active', -1) == 0 then redis.call('HSET', KEYS[1], 'idleSince', now) end
end
return 1`;
const ENQUEUE = `
${CHECK_STATE}
${REDIS_TIME}
local raw = redis.call('HGET', KEYS[3], ARGV[1])
local job = raw and cjson.decode(raw) or {revision=0, payload={}}
local incoming = cjson.decode(ARGV[2])
local payload = job.payload
local deleted = {}; local seen = {}
for _, id in ipairs(payload.deletedSourceKeys or {}) do if not seen[id] then seen[id]=true; table.insert(deleted,id) end end
for _, id in ipairs(incoming.deletedSourceKeys or {}) do if not seen[id] then seen[id]=true; table.insert(deleted,id) end end
for k, v in pairs(incoming) do
  if k ~= 'deletedSourceKeys' and k ~= 'fullWorkspaceReseed' then payload[k] = v end
end
if payload.fullWorkspaceReseed or incoming.fullWorkspaceReseed then payload.fullWorkspaceReseed=true end
if #deleted > 0 then payload.deletedSourceKeys=deleted end
job.payload=payload; job.revision=job.revision+1
-- Explicit requests may retry a blocked update after the source changes.
job.blocked=nil
redis.call('HSET', KEYS[3], ARGV[1], cjson.encode(job))
if redis.call('SCARD', KEYS[2]) == 0 then redis.call('HSETNX', KEYS[1], 'idleSince', now) end
return job.revision`;
const CLAIM = `
${CHECK_STATE}
${REDIS_TIME}
local raw = redis.call('HGET', KEYS[3], ARGV[1])
if not raw or redis.call('HGET', KEYS[1], 'owner') or redis.call('SCARD', KEYS[2]) > 0 then return nil end
local job = cjson.decode(raw)
if job.blocked then return nil end
local idle = redis.call('HGET', KEYS[1], 'idleSince')
if not idle then redis.call('HSET', KEYS[1], 'idleSince', now); return nil end
if now - tonumber(idle) < tonumber(ARGV[3]) then return nil end
redis.call('HSET', KEYS[1], 'owner', ARGV[2], 'applying', ARGV[1])
return raw`;
const FINISH = `
${CHECK_STATE}
-- A successful FINISH response can be lost. Retrying that exact owner is safe.
if redis.call('HEXISTS', KEYS[1], 'finished:' .. ARGV[2]) == 1 then return 1 end
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[2] then return 0 end
local raw = redis.call('HGET', KEYS[3], ARGV[1])
if raw then
  local job = cjson.decode(raw)
  if job.revision == tonumber(ARGV[3]) then
    if ARGV[4] == '' then redis.call('HDEL', KEYS[3], ARGV[1])
    else
      job.error=ARGV[4]; job.blocked=ARGV[5] == '1' or nil
      redis.call('HSET', KEYS[3], ARGV[1], cjson.encode(job))
    end
  end
end
redis.call('HDEL', KEYS[1], 'owner', 'applying')
redis.call('HSET', KEYS[1], 'finished:' .. ARGV[2], '1')
return 1`;

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error(String(signal?.reason || "task cancelled"));
}
async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", cancelled); resolve(); }
    function cancelled() { clearTimeout(timer); signal?.removeEventListener("abort", cancelled); reject(abortError(signal)); }
    signal?.addEventListener("abort", cancelled, { once: true });
  });
}

export function createRedisRuntimeUpdateGate(params: {
  redis: Pick<RedisClient, "eval">;
  scope: string;
  generation?: string;
  idleMs?: number;
}) {
  const prefix = `byai_gateway:runtime_update:{${params.scope}}`;
  const generation = params.generation ?? PROCESS_GENERATION;
  const keys = [`${prefix}:state:${generation}`, `${prefix}:executions:${generation}`, `${prefix}:pending`];
  let initialized: Promise<unknown> | undefined;
  const evaluate = async (script: string, ...args: string[]) => {
    // Keep a rejected initialization rejected: uncertainty cannot become idle.
    initialized ??= params.redis.eval(INITIALIZE, keys.length, ...keys);
    await initialized;
    return params.redis.eval(script, keys.length, ...keys, ...args);
  };
  const gate: RuntimeUpdateGate & {
    acquireExecution: (options?: { signal?: AbortSignal }) => Promise<RuntimeExecutionLease>;
    pending: (key: string) => Promise<{ error?: string; blocked?: boolean } | null>;
    keys: string[];
  } = {
    keys,
    async acquireExecution(options = {}) {
      const token = randomUUID();
      for (;;) {
        if (options.signal?.aborted) throw abortError(options.signal);
        if (Number(await evaluate(ENTER, token)) === 1) break;
        await pause(50, options.signal);
      }
      let refs = 1;
      let removed: Promise<void> | undefined;
      const releaseRef = async () => {
        refs -= 1;
        if (refs === 0) {
          removed = evaluate(LEAVE, token).then(() => undefined);
          await removed;
        } else if (removed) await removed;
      };
      const makeRelease = () => {
        let released = false;
        return async () => { if (!released) { released = true; await releaseRef(); } };
      };
      const lease: RuntimeExecutionLease = {
        release: makeRelease(),
        retain() {
          if (refs <= 0) throw new Error("Cannot retain a completed execution");
          refs += 1;
          return makeRelease();
        },
      };
      // Cancellation does not release the token; actual execution cleanup does.
      if (options.signal?.aborted) { await lease.release(); throw abortError(options.signal); }
      return lease;
    },
    async enqueue(key, payload) { await evaluate(ENQUEUE, key, JSON.stringify(payload)); },
    async pending(key) {
      const raw = await evaluate("return redis.call('HGET', KEYS[3], ARGV[1])", key);
      return raw ? JSON.parse(String(raw)) as { error?: string; blocked?: boolean } : null;
    },
    async claim(key) {
      const owner = randomUUID();
      const raw = await evaluate(CLAIM, key, owner, String(params.idleMs ?? RUNTIME_UPDATE_IDLE_MS));
      if (!raw) return null;
      const job = JSON.parse(String(raw)) as { revision: number; payload: RuntimeUpdatePayload };
      return { owner, ...job };
    },
    async finish(key, claim, error) {
      const released = await evaluate(FINISH, key, claim.owner, String(claim.revision), error?.reason || "", error?.blocked ? "1" : "0");
      if (Number(released) !== 1) throw new Error("Runtime update ownership lost; admission remains blocked");
    },
  };
  return gate;
}

let defaultGate: ReturnType<typeof createRedisRuntimeUpdateGate> | undefined;
function runtimeGate() {
  if (!defaultGate) {
    const config = readRedisConfig();
    if (!hasRedisConnectionConfig(config)) throw new Error("Redis configuration required for safe runtime updates");
    defaultGate = createRedisRuntimeUpdateGate({
      redis: createRedisClient(config, { lazyConnect: true, enableOfflineQueue: true, maxRetriesPerRequest: 1, connectTimeout: 3_000 }),
      scope: resolveRuntimeUpdateScope(),
    });
  }
  return defaultGate;
}
export function acquireRuntimeExecution(options?: { signal?: AbortSignal }): Promise<RuntimeExecutionLease> {
  return runtimeGate().acquireExecution(options);
}
export function readPendingRuntimeUpdate(key: string) {
  return runtimeGate().pending(key);
}

export type RuntimeUpdateQueue = {
  register: (key: string, handler: (payload: RuntimeUpdatePayload) => Promise<void>) => () => void;
  enqueue: (key: string, payload?: RuntimeUpdatePayload) => Promise<void>;
  applyNow: (key: string, payload?: RuntimeUpdatePayload) => Promise<"applied" | "pending">;
  drain: () => Promise<void>;
  start: () => void;
  stop: () => Promise<void>;
};

/** Handlers are local; all admission, pending data and update ownership live in Redis. */
export function createRuntimeUpdateQueue(params: { gate?: RuntimeUpdateGate; logger?: Logger; pollMs?: number } = {}): RuntimeUpdateQueue {
  const handlers = new Map<string, (payload: RuntimeUpdatePayload) => Promise<void>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let draining: Promise<void> | undefined;
  let closing = false;
  const inFlight = new Set<Promise<unknown>>();
  const unfinished = new Map<string, { claim: RuntimeUpdateClaim; failure?: { reason: string; blocked: boolean } }>();
  const gate = () => params.gate ?? runtimeGate();
  const finishOutstanding = async (key: string) => {
    const outstanding = unfinished.get(key);
    if (!outstanding) return;
    await gate().finish(key, outstanding.claim, outstanding.failure);
    if (unfinished.get(key) === outstanding) unfinished.delete(key);
  };
  const drainKey = async (key: string): Promise<"applied" | "pending"> => {
    await finishOutstanding(key);
    if (closing) return "pending";
    const handler = handlers.get(key);
    if (!handler) return "pending";
    const claim = await gate().claim(key);
    if (!claim) return "pending";
    let failure: { reason: string; blocked: boolean } | undefined;
    try {
      await runRuntimeUpdateContext(() => handler(claim.payload));
      return "applied";
    } catch (error) {
      failure = { reason: error instanceof Error ? error.message : String(error), blocked: error instanceof RuntimeUpdateDeferredError };
      params.logger?.warn?.(`baiying-enhance: runtime update pending key=${key}: ${failure.reason}`);
      return "pending";
    } finally {
      unfinished.set(key, { claim, failure });
      await finishOutstanding(key);
    }
  };
  const track = <T>(work: Promise<T>): Promise<T> => {
    inFlight.add(work);
    void work.then(() => inFlight.delete(work), () => inFlight.delete(work));
    return work;
  };
  const queue: RuntimeUpdateQueue = {
    register(key, handler) { handlers.set(key, handler); return () => { if (handlers.get(key) === handler) handlers.delete(key); }; },
    enqueue(key, payload = {}) {
      if (closing) return Promise.reject(new Error("Runtime update queue is stopping"));
      return track(gate().enqueue(key, payload));
    },
    applyNow(key, payload = {}) {
      if (closing) return Promise.reject(new Error("Runtime update queue is stopping"));
      return track((async () => { await queue.enqueue(key, payload); return drainKey(key); })());
    },
    async drain() {
      if (closing || draining || handlers.size === 0) return draining;
      draining = track((async () => { for (const key of handlers.keys()) await drainKey(key); })());
      try { await draining; } finally { draining = undefined; }
    },
    start() {
      if (timer) return;
      closing = false;
      timer = setInterval(() => { void queue.drain().catch((error) => params.logger?.warn?.(`Runtime update queue unavailable: ${String(error)}`)); }, params.pollMs ?? 500);
      timer.unref?.();
    },
    async stop() {
      closing = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await Promise.allSettled([...inFlight]);
      // Handler resources are no longer in use. Retry a lost FINISH response;
      // if Redis stays unavailable the owner remains locked for maintenance.
      for (const key of unfinished.keys()) await finishOutstanding(key);
    },
  };
  return queue;
}
