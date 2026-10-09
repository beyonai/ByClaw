import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { joinGroup } from "../src/infrastructure/persistence/group-join.js";
import { addMembers } from "../src/infrastructure/persistence/member-writer.js";
import { command } from "./fixtures.js";
describe("BE-authorized group joins", () => {
  it("checks the link proof and current group setting", async () => {
    const query = vi.fn(async () => [{ ext_param_value: "false" }]);
    const context = new CommandContext(
      { query },
      command({ operation: "JOIN_GROUP", payload: { joinLinkAuthorized: true } }),
    );
    await expect(joinGroup(context)).rejects.toThrow("GROUP_JOIN_DISABLED");
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
