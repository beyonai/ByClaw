import { describe, expect, it } from "vitest";
import {
  LEADER_CHECKPOINT_TOOL_NAMES,
  LEADER_FILE_TOOL_NAMES,
} from "../src/context/active-leader-tools.js";

describe("Leader checkpoint tool allowlist", () => {
  it("covers attachment tools and every enabled session file tool", () => {
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toContain("inspectAttachment");
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toContain("downloadAttachment");
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toEqual(
      expect.arrayContaining([...LEADER_FILE_TOOL_NAMES]),
    );
  });
});
