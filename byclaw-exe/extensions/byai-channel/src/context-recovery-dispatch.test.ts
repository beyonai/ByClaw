import { afterEach, describe, expect, it, vi } from "vitest";
import { runObservedContextDispatch } from "./context-recovery-dispatch.js";
import type { ContextOverflowRecoveryState } from "./context-overflow-recovery.js";

function setup() {
  const state: ContextOverflowRecoveryState = { dispatchPending: true, replaySafe: true, attempts: 0 };
  return { state, recoveryTimeoutMs: 100, nativeCompactionTimeoutMs: () => 1, drainTimeoutMs: 20,
    failureText: "Recovery failed", onUnsettledDispatch: vi.fn() };
}
afterEach(() => vi.useRealTimers());

describe("native compaction dispatch supervision", () => {
  it("never puts a recovery deadline on a normal long answer", async () => {
    vi.useFakeTimers();
    const p = setup();
    let finish!: () => void;
    let signal!: AbortSignal;
    const result = runObservedContextDispatch({ ...p, dispatch: async (s) => {
      signal = s!;
      await new Promise<void>((resolve) => { finish = resolve; });
    } });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(signal.aborted).toBe(false);
    finish();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for the actual aborted dispatch to exit before allowing recovery", async () => {
    vi.useFakeTimers();
    const p = setup();
    let exited = false;
    const result = runObservedContextDispatch({ ...p, dispatch: async (signal) => {
      p.state.onNativeCompaction?.("start");
      await new Promise<void>((resolve) => signal!.addEventListener("abort", () => {
        setTimeout(() => { exited = true; resolve(); }, 10);
      }));
    } });
    const outcome = expect(result).rejects.toThrow("Preflight compaction required but failed");
    await vi.advanceTimersByTimeAsync(105);
    expect(exited).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    await outcome;
    expect(exited).toBe(true);
    expect(p.onUnsettledDispatch).not.toHaveBeenCalled();
  });

  it("bounds a stuck native operation and retains it instead of overlapping a new one", async () => {
    vi.useFakeTimers();
    const p = setup();
    const outcome = expect(runObservedContextDispatch({ ...p, dispatch: async () => {
      p.state.onNativeCompaction?.("start");
      await new Promise(() => {});
    } })).rejects.toMatchObject({ kind: "operation_pending" });
    await vi.advanceTimersByTimeAsync(121);
    await outcome;
    expect(p.onUnsettledDispatch).toHaveBeenCalledTimes(1);
    expect(p.state.onNativeCompaction).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["compaction_end", "business_execution"])("stops the watchdog after %s", async (event) => {
    vi.useFakeTimers();
    const p = setup();
    let finish!: () => void;
    let signal!: AbortSignal;
    const result = runObservedContextDispatch({ ...p, dispatch: async (s) => {
      signal = s!;
      p.state.onNativeCompaction?.("start");
      if (event === "compaction_end") p.state.onNativeCompaction?.("end");
      else { p.state.replaySafe = false; p.state.onExecutionProgress?.(); }
      await new Promise<void>((resolve) => { finish = resolve; });
    } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal.aborted).toBe(false);
    finish();
    await result;
  });

  it("stops waiting immediately on user cancellation and keeps the native operation tracked", async () => {
    const p = setup();
    const controller = new AbortController();
    const result = runObservedContextDispatch({ ...p, signal: controller.signal, dispatch: async () => {
      p.state.onNativeCompaction?.("start");
      controller.abort(new Error("user cancelled"));
      // Protection must exist before sdk-app can release the cancelled FIFO lease.
      expect(p.onUnsettledDispatch).toHaveBeenCalledTimes(1);
      await new Promise(() => {});
    } });
    await expect(result).rejects.toThrow("user cancelled");
    expect(p.onUnsettledDispatch).toHaveBeenCalledTimes(1);
  });
});
