import { describe, expect, it, vi } from "vitest";
import { projectGroupTaskAnswer } from "../src/infrastructure/persistence/group-task-answer.js";
import { answer, event } from "./fixtures.js";

function database() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM byai.byai_group_chat_task WHERE task_session_id"))
      return [
        {
          task_session_id: "50",
          group_session_id: "30",
          source_message_id: "40",
          target_agent_id: "42",
          turn_status: "RUNNING",
        },
      ];
    if (sql.includes("ext_param_code='group_auto_dispatch'")) return [{ ext_param_value: "40" }];
    if (sql.includes("mem_obj_type='AGENT'")) return [{ mem_name: "助手" }];
    if (sql.includes("session_type='hs_as'")) return [{ state: "ACTIVE" }];
    if (sql.includes("nextval(")) return [{ id: "101" }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "2" }];
    if (sql.includes("SELECT m.*,s.session_type"))
      return [
        { message_id: "101", session_id: "30", session_type: "hs_as", create_time: new Date() },
      ];
    if (sql.includes("SELECT message_id,message_ref,topic_id,usage"))
      return [{ message_id: "40", message_ref: null, topic_id: "40", usage: 1 }];
    return [];
  });
  return { query };
}

describe("tenant group task answer", () => {
  it("projects the terminal answer into the owning group and links the source", async () => {
    const db = database();
    await projectGroupTaskAnswer(db, "10", event({ sessionId: "50", eventType: "TERMINAL" }), {
      ...answer(),
      content: "完成",
      finalContent: "完成",
    });
    const message = db.query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO byai.byai_message"),
    );
    expect(message).toBeDefined();
    expect(message![1]).toContain("30");
    expect(message![1]).toContain("42");
    expect(message![1]).toContain("完成");
    expect(db.query.mock.calls.some(([sql]) => sql.includes("turn_status='WAITING_USER'"))).toBe(
      true,
    );
  });

  it("marks a failed turn without publishing a group reply", async () => {
    const db = database();
    await projectGroupTaskAnswer(
      db,
      "10",
      event({ sessionId: "50", eventType: "ERROR" }),
      answer(),
    );
    expect(db.query.mock.calls.some(([sql]) => sql.includes("turn_status='FAILED'"))).toBe(true);
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_message")),
    ).toBe(false);
  });
});
