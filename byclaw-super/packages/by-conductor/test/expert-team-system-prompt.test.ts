import { describe, expect, it } from "vitest";
import { EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT } from "../src/context/expert-team-system-prompt.js";

describe("EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT", () => {
  it("makes the final response self-contained when member output is collapsed", () => {
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "Sub-agent activity and raw output may be hidden or collapsed",
    );
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "produce your own user-facing response that stands on its own",
    );
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "Treat that response as the primary delivery of the result",
    );
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "material findings, conclusions, completed actions, and unresolved issues",
    );
  });

  it("delivers member file artifacts in the same user-facing response", () => {
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "include every returned artifact in the same user-facing response",
    );
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "Use the artifact name and URI or link exactly as returned when available",
    );
    expect(EXPERT_TEAM_PLATFORM_SYSTEM_PROMPT).toContain(
      "leave it solely in the sub-agent output",
    );
  });
});
