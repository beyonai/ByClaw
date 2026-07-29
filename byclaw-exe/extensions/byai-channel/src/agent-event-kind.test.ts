import { describe, expect, it } from "vitest";
import {
  resolveAssistantDisplayStream,
  resolveAssistantEventKind,
  resolveAssistantEventText,
  resolveReasoningEventText,
} from "./agent-event-kind.js";
import type { AgentEvent } from "./types.js";

function assistantEvent(data: Record<string, unknown>): AgentEvent {
  return {
    seq: 1,
    runId: "run-1",
    stream: "assistant",
    data,
  } as AgentEvent;
}

function agentEvent(event: Partial<AgentEvent> & { data: Record<string, unknown> }): AgentEvent {
  return {
    seq: 1,
    runId: "run-1",
    stream: "assistant",
    ...event,
  } as AgentEvent;
}

describe("resolveAssistantEventKind", () => {
  it("routes explicit reasoning phases to reasoning", () => {
    expect(
      resolveAssistantEventKind(assistantEvent({ phase: "reasoning", delta: "step" }), false),
    ).toBe("reasoning");
    expect(
      resolveAssistantEventKind(assistantEvent({ phase: "commentary", delta: "plan" }), false),
    ).toBe("reasoning");
    expect(
      resolveAssistantEventKind(assistantEvent({ phase: "analysis", delta: "plan" }), false),
    ).toBe("reasoning");
  });

  it("routes explicit answer phases to answer", () => {
    expect(
      resolveAssistantEventKind(assistantEvent({ phase: "final_answer", delta: "hi" }), false),
    ).toBe("answer");
    expect(
      resolveAssistantEventKind(assistantEvent({ phase: "final", delta: "hi" }), false),
    ).toBe("answer");
  });

  it("routes phase-less assistant chunks to answer (visible body)", () => {
    expect(
      resolveAssistantEventKind(assistantEvent({ delta: "Checking tools..." }), false),
    ).toBe("answer");
    expect(
      resolveAssistantEventKind(
        assistantEvent({ delta: "<!DOCTYPE html><html><head>" }),
        false,
      ),
    ).toBe("answer");
  });

  it("routes child session phase-less assistant chunks to answer", () => {
    expect(
      resolveAssistantEventKind(assistantEvent({ delta: "sub-agent reply" }), true),
    ).toBe("answer");
  });

  it("routes replace events to answer", () => {
    expect(
      resolveAssistantEventKind(
        assistantEvent({ replace: true, text: "final answer" }),
        false,
      ),
    ).toBe("answer");
  });

  it("prefers answer delta over cumulative text snapshots", () => {
    const event = assistantEvent({
      text: "初稿已写入工作区。以下是正文：",
      delta: "以下是正文：",
    });

    expect(resolveAssistantEventText(event, "answer")).toBe("以下是正文：");
  });

  it("routes normalized thinking events to reasoning", () => {
    const event = agentEvent({
      stream: "agent",
      type: "thinking.delta",
      data: { delta: "new thought" },
    });

    expect(resolveAssistantEventKind(event, false)).toBe("reasoning");
    expect(resolveAssistantDisplayStream(event, false)).toBe("thinking");
    expect(resolveReasoningEventText(event)).toBe("new thought");
  });

  it("routes raw thinking stream events to reasoning", () => {
    const event = agentEvent({
      stream: "thinking",
      data: { thinking: "checking context" },
    });

    expect(resolveAssistantEventKind(event, false)).toBe("reasoning");
    expect(resolveAssistantDisplayStream(event, false)).toBe("thinking");
    expect(resolveReasoningEventText(event)).toBe("checking context");
  });

  it("extracts reasoning content blocks from normalized payloads", () => {
    const event = agentEvent({
      stream: "agent",
      type: "thinking.delta",
      data: {
        content: [
          { type: "text", text: "visible answer" },
          { type: "reasoning", text: "hidden plan" },
        ],
      },
    });

    expect(resolveReasoningEventText(event)).toBe("hidden plan");
    expect(resolveAssistantEventText(event, "reasoning")).toBe("hidden plan");
  });
});
