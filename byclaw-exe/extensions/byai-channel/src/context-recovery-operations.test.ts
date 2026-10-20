import { afterEach, describe, expect, it, vi } from "vitest";
import { assertContextRecoveryIdle, retainUnsettledContextDispatch, resetContextRecoveryOperationsForTest, withTrackedContextCompaction } from "./context-recovery-operations.js";

afterEach(resetContextRecoveryOperationsForTest);
describe("context recovery operation isolation", () => {
  it("keeps admission and nested operation errors in the request language", async () => {
    retainUnsettledContextDispatch("session", new Promise(() => {}), "en_US");
    expect(() => assertContextRecoveryIdle("session", "en_US")).toThrow("contact an administrator");
    const run = vi.fn();
    await expect(withTrackedContextCompaction("session", run, "en_US")).rejects.toThrow("contact an administrator");
    expect(() => retainUnsettledContextDispatch("session", new Promise(() => {}), "en_US")).toThrow("contact an administrator");
    expect(run).not.toHaveBeenCalled();
  });

  it("localizes the capacity failure before it leaves the operation tracker", async () => {
    const pending = new Promise<void>(() => {});
    for (let i = 0; i < 256; i++) retainUnsettledContextDispatch(`busy-${i}`, pending);
    const run = vi.fn();
    await expect(withTrackedContextCompaction("new-session", run, "en_US")).rejects.toThrow("Start a new conversation");
    expect(run).not.toHaveBeenCalled();
  });
  it("blocks only the same session until an actual background dispatch exits", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    retainUnsettledContextDispatch("session-a", pending);
    expect(() => assertContextRecoveryIdle("session-a")).toThrow();
    expect(() => assertContextRecoveryIdle("session-b")).not.toThrow();
    finish();
    await pending;
    expect(() => assertContextRecoveryIdle("session-a")).not.toThrow();
  });
  it("releases definitive compaction failures but quarantines unknown RPC results", async () => {
    await withTrackedContextCompaction("session", async () => ({ ok: false, compacted: false }));
    expect(() => assertContextRecoveryIdle("session")).not.toThrow();
    await expect(withTrackedContextCompaction("session", async () => { throw new Error("gateway timeout"); })).rejects.toThrow("gateway timeout");
    expect(() => assertContextRecoveryIdle("session")).toThrow();
  });
  it("allows later use after an explicit pre-execution authentication rejection", async () => {
    await expect(withTrackedContextCompaction("session", async () => { throw new Error("Unauthorized"); })).rejects.toThrow();
    expect(() => assertContextRecoveryIdle("session")).not.toThrow();
  });
  it.each(["resolve", "reject"])("retains the execution token after local cancellation until the original dispatch %ss", async (outcome) => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const originalDispatch = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const release = vi.fn(async () => {});
    const retain = vi.fn(() => release);
    retainUnsettledContextDispatch("cancelled-session", originalDispatch, "en_US", retain);
    expect(retain).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    expect(() => assertContextRecoveryIdle("cancelled-session")).toThrow();
    if (outcome === "resolve") finish();
    else fail(new Error("model request aborted after cleanup"));
    await originalDispatch.catch(() => undefined);
    expect(release).toHaveBeenCalledOnce();
    expect(() => assertContextRecoveryIdle("cancelled-session")).not.toThrow();
  });
  it("keeps an uncertain compaction busy for hot updates after the request returns", async () => {
    const release = vi.fn(async () => {});
    const retain = vi.fn(() => release);
    await expect(withTrackedContextCompaction("uncertain-session", async () => {
      throw new Error("gateway disconnected while model was still running");
    }, "en_US", retain)).rejects.toThrow("gateway disconnected");
    expect(retain).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    expect(() => assertContextRecoveryIdle("uncertain-session")).toThrow();
  });
  it.each(["success", "pre-execution rejection"])("releases the retained execution token after confirmed %s", async (outcome) => {
    const release = vi.fn(async () => {});
    const run = async () => {
      if (outcome === "pre-execution rejection") throw new Error("Forbidden");
      return { ok: true, compacted: true };
    };
    await withTrackedContextCompaction("confirmed-session", run, "en_US", () => release).catch(() => undefined);
    expect(release).toHaveBeenCalledOnce();
    expect(() => assertContextRecoveryIdle("confirmed-session")).not.toThrow();
  });
});
