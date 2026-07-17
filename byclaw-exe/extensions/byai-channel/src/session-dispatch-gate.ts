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

/** Reset gate state between tests. */
export function resetSessionDispatchGateForTest(): void {
  getGateStore().clear();
}
