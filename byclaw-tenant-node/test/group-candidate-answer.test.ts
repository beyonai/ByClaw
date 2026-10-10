import { describe, expect, it, vi } from "vitest";
import { projectGroupTaskAnswer } from "../src/infrastructure/persistence/group-task-answer.js";
import { MirrorInputWriter } from "../src/infrastructure/persistence/mirror-input.js";
import { answer, event } from "./fixtures.js";

function setup() {
  const candidate: Record<string, any> = {
    execution_id: "60",
    group_session_id: "30",
    source_message_id: "40",
    target_agent_id: "42",
    initiator_user_id: "20",
    candidate_session_id: "50",
    status: "RUNNING",
    disposition: "UNKNOWN",
    trace_id: "trace",
    answer_message_id: "101",
  };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT * FROM byai.byai_group_chat_execution")) return [candidate];
    if (sql.includes("mem_obj_type='AGENT'")) return [{ mem_name: "助手" }];
    if (sql.includes("mem_obj_type='USER'")) return [{ exists: true }];
    if (sql.includes("session_type='hs_as'")) return [{ state: "ACTIVE" }];
    if (sql.includes("SELECT message_id,recalled_at")) return [{ message_id: "40" }];
    if (sql.includes("nextval(")) return [{ id: "102" }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "2" }];
    if (sql.startsWith("UPDATE byai.byai_group_chat_execution SET disposition=")) {
      if (sql.includes("SET disposition='CHAT'")) {
        candidate.disposition = "CHAT";
        return [];
      }
      candidate.disposition = params[0];
      candidate.status = params[4];
    }
    if (sql.startsWith("UPDATE byai.byai_group_chat_execution SET status="))
      candidate.status = params[0];
    return [];
  });
  const messages = () =>
    query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO byai.byai_message"));
  const tasks = () =>
    query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO byai.byai_group_chat_task"));
  const disposition = {
    schemaVersion: "1",
    dispatchId: "60",
    kind: "TASK",
    taskName: "制作视频",
    ackText: "已接收视频任务",
  };
  const project = (
    eventType: "DELTA" | "TERMINAL" | "ERROR" | "CANCEL",
    metadata?: Record<string, unknown>,
  ) =>
    projectGroupTaskAnswer(
      { query },
      "10",
      event({
        sessionId: "50",
        eventType,
        payload: { id: "201", ...(metadata ? { metadata } : {}) },
      }),
      answer({ content: "你好", finalContent: eventType === "TERMINAL" ? "你好" : null }),
    );
  return { candidate, query, messages, tasks, disposition, project };
}

describe("tenant single-mention classification", () => {
  it("does not publish an empty CHAT reply or fall back to private progress", async () => {
    const { query, messages, tasks, candidate } = setup();
    await projectGroupTaskAnswer(
      { query },
      "10",
      event({ sessionId: "50", eventType: "TERMINAL" }),
      answer({ content: "先读取历史。", finalContent: "" }),
    );
    expect(messages()).toHaveLength(0);
    expect(tasks()).toHaveLength(0);
    expect(candidate.status).toBe("FAILED");
  });

  it.each([
    undefined,
    { schemaVersion: "1", dispatchId: "60", kind: "CHAT" },
    { schemaVersion: "1", dispatchId: "999", kind: "TASK", taskName: "错误任务" },
  ])(
    "publishes a greeting without a task card when TASK is not declared for this dispatch",
    async (groupDisposition) => {
      const { project, messages, tasks, candidate, query } = setup();
      await project("TERMINAL", groupDisposition ? { groupDisposition } : {});
      expect(tasks()).toHaveLength(0);
      expect(messages()).toHaveLength(1);
      const metadata = messages()[0]![1].find(
        (v) => typeof v === "string" && v.includes('"scene"'),
      ) as string;
      expect(JSON.parse(metadata)).toMatchObject({ kind: "CHAT_REPLY", sourceMessageId: "40" });
      expect(JSON.parse(metadata)).not.toHaveProperty("taskId");
      expect(
        query.mock.calls.some(
          ([sql, values]) =>
            sql.startsWith("UPDATE byai.byai_session SET state=") &&
            values[0] === "GROUP_CHAT_DISPATCH",
        ),
      ).toBe(true);
      expect(candidate).toMatchObject({ disposition: "CHAT", status: "COMPLETED" });
      await project("TERMINAL", groupDisposition ? { groupDisposition } : {});
      expect(messages()).toHaveLength(1);
    },
  );
  it("promotes the running execution immediately, emits one acknowledgement, and keeps the result private", async () => {
    const { project, messages, tasks, disposition, candidate } = setup();
    await project("DELTA", { groupDisposition: disposition });
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]![1]).toContain("RUNNING");
    expect(messages()).toHaveLength(1);
    expect(messages()[0]![1]).toContain("已接收视频任务");
    expect(messages()[0]![1]).not.toContain("你好");
    const metadata = messages()[0]![1].find(
      (v) => typeof v === "string" && v.includes('"scene"'),
    ) as string;
    expect(JSON.parse(metadata)).toMatchObject({ kind: "TASK_ACK", taskId: "50" });
    await project("DELTA", { groupDisposition: disposition });
    await project("TERMINAL");
    expect(tasks()).toHaveLength(1);
    expect(messages()).toHaveLength(1);
    expect(candidate).toMatchObject({ disposition: "TASK", status: "COMPLETED" });
  });
  it("persists the first CHAT decision without an early group reply and ignores later TASK declarations", async () => {
    const { project, tasks, messages, candidate, disposition } = setup();
    await project("DELTA", {
      groupDisposition: { schemaVersion: "1", dispatchId: "60", kind: "CHAT" },
    });
    expect(tasks()).toHaveLength(0);
    expect(messages()).toHaveLength(0);
    expect(candidate.disposition).toBe("CHAT");
    await project("TERMINAL", { groupDisposition: disposition });
    expect(tasks()).toHaveLength(0);
    expect(messages()).toHaveLength(1);
    expect(candidate.disposition).toBe("CHAT");
  });
  it("retains TASK classification while normalizing a long task name to the persisted limit", async () => {
    const { project, tasks, disposition, candidate } = setup();
    await project("TERMINAL", { groupDisposition: { ...disposition, taskName: "中".repeat(300) } });
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]![1]).toContain("中".repeat(85));
    expect(candidate.disposition).toBe("TASK");
  });
  it("rejects a terminal answer from a different execution trace", async () => {
    const { project, candidate, messages, tasks } = setup();
    candidate.trace_id = "other-trace";
    await expect(project("TERMINAL")).rejects.toThrow("MIRROR_CONTEXT_MISMATCH");
    expect(messages()).toHaveLength(0);
    expect(tasks()).toHaveLength(0);
  });
  it.each(["ERROR", "CANCEL"] as const)(
    "fails a candidate on %s without creating a task or group reply",
    async (type) => {
      const { project, candidate, messages, tasks } = setup();
      await project(type);
      expect(candidate.status).toBe("FAILED");
      expect(messages()).toHaveLength(0);
      expect(tasks()).toHaveLength(0);
    },
  );
  it("does not promote or publish a recalled source message", async () => {
    const { project, query, disposition, messages, tasks, candidate } = setup();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, params = []) =>
      sql.includes("SELECT message_id,recalled_at")
        ? [{ message_id: "40", recalled_at: new Date() }]
        : original(sql, params),
    );
    await project("TERMINAL", { groupDisposition: disposition });
    expect(candidate.status).toBe("FAILED");
    expect(messages()).toHaveLength(0);
    expect(tasks()).toHaveLength(0);
  });
  it("binds a promoted task follow-up and completes only its current trace without reclassification or a group result", async () => {
    const { candidate, query, tasks, messages } = setup();
    candidate.disposition = "TASK";
    candidate.status = "COMPLETED";
    const task = {
      group_session_id: "30",
      source_message_id: "40",
      initiator_user_id: "20",
      status: "ACTIVE",
      current_turn_trace_id: "trace",
      turn_status: "WAITING_USER",
    };
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, params = []) => {
      if (sql.startsWith("SELECT * FROM byai.byai_session WHERE"))
        return [{ session_id: "50", creator_id: "20", state: "GROUP_TASK", session_type: "h_as" }];
      if (sql.includes("JOIN byai.byai_session_member")) return [{ exists: true }];
      if (sql.includes("SELECT group_session_id")) return [task];
      if (sql.startsWith("UPDATE byai.byai_group_chat_task SET turn_status='RUNNING'")) {
        task.current_turn_trace_id = String(params[1]);
        task.turn_status = "RUNNING";
        return [{ task_session_id: "50" }];
      }
      if (sql.startsWith("UPDATE byai.byai_group_chat_task SET turn_status=$1")) {
        if (task.current_turn_trace_id === params[2]) task.turn_status = String(params[0]);
        return [];
      }
      return original(sql, params);
    });
    const input = event({
      sessionId: "50",
      eventType: "INPUT",
      traceId: "new-trace",
      userMessageId: "200",
      answerMessageId: "202",
      payload: { id: "200", userId: "20", messageContent: "继续做视频" },
    });
    const writer = new MirrorInputWriter({ query }, "10");
    await writer.assertInputAccess(input);
    await writer.insertInput(input);
    expect(task.turn_status).toBe("RUNNING");
    const previousMessageCount = messages().length;
    await projectGroupTaskAnswer(
      { query },
      "10",
      event({ sessionId: "50", eventType: "TERMINAL" }),
      answer(),
    );
    expect(task.turn_status).toBe("RUNNING");
    await projectGroupTaskAnswer(
      { query },
      "10",
      event({
        sessionId: "50",
        eventType: "TERMINAL",
        traceId: "new-trace",
        answerMessageId: "202",
      }),
      answer({ content: "新的视频结果" }),
    );
    expect(task.turn_status).toBe("WAITING_USER");
    expect(messages()).toHaveLength(previousMessageCount);
    expect(tasks()).toHaveLength(0);
    expect(candidate.disposition).toBe("TASK");
  });
});
