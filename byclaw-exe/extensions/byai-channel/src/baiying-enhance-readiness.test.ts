import { describe, expect, it } from "vitest";
import {
  markBaiyingEnhanceColdStartReady,
  resetBaiyingEnhanceColdStartReadiness,
} from "../../baiying-enhance/src/cold-start-readiness.js";
import {
  isBaiyingEnhanceConfigured,
  waitForBaiyingEnhanceColdStartReady,
} from "./baiying-enhance-readiness.js";

describe("baiying-enhance cold-start readiness", () => {
  it("preserves a pending channel waiter when the enhance service resets readiness", async () => {
    resetBaiyingEnhanceColdStartReadiness("not_started");
    const waiting = waitForBaiyingEnhanceColdStartReady(100);

    resetBaiyingEnhanceColdStartReadiness("service_starting");
    markBaiyingEnhanceColdStartReady("initial_managed_agent_sync_complete");

    await expect(waiting).resolves.toMatchObject({
      ready: true,
      reason: "initial_managed_agent_sync_complete",
    });
  });

  it("does not gate channel consumption when the enhance plugin is explicitly disabled", () => {
    expect(
      isBaiyingEnhanceConfigured({
        plugins: {
          entries: { "baiying-enhance": { enabled: false } },
          load: { paths: ["/app/dist-runtime/extensions/baiying-enhance"] },
        },
      }),
    ).toBe(false);
  });
});
