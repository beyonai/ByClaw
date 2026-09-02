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
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "If the user's request is complex or requires multiple steps to complete, you must use updateTaskPlan to plan the work.",
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

  it("makes the final response self-contained when delegated output is collapsed", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Sub-agent activity and raw output may be hidden or collapsed",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "produce your own user-facing response that stands on its own",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Treat that response as the primary delivery of the result",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "material findings, conclusions, completed actions, and unresolved issues",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Do not respond only with an acknowledgement, a completion status",
    );
  });

  it("delivers specialist file artifacts in the same user-facing response", () => {
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "include every returned artifact in the same user-facing response",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Use the artifact name and URI or link exactly as returned when available",
    );
    expect(SUPER_ASSISTANT_SYSTEM_PROMPT).toContain(
      "leave it solely in the sub-agent output",
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
