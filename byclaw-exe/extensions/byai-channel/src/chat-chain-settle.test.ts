import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  ready: false,
  request: {
    requestId: "root", sessionId: "session", traceId: "lane", rootLifecyclePhase: "end",
    awaitingFollowup: true, pendingOutboundCount: 2, delegatedWorkToolCallIds: new Set(["tool"]),
  },
}));
vi.mock("./session-context.js", () => ({
  resolveActiveSdkRequestBySessionKey: () => state.request,
  shouldCompleteActiveSdkRequest: () => state.ready,
  markActiveSdkDispatchSettled: vi.fn(),
  completeActiveSdkRequest: vi.fn(async () => true),
}));
vi.mock("./prompt-injection-snapshot.js", () => ({ clearPromptInjectionSnapshot: vi.fn() }));
import { waitForSdkSessionDispatchSettled } from "./session-dispatch-settle.js";

describe("completion wait diagnostics", () => {
  afterEach(() => { vi.useRealTimers(); state.ready = false; });
  it("reports a prolonged wait once without cancelling it or changing completion", async () => {
    vi.useFakeTimers();
    const log = { info: vi.fn(), warn: vi.fn() };
    const wait = waitForSdkSessionDispatchSettled("session", { log, timeoutMs: 120_000 });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(log.warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toContain('"requestId":"root"');
    expect(log.warn.mock.calls[0][0]).toContain("awaiting_followup");
    state.ready = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await wait).toMatchObject({ settled: true, timedOut: false });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
