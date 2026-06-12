import type { AgentEvent } from "./types.js";

export type AssistantEventKind = "answer" | "reasoning" | "ignore";

const REASONING_PHASES = new Set(["commentary", "reasoning", "analysis"]);
const ANSWER_PHASES = new Set(["final_answer", "final", "answer"]);
const REASONING_STREAMS = new Set(["thinking", "plan"]);
const REASONING_EVENT_TYPES = new Set([
  "thinking",
  "thinking.delta",
  "thinking.start",
  "thinking.end",
  "thinking_delta",
  "thinking_start",
  "thinking_end",
  "reasoning",
  "reasoning.delta",
  "reasoning_delta",
  "plan.delta",
]);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function normalizePhase(value: unknown): string {
  return stringValue(value).trim().toLowerCase();
}

function resolveEventType(event: AgentEvent): string {
  return normalizePhase(event.type) || normalizePhase(event.data?.type);
}

function isReasoningEventType(eventType: string): boolean {
  return REASONING_EVENT_TYPES.has(eventType)
    || eventType.startsWith("thinking.")
    || eventType.startsWith("reasoning.");
}

function isReasoningEvent(event: AgentEvent): boolean {
  return REASONING_STREAMS.has(event.stream) || isReasoningEventType(resolveEventType(event));
}

function textFromContentBlock(value: unknown, kind: AssistantEventKind): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const blockType = normalizePhase(record.type);
    const isReasoningBlock = blockType.includes("thinking")
      || blockType.includes("reasoning")
      || blockType.includes("analysis");
    if (kind === "reasoning" && !isReasoningBlock) {
      continue;
    }
    const text = stringValue(record.text)
      || stringValue(record.delta)
      || stringValue(record.thinking)
      || stringValue(record.reasoning)
      || stringValue(record.content);
    if (text) {
      return text;
    }
  }
  return "";
}

/**
 * Classify assistant agent events for ByAI SSE lanes.
 *
 * Strict split aligned with OpenClaw:
 * - `stream: "thinking"` / SDK `type: "thinking.delta"` → reasoning
 * - `stream: "assistant"` + explicit reasoning phase → reasoning
 * - `stream: "assistant"` otherwise (including phase-less deltas) → answer
 */
export function resolveAssistantEventKind(
  event: AgentEvent,
  _isChildSession: boolean,
): AssistantEventKind {
  if (isReasoningEvent(event)) {
    return "reasoning";
  }
  if (event.stream !== "assistant") {
    return "ignore";
  }

  const phase = normalizePhase(event.data?.phase);
  if (REASONING_PHASES.has(phase)) {
    return "reasoning";
  }
  if (ANSWER_PHASES.has(phase)) {
    return "answer";
  }
  if (boolValue(event.data?.replace)) {
    return "answer";
  }

  // Phase-less assistant chunks are visible answer text. Model-side planning must
  // use stream "thinking" or an explicit reasoning phase — never the default lane.
  return "answer";
}

export function resolveReasoningEventText(event: AgentEvent): string {
  return stringValue(event.data?.text)
    || stringValue(event.data?.delta)
    || stringValue(event.data?.thinking)
    || stringValue(event.data?.reasoning)
    || stringValue(event.data?.outputText)
    || textFromContentBlock(event.data?.content, "reasoning");
}

export function resolveAssistantEventText(
  event: AgentEvent,
  kind: AssistantEventKind,
): string {
  if (kind === "reasoning") {
    return resolveReasoningEventText(event);
  }
  const delta = stringValue(event.data?.delta);
  const text = stringValue(event.data?.text);
  if (kind === "answer" && boolValue(event.data?.replace)) {
    return text || delta;
  }
  return delta
    || text
    || stringValue(event.data?.content)
    || stringValue(event.data?.outputText)
    || textFromContentBlock(event.data?.content, kind);
}

export function resolveAssistantDisplayStream(
  event: AgentEvent,
  isChildSession: boolean,
): string {
  if (isReasoningEvent(event)) {
    return "thinking";
  }
  if (event.stream !== "assistant") {
    return event.stream;
  }
  const kind = resolveAssistantEventKind(event, isChildSession);
  if (kind === "reasoning") {
    return "thinking";
  }
  if (kind === "answer") {
    return "assistant";
  }
  return event.stream;
}
