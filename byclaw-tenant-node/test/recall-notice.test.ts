import { expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { recallMessage } from "../src/infrastructure/persistence/session-writer.js";
import { safeMessage } from "../src/application/history/message-format.js";
import { command } from "./fixtures.js";

it("returns a named recall notice and preserves its first operator on retries", async () => {
  const saved = {
    creator_id: "20",
    usage: 1,
    recalled_at: null as Date | null,
    recalled_by: null as string | null,
    metadata: JSON.stringify({ scene: "GROUP_CHAT", resourceList: [{ secret: "hidden" }] }),
  };
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.startsWith("SELECT") && sql.includes("byai.byai_message")) return [{ ...saved }];
    if (sql.includes("SET recalled_at=")) {
      if (!saved.recalled_at) {
        saved.recalled_at = new Date(1000);
        saved.recalled_by = String(args[0]);
        saved.metadata = String(args[4]);
      }
    }
    return [];
  });
  const context = new CommandContext(
    { query },
    command({ operation: "RECALL_MESSAGE", payload: { messageId: "90" } }),
  );
  vi.spyOn(context, "member").mockResolvedValue({ memName: "张三", userRole: "OWNER" });
  const result = await recallMessage(context);
  expect(result.data).toMatchObject({
    messageId: "90",
    recalled: true,
    content: "张三 撤回了一条消息",
    recall: { operatorId: "20", operatorName: "张三", recalledAt: 1000 },
  });
  context.command.userId = "21";
  const authorize = vi.spyOn(context, "requireRole").mockResolvedValue();
  vi.spyOn(context, "member").mockResolvedValue({ memName: "李四", userRole: "OWNER" });
  expect((await recallMessage(context)).data.recall).toEqual(result.data.recall);
  expect(authorize).toHaveBeenCalledWith(["OWNER", "ADMIN"]);
  const projection = safeMessage({
    messageId: "90",
    recalledAt: saved.recalled_at,
    recalledBy: saved.recalled_by,
    metadata: saved.metadata,
    messageContent: "secret",
    relatedResources: "secret",
  });
  expect(projection.messageContent).toBe("张三 撤回了一条消息");
  expect(projection.recall.operatorName).toBe("张三");
  expect(JSON.stringify(projection)).not.toContain("secret");
  expect(JSON.stringify(projection)).not.toContain("hidden");
});

it("assigns a new millisecond version when recalling immediately after undo", async () => {
  let version = 0;
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.includes("SELECT creator_id"))
      return [
        {
          creator_id: "20",
          usage: 1,
          metadata: JSON.stringify({ recallUndo: { operatorId: "20", recalledAt: 1800000000000 } }),
        },
      ];
    if (sql.includes("SET recalled_at=")) version = args[5] instanceof Date ? args[5].getTime() : 0;
    if (sql.startsWith("SELECT recalled_at"))
      return [{ recalled_at: new Date(version), recalled_by: "20", metadata: "{}" }];
    return [];
  });
  const context = new CommandContext(
    { query },
    command({ operation: "RECALL_MESSAGE", payload: { messageId: "90" } }),
  );
  vi.spyOn(context, "member").mockResolvedValue({ memName: "张三" });
  await recallMessage(context);
  expect(version).toBe(1800000000001);
});
