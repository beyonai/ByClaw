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
});
function context(operation: any, payload: Record<string, any> = {}, role = "MEMBER") {
  const query = vi.fn(async () => [] as any[]);
  const ctx = new CommandContext({ query }, command({ operation, payload }));
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
  it("accepts acknowledgement only for a dissolved group", async () => {
    const s = context("ACK_DISSOLUTION");
    await expect(groupSettings(s.ctx)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("creates personal sessions with the existing project sentinel", async () => {
    const query = vi.fn(async () => []);
    const ctx = new CommandContext({ query }, command());
    await createSession(ctx);
    const [sql, parameters] = query.mock.calls.at(-1)!;
    expect(sql).toContain("project_id");
    expect(parameters).toContain("-1");
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
    const [sql, parameters] = s.query.mock.calls[0]!;
    expect(sql).toContain("session_content");
    expect(parameters).toContain("shared goal");
  });
  it("allows pending task writes only to the initiator", async () => {
    const s = context("SAVE_PENDING_PUBLICATION", { taskSessionId: "40" });
    s.query.mockResolvedValue([{ initiator_user_id: "21" }]);
    await expect(changeTask(s.ctx)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
});
