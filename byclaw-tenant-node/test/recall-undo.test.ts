import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import * as writer from "../src/infrastructure/persistence/session-writer.js";
import { command } from "./fixtures.js";

const now = 1800000000000;
let saved: Record<string, any>;
let context: CommandContext;
let query: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  saved = {
    message_id: "90",
    session_id: "30",
    usage: 1,
    recalled_at: new Date(now - 1000),
    recalled_by: "20",
    server_now: new Date(now),
    message_content: "original",
    metadata: JSON.stringify({
      resourceList: [{ id: "9007199254740993" }],
      recall: { operatorId: "20" },
    }),
  };
  query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.startsWith("SELECT") && sql.includes("byai.byai_message")) return [{ ...saved }];
    if (sql.startsWith("UPDATE byai.byai_message")) {
      saved.recalled_at = null;
      saved.recalled_by = null;
      saved.metadata = args[3];
      return [{ message_id: "90" }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  context = new CommandContext(
    { query },
    command({ payload: { messageId: "90", recalledAt: now - 1000 } }),
  );
  vi.spyOn(context, "member").mockResolvedValue({ userRole: "MEMBER" });
  vi.spyOn(context, "session").mockResolvedValue({ sessionType: "hs_as" });
});

afterEach(() => vi.useRealTimers());

async function undo() {
  expect(writer).toHaveProperty("undoRecallMessage");
  return (writer as any).undoRecallMessage(context);
}

it("restores the original payload without touching cancelled tasks or executions", async () => {
  const result = await undo();
  expect(result.data).toMatchObject({ messageId: "90", recalled: false, recall: null });
  expect(result.data.changed).toBe(true);
  expect(saved.recalled_at).toBeNull();
  expect(saved.message_content).toBe("original");
  expect(JSON.parse(saved.metadata)).toEqual({
    resourceList: [{ id: "9007199254740993" }],
    recallUndo: { operatorId: "20", recalledAt: now - 1000 },
  });
});

it.each([120000, 119999])("accepts a recall made %i milliseconds ago", async (age) => {
  saved.recalled_at = new Date(now - age);
  context.command.payload.recalledAt = now - age;
  expect((await undo()).data.recalled).toBe(false);
});

it.each([120001, -1])("rejects an expired or future recall with age %i", async (age) => {
  saved.recalled_at = new Date(now - age);
  context.command.payload.recalledAt = now - age;
  await expect(undo()).rejects.toThrow("RECALL_UNDO_EXPIRED");
  expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
});

it("rejects another operator even when they are the owner", async () => {
  saved.recalled_by = "21";
  vi.spyOn(context, "member").mockResolvedValue({ userRole: "OWNER" });
  await expect(undo()).rejects.toThrow("RECALL_UNDO_FORBIDDEN");
});

it("rejects an old undo request after a later recall", async () => {
  saved.recalled_at = new Date(now - 500);
  await expect(undo()).rejects.toThrow("RECALL_UNDO_CONFLICT");
});

it("only treats the matching actor and recall as an idempotent retry", async () => {
  await undo();
  saved.server_now = new Date(now + 180000);
  expect((await undo()).data.changed).toBe(false);
  expect(query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"))).toHaveLength(1);
  context.command.userId = "21";
  await expect(undo()).rejects.toThrow("RECALL_UNDO_FORBIDDEN");
});

it("requires current group membership", async () => {
  vi.spyOn(context, "member").mockResolvedValue(null);
  await expect(undo()).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
});

it("rejects a message that has never been recalled", async () => {
  saved.recalled_at = null;
  await expect(undo()).rejects.toThrow("RECALL_UNDO_CONFLICT");
});

it("rejects missing, system and personal-session messages", async () => {
  query.mockResolvedValueOnce([]);
  await expect(undo()).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  saved.usage = 5;
  await expect(undo()).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  saved.usage = 1;
  vi.spyOn(context, "session").mockResolvedValue({ sessionType: "hs_ah" });
  await expect(undo()).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
});

it("rejects a competing conditional update without reporting success", async () => {
  query.mockImplementation(async (sql: string) => (sql.startsWith("SELECT") ? [{ ...saved }] : []));
  await expect(undo()).rejects.toThrow("RECALL_UNDO_CONFLICT");
});

it("uses timestamp parameters and the database clock for the restoration window", async () => {
  // 数据库无时区时间按 pg 的进程时区读取；窗口不能依赖运行进程的 Date.now。
  vi.setSystemTime(now + 8 * 60 * 60 * 1000);
  await undo();
  const update = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE"))!;
  expect(update[1][5]).toEqual(new Date(now - 1000));
  expect(update[1][6]).toEqual(new Date(now));
  expect(update[1][7]).toEqual(new Date(now - 120000));
});

it.each([null, 0, "1800000000000", 1.5])("rejects invalid recalledAt %s", async (value) => {
  context.command.payload.recalledAt = value;
  await expect(undo()).rejects.toThrow("INVALID_RECALLED_AT");
});
