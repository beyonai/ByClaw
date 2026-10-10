import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { joinGroup } from "../src/infrastructure/persistence/group-join.js";
import { addMembers } from "../src/infrastructure/persistence/member-writer.js";
import { command } from "./fixtures.js";
describe("BE-authorized group joins", () => {
  it("checks the link proof and current group setting", async () => {
    let joinEnabled = false;
    const query = vi.fn(async (sql: string) => {
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
        return [{ session_id: "30", session_type: "hs_as", state: "ACTIVE" }];
      if (sql.includes("SELECT * FROM byai.byai_session_member"))
        return [{ user_role: "OWNER", mem_name: "群主" }];
      if (sql.includes("SELECT ext_param_code,ext_param_value"))
        return [
          { ext_param_code: "group_join_link_enabled", ext_param_value: String(joinEnabled) },
        ];
      return [];
    });
    const context = new CommandContext(
      { query },
      command({
        operation: "JOIN_GROUP",
        payload: { joinLinkAuthorized: true, token: "Invite01" },
      }),
    );
    await expect(joinGroup(context)).rejects.toThrow("INVALID_INVITATION");
    joinEnabled = true;
    context.command.payload.joinLinkAuthorized = false;
    await expect(joinGroup(context)).rejects.toThrow("FORBIDDEN");
  });
  it("permits a member invitation only when its matching setting is enabled", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT ext_param_code")
        ? [{ ext_param_code: "group_member_invite_user_enabled", ext_param_value: "true" }]
        : sql.includes("nextval")
          ? [{ id: "40" }]
          : [],
    );
    const context = new CommandContext(
      { query },
      command({
        operation: "ADD_MEMBERS",
        payload: { members: [{ memObjType: "USER", memObjId: "21" }] },
      }),
    );
    vi.spyOn(context, "member").mockResolvedValue({ userRole: "MEMBER" });
    await addMembers(context);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(true);
  });
});
