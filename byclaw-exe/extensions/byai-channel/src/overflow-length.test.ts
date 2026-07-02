import { describe, expect, it } from "vitest";
import { isContextPressureLength } from "./overflow-length.js";

describe("isContextPressureLength", () => {
  it("treats real-log context-pressure truncation as pressure (totalTokens over threshold)", () => {
    // 复刻 log2：window=50000，totalTokens=45082 > 50000-20000=30000 → true。
    expect(
      isContextPressureLength({
        stopReason: "length",
        usage: { input: 2202, output: 512, cacheRead: 42368, totalTokens: 45082 },
        contextWindow: 50000,
      }),
    ).toBe(true);
  });

  it("does NOT treat below-threshold length truncation as pressure (genuine maxToken)", () => {
    // 大窗口、totalTokens 远低于阈值：模型写多被切，不是上下文压力。
    expect(
      isContextPressureLength({
        stopReason: "length",
        usage: { input: 2000, output: 4000, cacheRead: 0, totalTokens: 43239 },
        contextWindow: 200000,
      }),
    ).toBe(false);
  });

  it("returns false for non-length stop reasons", () => {
    expect(
      isContextPressureLength({
        stopReason: "stop",
        usage: { totalTokens: 45082 },
        contextWindow: 50000,
      }),
    ).toBe(false);
    expect(
      isContextPressureLength({
        stopReason: "toolUse",
        usage: { totalTokens: 45082 },
        contextWindow: 50000,
      }),
    ).toBe(false);
  });

  it("returns false when context window is missing (safe fallback to genuine path)", () => {
    expect(
      isContextPressureLength({
        stopReason: "length",
        usage: { totalTokens: 45082 },
        contextWindow: undefined,
      }),
    ).toBe(false);
    expect(
      isContextPressureLength({
        stopReason: "length",
        usage: { totalTokens: 45082 },
        contextWindow: 0,
      }),
    ).toBe(false);
  });

  it("falls back to summing usage parts when totalTokens absent", () => {
    // 无 totalTokens：input+output+cacheRead = 44570 > 30000 → true。
    expect(
      isContextPressureLength({
        stopReason: "length",
        usage: { input: 2202, output: 512, cacheRead: 42368 },
        contextWindow: 50000,
      }),
    ).toBe(true);
  });

  it("honors an explicit reserveTokens override", () => {
    // reserveTokens=5000 → 阈值=45000；totalTokens=45082 > 45000 → true。
    expect(
      isContextPressureLength({
        stopReason: "length",
        usage: { totalTokens: 45082 },
        contextWindow: 50000,
        reserveTokens: 5000,
      }),
    ).toBe(true);
    // reserveTokens=0 → 阈值=50000；totalTokens=45082 < 50000 → false。
    expect(
      isContextPressureLength({
        stopReason: "length",
        usage: { totalTokens: 45082 },
        contextWindow: 50000,
        reserveTokens: 0,
      }),
    ).toBe(false);
  });

  it("returns false when total tokens are zero/unknown", () => {
    expect(
      isContextPressureLength({ stopReason: "length", usage: {}, contextWindow: 50000 }),
    ).toBe(false);
    expect(
      isContextPressureLength({ stopReason: "length", usage: undefined, contextWindow: 50000 }),
    ).toBe(false);
  });
});
