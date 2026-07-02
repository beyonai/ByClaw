import { describe, expect, it } from "vitest";
import {
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
});
