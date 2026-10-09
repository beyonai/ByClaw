import { describe, expect, it, vi } from "vitest";
import { MirrorInputWriter } from "../src/infrastructure/persistence/mirror-input.js";
import { event } from "./fixtures.js";

function setup(previous = false, task = true) {
  let saved: Record<string, unknown> = {};
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes("SELECT group_session_id,source_message_id"))
      return task
        ? [
            {
              group_session_id: "30",
              source_message_id: "8000000010000000100",
              initiator_user_id: "20",
            },
          ]
        : [];
    if (sql.includes("usage=1 LIMIT 1")) return previous ? [{ message_id: "100" }] : [];
    if (sql.includes("MAX(message_id)")) return [{ message_id: "8000000010000000200" }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
    if (sql.startsWith("INSERT INTO byai.byai_message ")) {
      const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",");
      saved = Object.fromEntries(columns.map((column, index) => [column, parameters[index]]));
    }
    return [];
  });
  const writer = new MirrorInputWriter({ query }, "10");
  const input = event({
    eventType: "INPUT",
    userMessageId: "101",
    payload: {
      id: "101",
      userId: "20",
      messageContent: "继续处理",
      metadata: { groupPublicContext: { groupSessionId: "999", beforeMessageId: "999" } },
    },
  });
  return { writer, query, input, metadata: () => JSON.parse(saved.metadata as string) };
}

describe("server-owned group context input boundary", () => {
  it("freezes the original group source for the first private input", async () => {
    const s = setup();
    await s.writer.insertInput(s.input);
    expect(s.metadata().groupPublicContext).toEqual({
      groupSessionId: "30",
      beforeMessageId: "8000000010000000100",
    });
    expect(s.query.mock.calls.some(([sql]) => sql.includes("MAX(message_id)"))).toBe(false);
  });
  it("uses the current public ID range for a later input instead of the private BE ID", async () => {
    const s = setup(true);
    await s.writer.insertInput(s.input);
    expect(s.metadata().groupPublicContext).toEqual({
      groupSessionId: "30",
      beforeMessageId: "8000000010000000201",
    });
  });
  it("strips supplied group context metadata from an ordinary session", async () => {
    const s = setup(false, false);
    await s.writer.insertInput(s.input);
    expect(s.metadata()).not.toHaveProperty("groupPublicContext");
  });
});
