import { describe, expect, it } from "vitest";
import {
  releaseCancelledSessionDispatch,
  resetSessionDispatchGateForTest,
  runSessionDispatchExclusive,
  sessionDispatchQueueDepth,
} from "./session-dispatch-gate.js";

describe("session-dispatch-gate", () => {
  it("serializes tasks for the same sessionKey", async () => {
    resetSessionDispatchGateForTest();
    const order: string[] = [];

    const first = runSessionDispatchExclusive("agent:main:direct:1", async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("first-end");
      return "first";
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = runSessionDispatchExclusive("agent:main:direct:1", async () => {
      order.push("second-start");
      order.push("second-end");
      return "second";
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.result).toBe("first");
    expect(secondResult.result).toBe("second");
    expect(secondResult.meta.queued).toBe(true);
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("allows parallel tasks for different session keys", async () => {
    resetSessionDispatchGateForTest();
    let overlap = false;
    let aRunning = false;
    let bRunning = false;

    await Promise.all([
      runSessionDispatchExclusive("agent:main:direct:a", async () => {
        aRunning = true;
        overlap = overlap || bRunning;
        await new Promise((resolve) => setTimeout(resolve, 20));
        aRunning = false;
      }),
      runSessionDispatchExclusive("agent:main:direct:b", async () => {
        bRunning = true;
        overlap = overlap || aRunning;
        await new Promise((resolve) => setTimeout(resolve, 20));
        bRunning = false;
      }),
    ]);

    expect(overlap).toBe(true);
    expect(sessionDispatchQueueDepth("agent:main:direct:a")).toBe(0);
  });

  it("allows the next task to start when the current session dispatch is cancelled", async () => {
    resetSessionDispatchGateForTest();
    const sessionKey = "agent:main:direct:cancelled";
    const order: string[] = [];
    let finishFirst!: () => void;

    const first = runSessionDispatchExclusive(sessionKey, async () => {
      order.push("first-start");
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      order.push("first-end");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = runSessionDispatchExclusive(sessionKey, async () => {
      order.push("second-start");
      order.push("second-end");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(["first-start"]);
    expect(releaseCancelledSessionDispatch(sessionKey)).toBe(true);
    await second;
    expect(order).toEqual(["first-start", "second-start", "second-end"]);

    finishFirst();
    await first;
    expect(order).toEqual(["first-start", "second-start", "second-end", "first-end"]);
    expect(sessionDispatchQueueDepth(sessionKey)).toBe(0);
  });
});
