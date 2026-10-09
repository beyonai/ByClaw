import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import {
  updateFeedback,
  updateMessageStructure,
} from "../src/infrastructure/persistence/message-update-writer.js";
import { command } from "./fixtures.js";

function setup(
  operation: "UPDATE_FEEDBACK" | "UPDATE_MESSAGE_STRUCTURE",
  payload: Record<string, unknown>,
) {
  const row = {
    message_id: "40",
    session_id: "30",
    enterprise_id: "10",
    metadata: '{"agentId":"42","tread":"21","feedback_content":"old"}',
    message_struct: '[{"id":"segment","choices":[{"delta":{"content":"old"}}]}]',
  };
  const query = vi.fn(async (sql: string, _args: unknown[] = []) =>
    sql.startsWith("SELECT") ? [row] : [],
  );
  const ctx = new CommandContext({ query }, command({ operation, payload }));
  return { ctx, query };
}

describe("tenant message updates", () => {
  it("replaces feedback while retaining unrelated metadata inside the owning session", async () => {
    const s = setup("UPDATE_FEEDBACK", { messageId: "40", type: "praise", mode: "reaction" });
    const result = await updateFeedback(s.ctx);
    expect(JSON.parse(result.metadata)).toEqual({
      agentId: "42",
      praise: "20",
      feedback_type: "praise",
    });
    expect(s.query.mock.calls[0]![1]).toEqual(["40", "30", "10"]);
    expect(s.query.mock.calls[1]![1]).toEqual([result.metadata, "40", "30", "10"]);
  });

  it("clears feedback without deleting responder metadata", async () => {
    const s = setup("UPDATE_FEEDBACK", { messageId: "40", type: "none", mode: "feedback" });
    expect(JSON.parse((await updateFeedback(s.ctx)).metadata)).toEqual({ agentId: "42" });
  });

  it("rejects missing or recalled messages before writing", async () => {
    const s = setup("UPDATE_FEEDBACK", { messageId: "40", type: "praise", mode: "reaction" });
    s.query.mockResolvedValue([]);
    await expect(updateFeedback(s.ctx)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    expect(s.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });

  it("edits the selected response segment in the tenant database", async () => {
    const s = setup("UPDATE_MESSAGE_STRUCTURE", {
      messageId: "40",
      updateField: "messageStruct",
      id: "segment",
      content: "new",
    });
    await updateMessageStructure(s.ctx);
    expect(JSON.parse(s.query.mock.calls[1]![1]![0] as string)).toEqual([
      { id: "segment", choices: [{ delta: { content: "new" } }] },
    ]);
    expect(s.query.mock.calls[1]![1]!.slice(1)).toEqual(["40", "30", "10"]);
  });

  it("rejects unknown update columns and malformed feedback types", async () => {
    await expect(
      updateMessageStructure(setup("UPDATE_MESSAGE_STRUCTURE", { updateField: "metadata" }).ctx),
    ).rejects.toThrow("INVALID_MESSAGE_UPDATE");
    await expect(
      updateFeedback(setup("UPDATE_FEEDBACK", { type: "invalid", mode: "feedback" }).ctx),
    ).rejects.toThrow("INVALID_FEEDBACK");
  });
});
