import { setTimeout as delay } from "node:timers/promises";

export async function waitForWorkerLease(
    initialize: () => Promise<void>,
    workerId: string,
    options: {
        signal?: AbortSignal;
        timeoutMs?: number;
        retryMs?: number;
        onWait?: () => void;
    } = {}
): Promise<void> {
    const deadline = Date.now() + (options.timeoutMs ?? 65_000);
    let reported = false;
    while (true) {
        options.signal?.throwIfAborted();
        try {
            await initialize();
            return;
        } catch (error) {
            // Retry only the SDK's exclusive-lease conflict, never other initialization failures.
            if (
                !(error instanceof Error) ||
                error.message !== `worker_id already in use: ${workerId}`
            ) {
                throw error;
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw error;
            if (!reported) {
                options.onWait?.();
                reported = true;
            }
            await delay(Math.min(options.retryMs ?? 1_000, remaining), undefined, {
                signal: options.signal,
            });
        }
    }
}

export async function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    signal.throwIfAborted();
    let abort: () => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason ?? new Error("Worker startup aborted"));
        signal.addEventListener("abort", abort, { once: true });
    });
    try {
        return await Promise.race([promise, cancelled]);
    } finally {
        signal.removeEventListener("abort", abort);
    }
}

export async function runSdkAccountLifetime(
    app: { start(signal?: AbortSignal): Promise<void>; stop(): Promise<void> },
    signal?: AbortSignal,
    onStarted?: () => void
): Promise<void> {
    // Install the listener before starting so an abort during initialization is never lost.
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<void>((resolve) => {
        onAbort = resolve;
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
        if (signal?.aborted) return;
        await app.start(signal);
        if (!signal?.aborted) onStarted?.();
        await aborted;
    } catch (error) {
        if (!signal?.aborted) throw error;
    } finally {
        signal?.removeEventListener("abort", onAbort);
        // The host must not consider the old account stopped until its lease is released.
        await app.stop();
    }
}
