import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { acknowledgeMessage } from "../src/infrastructure/persistence/message-ack-writer.js";
import { command } from "./fixtures.js";

describe("tenant message acknowledgement", () => {
  it("confirms a human mention with the same idempotent MERGE contract as BE", async () => {
    const query = vi.fn(async (sql: string, _parameters: unknown[] = []) => {
      if (sql.includes("ON CONFLICT")) throw new Error('syntax error at or near "CONFLICT"');
      if (sql.startsWith("SELECT m.creator_id")) return [{ creator_id: "20" }];
      if (sql.startsWith("SELECT 1")) return [{ exists: 1 }];
      if (sql.startsWith("SELECT a.*"))
        return [
          { message_id: "40", user_id: "21", user_name: "张三", acknowledged_at: new Date(1000) },
        ];
      return [];
    });
    const context = new CommandContext(
      { query },
      command({
        userId: "21",
        operation: "ACK_MESSAGE",
        payload: { messageId: "40", userName: "张三" },
      }),
    );
    vi.spyOn(context, "member").mockResolvedValue({ memName: "张三" });
    expect(await acknowledgeMessage(context)).toEqual({
      messageId: "40",
      acknowledgements: [{ messageId: "40", userId: "21", userName: "张三", acknowledgedAt: 1000 }],
    });
    const write = query.mock.calls.find(([sql]) =>
      sql.startsWith("MERGE INTO byai.byai_group_chat_message_ack"),
    );
    expect(write?.[1]).toEqual(["30", "40", "21", "张三"]);
    expect(write?.[0]).toContain("WHEN NOT MATCHED");
    expect(write?.[0]).not.toContain("WHEN MATCHED");
  });
});
