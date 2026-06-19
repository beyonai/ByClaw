import { describe, expect, it } from "vitest";
import { isOpenClawContextOverflowDispatchError } from "./dispatch-error.js";

describe("isOpenClawContextOverflowDispatchError", () => {
  it("recognizes OpenClaw recoverable context overflow dispatch errors", () => {
    expect(
      isOpenClawContextOverflowDispatchError(
        new Error(
          "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.",
        ),
      ),
    ).toBe(true);
    expect(
      isOpenClawContextOverflowDispatchError(
        "Context overflow: prompt too large for the model (precheck).",
      ),
    ).toBe(true);
    expect(
      isOpenClawContextOverflowDispatchError(
        "Context overflow: estimated context size exceeds safe threshold during tool loop.",
      ),
    ).toBe(true);
  });

  it("does not classify unrelated dispatch errors as recoverable overflow", () => {
    expect(isOpenClawContextOverflowDispatchError(new Error("Redis connection failed"))).toBe(
      false,
    );
    expect(isOpenClawContextOverflowDispatchError("provider returned HTTP 401")).toBe(false);
  });
});
