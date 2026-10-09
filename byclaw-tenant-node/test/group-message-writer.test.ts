import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { sendGroupMessage } from "../src/infrastructure/persistence/group-message-writer.js";
import { command } from "./fixtures.js";

function setup(payload: Record<string, any>, coordinatorAgentId?: string) {
  let sequence = 100;
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes("nextval(")) return [{ id: String(++sequence) }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
    if (
      sql.includes("mem_obj_type=$2") ||
      (sql.includes("SELECT 1") && sql.includes("mem_obj_type='AGENT'"))
    )
      return [{ exists: 1 }];
    if (sql.includes("ext_param_code=$2") && parameters[1] === "group_coordinator_agent_id")
      return coordinatorAgentId ? [{ ext_param_value: coordinatorAgentId }] : [];
    if (sql.includes("SELECT mem_obj_id"))
      return [{ mem_obj_id: "42" }, { mem_obj_id: "43" }, { mem_obj_id: "90" }];
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

  it("creates one fixed coordinator task scoped to distinct mentioned agents", async () => {
    const { context, query } = setup(
      {
        chatContent: "{{DIG_EMPLOYEE_42}} {{DIG_EMPLOYEE_43}} 一起制作视频",
        resourceList: [
          { resourceType: "DIG_EMPLOYEE", resourceId: "42" },
          { resourceType: "DIG_EMPLOYEE", resourceId: "43" },
          { resourceType: "DIG_EMPLOYEE", resourceId: "42" },
          { resourceType: "HUMAN", resourceId: "21" },
        ],
      },
      "90",
    );
    const result = await sendGroupMessage(context);
    expect(result.dispatches).toHaveLength(1);
    expect(result.dispatches[0]).toMatchObject({
      targetAgentId: "90",
      groupCoordination: {
        schemaVersion: "byclaw.group-coordination/v1",
        mode: "COORDINATED",
        groupSessionId: "30",
        taskSessionId: result.dispatches[0]!.taskSessionId,
        coordinatorAgentId: "90",
        allowedAgentIds: ["42", "43"],
      },
    });
    const sessions = query.mock.calls.filter(([sql]) =>
      sql.startsWith("INSERT INTO byai.byai_session ("),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]![1]).toContain("GROUP_TASK");
    expect(
      query.mock.calls.some(
        ([sql, args]) =>
          sql.startsWith("INSERT INTO byai.byai_session_ext") &&
          args.includes("group_coordination_scope"),
      ),
    ).toBe(true);
  });

  it("does not count duplicate agent or human mentions as a coordinated task", async () => {
    const { context } = setup(
      {
        chatContent: "你好",
        resourceList: [
          { resourceType: "DIG_EMPLOYEE", resourceId: "42" },
          { resourceType: "DIG_EMPLOYEE", resourceId: "42" },
          { resourceType: "HUMAN", resourceId: "21" },
        ],
      },
      "90",
    );
    const result = await sendGroupMessage(context);
    expect(result.dispatches).toHaveLength(1);
    expect(result.dispatches[0]).toMatchObject({
      targetAgentId: "42",
      groupCoordination: {
        mode: "DIRECT",
        coordinatorAgentId: "90",
        allowedAgentIds: ["42", "43"],
      },
    });
  });

  it("rejects multi-agent dispatch without a configured coordinator", async () => {
    const { context } = setup({
      chatContent: "一起工作",
      resourceList: [
        { resourceType: "DIG_EMPLOYEE", resourceId: "42" },
        { resourceType: "DIG_EMPLOYEE", resourceId: "43" },
      ],
    });
    await expect(sendGroupMessage(context)).rejects.toThrow("GROUP_COORDINATOR_NOT_CONFIGURED");
  });

  it("returns the persisted coordinator scope when replaying the same source message", async () => {
    const { context, query } = setup(
      {
        chatContent: "一起工作",
        resourceList: [
          { resourceType: "DIG_EMPLOYEE", resourceId: "42" },
          { resourceType: "DIG_EMPLOYEE", resourceId: "43" },
        ],
      },
      "90",
    );
    const scope = {
      schemaVersion: "byclaw.group-coordination/v1",
      mode: "COORDINATED",
      groupSessionId: "30",
      taskSessionId: "50",
      coordinatorAgentId: "90",
      allowedAgentIds: ["42", "43"],
    };
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, parameters = []) => {
      if (sql.includes("SELECT message_id FROM byai.byai_message")) return [{ message_id: "40" }];
      if (sql.includes("SELECT task_session_id,target_agent_id"))
        return [{ task_session_id: "50", target_agent_id: "90" }];
      if (sql.includes("ext_param_code=$2") && parameters[1] === "group_coordination_scope")
        return [{ ext_param_value: JSON.stringify(scope) }];
      return original(sql, parameters);
    });
    expect(await sendGroupMessage(context)).toEqual({
      messageId: "40",
      dispatches: [{ taskSessionId: "50", targetAgentId: "90", groupCoordination: scope }],
    });
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("atomically adds a BE-authorized default coordinator to an existing group", async () => {
    const { context, query } = setup({
      chatContent: "一起工作",
      coordinatorAgentId: "90",
      coordinatorName: "群组工作助手",
      coordinatorAuthorized: true,
      resourceList: [
        { resourceType: "DIG_EMPLOYEE", resourceId: "42" },
        { resourceType: "DIG_EMPLOYEE", resourceId: "43" },
      ],
    });
    const original = query.getMockImplementation()!;
    let bound = false;
    let member = false;
    query.mockImplementation(async (sql, parameters = []) => {
      if (sql.includes("ext_param_code=$2") && parameters[1] === "group_coordinator_agent_id")
        return bound ? [{ ext_param_value: "90" }] : [];
      if (
        sql.includes("SELECT 1") &&
        sql.includes("mem_obj_type='AGENT'") &&
        parameters[1] === "90"
      )
        return member ? [{ exists: 1 }] : [];
      if (sql.startsWith("INSERT INTO byai.byai_session_member")) member = true;
      if (
        sql.startsWith("INSERT INTO byai.byai_session_ext") &&
        parameters.includes("group_coordinator_agent_id")
      )
        bound = true;
      return original(sql, parameters);
    });
    const result = await sendGroupMessage(context);
    expect(result.dispatches).toHaveLength(1);
    expect(result.dispatches[0]!.targetAgentId).toBe("90");
    expect(member).toBe(true);
    expect(bound).toBe(true);
  });
});
