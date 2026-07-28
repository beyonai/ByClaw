import { describe, expect, it } from "vitest";
import { shouldPreflightCompact } from "../src/index.js";

const base = {
  enabled: true,
  systemPromptCharacters: 4_000,
  pendingMessageCharacters: 2_000,
  contextWindow: 100_000,
  reserveTokens: 16_000,
  keepRecentTokens: 20_000,
};

describe("Pi preflight compaction", () => {
  it("does not compact every run below the projected threshold", () => {
    expect(
      shouldPreflightCompact({
        ...base,
        messageTokens: 30_000,
      }),
    ).toBe(false);
  });

  it("compacts once projected context crosses the reserve line", () => {
    expect(
      shouldPreflightCompact({
        ...base,
        messageTokens: 83_000,
      }),
    ).toBe(true);
  });

  it("does not compact when there is no discardable history", () => {
    expect(
      shouldPreflightCompact({
        ...base,
        messageTokens: 20_000,
        pendingMessageCharacters: 300_000,
      }),
    ).toBe(false);
  });
});
