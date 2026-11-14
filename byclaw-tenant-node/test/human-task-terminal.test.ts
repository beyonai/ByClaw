import { describe, expect, it, vi } from "vitest";
import { projectGroupTaskAnswer } from "../src/infrastructure/persistence/group-task-answer.js";
import { event, answer } from "./fixtures.js";
describe("human task terminal projection", () => {
  it("waits for user confirmation without publishing task-result group messages", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("nextval(")) return [{ id: "100" }];
      if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
      if (sql.includes("FROM byai.byai_group_chat_execution")) return [];
      if (sql.includes("SELECT * FROM byai.byai_group_chat_task"))
        return [
          {
            task_session_id: "40",
            group_session_id: "30",
            target_agent_id: "50",
            source_message_id: "60",
            status: "ACTIVE",
            turn_status: "RUNNING",
          },
        ];
      if (sql.includes("ext_param_code='group_auto_dispatch'")) return [{ ext_param_value: "60" }];
      if (sql.includes("SELECT mem_name")) return [{ mem_name: "employee" }];
      if (sql.includes("SELECT state")) return [{ state: "ACTIVE" }];
      if (sql.includes("FROM byai.byai_group_human_task_session")) return [{ human_task_id: "90" }];
      return [];
    });
    await projectGroupTaskAnswer(
      { query, lock: async () => {} },
      "10",
      event({ eventType: "TERMINAL", sessionId: "40" }),
      answer({ content: "private result", finalContent: "private result" }),
    );
    expect(query.mock.calls.some(([sql]) => sql.includes("turn_status='WAITING_USER'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_message"))).toBe(
      false,
    );
    expect(query.mock.calls.some(([sql]) => sql.includes("publish_message_id="))).toBe(false);
  });
});
