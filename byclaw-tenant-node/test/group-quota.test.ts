import { describe, expect, it, vi } from "vitest";
import type { SharedQuota } from "../src/application/shared-quota.js";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { requireGroupMemberCapacity } from "../src/infrastructure/persistence/group-quota.js";
import { addMembers } from "../src/infrastructure/persistence/member-writer.js";
import { createSession } from "../src/infrastructure/persistence/session-writer.js";
import { joinGroup } from "../src/infrastructure/persistence/group-join.js";
import { sendGroupMessage } from "../src/infrastructure/persistence/group-message-writer.js";
import { command } from "./fixtures.js";

const quota: SharedQuota = {
  schemaVersion: 1,
  enterpriseId: "10",
  revision: "1",
  mode: "LIMITED",
  limits: { memberLimit: 100, groupLimit: 1, groupMemberLimit: 2, agentLimit: 1 },
  updatedAt: "2026-10-27T01:00:00Z",
};
const user = (id: string) => ({ memObjType: "USER" as const, memObjId: id });
const agent = (id: string) => ({ memObjType: "AGENT" as const, memObjId: id });

function fixture(value: SharedQuota | null = quota, existing = [user("20"), agent("90")]) {
  const rows = [...existing];
  const effects: string[] = [];
  let sequence = 0;
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.startsWith("SELECT session_id FROM byai.byai_session WHERE session_id=")) {
      effects.push("ownership-check");
      return [{ session_id: "30" }];
    }
    if (sql.includes("COUNT(*)::text AS current_count") && sql.includes("session_type='hs_as'")) {
      effects.push("group-count");
      return [{ current_count: "1" }];
    }
    if (sql.includes("GROUP BY mem_obj_type")) {
      effects.push("count");
      return ["USER", "AGENT"].map((type) => ({
        mem_obj_type: type,
        current_count: String(rows.filter((row) => row.memObjType === type).length),
      }));
    }
    if (sql.startsWith("SELECT mem_obj_type,mem_obj_id"))
      return rows.map((row) => ({ mem_obj_type: row.memObjType, mem_obj_id: row.memObjId }));
    if (sql.includes("BTRIM(session_name")) return [];
    if (sql.includes("FROM byai.byai_session WHERE"))
      return [{ session_id: "30", session_type: "hs_as", state: "ACTIVE", project_id: "50" }];
    if (sql.startsWith("SELECT") && sql.includes("FROM byai.byai_session_member")) {
      const type = sql.includes("mem_obj_type=$2")
        ? args[1]
        : sql.includes("mem_obj_type='AGENT'")
          ? "AGENT"
          : "USER";
      const id = sql.includes("mem_obj_type=$2") ? args[2] : args[1];
      return rows.some((row) => row.memObjType === type && row.memObjId === id)
        ? [{ mem_obj_id: id, mem_name: id, user_role: "OWNER" }]
        : [];
    }
    if (sql.includes("SELECT e.session_id,e.ext_param_value"))
      return [
        {
          session_id: "30",
          ext_param_value: JSON.stringify({
            token: "Invite01",
            inviterId: "20",
            expiresAt: Date.now() + 60000,
          }),
        },
      ];
    if (sql.includes("nextval(")) return [{ id: String(++sequence) }];
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: String(sequence) }];
    if (sql.startsWith("INSERT")) {
      effects.push(sql.includes("byai_session_member") ? "insert-member" : "insert-other");
      if (sql.includes("byai_session_member")) {
        const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",");
        rows.push({
          memObjType: args[columns.indexOf("mem_obj_type")],
          memObjId: args[columns.indexOf("mem_obj_id")],
        });
      }
    }
    return [];
  });
  const db = {
    query,
    lock: async (key: string) => {
      effects.push(`lock:${key}`);
    },
  };
  const reader = { read: async () => value };
  const context = new CommandContext(db, command(), reader);
  return { context, db, query, reader, rows, effects };
}

/** Pause only the Redis lock, so policy changes happen while the real admission flow waits for it. */
function pauseGuard(query: ReturnType<typeof fixture>["query"]) {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = query.getMockImplementation()!;
  query.mockImplementation(async (sql, args = []) => {
    if (sql.startsWith("SELECT session_id FROM byai.byai_session WHERE session_id=")) {
      enter();
      await released;
    }
    return original(sql, args);
  });
  return { entered, release };
}

describe("tenant group membership quota", () => {
  it("uses independent USER and AGENT limits, counting the owner and coordinator", async () => {
    const { context, effects } = fixture();
    await expect(requireGroupMemberCapacity(context, [user("21")])).resolves.toBeUndefined();
    await expect(requireGroupMemberCapacity(context, [agent("91")])).rejects.toMatchObject({
      code: "GROUP_AGENT_LIMIT_EXCEEDED",
    });
    expect(effects[0]).toBe("lock:session:30");
    expect(effects.indexOf("ownership-check")).toBeLessThan(effects.indexOf("count"));
  });

  it("cannot count or admit members without a valid group after acquiring the Redis lock", async () => {
    const { context, query, effects } = fixture();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, args = []) =>
      sql.startsWith("SELECT session_id FROM byai.byai_session WHERE session_id=")
        ? []
        : original(sql, args),
    );
    await expect(requireGroupMemberCapacity(context, [user("21")])).rejects.toMatchObject({
      code: "RESOURCE_NOT_ACCESSIBLE",
    });
    expect(effects).not.toContain("count");
  });

  it("applies a lower limit published while waiting for the Redis lock", async () => {
    const { context, query, reader } = fixture();
    let current: SharedQuota | null = quota;
    const read = vi.spyOn(reader, "read").mockImplementation(async () => current);
    const wait = pauseGuard(query);
    const pending = requireGroupMemberCapacity(context, [user("21")]);
    await wait.entered;
    current = { ...quota, revision: "2", limits: { ...quota.limits, groupMemberLimit: 1 } };
    wait.release();
    await expect(pending).rejects.toMatchObject({ code: "GROUP_MEMBER_LIMIT_EXCEEDED" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([null, { ...quota, revision: "2", mode: "UNLIMITED" as const }])(
    "allows a constraint removed while waiting for the Redis lock: %j",
    async (updated) => {
      const { context, query, reader, effects } = fixture();
      let current: SharedQuota | null = quota;
      const read = vi.spyOn(reader, "read").mockImplementation(async () => current);
      const wait = pauseGuard(query);
      const pending = requireGroupMemberCapacity(context, [user("21"), user("22")]);
      await wait.entered;
      current = updated;
      wait.release();
      await expect(pending).resolves.toBeUndefined();
      expect(read).toHaveBeenCalledTimes(2);
      expect(effects).not.toContain("count");
    },
  );

  it("deduplicates additions and allows existing memberships after limits decrease", async () => {
    const { context } = fixture({
      ...quota,
      limits: { ...quota.limits, groupMemberLimit: 0, agentLimit: 0 },
    });
    await expect(
      requireGroupMemberCapacity(context, [user("20"), user("20"), agent("90")]),
    ).resolves.toBeUndefined();
    await expect(requireGroupMemberCapacity(context, [user("21")])).rejects.toMatchObject({
      code: "GROUP_MEMBER_LIMIT_EXCEEDED",
    });
    const other = fixture();
    await expect(
      requireGroupMemberCapacity(other.context, [user("21"), user("21")]),
    ).resolves.toBeUndefined();
  });

  it.each([null, { ...quota, mode: "UNLIMITED" as const }])(
    "allows unrestricted projections",
    async (value) => {
      const { context, effects } = fixture(value);
      await expect(
        requireGroupMemberCapacity(context, [user("21"), user("22"), agent("91")]),
      ).resolves.toBeUndefined();
      expect(effects).not.toContain("count");
    },
  );

  it("rejects an over-limit mixed batch before writing any member or notice", async () => {
    const { db, reader, rows, effects } = fixture();
    const context = new CommandContext(
      db,
      command({
        operation: "ADD_MEMBERS",
        payload: {
          members: [user("21"), { ...agent("91"), resourceAuthorized: true }],
        },
      }),
      reader,
    );
    await expect(addMembers(context)).rejects.toMatchObject({ code: "GROUP_AGENT_LIMIT_EXCEEDED" });
    expect(rows).toHaveLength(2);
    expect(effects.filter((effect) => effect.startsWith("insert"))).toEqual([]);
  });

  it.each([1, 150])("admits CREATE_GROUP when the inserted group fits limit %i", async (groupLimit) => {
    const { db, reader } = fixture({ ...quota, limits: { ...quota.limits, groupLimit } }, []);
    const context = new CommandContext(db, command({ operation: "CREATE_GROUP" }), reader);
    // The count includes the new session already inserted in the command transaction.
    await expect(requireGroupMemberCapacity(context, [user("20"), agent("90")])).resolves.toBeUndefined();
  });

  it("guards an entire initial CREATE_GROUP batch including owner and default coordinator", async () => {
    const { db, reader, effects } = fixture(
      { ...quota, limits: { ...quota.limits, agentLimit: 0 } },
      [],
    );
    const context = new CommandContext(
      db,
      command({
        operation: "CREATE_GROUP",
        payload: {
          projectId: "50",
          sessionName: "Design",
          coordinatorAgentId: "90",
          members: [
            { ...user("20"), userRole: "OWNER" },
            { ...agent("90"), userRole: "MEMBER", resourceAuthorized: true },
          ],
        },
      }),
      reader,
    );
    vi.spyOn(context, "session").mockResolvedValue(null);
    await expect(createSession(context)).rejects.toMatchObject({
      code: "GROUP_AGENT_LIMIT_EXCEEDED",
    });
    expect(effects).not.toContain("insert-member");
  });

  it("rejects CREATE_GROUP when the enterprise workgroup limit is already full", async () => {
    const { db, reader, effects } = fixture(
      { ...quota, limits: { ...quota.limits, groupLimit: 0 } },
      [],
    );
    const context = new CommandContext(
      db,
      command({
        operation: "CREATE_GROUP",
        payload: {
          projectId: "50",
          sessionName: "Full",
          members: [{ ...user("20"), userRole: "OWNER" }],
        },
      }),
      reader,
    );
    vi.spyOn(context, "session").mockResolvedValue(null);
    await expect(createSession(context)).rejects.toMatchObject({ code: "GROUP_LIMIT_EXCEEDED" });
    expect(effects).not.toContain("insert-member");
  });

  it("enforces USER capacity for a link join", async () => {
    const { db, reader, effects } = fixture({
      ...quota,
      limits: { ...quota.limits, groupMemberLimit: 1 },
    });
    const context = new CommandContext(
      db,
      command({
        operation: "JOIN_GROUP",
        userId: "21",
        payload: {
          token: "Invite01",
          joinLinkAuthorized: true,
          memName: "New member",
        },
      }),
      reader,
    );
    await expect(joinGroup(context)).rejects.toMatchObject({ code: "GROUP_MEMBER_LIMIT_EXCEEDED" });
    expect(effects).not.toContain("insert-member");
  });

  it("guards coordinator restoration while sending a group message", async () => {
    const { db, reader, effects } = fixture();
    const context = new CommandContext(
      db,
      command({
        operation: "SEND_GROUP_MESSAGE",
        payload: {
          chatContent: "Hello",
          resourceList: [{ resourceType: "DIG_EMPLOYEE", resourceId: "90" }],
          coordinatorAgentId: "91",
          coordinatorAuthorized: true,
        },
      }),
      reader,
    );
    await expect(sendGroupMessage(context)).rejects.toMatchObject({
      code: "GROUP_AGENT_LIMIT_EXCEEDED",
    });
    expect(effects.filter((effect) => effect.startsWith("insert"))).toEqual([]);
  });
});
