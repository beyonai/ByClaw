import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { sendGroupMessage } from "../src/infrastructure/persistence/group-message-writer.js";
import { command } from "./fixtures.js";

function setup(payload: Record<string, any>) {
  let sequence = 100;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("nextval(")) return [{ id: String(++sequence) }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
    if (sql.includes("mem_obj_type=$2")) return [{ exists: 1 }];
    if (sql.includes("SELECT m.*,s.session_type"))
      return [{ session_id: "30", session_type: "hs_as" }];
    return [];
  });
  const context = new CommandContext(
    { query },
    command({
      operation: "SEND_GROUP_MESSAGE",
      requestId: "hacu-request",
      payload,
    }),
  );
  vi.spyOn(context, "session").mockResolvedValue({ sessionType: "hs_as" });
  return { context, query };
}

describe("tenant group message", () => {
  it("commits a text message with the tenant and client request identity", async () => {
    const { context, query } = setup({
      chatContent: "你好",
      resourceList: [],
      creatorName: "张三",
    });
    expect(await sendGroupMessage(context)).toEqual({
      messageId: "8000000010000000101",
      dispatches: [],
    });
    const insert = query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO byai.byai_message"),
    );
    expect(insert).toBeDefined();
    expect(insert![1]).toContain("10");
    expect(insert![1]).toContain("hacu-request");
  });

  it("creates a tenant task and private session for an agent mention", async () => {
    const { context, query } = setup({
      chatContent: "@助手 你好",
      resourceList: [{ resourceType: "DIG_EMPLOYEE", resourceId: "42" }],
    });
    expect(await sendGroupMessage(context)).toEqual({
      messageId: "8000000010000000101",
      dispatches: [{ taskSessionId: "8000000010000000102", targetAgentId: "42" }],
    });
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_session (")),
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_group_chat_task")),
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_session_ext")),
    ).toBe(true);
  });
});
