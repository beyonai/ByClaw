import { describe, expect, it, vi } from "vitest";
import { publishTask } from "../src/infrastructure/persistence/task-publication.js";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { command } from "./fixtures.js";

describe("task publication mentions", () => {
  it("publishes attribution mentions without creating any new agent task", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM byai.byai_group_chat_task WHERE"))
        return [
          {
            task_session_id: "50",
            group_session_id: "30",
            source_message_id: "40",
            target_agent_id: "90",
            initiator_user_id: "20",
            status: "ACTIVE",
            turn_status: "WAITING_USER",
          },
        ];
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
    const context = new CommandContext(
      { query },
      command({
        operation: "PUBLISH_TASK",
        payload: {
          taskSessionId: "50",
          text: "[@视频助手](uid=DIG_EMPLOYEE_42)：已完成",
          files: [],
          metadata: { resourceList: [{ resourceType: "DIG_EMPLOYEE", resourceId: "42" }] },
        },
      }),
    );
    const result = await publishTask(context);
    expect(result.dispatches).toBeUndefined();
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_group_chat_task (")),
    ).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO byai.byai_message"))).toBe(
      true,
    );
  });
});
