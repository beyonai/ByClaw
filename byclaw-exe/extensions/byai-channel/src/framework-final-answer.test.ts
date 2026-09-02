import { describe, expect, it } from "vitest";
import {
  createFrameworkFinalAnswerLedger,
  extractLastAssistantText,
  markRootRunOverflowFragment,
  recordRootRunAgentEnd,
  recordRootRunLifecycleTerminal,
  recordRootRunStreamAnswer,
  resolveFrameworkFinalAnswer,
  resolveFrameworkFinalAnswerTerminalOutcome,
} from "./framework-final-answer.js";

describe("framework finalAnswer ledger", () => {
  it("extracts only visible text from the last assistant message", () => {
    expect(
      extractLastAssistantText([
        { role: "assistant", content: "earlier" },
        { role: "tool", content: "tool output" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "final " },
            { type: "tool_use", name: "search" },
            { type: "output_text", text: "answer" },
          ],
        },
      ]),
    ).toBe("final answer");
  });

  it("uses agent_end text instead of the stream fallback", () => {
    const ledger = createFrameworkFinalAnswerLedger();
    recordRootRunStreamAnswer(ledger, "run-1", "stream fallback");
    recordRootRunLifecycleTerminal(ledger, "run-1", "end");
    recordRootRunAgentEnd(ledger, {
      runId: "run-1",
      success: true,
      messages: [{ role: "assistant", content: "authoritative final" }],
    });

    expect(resolveFrameworkFinalAnswer(ledger)).toBe("authoritative final");
  });

  it("returns only the last successful root run", () => {
    const ledger = createFrameworkFinalAnswerLedger();
    recordRootRunStreamAnswer(ledger, "run-process", "I am waiting for delegated work.");
    recordRootRunLifecycleTerminal(ledger, "run-process", "end");
    recordRootRunStreamAnswer(ledger, "run-fallback-failed", "failed candidate");
    recordRootRunLifecycleTerminal(ledger, "run-fallback-failed", "error");
    recordRootRunStreamAnswer(ledger, "run-final", "Consolidated result");
    recordRootRunLifecycleTerminal(ledger, "run-final", "end");

    expect(resolveFrameworkFinalAnswer(ledger)).toBe("Consolidated result");
  });

  it("does not fall back to process text when the terminal root run failed", () => {
    const ledger = createFrameworkFinalAnswerLedger();
    recordRootRunStreamAnswer(ledger, "run-process", "process text");
    recordRootRunLifecycleTerminal(ledger, "run-process", "end");
    recordRootRunStreamAnswer(ledger, "run-terminal", "incomplete failure text");
    recordRootRunAgentEnd(ledger, {
      runId: "run-terminal",
      success: false,
      messages: [{ role: "assistant", content: "incomplete failure text" }],
    });

    expect(resolveFrameworkFinalAnswer(ledger)).toBe("");
    expect(resolveFrameworkFinalAnswerTerminalOutcome(ledger)).toBe("failure");
  });

  it("keeps an empty last successful run authoritative", () => {
    const ledger = createFrameworkFinalAnswerLedger();
    recordRootRunStreamAnswer(ledger, "run-earlier", "process text");
    recordRootRunLifecycleTerminal(ledger, "run-earlier", "end");
    recordRootRunLifecycleTerminal(ledger, "run-no-reply", "end");

    expect(resolveFrameworkFinalAnswer(ledger)).toBe("");
    expect(resolveFrameworkFinalAnswerTerminalOutcome(ledger)).toBe("success");
  });

  it("treats OpenClaw NO_REPLY as an empty terminal answer", () => {
    const ledger = createFrameworkFinalAnswerLedger();
    recordRootRunAgentEnd(ledger, {
      runId: "run-no-reply",
      success: true,
      messages: [{ role: "assistant", content: "NO_REPLY" }],
    });

    expect(resolveFrameworkFinalAnswer(ledger)).toBe("");
  });

  it("joins only the overflow fragment chain with its successful continuation", () => {
    const ledger = createFrameworkFinalAnswerLedger();
    recordRootRunStreamAnswer(ledger, "run-earlier", "unrelated preface");
    recordRootRunLifecycleTerminal(ledger, "run-earlier", "end");
    recordRootRunStreamAnswer(ledger, "run-truncated", "The partial ");
    recordRootRunAgentEnd(ledger, {
      runId: "run-truncated",
      success: false,
      messages: [{ role: "assistant", content: "The partial " }],
    });
    markRootRunOverflowFragment(ledger, "run-truncated");
    recordRootRunStreamAnswer(ledger, "run-continuation", "answer is complete.");
    recordRootRunLifecycleTerminal(ledger, "run-continuation", "end");

    expect(resolveFrameworkFinalAnswer(ledger)).toBe("The partial answer is complete.");
  });
});
