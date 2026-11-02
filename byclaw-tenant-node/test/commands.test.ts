import { describe, expect, it, vi } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { createSession } from "../src/infrastructure/persistence/session-writer.js";
import {
  removeMember,
  changeRole,
  groupSettings,
  addMembers,
} from "../src/infrastructure/persistence/member-writer.js";
import { changeTask } from "../src/infrastructure/persistence/task-writer.js";
import { command } from "./fixtures.js";
import { SqlCommandTransactions } from "../src/infrastructure/persistence/command-repository.js";
import type { ConnectionManager } from "../src/application/connection-manager.js";
describe("command receipts", () => {
  const setup = () => {
    const tx = {
      lock: vi.fn(async () => {}),
      authorize: vi.fn(async () => {}),
      previous: vi.fn(async () => null as any),
      apply: vi.fn(async () => ({ sessionId: "30" })),
      record: vi.fn(async () => {}),
    };
    return { tx, service: new CommandService({ run: async (work) => work(tx) }) };
  };
  it("applies and records inside one transaction", async () => {
    const s = setup(),
      c = command();
    expect(await s.service.execute(c)).toEqual({ sessionId: "30" });
    expect(s.tx.authorize).toHaveBeenCalledWith(c);
    expect(s.tx.record).toHaveBeenCalledWith(c, { sessionId: "30" });
  });
  it("returns the original result after leaving a group without reapplying", async () => {
    const s = setup(),
      c = command({ operation: "LEAVE_GROUP" });
    s.tx.previous.mockResolvedValue({
      hash: c.requestHash,
      userId: c.userId,
      result: { done: true },
    });
    expect(await s.service.execute(c)).toEqual({ done: true });
    expect(s.tx.apply).not.toHaveBeenCalled();
    expect(s.tx.authorize).not.toHaveBeenCalled();
  });
  it("rejects a conflicting request ID", async () => {
    const s = setup();
    s.tx.previous.mockResolvedValue({ hash: "different", userId: "20", result: {} });
    await expect(s.service.execute(command())).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("does not emit saved-row facts again when replaying a command receipt", async () => {
    const s = setup(),
      c = command();
    s.tx.previous.mockResolvedValue({
      hash: c.requestHash,
      userId: c.userId,
      result: {
        sessionId: "30",
        data: { savedMembers: [{ byaiSessionMemberId: "50" }], other: true },
      },
    });
    expect(await s.service.execute(c)).toEqual({
      sessionId: "30",
      data: { savedMembers: [], other: true },
    });
    expect(s.tx.apply).not.toHaveBeenCalled();
  });
});
function context(operation: any, payload: Record<string, any> = {}, role = "MEMBER") {
  const query = vi.fn(async () => [] as any[]);
  const ctx = new CommandContext({ query, lock: async () => {} }, command({ operation, payload }));
  vi.spyOn(ctx, "session").mockResolvedValue({
    sessionType: "hs_as",
    enterpriseId: "10",
    state: "ACTIVE",
  });
  vi.spyOn(ctx, "member").mockResolvedValue({ userRole: role, memObjId: "20" });
  return { ctx, query };
}
describe("group write permission", () => {
  it("rejects nonmembers before mutation", async () => {
    const s = context("UPDATE_SESSION");
    vi.mocked(s.ctx.member).mockResolvedValue(null);
    await expect(s.ctx.authorize()).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("requires a privileged role or enabled member invitation setting", async () => {
    const s = context("ADD_MEMBERS", { members: [{ memObjType: "USER", memObjId: "21" }] });
    await expect(addMembers(s.ctx)).rejects.toThrow("FORBIDDEN");
    expect(s.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it.each(["ADD_MEMBERS", "CREATE_GROUP"])(
    "rejects malformed members in %s with a protocol error",
    async (operation) => {
      const s = context(
        operation,
        { members: [null], sessionName: "group", projectId: "50" },
        "OWNER",
      );
      vi.mocked(s.ctx.session).mockResolvedValue(null);
      await expect(
        operation === "CREATE_GROUP" ? createSession(s.ctx) : addMembers(s.ctx),
      ).rejects.toThrow("INVALID_GROUP_MEMBERS");
    },
  );
  it("requires an ACTIVE tenant member assertion for invited users", async () => {
    const s = context(
      "ADD_MEMBERS",
      { members: [{ memObjType: "USER", memObjId: "99" }] },
      "OWNER",
    );
    await expect(addMembers(s.ctx)).rejects.toThrow("INVALID_GROUP_MEMBERS");
  });
  it("prevents an OWNER from leaving without a transfer", async () => {
    const s = context("LEAVE_GROUP", {}, "OWNER");
    s.query.mockResolvedValue([{ byai_session_member_id: "40", user_role: "OWNER" }]);
    await expect(removeMember(s.ctx)).rejects.toThrow("OWNER_TRANSFER_REQUIRED");
  });
  it("prevents ADMIN from removing another ADMIN", async () => {
    const s = context("REMOVE_MEMBER", { memObjId: "21" }, "ADMIN");
    s.query.mockResolvedValue([{ byai_session_member_id: "40", user_role: "ADMIN" }]);
    await expect(removeMember(s.ctx)).rejects.toThrow("FORBIDDEN");
  });
  it("requires OWNER to assign roles", async () => {
    const s = context("SET_ROLE", { userId: "21", role: "ADMIN" }, "ADMIN");
    await expect(changeRole(s.ctx)).rejects.toThrow("FORBIDDEN");
  });
  it("transfers ownership atomically with demotion", async () => {
    const s = context("TRANSFER_OWNER", { userId: "21" }, "OWNER");
    await changeRole(s.ctx);
    expect(s.query.mock.calls[0]?.[0]).toContain("user_role='ADMIN'");
    expect(s.query.mock.calls[1]?.[1]).toEqual(["OWNER", "30", "21", "10"]);
  });
  it("allows dissolution only to OWNER", async () => {
    const s = context("DISSOLVE_GROUP", {}, "ADMIN");
    await expect(groupSettings(s.ctx)).rejects.toThrow("FORBIDDEN");
  });
  it("updates group name and member permission for an admin", async () => {
    const s = context(
      "UPDATE_SETTINGS",
      { sessionName: " New name ", allowMemberAddAgent: true },
      "ADMIN",
    );
    const extension = vi.spyOn(s.ctx, "setExtension").mockResolvedValue();
    await groupSettings(s.ctx);
    expect(s.query.mock.calls).toContainEqual([
      expect.stringContaining("SET session_name=$1"),
      ["New name", "30", "10"],
    ]);
    expect(extension).toHaveBeenCalledWith("group_member_add_agent_enabled", "true");
  });
  it("rejects empty group settings", async () => {
    const s = context("UPDATE_SETTINGS", {}, "OWNER");
    await expect(groupSettings(s.ctx)).rejects.toThrow("INVALID_GROUP_SETTINGS");
  });
  it("accepts acknowledgement only for a dissolved group", async () => {
    const s = context("ACK_DISSOLUTION");
    await expect(groupSettings(s.ctx)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("creates personal sessions with the existing project sentinel", async () => {
    const query = vi.fn(async () => []);
    const ctx = new CommandContext({ query, lock: async () => {} }, command());
    await createSession(ctx);
    const [sql, parameters] = query.mock.calls.at(-1)!;
    expect(sql).toContain("project_id");
    expect(parameters).toContain("-1");
  });
  it("retains the selected agent and project when creating a tenant chat", async () => {
    const query = vi.fn(async () => []);
    const ctx = new CommandContext(
      { query, lock: async () => {} },
      command({
        payload: {
          sessionName: "project chat",
          sessionType: "h_as",
          agentId: "42",
          projectId: "50",
        },
      }),
    );
    await createSession(ctx);
    const [sql, parameters] = query.mock.calls.at(-1)!;
    expect(sql).toContain("object_id");
    expect(parameters).toContain("42");
    expect(parameters).toContain("50");
  });
  it("rejects a group with two owners", async () => {
    const s = context(
      "CREATE_GROUP",
      {
        sessionName: "group",
        projectId: "50",
        members: [
          { memObjType: "USER", memObjId: "20", userRole: "OWNER" },
          { memObjType: "USER", memObjId: "21", userRole: "OWNER" },
        ],
      },
      "OWNER",
    );
    vi.mocked(s.ctx.session).mockResolvedValue(null);
    await expect(createSession(s.ctx)).rejects.toThrow("INVALID_GROUP_MEMBERS");
  });
  it("persists a new group's goal in the create transaction", async () => {
    const s = context("CREATE_GROUP", {
      sessionName: "group",
      sessionContent: "shared goal",
      projectId: "50",
      members: [{ memObjType: "USER", memObjId: "20", userRole: "OWNER" }],
    });
    vi.mocked(s.ctx.session).mockResolvedValue(null);
    s.query.mockImplementation(async (sql) => (sql.includes("nextval") ? [{ id: "1" }] : []));
    await createSession(s.ctx);
    const [sql, parameters] = s.query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO byai.byai_session "),
    )!;
    expect(sql).toContain("session_content");
    expect(parameters).toContain("shared goal");
    const [memberSql, memberValues] = s.query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO byai.byai_session_member "),
    )!;
    const columns = memberSql.slice(memberSql.indexOf("(") + 1, memberSql.indexOf(")")).split(",");
    const savedId = memberValues[columns.indexOf("byai_session_member_id")];
    expect(s.ctx.savedMembers).toEqual([
      {
        byaiSessionMemberId: savedId,
        groupId: "30",
        enterpriseId: "10",
        userId: "20",
        invitedBy: "20",
      },
    ]);
  });
  it("returns initial member insert facts from the command transaction without chat notices", async () => {
    let sequence = 0;
    const query = vi.fn(async (sql: string) =>
      sql.includes("nextval") ? [{ id: String(++sequence) }] : [],
    );
    const transactions = new SqlCommandTransactions({
      write: async (work: any) => work({ query, lock: async () => {} }),
    } as unknown as ConnectionManager);
    const result = await transactions.run((tx) =>
      tx.apply(
        command({
          operation: "CREATE_GROUP",
          payload: {
            sessionName: "group",
            projectId: "50",
            members: [
              { memObjType: "USER", memObjId: "20", userRole: "OWNER" },
              { memObjType: "AGENT", memObjId: "42", userRole: "MEMBER", resourceAuthorized: true },
            ],
          },
        }),
      ),
    );
    expect(result.data.savedMembers).toHaveLength(1);
    expect(result.data.savedMembers[0]).toMatchObject({
      groupId: "30",
      userId: "20",
      invitedBy: "20",
    });
    expect(result.data.savedMembers[0].byaiSessionMemberId).toMatch(/^[1-9][0-9]*$/);
    expect(result.data.systemEvents).toBeUndefined();
  });
  it("never records a saved-member fact when the member insert fails", async () => {
    const s = context("ADD_MEMBERS");
    s.query.mockImplementation(async (sql) => {
      if (sql.includes("nextval")) return [{ id: "1" }];
      throw new Error("member insert failed");
    });
    await expect(
      s.ctx.saveMember({
        session_id: "30",
        mem_obj_type: "USER",
        mem_obj_id: "20",
        creator_id: "20",
        com_acct_id: "10",
      }),
    ).rejects.toThrow("member insert failed");
    expect(s.ctx.savedMembers).toEqual([]);
  });
  it("allows pending task writes only to the initiator", async () => {
    const s = context("SAVE_PENDING_PUBLICATION", { taskSessionId: "40" });
    s.query.mockResolvedValue([{ initiator_user_id: "21" }]);
    await expect(changeTask(s.ctx)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
});
