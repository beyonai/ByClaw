import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import { SqlCommandTransactions } from "../src/infrastructure/persistence/command-repository.js";
import { command } from "./fixtures.js";
import { forwardFixture } from "./support/forward-pg-fixture.js";

// This opt-in fixture uses real SQL transactions and Redis session leases; it never targets an arbitrary database.
describe.skipIf(!process.env.FORWARD_TEST_PG)(
  "membership quota at the database write boundary",
  () => {
    let fixture: Awaited<ReturnType<typeof forwardFixture>>;
    beforeAll(async () => {
      fixture = await forwardFixture();
    });
    afterAll(async () => {
      await fixture?.close();
    });
    beforeEach(async () => {
      await fixture.seed();
    });

    function buildService() {
      return new CommandService(
        new SqlCommandTransactions(fixture.connection, {
          read: async () => ({
            schemaVersion: 1,
            enterpriseId: "1",
            revision: "1",
            mode: "LIMITED",
            limits: { memberLimit: 100, groupLimit: 20, groupMemberLimit: 3, agentLimit: 2 },
            updatedAt: "2026-10-27T01:00:00Z",
          }),
        }),
      );
    }

    it("admits only one contender for the last USER slot across ADD_MEMBERS commands", async () => {
      const service = new CommandService(
        new SqlCommandTransactions(fixture.connection, {
          read: async () => ({
            schemaVersion: 1,
            enterpriseId: "1",
            revision: "1",
            mode: "LIMITED",
            limits: { memberLimit: 100, groupLimit: 20, groupMemberLimit: 3, agentLimit: 2 },
            updatedAt: "2026-10-27T01:00:00Z",
          }),
        }),
      );
      const outcomes = await Promise.allSettled(
        ["40", "41"].map((id) =>
          service.execute(
            command({
              enterpriseId: "1",
              sessionId: "20",
              userId: "31",
              requestId: `quota-${id}`,
              operation: "ADD_MEMBERS",
              tenantMemberUserIds: ["31", id],
              payload: { members: [{ memObjType: "USER", memObjId: id }] },
            }),
          ),
        ),
      );
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({
        reason: { code: "GROUP_MEMBER_LIMIT_EXCEEDED" },
      });
      expect(
        await fixture.sql(
          "SELECT mem_obj_id::text AS id FROM byai.byai_session_member WHERE session_id=20 AND mem_obj_type='USER' ORDER BY mem_obj_id",
        ),
      ).toHaveLength(3);
      expect(
        await fixture.sql(
          "SELECT message_id FROM byai.byai_message WHERE session_id=20 AND usage=5",
        ),
      ).toHaveLength(1);
    });

    it("shares the last USER slot between invitation joins and member invitations", async () => {
      await fixture.sql(
        "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES(900,20,'group_invitation',$1)",
        [JSON.stringify({ token: "Invite01", inviterId: "31", expiresAt: Date.now() + 60000 })],
      );
      const commands = buildService();
      const outcomes = await Promise.allSettled([
        commands.execute(
          command({
            enterpriseId: "1",
            sessionId: "20",
            userId: "31",
            requestId: "invite-40",
            operation: "ADD_MEMBERS",
            tenantMemberUserIds: ["31", "40"],
            payload: { members: [{ memObjType: "USER", memObjId: "40" }] },
          }),
        ),
        commands.execute(
          command({
            enterpriseId: "1",
            sessionId: "20",
            userId: "41",
            requestId: "join-41",
            operation: "JOIN_GROUP",
            tenantMemberUserIds: ["41"],
            payload: { token: "Invite01", joinLinkAuthorized: true },
          }),
        ),
      ]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({
        reason: { code: "GROUP_MEMBER_LIMIT_EXCEEDED" },
      });
      expect(
        await fixture.sql(
          "SELECT mem_obj_id FROM byai.byai_session_member WHERE session_id=20 AND mem_obj_type='USER'",
        ),
      ).toHaveLength(3);
    });

    it("shares the last AGENT slot with automatic coordinator insertion", async () => {
      await fixture.sql(
        "INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id,user_role,mem_name) VALUES(901,20,'AGENT',42,1,'MEMBER','Agent')",
      );
      const commands = buildService();
      const outcomes = await Promise.allSettled([
        commands.execute(
          command({
            enterpriseId: "1",
            sessionId: "20",
            userId: "31",
            requestId: "agent-90",
            operation: "ADD_MEMBERS",
            tenantMemberUserIds: ["31"],
            payload: {
              members: [{ memObjType: "AGENT", memObjId: "90", resourceAuthorized: true }],
            },
          }),
        ),
        commands.execute(
          command({
            enterpriseId: "1",
            sessionId: "20",
            userId: "31",
            requestId: "coordinator-91",
            operation: "SEND_GROUP_MESSAGE",
            tenantMemberUserIds: ["31"],
            payload: {
              chatContent: "Hello",
              coordinatorAgentId: "91",
              coordinatorAuthorized: true,
              resourceList: [{ resourceType: "DIG_EMPLOYEE", resourceId: "42" }],
            },
          }),
        ),
      ]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({
        reason: { code: "GROUP_AGENT_LIMIT_EXCEEDED" },
      });
      expect(
        await fixture.sql(
          "SELECT mem_obj_id FROM byai.byai_session_member WHERE session_id=20 AND mem_obj_type='AGENT'",
        ),
      ).toHaveLength(2);
    });

    it("rolls back every member, notice and command receipt when a batch exceeds capacity", async () => {
      await expect(
        buildService().execute(
          command({
            enterpriseId: "1",
            sessionId: "20",
            userId: "31",
            requestId: "oversized-batch",
            operation: "ADD_MEMBERS",
            tenantMemberUserIds: ["31", "40", "41"],
            payload: {
              members: [
                { memObjType: "USER", memObjId: "40" },
                { memObjType: "USER", memObjId: "41" },
              ],
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "GROUP_MEMBER_LIMIT_EXCEEDED" });
      expect(
        await fixture.sql(
          "SELECT mem_obj_id FROM byai.byai_session_member WHERE session_id=20 AND mem_obj_type='USER'",
        ),
      ).toHaveLength(2);
      expect(
        await fixture.sql(
          "SELECT message_id FROM byai.byai_message WHERE session_id=20 AND usage=5",
        ),
      ).toHaveLength(0);
      expect(
        await fixture.sql(
          "SELECT ext_id FROM byai.byai_session_ext WHERE session_id=20 AND ext_param_code='node_command:oversized-batch'",
        ),
      ).toHaveLength(0);
    });
  },
);
