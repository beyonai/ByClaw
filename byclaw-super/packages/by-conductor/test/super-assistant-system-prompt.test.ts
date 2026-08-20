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
      "use askUserQuestion to ask the user the minimum necessary structured question",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Never guess or make the decision without the user's confirmation.",
    );
  });

  it("uses structured clarification and lets the user choose between similar employees", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "use askUserQuestion to ask the minimum necessary structured questions",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "two or more authorized digital employees have similar capabilities",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "let the user choose the digital employee before delegating",
    );
  });

  it("delegates file reading to a specialist instead of reading attachments locally", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "You have no file-reading capability",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "delegate the work to a suitable authorized specialist via delegateAgent",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "forward the relevant attachment id(s) through attachmentIds",
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
