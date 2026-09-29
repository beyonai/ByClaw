import { describe, expect, it, vi } from "vitest";
import { reduceAnswer } from "../src/domain/mirror.js";
import { MirrorService } from "../src/application/mirror-service.js";
import type { MirrorTransaction } from "../src/application/mirror-ports.js";
import { answer, event } from "./fixtures.js";
describe("answer state machine", () => {
  it("appends once and ignores an identical retry", () => {
    const e = event(),
      next = reduceAnswer(answer(), e)!;
    expect(next.content).toBe("hi");
    expect(next.version).toBe("1");
    expect(reduceAnswer(next, e)).toBeNull();
  });
  it("rejects a repeated ID with changed content", () => {
    const next = reduceAnswer(answer(), event())!;
    expect(() => reduceAnswer(next, event({ payload: { id: "201", text: "different" } }))).toThrow(
      "IDEMPOTENCY_CONFLICT",
    );
  });
  it("leaves sequence gaps retryable", () => {
    expect(() => reduceAnswer(answer(), event({ eventSeq: "2" }))).toThrow("MIRROR_SEQUENCE_GAP");
  });
  it("compares Gateway IDs numerically, including child order", () => {
    const next = reduceAnswer(answer(), event({ sourceStreamId: "9-2" }))!;
    const later = event({
      sourceStreamId: "10-0",
      eventId: "event2",
      payload: { id: "201", text: " there" },
    });
    expect(reduceAnswer(next, later)?.content).toBe("hi there");
    expect(reduceAnswer(next, event({ sourceStreamId: "8-99", eventId: "older" }))).toBeNull();
  });
  it("rejects switching event ordering mode within a run", () => {
    const next = reduceAnswer(answer(), event())!;
    expect(() => reduceAnswer(next, event({ eventId: "next", sourceStreamId: "10-0" }))).toThrow(
      "MIRROR_ORDER_MODE_MISMATCH",
    );
  });
  it("terminal replaces the draft with a full snapshot", () => {
    const next = reduceAnswer(answer(), event())!;
    const terminal = reduceAnswer(
      next,
      event({
        eventId: "terminal",
        eventSeq: "2",
        eventType: "TERMINAL",
        payload: { id: "201", relationId: "202", messageContent: "full answer" },
      }),
    )!;
    expect(terminal.content).toBe("full answer");
    expect(terminal.complete).toBe(true);
    expect(() => reduceAnswer(terminal, event({ eventId: "late", eventSeq: "3" }))).toThrow(
      "ANSWER_ALREADY_TERMINAL",
    );
  });
  it.each(["ERROR", "CANCEL"] as const)("persists %s as a completed failure", (eventType) => {
    expect(reduceAnswer(answer(), event({ eventType }))?.status).toBe(-1);
  });
});
function setup() {
  const tx: MirrorTransaction = {
    lock: vi.fn(async () => {}),
    input: vi.fn(async () => ({
      messageId: "100",
      sessionId: "30",
      runId: "run",
      answerMessageId: "101",
      hash: "",
      userId: "20",
      content: "question",
    })),
    assertInputAccess: vi.fn(async () => {}),
    insertInput: vi.fn(async () => {}),
    answer: vi.fn(async () => null),
    saveAnswer: vi.fn(async () => {}),
    saveRelation: vi.fn(async () => {}),
  };
  const commit = vi.fn();
  const service = new MirrorService({
    run: async (work) => {
      const result = await work(tx);
      commit();
      return result;
    },
  });
  return { tx, commit, service };
}
describe("mirror transaction", () => {
  it("waits for the input instead of inventing a relation", async () => {
    const s = setup();
    vi.mocked(s.tx.input).mockResolvedValue(null);
    await expect(s.service.apply(event())).rejects.toThrow("INPUT_NOT_COMMITTED");
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.tx.saveAnswer).not.toHaveBeenCalled();
  });
  it("writes answer and relation in the same successful transaction", async () => {
    const s = setup();
    await s.service.apply(
      event({
        eventType: "TERMINAL",
        payload: { id: "201", relationId: "202", messageContent: "answer" },
      }),
    );
    expect(s.tx.saveAnswer).toHaveBeenCalledOnce();
    expect(s.tx.saveRelation).toHaveBeenCalledOnce();
    expect(s.commit).toHaveBeenCalledOnce();
  });
  it("does not commit if the consumer lease is lost", async () => {
    const s = setup();
    await expect(
      s.service.apply(event(), async () => {
        throw new Error("lease lost");
      }),
    ).rejects.toThrow();
    expect(s.commit).not.toHaveBeenCalled();
  });
  it("rejects foreign run/answer context", async () => {
    const s = setup();
    await expect(s.service.apply(event({ runId: "other" }))).rejects.toThrow(
      "MIRROR_CONTEXT_MISMATCH",
    );
  });
});
