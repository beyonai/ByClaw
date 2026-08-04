import type { RunEvent } from "@byclaw/by-conductor";
import { describe, expect, it } from "vitest";
import { createByClawSseSerializer } from "../server/byclaw-sse.js";

describe("createByClawSseSerializer", () => {
  it("serializes Leader reasoning separately from the visible answer", () => {
    const serialize = createByClawSseSerializer();

    const reasoning = serialize(event(1, "leader.reasoning.delta", { text: "分析中" }));
    const answer = serialize(event(2, "leader.delta", { text: "正文" }));

    expect(reasoning).toContain("event: reasoningLogStart");
    expect(reasoning).toContain("event: reasoningLogDelta");
    expect(reasoning).toContain("分析中");
    expect(reasoning).not.toContain("answerDelta");
    expect(answer).toContain("event: reasoningLogEnd");
    expect(answer).toContain("event: answerStart");
    expect(answer).toContain("event: answerDelta");
    expect(answer).toContain("正文");
  });
});

function event(eventId: number, type: RunEvent["type"], data: RunEvent["data"]): RunEvent {
  return {
    eventId,
    timestamp: eventId,
    runId: "run-1",
    type,
    data,
  };
}
