export interface StorageReadiness {
  enabled: boolean;
  ready: boolean;
  taskId?: string;
  version?: number;
  state: string;
}
export interface ReadinessView {
  phase: 'waiting' | 'recovering' | 'timeout' | 'blocked';
  state?: string;
}
export class NasReadinessCancelled extends Error {
  constructor() {
    super('Storage operation cancelled');
    this.name = 'NasReadinessCancelled';
  }
}
interface Options {
  read: (signal: AbortSignal) => Promise<StorageReadiness>;
  subscribe: (wake: (event?: { taskId?: string; version?: number }) => void) => () => void;
  isCurrent: () => boolean;
  onState: (view: ReadinessView) => void;
  maxWaitMs?: number;
  fallbackMs?: number;
}

/** One held operation; push never authorizes execution. Retry starts a new bounded waiting period. */
export function createNasReadinessWaiter(options: Options) {
  let finished = false;
  let paused = false;
  let reading = false;
  let dirty = false;
  let failures = 0;
  let generation = 0;
  let started = Date.now();
  let taskId: string | undefined;
  const versions = new Map<string, number>();
  let controller: AbortController | undefined;
  let watchdog: ReturnType<typeof setInterval>;
  let read: () => Promise<void>;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let resolve: () => void = () => {};
  let reject: (reason: Error) => void = () => {};
  let unsubscribe = () => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const clear = () => {
    clearTimeout(fallback);
    clearInterval(watchdog);
    controller?.abort();
    unsubscribe();
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    clear();
    reject(new NasReadinessCancelled());
  };
  const current = () => {
    if (!options.isCurrent()) cancel();
    return !finished;
  };
  const schedule = () => {
    clearTimeout(fallback);
    if (!finished && !paused)
      fallback = setTimeout(
        () => void read(),
        Math.min(60000, (options.fallbackMs ?? 15000) * 2 ** Math.min(failures, 2))
      );
  };
  read = async () => {
    if (!current() || paused) return;
    if (reading) {
      dirty = true;
      return;
    }
    reading = true;
    dirty = false;
    const attempt = generation;
    controller = new AbortController();
    const requestController = controller;
    const signal = requestController.signal;
    const deadline = setTimeout(() => requestController.abort(), 10000);
    try {
      const value = await Promise.race([
        options.read(signal),
        new Promise<never>((_, no) => {
          signal.addEventListener('abort', () => no(new Error('Read timeout')), { once: true });
        }),
      ]);
      if (!current() || paused || attempt !== generation) return;
      failures = 0;
      taskId = value.taskId;
      const minimum = taskId ? versions.get(taskId) ?? 0 : 0;
      if (value.enabled === false || (value.ready === true && Number(value.version) >= minimum)) {
        finished = true;
        clear();
        resolve();
        return;
      }
      paused = value.state === 'MIGRATION_REQUIRED';
      options.onState({ phase: paused ? 'blocked' : 'waiting', state: value.state });
    } catch {
      failures += 1;
      if (!finished && !paused && attempt === generation) options.onState({ phase: 'recovering' });
    } finally {
      clearTimeout(deadline);
      if (attempt === generation) {
        reading = false;
        if (dirty && !paused && !finished) void read();
        else schedule();
      }
    }
  };
  const wake = (event?: { taskId?: string; version?: number }) => {
    if (finished || paused) return;
    if (event?.taskId) {
      if (taskId && event.taskId !== taskId) return;
      if (!Number.isSafeInteger(event.version) || Number(event.version) < 0) return;
      if (Number(event.version) <= (versions.get(event.taskId) ?? -1)) return;
      versions.set(event.taskId, Number(event.version));
    }
    void read();
  };
  watchdog = setInterval(() => {
    if (!current() || paused) return;
    if (Date.now() - started >= (options.maxWaitMs ?? 20 * 60 * 1000)) {
      paused = true;
      controller?.abort();
      clearTimeout(fallback);
      options.onState({ phase: 'timeout' });
    }
  }, 1000);
  const retry = () => {
    if (!current()) return;
    generation += 1;
    controller?.abort();
    reading = false;
    paused = false;
    started = Date.now();
    options.onState({ phase: 'waiting' });
    void read();
  };
  unsubscribe = options.subscribe(wake);
  void read();
  return { promise, cancel, retry, wake };
}
