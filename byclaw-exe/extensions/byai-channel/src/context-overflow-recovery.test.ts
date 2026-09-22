import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactSessionForRecovery,
  didCompactContext,
  dispatchWithContextOverflowRecovery,
  type CompactionResult,
  type ContextOverflowRecoveryState,
} from "./context-overflow-recovery.js";

const precheck = "Context overflow: prompt too large for the model (precheck).";
const success = { ok: true, compacted: true, result: { tokensBefore: 180_000, tokensAfter: 40_000 } };
const { callGatewayFromCli } = vi.hoisted(() => ({ callGatewayFromCli: vi.fn() }));
vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({ callGatewayFromCli }));
function setup() {
  const state: ContextOverflowRecoveryState = { dispatchPending: true, replaySafe: true, attempts: 0 };
  const dispatch = vi.fn(async (_signal?: AbortSignal) => {}).mockRejectedValueOnce(new Error(precheck));
  const compact = vi.fn(async () => success);
  const notice = vi.fn(async (_phase: "start" | "retry" | "failed", _attempt: number, _failureKind?: string) => {});
  return { state, dispatch, compact, notice, failureText: "Recovery failed" };
}

afterEach(() => vi.useRealTimers());

describe("precheck overflow recovery", () => {
  it("recovers a required preflight summary timeout", async () => {
    const p = setup();
    p.dispatch.mockReset().mockRejectedValueOnce(new Error("Preflight compaction required but failed: Compaction timed out"));
    await dispatchWithContextOverflowRecovery(p);
    expect(p.compact).toHaveBeenCalledTimes(1);
    expect(p.dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not abort a healthy replay when the recovery deadline passes", async () => {
    vi.useFakeTimers();
    const p = setup();
    let replaySignal: AbortSignal | undefined;
    p.dispatch.mockReset().mockRejectedValueOnce(new Error(precheck)).mockImplementationOnce(async (signal) => {
      replaySignal = signal;
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    });
    const pending = dispatchWithContextOverflowRecovery({ ...p, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(2001);
    await pending;
    expect(replaySignal?.aborted).toBe(false);
    expect(p.compact).toHaveBeenCalledTimes(1);
  });

  it("preserves evidence of an oversized submission discovered on replay", async () => {
    const p = setup();
    p.dispatch.mockReset().mockRejectedValueOnce(new Error(precheck))
      .mockRejectedValueOnce(Object.assign(new Error("too many bytes"), { code: "attachment_too_large" }));
    await expect(dispatchWithContextOverflowRecovery(p)).rejects.toMatchObject({ kind: "input_too_large" });
    expect(p.compact).toHaveBeenCalledTimes(1);
    expect(p.notice).toHaveBeenLastCalledWith("failed", 1, "input_too_large");
  });

  it.each(["Unauthorized", "no messages", "nothing to compact"])("does not waste three attempts on definitive failure: %s", async (reason) => {
    const p = setup();
    p.compact.mockResolvedValue({ ok: false, compacted: false, reason } as never);
    await expect(dispatchWithContextOverflowRecovery(p)).rejects.toThrow("Recovery failed");
    expect(p.compact).toHaveBeenCalledTimes(1);
    expect(p.dispatch).toHaveBeenCalledTimes(1);
  });
  it("compacts before replay and stops on the first successful answer", async () => {
    const p = setup();
    await dispatchWithContextOverflowRecovery(p);
    expect(p.compact).toHaveBeenCalledTimes(1);
    expect(p.dispatch).toHaveBeenCalledTimes(2);
    expect(p.notice.mock.calls).toEqual([["start", 1], ["retry", 1]]);
    expect(p.compact.mock.invocationCallOrder[0]).toBeLessThan(p.dispatch.mock.invocationCallOrder[1]!);
  });

  it("recovers an agent_end precheck failure even when dispatch resolves", async () => {
    const p = setup();
    p.dispatch.mockReset().mockImplementationOnce(async () => { p.state.precheckError = precheck; });
    await dispatchWithContextOverflowRecovery(p);
    expect(p.dispatch).toHaveBeenCalledTimes(2);
  });

  it("allows exactly three additional recoveries, with at most four dispatches", async () => {
    const p = setup();
    p.dispatch.mockReset().mockRejectedValue(new Error(precheck));
    await expect(dispatchWithContextOverflowRecovery(p)).rejects.toThrow("Recovery failed");
    expect(p.compact).toHaveBeenCalledTimes(3);
    expect(p.dispatch).toHaveBeenCalledTimes(4);
    expect(p.state.attempts).toBe(3);
  });

  it("counts failed compressions but never resends after them", async () => {
    const p = setup();
    p.compact.mockResolvedValue({ ok: false, compacted: false } as typeof success);
    await expect(dispatchWithContextOverflowRecovery(p)).rejects.toThrow("Recovery failed");
    expect(p.compact).toHaveBeenCalledTimes(3);
    expect(p.dispatch).toHaveBeenCalledTimes(1);
    expect(p.notice).not.toHaveBeenCalledWith("retry", expect.anything());
  });

  it.each(["HTTP 401", "Context overflow: prompt too large for the model.",
    "Context overflow: prompt too large for the model (mid-turn precheck)."])("does not replay ambiguous/non-precheck errors: %s", async (message) => {
    const p = setup();
    p.dispatch.mockReset().mockRejectedValue(new Error(message));
    await expect(dispatchWithContextOverflowRecovery(p)).rejects.toThrow(message);
    expect(p.compact).not.toHaveBeenCalled();
  });

  it("does not replay a request that already executed a tool or emitted an answer", async () => {
    const p = setup();
    p.state.replaySafe = false;
    await expect(dispatchWithContextOverflowRecovery(p)).rejects.toThrow(precheck);
    expect(p.compact).not.toHaveBeenCalled();
  });

  it("stops on an uncertain RPC outcome without overlapping another compaction", async () => {
    const p = setup();
    p.compact.mockRejectedValue(new Error("gateway timeout"));
    await expect(dispatchWithContextOverflowRecovery(p)).rejects.toThrow("Recovery failed");
    expect(p.compact).toHaveBeenCalledTimes(1);
    expect(p.dispatch).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation while compression is pending without replay", async () => {
    const p = setup();
    const controller = new AbortController();
    p.compact.mockImplementation(async () => {
      controller.abort(new Error("user cancelled"));
      return new Promise(() => {});
    });
    await expect(dispatchWithContextOverflowRecovery({ ...p, signal: controller.signal })).rejects.toThrow("user cancelled");
    expect(p.dispatch).toHaveBeenCalledTimes(1);
    expect(p.notice.mock.calls.some(([phase]) => phase === "failed")).toBe(false);
  });

  it("does not start compaction after cancellation while displaying its notice", async () => {
    const p = setup();
    const controller = new AbortController();
    p.notice.mockImplementation(async () => { controller.abort(new Error("user cancelled")); });
    await expect(dispatchWithContextOverflowRecovery({ ...p, signal: controller.signal })).rejects.toThrow("user cancelled");
    expect(p.compact).not.toHaveBeenCalled();
  });

  it("bounds the complete recovery even if the transport never settles", async () => {
    vi.useFakeTimers();
    const p = setup();
    p.compact.mockImplementation(() => new Promise(() => {}));
    const outcome = expect(dispatchWithContextOverflowRecovery({ ...p, timeoutMs: 1000 })).rejects.toThrow("Recovery failed");
    await vi.advanceTimersByTimeAsync(1001);
    await outcome;
    expect(p.compact).toHaveBeenCalledTimes(1);
    expect(p.dispatch).toHaveBeenCalledTimes(1);
  });

  it("requires compacted success and rejects a known non-reduction", () => {
    expect(didCompactContext({ ok: true, compacted: false })).toBe(false);
    expect(didCompactContext({ ok: true, compacted: true, result: { tokensBefore: 100, tokensAfter: 100 } })).toBe(false);
    expect(didCompactContext({ ok: true, compacted: true, result: { tokensAfter: NaN } })).toBe(false);
    expect(didCompactContext(success)).toBe(true);
    expect(didCompactContext({ ok: true, compacted: true, result: { tokensBefore: 0, tokensAfter: 1522 } })).toBe(true);
    expect(didCompactContext({ ok: true, compacted: true })).toBe(true);
  });

  it("calls semantic compaction on the same session, without maxLines", async () => {
    const request = vi.fn(async () => success);
    const result = await compactSessionForRecovery({
      runtime: { gateway: { isAvailable: async () => true, request } } as never,
      sessionKey: "agent:test:direct:session", signal: new AbortController().signal, timeoutMs: 330_000,
    });
    expect(result).toEqual(success);
    expect(request).toHaveBeenCalledWith("sessions.compact", { key: "agent:test:direct:session" }, { timeoutMs: 330_000 });
  });

  it("uses the public CLI gateway transport in Redis workers without request scope", async () => {
    callGatewayFromCli.mockReset().mockResolvedValue(success);
    const signal = new AbortController().signal;
    const result = await compactSessionForRecovery({
      runtime: {}, sessionKey: "agent:test:direct:redis", signal, timeoutMs: 330_000,
    });
    expect(result).toEqual(success);
    expect(callGatewayFromCli).toHaveBeenCalledWith("sessions.compact", { timeout: "330000" },
      { key: "agent:test:direct:redis" }, { signal, progress: false });
  });

  it("uses authenticated CLI when the in-process official-plugin gate rejects before dispatch", async () => {
    callGatewayFromCli.mockReset().mockResolvedValue(success);
    const request = vi.fn().mockRejectedValue(new Error(
      "Gateway requests are only available to bundled or trusted official plugins.",
    ));
    await expect(compactSessionForRecovery({
      runtime: { gateway: { isAvailable: async () => true, request } },
      sessionKey: "agent:test:direct:third-party", signal: new AbortController().signal, timeoutMs: 330_000,
    })).resolves.toEqual(success);
    expect(callGatewayFromCli).toHaveBeenCalledTimes(1);
  });

  it.each(["gateway timeout", "connection closed", "Unauthorized"])(
    "never starts a second transport after an unknown or authentication failure: %s", async (message) => {
      callGatewayFromCli.mockReset();
      await expect(compactSessionForRecovery({
        runtime: { gateway: { isAvailable: async () => true, request: vi.fn().mockRejectedValue(new Error(message)) } },
        sessionKey: "agent:test:direct:no-overlap", signal: new AbortController().signal, timeoutMs: 330_000,
      })).rejects.toThrow(message);
      expect(callGatewayFromCli).not.toHaveBeenCalled();
    },
  );

  it("rechecks cancellation after gateway availability resolves", async () => {
    const controller = new AbortController();
    const request = vi.fn();
    const trackOperation = vi.fn((run: () => Promise<CompactionResult>) => run());
    await expect(compactSessionForRecovery({
      runtime: { gateway: { isAvailable: async () => { controller.abort(); return true; }, request } },
      sessionKey: "agent:test:direct:cancel", signal: controller.signal, timeoutMs: 330_000,
      trackOperation,
    })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(trackOperation).not.toHaveBeenCalled();
  });
});
