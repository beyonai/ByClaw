import { describe, expect, it, vi } from "vitest";
import { projectGroupTaskAnswer } from "../src/infrastructure/persistence/group-task-answer.js";
import { answer, event } from "./fixtures.js";

function database(scope?: Record<string, unknown>) {
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes("FROM byai.byai_group_chat_task WHERE task_session_id"))
      return [
        {
          task_session_id: "50",
          group_session_id: "30",
          source_message_id: "40",
          target_agent_id: "42",
          turn_status: "RUNNING",
          status: "ACTIVE",
        },
      ];
    if (sql.includes("ext_param_code='group_auto_dispatch'")) return [{ ext_param_value: "40" }];
    if (sql.includes("ext_param_code=$2") && parameters[1] === "group_coordination_scope")
      return scope ? [{ ext_param_value: JSON.stringify(scope) }] : [];
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
    const metadata = message![1]!.find(
      (value) => typeof value === "string" && value.startsWith('{"scene"'),
    );
    expect(JSON.parse(metadata as string)).toMatchObject({
      kind: "TASK_RESULT",
      taskId: "50",
      sourceMessageId: "40",
    });
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

  it("keeps progress private when the terminal event has no final answer", async () => {
    const db = database();
    await projectGroupTaskAnswer(db, "10", event({ sessionId: "50", eventType: "TERMINAL" }), {
      ...answer(),
      content: "先读取历史。",
      finalContent: "",
    });
    expect(db.query.mock.calls.some(([sql]) => sql.includes("turn_status='WAITING_USER'"))).toBe(
      true,
    );
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_message")),
    ).toBe(false);
  });

  it("keeps coordinator results private for publication confirmation", async () => {
    const db = database({
      schemaVersion: "byclaw.group-coordination/v1",
      mode: "COORDINATED",
      groupSessionId: "30",
      taskSessionId: "50",
      coordinatorAgentId: "42",
      allowedAgentIds: ["43", "44"],
    });
    await projectGroupTaskAnswer(db, "10", event({ sessionId: "50", eventType: "TERMINAL" }), {
      ...answer(),
      content: "@员工43 完成",
      finalContent: "@员工43 完成",
      metadata: { agentId: "42" },
    });
    expect(db.query.mock.calls.some(([sql]) => sql.includes("turn_status='WAITING_USER'"))).toBe(
      true,
    );
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_message")),
    ).toBe(false);
  });

  it("rejects terminal results attributed to an agent other than the coordinator", async () => {
    const db = database({
      schemaVersion: "byclaw.group-coordination/v1",
      mode: "COORDINATED",
      groupSessionId: "30",
      taskSessionId: "50",
      coordinatorAgentId: "42",
      allowedAgentIds: ["43", "44"],
    });
    await expect(
      projectGroupTaskAnswer(db, "10", event({ sessionId: "50", eventType: "TERMINAL" }), {
        ...answer(),
        metadata: { agentId: "43" },
      }),
    ).rejects.toThrow("GROUP_COORDINATION_AGENT_MISMATCH");
  });
});
