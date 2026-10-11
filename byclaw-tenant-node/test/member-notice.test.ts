import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { joinGroup } from "../src/infrastructure/persistence/group-join.js";
import { addMembers, removeMember } from "../src/infrastructure/persistence/member-writer.js";
import { command } from "./fixtures.js";

function fixture(operation: "JOIN_GROUP" | "ADD_MEMBERS" | "LEAVE_GROUP" | "REMOVE_MEMBER") {
  const members = new Map<string, any>([
    ["21", { mem_obj_id: "21", mem_name: "群主", user_role: "OWNER" }],
  ]);
  if (["LEAVE_GROUP", "REMOVE_MEMBER"].includes(operation))
    members.set("20", {
      byai_session_member_id: "40",
      mem_obj_id: "20",
      mem_obj_type: "USER",
      mem_name: "新成员",
      user_role: "MEMBER",
    });
  const messages: Record<string, any>[] = [];
  let sequence = 0;
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.includes("SELECT e.session_id,e.ext_param_value"))
      return [
        {
          session_id: "30",
          ext_param_value: JSON.stringify({
            token: "Invite01",
            inviterId: "21",
            expiresAt: Date.now() + 60000,
          }),
        },
      ];
    if (sql.includes("FROM byai.byai_session WHERE"))
      return [{ session_id: "30", session_type: "hs_as", state: "ACTIVE", project_id: "50" }];
    if (sql.startsWith("SELECT") && sql.includes("FROM byai.byai_session_member")) {
      const id = sql.includes("mem_obj_type=$2") ? args[2] : args[1];
      return members.has(id) ? [members.get(id)] : [];
    }
    if (sql.includes("nextval")) return [{ id: String(++sequence) }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: String(sequence) }];
    if (sql.startsWith("DELETE FROM byai.byai_session_member")) {
      for (const [id, member] of members)
        if (member.byai_session_member_id === args[0]) members.delete(id);
    }
    if (sql.startsWith("INSERT")) {
      const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",");
      const row = Object.fromEntries(columns.map((key, index) => [key, args[index]]));
      if (sql.includes("byai_session_member")) members.set(row.mem_obj_id, row);
      if (sql.includes("byai_message")) messages.push(row);
    }
    return [];
  });
  const context = new CommandContext(
    { query },
    command({
      operation,
      userId: operation === "REMOVE_MEMBER" ? "21" : "20",
      payload: ["LEAVE_GROUP", "REMOVE_MEMBER"].includes(operation)
        ? { memObjType: "USER", memObjId: "20" }
        : operation === "JOIN_GROUP"
          ? { token: "Invite01", joinLinkAuthorized: true, memName: "新成员" }
          : {
              members: [
                { memObjType: "USER", memObjId: "20", memName: "新成员" },
                { memObjType: "USER", memObjId: "20", memName: "新成员" },
              ],
            },
    }),
  );
  if (operation === "ADD_MEMBERS")
    vi.spyOn(context, "member").mockResolvedValue({
      userRole: "OWNER",
      memName: "群主",
      memObjId: "20",
    });
  return { context, messages };
}

describe("tenant membership chat notices", () => {
  it("persists a link join notice once, including inviter and member name snapshots", async () => {
    const { context, messages } = fixture("JOIN_GROUP");
    const result = await joinGroup(context);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      usage: 5,
      role: "event",
      message_content: "群主 邀请 新成员 加入工作组",
      creator_id: "21",
      project_id: "50",
      is_complete: true,
    });
    expect(JSON.parse(messages[0].metadata).systemEvent).toMatchObject({
      eventType: "MEMBER_INVITED",
      operatorId: "21",
      memberId: "20",
      memberName: "新成员",
    });
    expect(result).toMatchObject({
      data: {
        systemEvents: [
          { event: "MESSAGE_CREATED", kind: "SYSTEM_EVENT", messageId: messages[0].message_id },
        ],
      },
    });
    expect(await joinGroup(context)).toBeUndefined();
    expect(messages).toHaveLength(1);
  });
  it("writes one notice for a newly invited member and none for duplicates or retries", async () => {
    const { context, messages } = fixture("ADD_MEMBERS");
    const result = await addMembers(context);
    expect(messages).toHaveLength(1);
    expect(result).toMatchObject({ data: { systemEvents: [{ event: "MESSAGE_CREATED" }] } });
    await addMembers(context);
    expect(messages).toHaveLength(1);
  });
  it.each(["LEAVE_GROUP", "REMOVE_MEMBER"] as const)(
    "persists %s with names once and keeps the history snapshot after deletion",
    async (operation) => {
      const { context, messages } = fixture(operation);
      const result = await removeMember(context);
      expect(messages).toHaveLength(1);
      expect(messages[0].message_content).toBe(
        operation === "LEAVE_GROUP" ? "新成员 离开了工作组" : "群主 将 新成员 移出工作组",
      );
      expect(JSON.parse(messages[0].metadata).systemEvent).toMatchObject({
        eventType: operation === "LEAVE_GROUP" ? "MEMBER_LEFT" : "MEMBER_REMOVED",
        memberName: "新成员",
        operatorName: operation === "LEAVE_GROUP" ? "新成员" : "群主",
      });
      expect(result).toMatchObject({ data: { systemEvents: [{ event: "MESSAGE_CREATED" }] } });
      expect(await removeMember(context)).toBeUndefined();
      expect(messages).toHaveLength(1);
    },
  );
});
