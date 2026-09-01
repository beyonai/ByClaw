import { describe, expect, it } from "vitest";
import { EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT } from "../src/context/expert-team-system-prompt.js";

describe("EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT", () => {
  it("lists member file artifacts in the user-facing summary", () => {
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "If a member returns any file artifacts, list those artifacts together with the member's result",
    );
  });
});
