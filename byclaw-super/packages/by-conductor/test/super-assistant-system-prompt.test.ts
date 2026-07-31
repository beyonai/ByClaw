import { describe, expect, it } from "vitest";
import { SUPER_ASSISTANT_SYSTEM_PROMPT } from "../src/context/super-assistant-system-prompt.js";

describe("SUPER_ASSISTANT_SYSTEM_PROMPT", () => {
  it("defines distinct simple, standard, and complex request paths", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain("1. Simple request:");
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain("Answer it directly.");
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain("2. Standard request:");
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Do not solve it yourself. Immediately delegate",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain("3. Complex request:");
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Do not call any specialist in the same turn.",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Only after the user explicitly confirms the plan",
    );
  });

  it("requires user confirmation for specialist questions the leader cannot decide", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "apply the Mandatory Task Triage again to that question",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "ask the user the minimum necessary question",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Never guess or make the decision without the user's confirmation.",
    );
  });

  it("requires attachment ids to be materialized before local file access", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "call downloadAttachment with its exact attachment id",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "use the returned relativePath",
    );
  });

  it("forbids self-solving after a delegation failure", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "directly explain the reason and what remains unresolved",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Do not attempt to solve the failed delegated work yourself",
    );
  });
});
