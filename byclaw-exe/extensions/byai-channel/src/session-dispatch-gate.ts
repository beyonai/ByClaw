/**
 * Per-sessionKey FIFO mutex for SDK inbound dispatch.
 * Ensures only one OpenClaw dispatch runs at a time for a given sessionKey,
 * avoiding transcript races during embedded prompt lock release windows.
 */

type GateEntry = {
  activeRuns: Set<symbol>;
  currentRelease?: () => void;
  waiters: number;
  tail: Promise<void>;
};

const GATE_STATE = Symbol.for("openclaw.byaiChannel.sessionDispatchGate");

function getGateStore(): Map<string, GateEntry> {
  const globalState = globalThis as typeof globalThis & {
    [GATE_STATE]?: Map<string, GateEntry>;
  };
  if (!globalState[GATE_STATE]) {
    globalState[GATE_STATE] = new Map<string, GateEntry>();
  }
  return globalState[GATE_STATE];
}

function normalizeSessionKey(sessionKey: string | undefined): string | null {
  const trimmed = sessionKey?.trim();
  return trimmed ? trimmed : null;
}

function getOrCreateEntry(store: Map<string, GateEntry>, sessionKey: string): GateEntry {
  let entry = store.get(sessionKey);
  if (!entry) {
    entry = {
      activeRuns: new Set<symbol>(),
      waiters: 0,
      tail: Promise.resolve(),
    };
    store.set(sessionKey, entry);
  }
  return entry;
}

export function isSessionDispatchBusy(sessionKey: string | undefined): boolean {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return false;
  }
  const entry = getGateStore().get(normalized);
  return Boolean(entry && (entry.activeRuns.size > 0 || entry.waiters > 0));
}

export function sessionDispatchQueueDepth(sessionKey: string | undefined): number {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return 0;
  }
  const entry = getGateStore().get(normalized);
  if (!entry) {
    return 0;
  }
  return entry.waiters + entry.activeRuns.size;
}

/**
 * Release the currently held gate lease after its task has been cancelled.
 * The cancelled task may still be unwinding, so its lease remains tracked until `finally`.
 */
export function releaseCancelledSessionDispatch(sessionKey: string | undefined): boolean {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return false;
  }
  const entry = getGateStore().get(normalized);
  if (!entry?.currentRelease) {
    return false;
  }
  entry.currentRelease();
  return true;
}

export type SessionDispatchGateRunMeta = {
  sessionKey: string;
  queued: boolean;
  queueDepthBefore: number;
  waitMs: number;
};

/**
 * Run `task` exclusively for `sessionKey`. Tasks for the same key are FIFO-queued.
 */
export async function runSessionDispatchExclusive<T>(
  sessionKey: string,
  task: () => Promise<T>,
): Promise<{ result: T; meta: SessionDispatchGateRunMeta }> {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    const result = await task();
    return {
      result,
      meta: {
        sessionKey: sessionKey,
        queued: false,
        queueDepthBefore: 0,
        waitMs: 0,
      },
    };
  }

  const store = getGateStore();
  const entry = getOrCreateEntry(store, normalized);
  const queueDepthBefore = entry.activeRuns.size + entry.waiters;
  const queued = queueDepthBefore > 0;
  if (queued) {
    entry.waiters += 1;
  }

  const waitStartedAt = Date.now();
  const previous = entry.tail;
  const runToken = Symbol(normalized);
  let released = false;
  let release!: () => void;
  entry.tail = new Promise<void>((resolve) => {
    release = () => {
      if (released) {
        return;
      }
      released = true;
      resolve();
    };
  });

  await previous;
  const waitMs = Date.now() - waitStartedAt;

  entry.activeRuns.add(runToken);
  entry.currentRelease = release;
  if (queued) {
    entry.waiters = Math.max(0, entry.waiters - 1);
  }

  try {
    const result = await task();
    return {
      result,
      meta: {
        sessionKey: normalized,
        queued,
        queueDepthBefore,
        waitMs,
      },
    };
  } finally {
    entry.activeRuns.delete(runToken);
    if (entry.currentRelease === release) {
      entry.currentRelease = undefined;
    }
    release();
    if (entry.activeRuns.size === 0 && entry.waiters === 0) {
      store.delete(normalized);
    }
  }
}

export type SessionDispatchGateLeaseResult<T> = {
  result: T;
  meta: SessionDispatchGateRunMeta;
  /** Release is idempotent and must run after the caller's terminal side effects. */
  release: () => void;
};

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason || "task cancelled"));
}

async function waitForPreviousLease(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!signal) {
    await previous;
    return true;
  }
  if (signal.aborted) return false;

  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<false>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([previous.then(() => true as const), cancelled]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Variant whose FIFO lease survives the task promise. This is used when a
 * GatewayWorker must return a prepared result to its owner, emit FINAL_ANSWER,
 * and only then close the SDK stream and release the transcript session.
 */
export async function runSessionDispatchExclusiveLeased<T>(
  sessionKey: string,
  task: () => Promise<T>,
  options?: { signal?: AbortSignal },
): Promise<SessionDispatchGateLeaseResult<T>> {
  if (options?.signal?.aborted) {
    throw abortError(options.signal);
  }
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return {
      result: await task(),
      meta: {
        sessionKey,
        queued: false,
        queueDepthBefore: 0,
        waitMs: 0,
      },
      release: () => undefined,
    };
  }

  const store = getGateStore();
  const entry = getOrCreateEntry(store, normalized);
  const queueDepthBefore = entry.activeRuns.size + entry.waiters;
  const queued = queueDepthBefore > 0;
  if (queued) {
    entry.waiters += 1;
  }

  const waitStartedAt = Date.now();
  const previous = entry.tail;
  const runToken = Symbol(normalized);
  let tailReleased = false;
  let releaseTail!: () => void;
  entry.tail = new Promise<void>((resolve) => {
    releaseTail = () => {
      if (!tailReleased) {
        tailReleased = true;
        resolve();
      }
    };
  });

  const acquired = await waitForPreviousLease(previous, options?.signal);
  if (!acquired) {
    if (queued) {
      entry.waiters = Math.max(0, entry.waiters - 1);
    }
    // Preserve FIFO ordering: this cancelled link follows its predecessor
    // before releasing later requests.
    void previous.then(releaseTail, releaseTail);
    throw abortError(options!.signal!);
  }
  const waitMs = Date.now() - waitStartedAt;
  entry.activeRuns.add(runToken);
  entry.currentRelease = releaseTail;
  if (queued) {
    entry.waiters = Math.max(0, entry.waiters - 1);
  }

  let leaseReleased = false;
  const release = () => {
    if (leaseReleased) {
      return;
    }
    leaseReleased = true;
    entry.activeRuns.delete(runToken);
    if (entry.currentRelease === releaseTail) {
      entry.currentRelease = undefined;
    }
    releaseTail();
    if (entry.activeRuns.size === 0 && entry.waiters === 0) {
      store.delete(normalized);
    }
  };

  try {
    return {
      result: await task(),
      meta: {
        sessionKey: normalized,
        queued,
        queueDepthBefore,
        waitMs,
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Reset gate state between tests. */
export function resetSessionDispatchGateForTest(): void {
  getGateStore().clear();
}
