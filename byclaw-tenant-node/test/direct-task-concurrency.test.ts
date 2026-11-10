import { expect, it } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import type { Operation } from "../src/application/command.js";
import { SqlCommandTransactions } from "../src/infrastructure/persistence/command-repository.js";
import { command } from "./fixtures.js";
import { forwardFixture } from "./support/forward-pg-fixture.js";

// 使用已限定地址的临时数据库，两个命令各自取得真实租约和独立 SQL 事务。
it.skipIf(!process.env.FORWARD_TEST_PG)(
  "serializes concurrent opens and independent confirmations of the same private draft",
  async () => {
    const fixture = await forwardFixture();
    try {
      await fixture.sql(
        "INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id,user_role) VALUES(1050,10,'AGENT',50,1,'MEMBER')",
      );
      const commands = new CommandService(new SqlCommandTransactions(fixture.connection));
      const execute = (operation: Operation, requestId: string, payload: Record<string, unknown>) =>
        commands.execute(
          command({
            enterpriseId: "1",
            sessionId: "10",
            userId: "30",
            tenantMemberUserIds: ["30"],
            operation,
            requestId,
            payload,
          }),
        );
      const opens = await Promise.all([
        execute("CREATE_DIRECT_SESSION", "open-a", { agentId: "50" }),
        execute("CREATE_DIRECT_TASK", "open-b", { agentId: "50" }),
      ]);
      const taskSessionId = opens[0]!.data.sessionId;
      expect(opens[1]!.data.taskSessionId).toBe(taskSessionId);
      expect(
        await fixture.sql(
          "SELECT task_session_id FROM byai.byai_group_chat_task WHERE status='PRIVATE'",
        ),
      ).toEqual([{ task_session_id: taskSessionId }]);
      const draft = { taskSessionId, pendingPublicationId: "810", text: "confirmed" };
      await execute("SAVE_PENDING_PUBLICATION", "prepare", { ...draft, sourcePaths: [] });
      const results = await Promise.all([
        execute("PUBLISH_TASK", "publish-a", draft),
        execute("PUBLISH_TASK", "publish-b", draft),
      ]);
      expect(results[0]!.messageId).toBe(results[1]!.messageId);
      expect(results.map((r) => r.data.newlyPublished).sort()).toEqual([false, true]);
      expect(
        await fixture.sql(
          "SELECT status,turn_status FROM byai.byai_group_chat_task WHERE task_session_id=$1",
          [taskSessionId],
        ),
      ).toEqual([{ status: "PRIVATE", turn_status: "PRIVATE" }]);
      expect(
        await fixture.sql(
          "SELECT message_id,message_ref,topic_id FROM byai.byai_message WHERE message_content='confirmed'",
        ),
      ).toEqual([
        { message_id: results[0]!.messageId, message_ref: null, topic_id: results[0]!.messageId },
      ]);
      const reply = await execute("SEND_GROUP_MESSAGE", "reply-to-public-result", {
        chatContent: "请继续跟进",
        replyToMessageId: results[0]!.messageId,
        resourceList: [{ resourceType: "DIG_EMPLOYEE", resourceId: "50" }],
      });
      expect(reply.dispatches).toHaveLength(1);
      expect(reply.dispatches[0].taskSessionId).not.toBe(taskSessionId);
      expect(
        await fixture.sql(
          "SELECT message_ref,topic_id FROM byai.byai_message WHERE message_id=$1",
          [reply.messageId],
        ),
      ).toEqual([{ message_ref: results[0]!.messageId, topic_id: results[0]!.messageId }]);
    } finally {
      await fixture.close();
    }
  },
  30000,
);
