import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_ATTACHMENT_ENABLED,
  LEADER_CHECKPOINT_TOOL_NAMES,
  LEADER_FILE_TOOL_NAMES,
} from "../src/context/active-leader-tools.js";

describe("Leader checkpoint tool allowlist", () => {
  it("covers attachment tools and every enabled session file tool", () => {
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toContain("inspectAttachment");
    // downloadAttachment 随 DOWNLOAD_ATTACHMENT_ENABLED 开关进出长期 checkpoint 白名单。
    if (DOWNLOAD_ATTACHMENT_ENABLED) {
      expect(LEADER_CHECKPOINT_TOOL_NAMES).toContain("downloadAttachment");
    } else {
      expect(LEADER_CHECKPOINT_TOOL_NAMES).not.toContain("downloadAttachment");
    }
    expect(LEADER_CHECKPOINT_TOOL_NAMES).toEqual(
      expect.arrayContaining([...LEADER_FILE_TOOL_NAMES]),
    );
  });
});
