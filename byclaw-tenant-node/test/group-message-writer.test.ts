import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { sendGroupMessage } from "../src/infrastructure/persistence/group-message-writer.js";
import { command } from "./fixtures.js";

function setup(payload: Record<string, any>) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("nextval(")) return [{ id: "101" }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
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
    expect(await sendGroupMessage(context)).toBe("101");
    const insert = query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO byai.byai_message"),
    );
    expect(insert).toBeDefined();
    expect(insert![1]).toContain("10");
    expect(insert![1]).toContain("hacu-request");
  });

  it("rejects agent mentions until tenant execution has its own persistence path", async () => {
    const { context, query } = setup({
      chatContent: "@助手 你好",
      resourceList: [{ resourceType: "DIG_EMPLOYEE", resourceId: "42" }],
    });
    await expect(sendGroupMessage(context)).rejects.toThrow("TENANT_GROUP_AGENT_NOT_READY");
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_message"))).toBe(
      false,
    );
  });
});
