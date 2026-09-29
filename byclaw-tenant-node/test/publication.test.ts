import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { publishTask } from "../src/infrastructure/persistence/task-publication.js";
import { changeTask } from "../src/infrastructure/persistence/task-writer.js";
import { command } from "./fixtures.js";
function setup(overrides: Record<string, unknown> = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT * FROM byai.byai_group_chat_task"))
      return [
        {
          task_session_id: "40",
          initiator_user_id: "20",
          status: "ACTIVE",
          turn_status: "WAITING_USER",
          target_agent_id: "50",
          source_message_id: "100",
          ...overrides,
        },
      ];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
    return [];
  });
  const ctx = new CommandContext(
    { query },
    command({
      operation: "PUBLISH_TASK",
      payload: { taskSessionId: "40", id: "200", messageId: "201", text: "result", files: [] },
    }),
  );
  return { query, ctx };
}
describe("task publication", () => {
  it("writes publication, message, state and pending cleanup inside its enclosing transaction", async () => {
    const s = setup();
    await publishTask(s.ctx);
    expect(s.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO byai.byai_message"))).toBe(
      true,
    );
    expect(
      s.query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO byai.byai_group_chat_task_publication"),
      ),
    ).toBe(true);
    expect(s.query.mock.calls.at(-1)?.[0]).toContain(
      "DELETE FROM byai.byai_group_chat_pending_publication",
    );
  });
  it("rejects a running turn and non-initiator", async () => {
    await expect(publishTask(setup({ turn_status: "RUNNING" }).ctx)).rejects.toThrow(
      "TASK_NOT_READY_FOR_PUBLICATION",
    );
    await expect(publishTask(setup({ initiator_user_id: "21" }).ctx)).rejects.toThrow(
      "RESOURCE_NOT_ACCESSIBLE",
    );
  });
  it("requires BE-authorized files and a matching pending card", async () => {
    const s = setup();
    s.ctx.command.payload.files = [{}];
    await expect(publishTask(s.ctx)).rejects.toThrow("INVALID_PUBLICATION_FILES");
    s.ctx.command.payload.files = [];
    s.ctx.command.payload.pendingPublicationId = "900";
    await expect(publishTask(s.ctx)).rejects.toThrow("PENDING_PUBLICATION_CHANGED");
  });
  it("prevents generic task updates from bypassing publication", async () => {
    const s = setup();
    s.ctx.command.operation = "UPDATE_TASK";
    s.ctx.command.payload.status = "PUBLISHED";
    await expect(changeTask(s.ctx)).rejects.toThrow("USE_TASK_PUBLICATION");
  });
});
