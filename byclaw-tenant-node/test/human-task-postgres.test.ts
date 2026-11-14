import Fastify from "fastify";
import { humanTaskRoutes } from "../src/interfaces/http/human-task-routes.js";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";
import { displayMessages } from "../src/application/history/timeline-format.js";
import { HistoryService } from "../src/application/history.js";
import { projectGroupTaskAnswer } from "../src/infrastructure/persistence/group-task-answer.js";
import { event, answer } from "./fixtures.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { HumanTaskRepository } from "../src/infrastructure/persistence/human-task-repository.js";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const enabled = process.env.HUMAN_TASK_TEST_PG === "1";
/** This fixture only accesses a disposable local Unix-socket database, never application configuration. */
describe.skipIf(!enabled)("human tasks PostgreSQL lifecycle", () => {
  let pool: any, repo: HumanTaskRepository;
  beforeAll(async () => {
    pool = new Pool({
      host: "/tmp",
      port: 15498,
      database: "human_task_test",
      user: process.env.USER,
    });
    await pool.query("DROP SCHEMA IF EXISTS byai CASCADE");
    await pool.query(
      await readFile(
        new URL(
          "../../deploy/migrations/versions/V0.7.0/tenant/V0.7.0__baseline__ddl.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await pool.query(
      "INSERT INTO byai.byai_session(session_id,enterprise_id,creator_id,session_type,last_seq,state) VALUES(100,10,20,'hs_as',0,'ACTIVE')",
    );
    await pool.query(
      "INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id,mem_name) VALUES(1,100,'USER',20,10,'发起人'),(2,100,'USER',21,10,'负责人'),(3,100,'AGENT',30,10,'事项助理'),(4,100,'AGENT',31,10,'测试员工')",
    );
    await pool.query(
      "INSERT INTO byai.byai_message(id,message_id,session_id,enterprise_id,creator_id,usage,message_content) VALUES(1,1,100,10,20,1,'assign')",
    );
    repo = new HumanTaskRepository(
      {
        write: async (work: any) => {
          const c = await pool.connect();
          try {
            await c.query("BEGIN");
            const r = await work({
              query: async (sql: string, args: any[]) => (await c.query(sql, args)).rows,
            });
            await c.query("COMMIT");
            return r;
          } catch (e) {
            await c.query("ROLLBACK");
            throw e;
          } finally {
            c.release();
          }
        },
      },
      "10",
    );
  });
  afterAll(async () => {
    await pool?.end();
  });
  const create = () =>
    repo.call("20", "createProposal", {
      groupSessionId: "100",
      sourceMessageId: "1",
      requestId: "proposal",
      items: [
        { title: "interview", content: "questions", assigneeUserId: "21" },
        { title: "prepare", content: "next", assigneeUserId: "20" },
      ],
    });
  it("creates once, rejects wrong confirmer and stale edits, confirms one batch atomically", async () => {
    const p = (await create())!;
    expect((await create())!.batchId).toBe(p.batchId);
    await expect(
      repo.call("21", "confirm", { batchId: p.batchId, expectedRevision: 0 }),
    ).rejects.toThrow("INITIATOR_REQUIRED");
    await expect(
      repo.call("20", "updateProposal", { batchId: p.batchId, expectedRevision: 5, items: [{}] }),
    ).rejects.toThrow("STALE_PROPOSAL");
    const b = (await repo.call("20", "confirm", { batchId: p.batchId, expectedRevision: 0 }))!;
    expect(b.items).toHaveLength(2);
    expect(
      (await repo.call("20", "confirm", { batchId: p.batchId, expectedRevision: 0 }))!
        .cardMessageId,
    ).toBe(b.cardMessageId);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM byai.byai_message WHERE metadata LIKE '%HUMAN_TASK_BATCH%' ",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("retains submissions, rejects stale acceptance, allows returns and freezes after acceptance", async () => {
    const p = (await create())!,
      b = (await repo.call("20", "batch", { batchId: p.batchId }))!,
      id = b.items[0].humanTaskId;
    const submit = (requestId: string, text: string) =>
      repo.call("21", "submit", { humanTaskId: id, requestId, text, sourceType: "DIRECT" });
    const first = (await submit("v1", "first"))!,
      second = (await submit("v2", "second"))!;
    expect((await submit("v1", "first"))!.submissionId).toBe(first.submissionId);
    await expect(submit("v1", "changed")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await expect(
      repo.call("20", "review", {
        humanTaskId: id,
        requestId: "stale",
        submissionId: first.submissionId,
        expectedRevision: 1,
        decision: "ACCEPT",
      }),
    ).rejects.toThrow("STALE_VERSION");
    await repo.call("20", "review", {
      humanTaskId: id,
      requestId: "return",
      submissionId: second.submissionId,
      expectedRevision: 2,
      decision: "RETURN",
      opinion: "more detail",
    });
    const third = (await submit("v3", "third"))!;
    const review = {
      humanTaskId: id,
      requestId: "accept",
      submissionId: third.submissionId,
      expectedRevision: 4,
      decision: "ACCEPT",
    };
    const accepted = (await repo.call("20", "review", review))!;
    expect((await repo.call("20", "review", review))!.reviewId).toBe(accepted.reviewId);
    await expect(submit("v4", "later")).rejects.toThrow("ACCEPTED");
    const history = (await repo.call("20", "history", { humanTaskId: id }))!.items;
    expect(history).toHaveLength(3);
    expect(history[0].superseded).toBe(false);
    expect(history[1].superseded).toBe(true);
    expect(history[1].reviews[0].opinion).toBe("more detail");
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM byai.byai_message")).rows[0].n).toBe(
      3,
    );
  });
  it("isolates tenant scope and creates a private session per human task", async () => {
    const p = (await create())!,
      b = (await repo.call("20", "batch", { batchId: p.batchId }))!,
      id = b.items[1].humanTaskId;
    const input = { humanTaskId: id, agentId: "30", requestId: "private", entryType: "PRIVATE" };
    const binding = (await repo.call("20", "bind", input))!;
    expect((await repo.call("20", "bind", input))!.taskSessionId).toBe(binding.taskSessionId);
    await expect(
      repo.call("20", "bind", { ...input, requestId: "foreign", agentId: "99" }),
    ).rejects.toThrow("AGENT_NOT_GROUP_MEMBER");
    const other = new HumanTaskRepository((repo as any).connection, "11");
    await expect(other.call("20", "task", { humanTaskId: id })).rejects.toThrow("NOT_FOUND");
  });
  it("creates a new private session for each request while replaying only the original request", async () => {
    const batch = (await repo.call("20", "createDirect", {
      groupSessionId: "100",
      requestId: "private-independent",
      items: [{ title: "独立沟通", content: "准备材料", assigneeUserId: "20" }],
    }))!;
    const input = {
      humanTaskId: batch.items[0].humanTaskId,
      entryType: "PRIVATE",
      agentId: "30",
      requestId: "open-first",
    };
    const first = (await repo.call("20", "bind", input))!;
    const second = (await repo.call("20", "bind", { ...input, requestId: "open-second" }))!;
    expect(second.taskSessionId).not.toBe(first.taskSessionId);
    expect(first.targetAgentId).toBe("30");
    expect(first.groupCoordination).toBeUndefined();
    expect((await repo.call("20", "bind", input))!.taskSessionId).toBe(first.taskSessionId);
    await expect(repo.call("21", "bind", input)).rejects.toThrow("SESSION_SCOPE_MISMATCH");
    expect(
      (await repo.call("20", "bind", {
        humanTaskId: input.humanTaskId,
        entryType: "PRIVATE",
        agentIds: ["30", "30"],
        requestId: input.requestId,
      }))!.taskSessionId,
    ).toBe(first.taskSessionId);
  });

  it("persists a private coordinator scope without publishing and replays normalized selections", async () => {
    const batch = (await repo.call("20", "createDirect", {
      groupSessionId: "100",
      requestId: "private-coordinated",
      items: [{ title: "协作沟通", content: "准备材料", assigneeUserId: "20" }],
    }))!;
    await pool.query(
      "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES(90,100,'group_coordinator_agent_id','31')",
    );
    const input = {
      humanTaskId: batch.items[0].humanTaskId,
      entryType: "PRIVATE",
      agentIds: ["31", "30", "30"],
      requestId: "coordinated-first",
      _resolvedCoordinator: {
        coordinatorAgentId: "31",
        coordinatorName: "工作助手",
        coordinatorAuthorized: true,
      },
    };
    const messagesBefore = (await pool.query("SELECT COUNT(*)::int n FROM byai.byai_message"))
      .rows[0].n;
    try {
      const [first, retry] = await Promise.all([
        repo.call("20", "bind", input),
        repo.call("20", "bind", input),
      ]);
      expect(retry!.taskSessionId).toBe(first!.taskSessionId);
      expect(first).toMatchObject({
        entryType: "PRIVATE",
        targetAgentId: "31",
        groupCoordination: {
          schemaVersion: "byclaw.group-coordination/v1",
          mode: "COORDINATED",
          groupSessionId: "100",
          taskSessionId: first!.taskSessionId,
          coordinatorAgentId: "31",
          allowedAgentIds: ["30"],
        },
      });
      expect(await repo.call("20", "binding", { taskSessionId: first!.taskSessionId })).toEqual(
        first,
      );
      const history = new HistoryService(
        "10",
        new SqlHistoryRepository(
          { query: async (sql, args) => (await pool.query(sql, args)).rows },
          "10",
        ),
      );
      expect(await history.access("20", first!.taskSessionId)).toMatchObject({
        groupDirectTask: { groupSessionId: "100", targetAgentId: "31" },
        groupCoordination: first!.groupCoordination,
      });
      const second = (await repo.call("20", "bind", {
        ...input,
        requestId: "coordinated-second",
      }))!;
      expect(second.taskSessionId).not.toBe(first!.taskSessionId);
      expect(
        (await repo.call("20", "bind", {
          ...input,
          agentIds: ["30", "31"],
          _resolvedCoordinator: {
            ...input._resolvedCoordinator,
            coordinatorName: "改名后的助手",
          },
        }))!.taskSessionId,
      ).toBe(first!.taskSessionId);
      await expect(repo.call("20", "bind", { ...input, agentIds: ["30"] })).rejects.toThrow(
        "IDEMPOTENCY_MISMATCH",
      );
      const persisted = (
        await pool.query(
          "SELECT s.object_id,s.parent_session_id,t.status,t.turn_status,t.publish_message_id FROM byai.byai_session s JOIN byai.byai_group_chat_task t ON t.task_session_id=s.session_id WHERE s.session_id=$1",
          [first!.taskSessionId],
        )
      ).rows[0];
      expect(persisted).toMatchObject({
        object_id: "31",
        parent_session_id: "100",
        status: "PRIVATE",
        turn_status: "PRIVATE",
        publish_message_id: null,
      });
      expect((await pool.query("SELECT COUNT(*)::int n FROM byai.byai_message")).rows[0].n).toBe(
        messagesBefore,
      );
    } finally {
      await pool.query("DELETE FROM byai.byai_session_ext WHERE ext_id=90");
    }
  });

  it("keeps separate selected employee sets when both conversations target the same coordinator", async () => {
    const batch = (await repo.call("20", "createDirect", {
      groupSessionId: "100",
      requestId: "private-different-scopes",
      items: [{ title: "范围隔离", content: "准备材料", assigneeUserId: "20" }],
    }))!;
    await pool.query(
      "INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id,mem_name) VALUES(91,100,'AGENT',32,10,'设计员工')",
    );
    await pool.query(
      "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES(90,100,'group_coordinator_agent_id','31')",
    );
    const input = {
      humanTaskId: batch.items[0].humanTaskId,
      entryType: "PRIVATE",
      _resolvedCoordinator: {
        coordinatorAgentId: "31",
        coordinatorName: "工作助手",
        coordinatorAuthorized: true,
      },
    };
    try {
      const [first, second] = await Promise.all([
        repo.call("20", "bind", { ...input, agentIds: ["30", "31"], requestId: "scope-a" }),
        repo.call("20", "bind", { ...input, agentIds: [" 32 ", "30"], requestId: "scope-b" }),
      ]);
      expect(first!.targetAgentId).toBe("31");
      expect(second!.targetAgentId).toBe("31");
      expect(first!.taskSessionId).not.toBe(second!.taskSessionId);
      expect(first!.groupCoordination.allowedAgentIds).toEqual(["30"]);
      expect(second!.groupCoordination.allowedAgentIds).toEqual(["30", "32"]);
      const bindings = (
        await pool.query(
          "SELECT task_session_id FROM byai.byai_group_human_task_session WHERE human_task_id=$1",
          [input.humanTaskId],
        )
      ).rows;
      expect(bindings).toHaveLength(2);
    } finally {
      await pool.query("DELETE FROM byai.byai_session_member WHERE byai_session_member_id=91");
      await pool.query("DELETE FROM byai.byai_session_ext WHERE ext_id=90");
    }
  });

  it("rejects invalid selections and unavailable coordinators without leaving a session", async () => {
    const batch = (await repo.call("20", "createDirect", {
      groupSessionId: "100",
      requestId: "private-invalid",
      items: [{ title: "校验协作", content: "准备材料", assigneeUserId: "20" }],
    }))!;
    const input = {
      humanTaskId: batch.items[0].humanTaskId,
      entryType: "PRIVATE",
      requestId: "invalid-selection",
    };
    const count = async () =>
      (await pool.query("SELECT COUNT(*)::int n FROM byai.byai_session")).rows[0].n;
    const before = await count();
    for (const selection of [
      {},
      { agentId: "30", entryType: "GROUP" },
      { agentId: "30", entryType: undefined },
      { agentIds: [] },
      { agentIds: "30" },
      { agentIds: ["0"] },
      { agentIds: [30] },
      { agentId: "30", agentIds: ["31"] },
      { agentIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) },
    ])
      await expect(repo.call("20", "bind", { ...input, ...selection })).rejects.toThrow();
    const multi = {
      ...input,
      agentIds: ["30", "31"],
      _resolvedCoordinator: {
        coordinatorAgentId: "31",
        coordinatorName: "工作助手",
        coordinatorAuthorized: true,
      },
    };
    await expect(repo.call("20", "bind", multi)).rejects.toThrow("COORDINATOR_UNAVAILABLE");
    await pool.query(
      "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES(90,100,'group_coordinator_agent_id','31')",
    );
    try {
      for (const resolved of [
        undefined,
        { coordinatorAgentId: "30", coordinatorAuthorized: true },
        { coordinatorAgentId: "31", coordinatorAuthorized: false },
      ])
        await expect(
          repo.call("20", "bind", { ...multi, _resolvedCoordinator: resolved }),
        ).rejects.toThrow("COORDINATOR_UNAVAILABLE");
      await expect(repo.call("20", "bind", { ...multi, agentIds: ["30", "99"] })).rejects.toThrow(
        "AGENT_NOT_GROUP_MEMBER",
      );
      await pool.query("UPDATE byai.byai_session_ext SET ext_param_value='99' WHERE ext_id=90");
      await expect(
        repo.call("20", "bind", {
          ...multi,
          _resolvedCoordinator: { coordinatorAgentId: "99", coordinatorAuthorized: true },
        }),
      ).rejects.toThrow("COORDINATOR_UNAVAILABLE");
      expect(await count()).toBe(before);
    } finally {
      await pool.query("DELETE FROM byai.byai_session_ext WHERE ext_id=90");
    }
  });

  it("consumes an exact private draft and reuses its recorded submission", async () => {
    const p = (await create())!,
      b = (await repo.call("20", "batch", { batchId: p.batchId }))!,
      id = b.items[1].humanTaskId;
    const binding = (await repo.call("20", "bind", {
      humanTaskId: id,
      agentId: "30",
      requestId: "private",
      entryType: "PRIVATE",
    }))!;
    await pool.query(
      "INSERT INTO byai.byai_group_chat_pending_publication(pending_publication_id,task_session_id,text_content,source_files_json,uploaded_files_json,create_time) VALUES(900,$1,'private','[]','{}',CURRENT_TIMESTAMP)",
      [binding.taskSessionId],
    );
    const input = {
      humanTaskId: id,
      taskSessionId: binding.taskSessionId,
      pendingPublicationId: "900",
      requestId: "private-result",
      sourceType: "PRIVATE",
      text: "result",
    };
    const submitted = (await repo.call("20", "submit", input))!;
    expect((await repo.call("20", "submit", input))!.submissionId).toBe(submitted.submissionId);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1",
          [binding.taskSessionId],
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(repo.call("20", "submit", { ...input, requestId: "another" })).rejects.toThrow(
      "STALE_PUBLICATION",
    );
    expect((await repo.call("20", "task", { humanTaskId: id }))!.latestVersion).toBe(1);
  });
  it("fences acceptance racing a newer submission using the same persisted revision", async () => {
    const p = (await create())!,
      b = (await repo.call("20", "batch", { batchId: p.batchId }))!,
      id = b.items[1].humanTaskId;
    const t = (await repo.call("20", "task", { humanTaskId: id }))!;
    const results = await Promise.allSettled([
      repo.call("20", "review", {
        humanTaskId: id,
        requestId: "race-review",
        submissionId: t.latestSubmissionId,
        expectedRevision: t.revision,
        decision: "ACCEPT",
      }),
      repo.call("20", "submit", {
        humanTaskId: id,
        requestId: "race-submit",
        sourceType: "DIRECT",
        text: "new version",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const latest = (await repo.call("20", "task", { humanTaskId: id }))!;
    if (latest.status === "ACCEPTED") expect(latest.latestSubmissionId).toBe(t.latestSubmissionId);
    else {
      expect(latest.status).toBe("PENDING_REVIEW");
      expect(latest.latestVersion).toBe(t.latestVersion + 1);
    }
  });
  it("keeps a completed bound group execution out of the group timeline", async () => {
    const p = (await create())!,
      b = (await repo.call("20", "batch", { batchId: p.batchId }))!,
      id = b.items[1].humanTaskId;
    await pool.query(
      "INSERT INTO byai.byai_session(session_id,enterprise_id,creator_id,parent_session_id,object_id,session_type,last_seq,state) VALUES(500,10,20,100,30,'h_as',0,'GROUP_TASK')",
    );
    await pool.query(
      "INSERT INTO byai.byai_group_chat_task(task_session_id,group_session_id,source_message_id,dispatch_id,initiator_user_id,target_agent_id,task_name,status,turn_status,create_time,update_time) VALUES(500,100,1,501,20,30,'execute','ACTIVE','RUNNING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
    );
    await pool.query(
      "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES(500,500,'group_auto_dispatch','1')",
    );
    await pool.query(
      "INSERT INTO byai.byai_group_human_task_session(task_session_id,enterprise_id,human_task_id,entry_type,create_time) VALUES(500,10,$1,'GROUP',CURRENT_TIMESTAMP)",
      [id],
    );
    const count = async () =>
      Number((await pool.query("SELECT COUNT(*) AS n FROM byai.byai_message")).rows[0].n);
    const before = await count();
    await projectGroupTaskAnswer(
      { query: async (sql, args) => (await pool.query(sql, args)).rows, lock: async () => {} },
      "10",
      event({ sessionId: "500", eventType: "TERMINAL" }),
      answer({ content: "not yet submitted", finalContent: "not yet submitted" }),
    );
    expect(await count()).toBe(before);
    const execution = (
      await pool.query(
        "SELECT turn_status,publish_message_id FROM byai.byai_group_chat_task WHERE task_session_id=500",
      )
    ).rows[0];
    expect(execution.turn_status).toBe("WAITING_USER");
    expect(execution.publish_message_id).toBeNull();
  });

  const fullItems = [
    {
      title: "访谈",
      content: "完成用户访谈",
      assigneeUserId: "21",
      acceptanceCriteria: "记录齐全",
    },
    { title: "复盘", content: "整理访谈结论", assigneeUserId: "20" },
  ];
  const messagesFor = async (batchId: string) =>
    (
      await pool.query(
        "SELECT * FROM byai.byai_message WHERE metadata::jsonb->>'batchId'=$1 ORDER BY message_id",
        [batchId],
      )
    ).rows;
  const speakerFor = async (messageId: string) => {
    const history = new SqlHistoryRepository(
      { query: async (sql, args) => (await pool.query(sql, args)).rows },
      "10",
    );
    return (await displayMessages(history, await history.messages({ ids: [messageId] }), "20"))[0]!
      .speaker;
  };
  const seedExecution = async (session: number, agent: number, enterprise = 10, group = 100) => {
    await pool.query(
      "INSERT INTO byai.byai_session(session_id,enterprise_id,creator_id,parent_session_id,object_id,session_type,last_seq,state) VALUES($1,$2,20,$3,$4,'h_as',0,'GROUP_TASK')",
      [session, enterprise, group, agent],
    );
    await pool.query(
      "INSERT INTO byai.byai_group_chat_execution(execution_id,group_session_id,source_message_id,initiator_user_id,target_agent_id,candidate_session_id,status,disposition,root_message_id) VALUES($1,$2,1,20,$3,$4,'RUNNING','TASK',1)",
      [session + 1, group, agent, session],
    );
  };

  it("direct creation commits every task and only one user card using the authenticated actor", async () => {
    const app = Fastify();
    humanTaskRoutes(app, repo);
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/group-human-tasks/createDirect",
      headers: { "x-actor-user-id": "20" },
      payload: {
        groupSessionId: "100",
        requestId: "direct",
        items: fullItems,
        actor: "999",
        initiatorUserId: "999",
        senderType: "AGENT",
        senderId: "30",
        sourceMessageId: "999",
        sourceTaskSessionId: "999",
      },
    });
    await app.close();
    expect(response.statusCode).toBe(200);
    const b = response.json();
    expect(b).toMatchObject({
      status: "CONFIRMED",
      revision: 1,
      initiatorUserId: "20",
      senderType: "USER",
      senderId: "20",
    });
    expect(b.sourceMessageId ?? null).toBeNull();
    expect(b.proposalMessageId ?? null).toBeNull();
    expect(b.items).toHaveLength(2);
    expect(b.items[0]).toMatchObject({ status: "PENDING", revision: 0, latestVersion: 0 });
    const messages = await messagesFor(b.batchId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      creator_id: "20",
      creator_name: "发起人",
      usage: 1,
      role: "user",
      res_com_id: null,
    });
    expect(JSON.parse(messages[0].metadata)).toMatchObject({ kind: "HUMAN_TASK_BATCH" });
    expect(await speakerFor(b.cardMessageId)).toMatchObject({
      type: "user",
      userCode: "20",
      displayName: "发起人",
    });
    const stored = (
      await pool.query(
        "SELECT sender_type,sender_id,source_message_id,payload FROM byai.byai_group_human_task_batch WHERE batch_id=$1",
        [b.batchId],
      )
    ).rows[0];
    expect(stored).toMatchObject({ sender_type: "USER", sender_id: "20", source_message_id: null });
    expect(JSON.parse(stored.payload)).toMatchObject({ senderType: "USER", senderId: "20" });
  });

  it("direct validation rolls back the whole batch when any item is incomplete or out of group", async () => {
    const count = async () =>
      (
        await pool.query(
          "SELECT (SELECT COUNT(*)::int FROM byai.byai_group_human_task_batch) batches,(SELECT COUNT(*)::int FROM byai.byai_group_human_task) tasks,(SELECT COUNT(*)::int FROM byai.byai_message) messages",
        )
      ).rows[0];
    const before = await count();
    await expect(
      repo.call("20", "createDirect", {
        groupSessionId: "100",
        requestId: "incomplete-direct",
        items: [fullItems[0], { title: "incomplete" }],
      }),
    ).rejects.toThrow("ITEM_INCOMPLETE");
    await expect(
      repo.call("20", "createDirect", {
        groupSessionId: "100",
        requestId: "foreign-assignee",
        items: [fullItems[0], { ...fullItems[1], assigneeUserId: "999" }],
      }),
    ).rejects.toThrow("ASSIGNEE_NOT_GROUP_MEMBER");
    expect(await count()).toEqual(before);
  });

  it("rolls back every task and batch when the final card insert fails in PostgreSQL", async () => {
    const count = async () =>
      (
        await pool.query(
          "SELECT (SELECT COUNT(*)::int FROM byai.byai_group_human_task_batch) batches,(SELECT COUNT(*)::int FROM byai.byai_group_human_task) tasks,(SELECT COUNT(*)::int FROM byai.byai_message) messages",
        )
      ).rows[0];
    const before = await count();
    // The local-only constraint fails after task inserts, exercising the actual transaction rollback.
    await pool.query(
      "ALTER TABLE byai.byai_message ADD CONSTRAINT reject_human_task_test_card CHECK (metadata::jsonb->>'kind' IS DISTINCT FROM 'HUMAN_TASK_BATCH') NOT VALID",
    );
    try {
      await expect(
        repo.call("20", "createDirect", {
          groupSessionId: "100",
          requestId: "failed-card",
          items: fullItems,
        }),
      ).rejects.toThrow("reject_human_task_test_card");
      expect(await count()).toEqual(before);
    } finally {
      await pool.query("ALTER TABLE byai.byai_message DROP CONSTRAINT reject_human_task_test_card");
    }
  });

  it("rejects a competing different direct payload without leaving a second batch or tasks", async () => {
    const body = { groupSessionId: "100", requestId: "conflicting-direct", items: [fullItems[0]] };
    const outcomes = await Promise.allSettled([
      repo.call("20", "createDirect", body),
      repo.call("20", "createDirect", { ...body, items: [fullItems[1]] }),
    ]);
    const succeeded = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const failed = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toContain("IDEMPOTENCY_MISMATCH");
    const b = (succeeded[0] as PromiseFulfilledResult<any>).value;
    expect(b.items).toHaveLength(1);
    expect(await messagesFor(b.batchId)).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM byai.byai_group_human_task_batch WHERE request_id='conflicting-direct'",
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("direct retries normalize untrusted fields, preserve submitted tasks and fence concurrent duplicates", async () => {
    const body = { groupSessionId: "100", requestId: "concurrent-direct", items: fullItems };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => repo.call("20", "createDirect", body)),
    );
    const b = results[0]!;
    expect(new Set(results.map((r) => r!.batchId)).size).toBe(1);
    const submission = (await repo.call("21", "submit", {
      humanTaskId: b.items[0].humanTaskId,
      requestId: "direct-result",
      sourceType: "DIRECT",
      text: "成果",
    }))!;
    const retry = (await repo.call("20", "createDirect", {
      ...body,
      senderType: "AGENT",
      senderId: "999",
      actor: "999",
      items: fullItems.map((item) => ({ ...item, title: `  ${item.title}  ` })),
    }))!;
    expect(retry.batchId).toBe(b.batchId);
    expect(retry.items[0]).toMatchObject({
      status: "PENDING_REVIEW",
      latestSubmissionId: submission.submissionId,
      latestVersion: 1,
    });
    expect(await messagesFor(b.batchId)).toHaveLength(1);
    await expect(
      repo.call("20", "createDirect", { ...body, items: [fullItems[1]] }),
    ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await expect(repo.call("20", "createProposal", body)).rejects.toThrow("IDEMPOTENCY_MISMATCH");
  });

  it("ordinary proposals may omit a source and retain their real user identity on confirmation", async () => {
    const b = (await repo.call("20", "createProposal", {
      groupSessionId: "100",
      requestId: "user-proposal",
      items: fullItems,
      senderType: "AGENT",
      senderId: "30",
    }))!;
    expect(b).toMatchObject({ senderType: "USER", senderId: "20" });
    const confirmed = (await repo.call("20", "confirm", {
      batchId: b.batchId,
      expectedRevision: 0,
    }))!;
    expect(confirmed).toMatchObject({ senderType: "USER", senderId: "20" });
    for (const message of await messagesFor(b.batchId))
      expect(message).toMatchObject({ creator_id: "20", usage: 1, role: "user" });
    await expect(
      repo.call("20", "createProposal", {
        groupSessionId: "100",
        requestId: "bad-source",
        sourceMessageId: "999",
        items: fullItems,
      }),
    ).rejects.toThrow("SOURCE_MISMATCH");
    await expect(
      repo.call("20", "createDirect", {
        groupSessionId: "100",
        requestId: "user-proposal",
        items: fullItems,
      }),
    ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
  });

  it("execution proposals select the exact employee among multiple employees and preserve agent speakers", async () => {
    await seedExecution(600, 30);
    await seedExecution(610, 31);
    for (const [sourceTaskSessionId, senderId, senderName] of [
      ["600", "30", "事项助理"],
      ["610", "31", "测试员工"],
    ]) {
      const b = (await repo.call("20", "createProposal", {
        sourceTaskSessionId,
        requestId: `agent-${senderId}`,
        items: fullItems,
        senderType: "USER",
        senderId: "999",
      }))!;
      expect(b).toMatchObject({
        senderType: "AGENT",
        senderId,
        initiatorUserId: "20",
        groupSessionId: "100",
        sourceMessageId: "1",
        sourceTaskSessionId,
      });
      const confirmed = (await repo.call("20", "confirm", {
        batchId: b.batchId,
        expectedRevision: 0,
        senderType: "USER",
        senderId: "20",
      }))!;
      expect(confirmed).toMatchObject({ senderType: "AGENT", senderId });
      const messages = await messagesFor(b.batchId);
      expect(messages).toHaveLength(2);
      for (const message of messages) {
        expect(message).toMatchObject({
          creator_id: senderId,
          creator_name: senderName,
          usage: 2,
          role: "assistant",
          res_com_id: senderId,
        });
        expect(JSON.parse(message.metadata).targetAgentId).toBe(senderId);
        expect(await speakerFor(message.message_id)).toMatchObject({
          type: "agent",
          agentId: senderId,
          agentName: senderName,
        });
      }
    }
  });

  it("accepts consistent task and execution provenance without guessing from a shared source message", async () => {
    await pool.query(
      "INSERT INTO byai.byai_group_chat_task(task_session_id,group_session_id,source_message_id,dispatch_id,initiator_user_id,target_agent_id,task_name,status,turn_status,create_time,update_time) VALUES(610,100,1,619,20,31,'promoted','ACTIVE','RUNNING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
    );
    const promoted = (await repo.call("20", "createProposal", {
      sourceTaskSessionId: "610",
      requestId: "consistent-source",
      items: fullItems,
    }))!;
    expect(promoted).toMatchObject({ senderType: "AGENT", senderId: "31" });
    const ordinary = (await repo.call("20", "createProposal", {
      groupSessionId: "100",
      sourceMessageId: "1",
      requestId: "shared-message-user",
      items: fullItems,
    }))!;
    expect(ordinary).toMatchObject({ senderType: "USER", senderId: "20" });
  });

  it("keeps the captured employee name when confirming after the employee leaves the group", async () => {
    const b = (await repo.call("20", "createProposal", {
      sourceTaskSessionId: "600",
      requestId: "employee-leaves",
      items: fullItems,
    }))!;
    await pool.query(
      "DELETE FROM byai.byai_session_member WHERE session_id=100 AND mem_obj_type='AGENT' AND mem_obj_id=30",
    );
    try {
      const confirmed = (await repo.call("20", "confirm", {
        batchId: b.batchId,
        expectedRevision: 0,
      }))!;
      expect(confirmed).toMatchObject({
        senderType: "AGENT",
        senderId: "30",
        senderName: "事项助理",
      });
      const messages = await messagesFor(b.batchId);
      expect(messages[1]).toMatchObject({ creator_id: "30", creator_name: "事项助理" });
      expect(await speakerFor(confirmed.cardMessageId)).toMatchObject({
        type: "agent",
        agentId: "30",
        agentName: "事项助理",
      });
    } finally {
      await pool.query(
        "INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id,mem_name) VALUES(3,100,'AGENT',30,10,'事项助理')",
      );
    }
  });

  it("rejects conflicting execution provenance and cross-tenant or explicit mismatched sources", async () => {
    await expect(
      repo.call("20", "createProposal", {
        sourceTaskSessionId: "600",
        groupSessionId: "101",
        requestId: "source-group-mismatch",
        items: fullItems,
      }),
    ).rejects.toThrow("SOURCE_MISMATCH");
    await expect(
      repo.call("20", "createProposal", {
        sourceTaskSessionId: "600",
        sourceMessageId: "999",
        requestId: "source-message-mismatch",
        items: fullItems,
      }),
    ).rejects.toThrow("SOURCE_MISMATCH");
    await expect(
      repo.call("21", "createProposal", {
        sourceTaskSessionId: "600",
        requestId: "source-actor-mismatch",
        items: fullItems,
      }),
    ).rejects.toThrow("SOURCE_MISMATCH");
    await seedExecution(620, 32, 11);
    await expect(
      repo.call("20", "createProposal", {
        sourceTaskSessionId: "620",
        requestId: "source-tenant-mismatch",
        items: fullItems,
      }),
    ).rejects.toThrow("SOURCE_MISMATCH");
    await pool.query(
      "INSERT INTO byai.byai_group_chat_task(task_session_id,group_session_id,source_message_id,dispatch_id,initiator_user_id,target_agent_id,task_name,status,turn_status,create_time,update_time) VALUES(600,100,1,699,20,31,'conflicting','ACTIVE','RUNNING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
    );
    await expect(
      repo.call("20", "createProposal", {
        sourceTaskSessionId: "600",
        requestId: "ambiguous-source",
        items: fullItems,
      }),
    ).rejects.toThrow("SOURCE_AMBIGUOUS");
  });

  it("reads authoritative sender columns when historical payload has no sender identity", async () => {
    const b = (await repo.call("20", "createProposal", {
      groupSessionId: "100",
      requestId: "legacy-payload",
      items: fullItems,
    }))!;
    await pool.query(
      "UPDATE byai.byai_group_human_task_batch SET payload=(payload::jsonb - 'senderType' - 'senderId')::text WHERE batch_id=$1",
      [b.batchId],
    );
    const loaded = (await repo.call("20", "proposal", { batchId: b.batchId }))!;
    expect(loaded).toMatchObject({ senderType: "USER", senderId: "20" });
    const confirmed = (await repo.call("20", "confirm", {
      batchId: b.batchId,
      expectedRevision: 0,
    }))!;
    expect(confirmed).toMatchObject({ senderType: "USER", senderId: "20" });
  });
  it("replays exact pre-sender proposal hashes while preserving migrated sender columns", async () => {
    const legacyItems = [{ title: "legacy", content: "details", assigneeUserId: "21" }];
    const ordinary = {
      groupSessionId: "100",
      sourceMessageId: "1",
      requestId: "legacy-user-retry",
      items: legacyItems,
    };
    const execution = {
      sourceTaskSessionId: "610",
      requestId: "legacy-agent-retry",
      items: legacyItems,
    };
    // These literals reproduce the former sorted serialization independently of the current normalizer.
    const legacyHashes = [
      createHash("sha256")
        .update(
          '{"groupSessionId":"100","items":[{"assigneeUserId":"21","content":"details","title":"legacy"}],"requestId":"legacy-user-retry","sourceMessageId":"1"}',
        )
        .digest("hex"),
      createHash("sha256")
        .update(
          '{"groupSessionId":"100","items":[{"assigneeUserId":"21","content":"details","title":"legacy"}],"requestId":"legacy-agent-retry","sourceMessageId":"1","sourceTaskSessionId":"610"}',
        )
        .digest("hex"),
    ];
    for (const [index, input] of [ordinary, execution].entries()) {
      const b = (await repo.call("20", "createProposal", input))!;
      const payload = { ...b, payloadHash: legacyHashes[index] };
      delete payload.creationMode;
      delete payload.senderType;
      delete payload.senderId;
      await pool.query(
        "UPDATE byai.byai_group_human_task_batch SET sender_type='AGENT',sender_id=31,payload_hash=$1,payload=$2 WHERE batch_id=$3",
        [legacyHashes[index], JSON.stringify(payload), b.batchId],
      );
      const before = (
        await pool.query("SELECT * FROM byai.byai_group_human_task_batch WHERE batch_id=$1", [
          b.batchId,
        ])
      ).rows[0];
      const retry = (await repo.call("20", "createProposal", {
        ...input,
        _resolvedSender: { senderId: "31", senderName: "平台新名称" },
      }))!;
      expect(retry).toMatchObject({
        batchId: b.batchId,
        status: "DRAFT",
        senderType: "AGENT",
        senderId: "31",
      });
      expect(
        (
          await pool.query("SELECT * FROM byai.byai_group_human_task_batch WHERE batch_id=$1", [
            b.batchId,
          ])
        ).rows[0],
      ).toEqual(before);
      expect(await messagesFor(b.batchId)).toHaveLength(1);
      await expect(
        repo.call("20", "createProposal", {
          ...input,
          items: [{ ...legacyItems[0], title: "changed" }],
        }),
      ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
      await expect(
        repo.call("20", "createDirect", { ...input, groupSessionId: "100" }),
      ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    }
  });
  it("captures a renamed employee for new batches while preserving the old batch name on confirmation", async () => {
    const input = { sourceTaskSessionId: "610", items: fullItems };
    const oldBatch = (await repo.call("20", "createProposal", {
      ...input,
      requestId: "before-employee-rename",
    }))!;
    expect(oldBatch).toMatchObject({ senderType: "AGENT", senderId: "31", senderName: "测试员工" });
    await pool.query(
      "UPDATE byai.byai_session_member SET mem_name='交付助理' WHERE session_id=100 AND mem_obj_type='AGENT' AND mem_obj_id=31",
    );
    try {
      const newBatch = (await repo.call("20", "createProposal", {
        ...input,
        requestId: "after-employee-rename",
      }))!;
      expect(newBatch).toMatchObject({
        senderType: "AGENT",
        senderId: "31",
        senderName: "交付助理",
      });
      // An existing batch owns its captured identity; only a new batch reads the current member name.
      for (const [batch, name] of [
        [oldBatch, "测试员工"],
        [newBatch, "交付助理"],
      ] as const) {
        const confirmed = (await repo.call("20", "confirm", {
          batchId: batch.batchId,
          expectedRevision: 0,
        }))!;
        expect(confirmed).toMatchObject({ senderType: "AGENT", senderId: "31", senderName: name });
        const messages = await messagesFor(batch.batchId);
        expect(messages).toHaveLength(2);
        for (const message of messages) {
          expect(message).toMatchObject({ creator_id: "31", creator_name: name, res_com_id: "31" });
          expect(await speakerFor(message.message_id)).toMatchObject({
            type: "agent",
            agentId: "31",
            agentName: name,
          });
        }
      }
    } finally {
      await pool.query(
        "UPDATE byai.byai_session_member SET mem_name='测试员工' WHERE session_id=100 AND mem_obj_type='AGENT' AND mem_obj_id=31",
      );
    }
  });
  it("resolves proposal sender only from an unambiguous tenant-owned execution without creating records", async () => {
    const count = async () =>
      (
        await pool.query(
          "SELECT (SELECT COUNT(*)::int FROM byai.byai_group_human_task_batch) batches,(SELECT COUNT(*)::int FROM byai.byai_message) messages",
        )
      ).rows[0];
    const before = await count();
    expect(await repo.call("20", "proposalSender", { sourceTaskSessionId: "610" })).toMatchObject({
      senderType: "AGENT",
      senderId: "31",
      sourceTaskSessionId: "610",
      groupSessionId: "100",
      sourceMessageId: "1",
    });
    for (const [actor, body, error] of [
      ["21", { sourceTaskSessionId: "610" }, "SOURCE_MISMATCH"],
      ["20", { sourceTaskSessionId: "620" }, "SOURCE_MISMATCH"],
      ["20", { sourceTaskSessionId: "600" }, "SOURCE_AMBIGUOUS"],
      ["20", { sourceTaskSessionId: "610", groupSessionId: "101" }, "SOURCE_MISMATCH"],
      ["20", { sourceTaskSessionId: "610", sourceMessageId: "999" }, "SOURCE_MISMATCH"],
    ] as const)
      await expect(repo.call(actor, "proposalSender", body)).rejects.toThrow(error);
    expect(await count()).toEqual(before);
  });

  it("uses the matching authoritative resource name despite a stale group member name", async () => {
    const input = { sourceTaskSessionId: "610", items: fullItems };
    const before = (await repo.call("20", "createProposal", {
      ...input,
      requestId: "resource-name-before",
      _resolvedSender: { senderId: "31", senderName: "平台事项助理" },
    }))!;
    const after = (await repo.call("20", "createProposal", {
      ...input,
      requestId: "resource-name-after",
      _resolvedSender: { senderId: "31", senderName: "平台交付助理" },
    }))!;
    expect(
      (
        await pool.query(
          "SELECT mem_name FROM byai.byai_session_member WHERE session_id=100 AND mem_obj_type='AGENT' AND mem_obj_id=31",
        )
      ).rows[0].mem_name,
    ).toBe("测试员工");
    for (const [batch, name] of [
      [before, "平台事项助理"],
      [after, "平台交付助理"],
    ] as const) {
      expect(batch).toMatchObject({ senderId: "31", senderName: name });
      const confirmed = (await repo.call("20", "confirm", {
        batchId: batch.batchId,
        expectedRevision: 0,
      }))!;
      expect(confirmed.senderName).toBe(name);
      for (const message of await messagesFor(batch.batchId)) {
        expect(message.creator_name).toBe(name);
        expect(await speakerFor(message.message_id)).toMatchObject({
          type: "agent",
          agentId: "31",
          agentName: name,
        });
      }
    }
    const retry = (await repo.call("20", "createProposal", {
      ...input,
      requestId: "resource-name-before",
      _resolvedSender: { senderId: "31", senderName: "平台再次改名" },
    }))!;
    expect(retry).toMatchObject({ batchId: before.batchId, senderName: "平台事项助理" });
  });

  it("rejects a resolved employee identity mismatch and never applies employee names to user creation", async () => {
    await expect(
      repo.call("20", "createProposal", {
        sourceTaskSessionId: "610",
        requestId: "wrong-resolved-id",
        items: fullItems,
        _resolvedSender: { senderId: "30", senderName: "另一员工" },
      }),
    ).rejects.toThrow("SOURCE_MISMATCH");
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS n FROM byai.byai_group_human_task_batch WHERE request_id='wrong-resolved-id'",
        )
      ).rows[0].n,
    ).toBe(0);
    const direct = (await repo.call("20", "createDirect", {
      groupSessionId: "100",
      requestId: "direct-resolved-ignored",
      items: fullItems,
      _resolvedSender: { senderId: "31", senderName: "不应生效" },
    }))!;
    expect(direct).toMatchObject({ senderType: "USER", senderId: "20", senderName: "发起人" });
    const ordinary = (await repo.call("20", "createProposal", {
      groupSessionId: "100",
      requestId: "user-resolved-ignored",
      items: fullItems,
      _resolvedSender: { senderId: "31", senderName: "不应生效" },
    }))!;
    expect(ordinary).toMatchObject({ senderType: "USER", senderId: "20", senderName: "发起人" });
  });

  it("filters todo views before pagination and preserves legacy relation/status filters", async () => {
    // Isolated actors expose unrelated rows and tenant leakage without relying on earlier tests.
    const rows = [
      [9101, 10, 90, 91, "PENDING_REVIEW"],
      [9102, 10, 90, 90, "PENDING_REVIEW"],
      [9103, 10, 91, 90, "PENDING_REVIEW"],
      [9104, 10, 91, 92, "PENDING_REVIEW"],
      [9105, 11, 90, 90, "PENDING_REVIEW"],
      [9111, 10, 91, 90, "PENDING"],
      [9112, 10, 90, 90, "PENDING"],
      [9113, 10, 90, 91, "PENDING"],
      [9114, 10, 91, 92, "PENDING"],
      [9115, 11, 91, 90, "PENDING"],
      [9121, 10, 91, 90, "CHANGES_REQUESTED"],
      [9122, 10, 90, 90, "CHANGES_REQUESTED"],
      [9123, 10, 90, 91, "CHANGES_REQUESTED"],
      [9124, 10, 91, 92, "CHANGES_REQUESTED"],
      [9125, 11, 91, 90, "CHANGES_REQUESTED"],
      [9131, 10, 91, 90, "ACCEPTED"],
      [9132, 10, 90, 90, "ACCEPTED"],
      [9133, 10, 90, 91, "ACCEPTED"],
    ] as const;
    for (const [id, tenant, initiator, assignee, status] of rows) {
      await pool.query(
        "INSERT INTO byai.byai_group_human_task(human_task_id,enterprise_id,group_session_id,batch_id,initiator_user_id,assignee_user_id,status,revision,latest_version,payload,create_time,update_time) VALUES($1,$2,100,9000,$3,$4,$5,0,0,$6,NOW(),NOW())",
        [
          id,
          tenant,
          initiator,
          assignee,
          status,
          JSON.stringify({ humanTaskId: String(id), status }),
        ],
      );
    }
    const list = async (query: Record<string, unknown>) => {
      const result = (await repo.call("90", "list", query))!;
      return { total: result.total, ids: result.items.map((item: any) => item.humanTaskId) };
    };
    expect(await list({ view: "PENDING_REVIEW" })).toEqual({ total: 2, ids: ["9102", "9101"] });
    expect(await list({ view: "PENDING_COMPLETION" })).toEqual({ total: 2, ids: ["9121", "9111"] });
    expect(await list({ view: "PENDING_MODIFICATION" })).toEqual({ total: 1, ids: ["9121"] });
    const counts = { pendingReview: 2, pendingCompletion: 2, pendingModification: 1, total: 4 };
    expect(await repo.call("90", "counts", {})).toEqual(counts);
    expect(
      await repo.call("90", "counts", {
        view: "INVALID",
        relation: "INITIATED",
        status: "ACCEPTED",
        pageNum: 0,
        actor: "91",
        enterpriseId: "11",
      }),
    ).toEqual(counts);
    for (const view of ["PENDING_REVIEW", "PENDING_COMPLETION", "PENDING_MODIFICATION"]) {
      const expected = await list({ view });
      // A business view owns its predicates even when callers also send legacy or forged scope fields.
      expect(
        await list({
          view,
          relation: "INITIATED",
          status: "ACCEPTED",
          enterpriseId: "11",
          actor: "91",
        }),
      ).toEqual(expected);
      expect(await list({ view, pageSize: 1, pageNum: 1 })).toEqual({
        total: expected.total,
        ids: expected.ids.slice(0, 1),
      });
      expect(await list({ view, pageSize: 1, pageNum: 2 })).toEqual({
        total: expected.total,
        ids: expected.ids.slice(1, 2),
      });
      expect(await list({ view, pageSize: 1, pageNum: 3 })).toEqual({
        total: expected.total,
        ids: [],
      });
    }
    expect(await list({ relation: "ASSIGNED", status: "PENDING" })).toEqual({
      total: 2,
      ids: ["9112", "9111"],
    });
    expect(await list({ relation: "INITIATED", status: "CHANGES_REQUESTED" })).toEqual({
      total: 2,
      ids: ["9123", "9122"],
    });
    expect(await list({ status: "PENDING_REVIEW" })).toEqual({
      total: 3,
      ids: ["9103", "9102", "9101"],
    });
    expect(await list({})).toEqual({
      total: 12,
      ids: [
        "9133",
        "9132",
        "9131",
        "9123",
        "9122",
        "9121",
        "9113",
        "9112",
        "9111",
        "9103",
        "9102",
        "9101",
      ],
    });
  });

  it("narrows lists and counts to one group without changing participant or tenant scope", async () => {
    // These actors have no current memberships; existing task participation remains readable after leaving.
    const rows = [
      [9201, 10, 800, 80, 81, "PENDING_REVIEW"],
      [9202, 10, 800, 80, 80, "PENDING_REVIEW"],
      [9203, 10, 800, 81, 80, "PENDING"],
      [9204, 10, 800, 81, 80, "CHANGES_REQUESTED"],
      [9205, 10, 800, 80, 80, "PENDING"],
      [9206, 10, 800, 82, 83, "CHANGES_REQUESTED"],
      [9207, 11, 800, 81, 80, "CHANGES_REQUESTED"],
      [9211, 10, 801, 80, 81, "PENDING_REVIEW"],
      [9212, 10, 801, 81, 80, "PENDING"],
      [9213, 10, 801, 81, 80, "CHANGES_REQUESTED"],
      [9221, 10, 802, 82, 83, "CHANGES_REQUESTED"],
      [9231, 11, 803, 81, 80, "PENDING"],
    ] as const;
    for (const [id, tenant, group, initiator, assignee, status] of rows) {
      await pool.query(
        "INSERT INTO byai.byai_group_human_task(human_task_id,enterprise_id,group_session_id,batch_id,initiator_user_id,assignee_user_id,status,revision,latest_version,payload,create_time,update_time) VALUES($1,$2,$3,9000,$4,$5,$6,0,0,$7,NOW(),NOW())",
        [
          id,
          tenant,
          group,
          initiator,
          assignee,
          status,
          JSON.stringify({ humanTaskId: String(id), status }),
        ],
      );
    }
    const list = async (body: Record<string, unknown>) => {
      const result = (await repo.call("80", "list", body))!;
      return { total: result.total, ids: result.items.map((item: any) => item.humanTaskId) };
    };
    const allCounts = { pendingReview: 3, pendingCompletion: 4, pendingModification: 2, total: 7 };
    expect(await repo.call("80", "counts", {})).toEqual(allCounts);
    expect(await repo.call("80", "counts", { groupSessionId: null })).toEqual(allCounts);
    expect(await list({})).toEqual({
      total: 8,
      ids: ["9213", "9212", "9211", "9205", "9204", "9203", "9202", "9201"],
    });
    expect(await list({ groupSessionId: null })).toEqual(await list({}));
    for (const [groupSessionId, expected] of [
      ["800", { pendingReview: 2, pendingCompletion: 2, pendingModification: 1, total: 4 }],
      ["801", { pendingReview: 1, pendingCompletion: 2, pendingModification: 1, total: 3 }],
      ["802", { pendingReview: 0, pendingCompletion: 0, pendingModification: 0, total: 0 }],
      ["803", { pendingReview: 0, pendingCompletion: 0, pendingModification: 0, total: 0 }],
      ["899", { pendingReview: 0, pendingCompletion: 0, pendingModification: 0, total: 0 }],
    ] as const) {
      expect(
        await repo.call("80", "counts", {
          groupSessionId,
          view: "INVALID",
          status: "ACCEPTED",
          pageNum: 0,
        }),
      ).toEqual(expected);
      for (const [key, view] of [
        ["pendingReview", "PENDING_REVIEW"],
        ["pendingCompletion", "PENDING_COMPLETION"],
        ["pendingModification", "PENDING_MODIFICATION"],
      ] as const) {
        expect((await list({ groupSessionId, view, pageSize: 1 })).total).toBe(expected[key]);
      }
    }
    for (const groupSessionId of ["802", "803", "899"]) {
      expect(await list({ groupSessionId })).toEqual({ total: 0, ids: [] });
    }
    expect(
      await list({ groupSessionId: "800", view: "PENDING_REVIEW", pageSize: 1, pageNum: 2 }),
    ).toEqual({ total: 2, ids: ["9201"] });
    expect(
      await list({ groupSessionId: "800", view: "PENDING_REVIEW", pageSize: 1, pageNum: 3 }),
    ).toEqual({ total: 2, ids: [] });
    expect(
      await list({
        groupSessionId: "800",
        relation: "ASSIGNED",
        status: "PENDING",
        pageSize: 1,
        pageNum: 1,
      }),
    ).toEqual({ total: 2, ids: ["9205"] });
    expect(
      await list({
        groupSessionId: "800",
        relation: "ASSIGNED",
        status: "PENDING",
        pageSize: 1,
        pageNum: 2,
      }),
    ).toEqual({ total: 2, ids: ["9203"] });
  });

  it.each(
    ["", " ", "0", "-1", "1.2", "01", "9223372036854775808", 800, [], {}].map((groupSessionId) => [
      groupSessionId,
    ]),
  )("rejects malformed group ID %j for both list and counts", async (groupSessionId) => {
    for (const action of ["list", "counts"]) {
      await expect(repo.call("80", action, { groupSessionId })).rejects.toThrow(
        "HUMAN_TASK_INVALID_groupSessionId",
      );
    }
  });

  it("lists all group todos for current members with combined multi-user filters and stable page totals", async () => {
    await pool.query(
      "INSERT INTO byai.byai_session(session_id,enterprise_id,creator_id,session_type,last_seq,state) VALUES(900,10,70,'hs_as',0,'ACTIVE'),(902,11,70,'hs_as',0,'ACTIVE'),(904,10,70,'h_as',0,'ACTIVE')",
    );
    await pool.query(
      "INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id) VALUES(9001,900,'USER',70,10),(9002,900,'USER',71,10),(9003,902,'USER',70,11),(9004,904,'USER',70,10),(9005,900,'AGENT',73,10)",
    );
    const rows = [
      [9301, 10, 900, 71, 72, "PENDING"],
      [9302, 10, 900, 72, 71, "PENDING"],
      [9303, 10, 900, 71, 71, "CHANGES_REQUESTED"],
      [9304, 10, 900, 72, 72, "PENDING_REVIEW"],
      [9305, 10, 900, 70, 71, "ACCEPTED"],
      [9306, 11, 900, 70, 71, "PENDING"],
      [9307, 10, 901, 71, 72, "PENDING"],
    ] as const;
    for (const [id, tenant, group, initiator, assignee, status] of rows) {
      await pool.query(
        "INSERT INTO byai.byai_group_human_task(human_task_id,enterprise_id,group_session_id,batch_id,initiator_user_id,assignee_user_id,status,revision,latest_version,payload,create_time,update_time) VALUES($1,$2,$3,9000,$4,$5,$6,0,0,$7,NOW(),NOW())",
        [
          id,
          tenant,
          group,
          initiator,
          assignee,
          status,
          JSON.stringify({
            humanTaskId: String(id),
            groupSessionId: String(group),
            initiatorUserId: String(initiator),
            assigneeUserId: String(assignee),
            title: "群待办",
            content: "任务要求",
            status,
          }),
        ],
      );
    }
    const list = async (body: Record<string, unknown> = {}) => {
      const result = (await repo.call("70", "groupList", { groupSessionId: "900", ...body }))!;
      return { total: result.total, ids: result.items.map((item: any) => item.humanTaskId) };
    };
    const all = { total: 5, ids: ["9305", "9304", "9303", "9302", "9301"] };
    expect(await list()).toEqual(all);
    // Personal views must not restrict the group listing, and filter targets may have already left.
    expect(await list({ view: "PENDING_REVIEW", relation: "ASSIGNED" })).toEqual(all);
    expect(await list({ initiatorUserIds: [], assigneeUserIds: null, status: null })).toEqual(all);
    expect(await list({ initiatorUserIds: ["70", "71"] })).toEqual({
      total: 3,
      ids: ["9305", "9303", "9301"],
    });
    expect(await list({ assigneeUserIds: ["71", "72"] })).toEqual(all);
    expect(
      await list({ initiatorUserIds: Array.from({ length: 100 }, (_, i) => String(i + 1)) }),
    ).toEqual(all);
    expect(await list({ status: "PENDING_REVIEW" })).toEqual({ total: 1, ids: ["9304"] });
    expect(await list({ status: "CHANGES_REQUESTED" })).toEqual({ total: 1, ids: ["9303"] });
    expect(await list({ status: "ACCEPTED" })).toEqual({ total: 1, ids: ["9305"] });
    expect(await list({ initiatorUserIds: ["71", "72"], assigneeUserIds: ["72"] })).toEqual({
      total: 2,
      ids: ["9304", "9301"],
    });
    expect(
      await list({ initiatorUserIds: ["71", "72"], assigneeUserIds: ["72"], status: "PENDING" }),
    ).toEqual({ total: 1, ids: ["9301"] });
    expect(await list({ initiatorUserIds: Array(101).fill("71") })).toEqual({
      total: 2,
      ids: ["9303", "9301"],
    });
    expect(await list({ assigneeUserIds: ["99"] })).toEqual({ total: 0, ids: [] });
    expect(await list({ pageSize: 2, pageNum: 1 })).toEqual({ total: 5, ids: ["9305", "9304"] });
    expect(await list({ pageSize: 2, pageNum: 3 })).toEqual({ total: 5, ids: ["9301"] });
    expect(await list({ pageSize: 2, pageNum: 4 })).toEqual({ total: 5, ids: [] });
    expect(await list({ status: "PENDING", pageSize: 1, pageNum: 2 })).toEqual({
      total: 2,
      ids: ["9301"],
    });
    expect(
      await list({
        initiatorUserIds: ["71", "72"],
        assigneeUserIds: ["71", "72"],
        status: "PENDING",
        pageSize: 1,
        pageNum: 2,
      }),
    ).toEqual({ total: 2, ids: ["9301"] });
    expect((await repo.call("70", "list", { groupSessionId: "900" }))!.total).toBe(1);
  });

  it("keeps submission and review histories out of group todo list items", async () => {
    await pool.query(
      "INSERT INTO byai.byai_group_human_task_submission(submission_id,enterprise_id,human_task_id,version_no,request_id,payload_hash,payload,create_time) VALUES(9401,10,9304,1,'private-history','hash',$1,NOW())",
      [JSON.stringify({ text: "private submission body", files: [{ fileId: "private-file" }] })],
    );
    await pool.query(
      "INSERT INTO byai.byai_group_human_task_review(review_id,enterprise_id,human_task_id,submission_id,request_id,payload_hash,payload,create_time) VALUES(9402,10,9304,9401,'private-history','hash',$1,NOW())",
      [JSON.stringify({ opinion: "private review opinion" })],
    );
    const result = (await repo.call("70", "groupList", {
      groupSessionId: "900",
      status: "PENDING_REVIEW",
    }))!;
    expect(result).toEqual({
      total: 1,
      items: [
        {
          humanTaskId: "9304",
          groupSessionId: "900",
          initiatorUserId: "72",
          assigneeUserId: "72",
          title: "群待办",
          content: "任务要求",
          status: "PENDING_REVIEW",
        },
      ],
    });
  });

  it("rejects group todo access for nonmembers, employees, foreign tenants and dissolved groups", async () => {
    for (const [actor, groupSessionId] of [
      ["72", "900"],
      ["73", "900"],
      ["70", "902"],
      ["70", "904"],
      ["70", "999"],
    ]) {
      await expect(repo.call(actor!, "groupList", { groupSessionId })).rejects.toThrow(
        "GROUP_SCOPE_MISMATCH",
      );
    }
    await pool.query("DELETE FROM byai.byai_session_member WHERE byai_session_member_id=9002");
    await expect(repo.call("71", "groupList", { groupSessionId: "900" })).rejects.toThrow(
      "GROUP_SCOPE_MISMATCH",
    );
    await pool.query("UPDATE byai.byai_session SET state='GROUP_DISSOLVED' WHERE session_id=900");
    try {
      await expect(repo.call("70", "groupList", { groupSessionId: "900" })).rejects.toThrow(
        "GROUP_SCOPE_MISMATCH",
      );
    } finally {
      await pool.query("UPDATE byai.byai_session SET state='ACTIVE' WHERE session_id=900");
    }
  });

  it("rejects malformed group todo status, group IDs, member filters and pagination", async () => {
    for (const groupSessionId of [undefined, null, "", "0", " 900", 900]) {
      await expect(repo.call("70", "groupList", { groupSessionId })).rejects.toThrow(
        "HUMAN_TASK_INVALID_groupSessionId",
      );
    }
    for (const status of ["", "pending", "UNKNOWN", ["PENDING"], 1]) {
      await expect(repo.call("70", "groupList", { groupSessionId: "900", status })).rejects.toThrow(
        "INVALID_STATUS",
      );
    }
    for (const field of ["initiatorUserIds", "assigneeUserIds"]) {
      for (const value of [
        "71",
        {},
        [""],
        [" 71"],
        [71],
        [null],
        ["0"],
        ["9223372036854775808"],
        Array.from({ length: 101 }, (_, i) => String(i + 1)),
      ]) {
        await expect(
          repo.call("70", "groupList", { groupSessionId: "900", [field]: value }),
        ).rejects.toThrow(`INVALID_${field}`);
      }
    }
    for (const page of [
      { pageNum: 0 },
      { pageNum: 1.5 },
      { pageNum: 1000001 },
      { pageSize: 0 },
      { pageSize: 101 },
    ]) {
      await expect(
        repo.call("70", "groupList", { groupSessionId: "900", ...page }),
      ).rejects.toThrow("INVALID_PAGE");
    }
  });

  it("returns numeric zero todo counts when the actor has no matching tasks", async () => {
    expect(await repo.call("99", "counts", {})).toEqual({
      pendingReview: 0,
      pendingCompletion: 0,
      pendingModification: 0,
      total: 0,
    });
    const emptyTenant = new HumanTaskRepository((repo as any).connection, "12");
    expect(await emptyTenant.call("90", "counts", {})).toEqual({
      pendingReview: 0,
      pendingCompletion: 0,
      pendingModification: 0,
      total: 0,
    });
  });

  it("counts from stored columns in one query without deserializing task payloads", async () => {
    await pool.query(
      "INSERT INTO byai.byai_group_human_task(human_task_id,enterprise_id,group_session_id,batch_id,initiator_user_id,assignee_user_id,status,revision,latest_version,payload,create_time,update_time) VALUES(9141,10,100,9000,95,96,'PENDING_REVIEW',0,0,'invalid JSON payload',NOW(),NOW())",
    );
    let queries = 0;
    const countingRepo = new HumanTaskRepository(
      {
        write: async (work) =>
          work({
            query: async (sql, args) => {
              queries++;
              return (await pool.query(sql, args)).rows;
            },
          }),
      },
      "10",
    );
    expect(await countingRepo.call("95", "counts", { groupSessionId: "100" })).toEqual({
      pendingReview: 1,
      pendingCompletion: 0,
      pendingModification: 0,
      total: 1,
    });
    expect(queries).toBe(1);
  });

  it.each(["", " ", "pending_review", "UNKNOWN", 1, false, [], {}].map((view) => [view]))(
    "rejects invalid todo view %j instead of returning all tasks",
    async (view) => {
      await expect(repo.call("20", "list", { view })).rejects.toThrow("HUMAN_TASK_INVALID_VIEW");
    },
  );

  it("moves a returned task between review and completion views when resubmitted", async () => {
    const assertCountsMatchViews = async () => {
      for (const actor of ["20", "21"]) {
        const counts = (await repo.call(actor, "counts", {}))!;
        expect(counts.total).toBe(counts.pendingReview + counts.pendingCompletion);
        for (const [key, view] of [
          ["pendingReview", "PENDING_REVIEW"],
          ["pendingCompletion", "PENDING_COMPLETION"],
          ["pendingModification", "PENDING_MODIFICATION"],
        ]) {
          expect(counts[key!]).toBe((await repo.call(actor, "list", { view, pageSize: 1 }))!.total);
        }
      }
    };
    const batch = (await repo.call("20", "createDirect", {
      groupSessionId: "100",
      requestId: "todo-view-lifecycle",
      items: [{ title: "待办视图流转", content: "准备材料", assigneeUserId: "21" }],
    }))!;
    const humanTaskId = batch.items[0].humanTaskId;
    const ids = async (actor: string, view: string) =>
      (await repo.call(actor, "list", { view, pageSize: 100 }))!.items.map(
        (item: any) => item.humanTaskId,
      );
    expect(await ids("21", "PENDING_COMPLETION")).toContain(humanTaskId);
    expect(await ids("21", "PENDING_MODIFICATION")).not.toContain(humanTaskId);
    await assertCountsMatchViews();
    const submission = (await repo.call("21", "submit", {
      humanTaskId,
      requestId: "todo-view-submit",
      text: "初稿",
      sourceType: "DIRECT",
    }))!;
    expect(await ids("20", "PENDING_REVIEW")).toContain(humanTaskId);
    expect(await ids("21", "PENDING_COMPLETION")).not.toContain(humanTaskId);
    await assertCountsMatchViews();
    await repo.call("20", "review", {
      humanTaskId,
      requestId: "todo-view-return",
      submissionId: submission.submissionId,
      expectedRevision: 1,
      decision: "RETURN",
      opinion: "补充内容",
    });
    expect(await ids("20", "PENDING_REVIEW")).not.toContain(humanTaskId);
    expect(await ids("21", "PENDING_COMPLETION")).toContain(humanTaskId);
    expect(await ids("21", "PENDING_MODIFICATION")).toContain(humanTaskId);
    await assertCountsMatchViews();
    await repo.call("21", "submit", {
      humanTaskId,
      requestId: "todo-view-resubmit",
      text: "修改稿",
      sourceType: "DIRECT",
    });
    expect(await ids("20", "PENDING_REVIEW")).toContain(humanTaskId);
    expect(await ids("21", "PENDING_COMPLETION")).not.toContain(humanTaskId);
    expect(await ids("21", "PENDING_MODIFICATION")).not.toContain(humanTaskId);
    await assertCountsMatchViews();
  });

  it("rejects new batches and draft confirmation after group dissolution while preserving existing retries", async () => {
    const input = {
      groupSessionId: "100",
      requestId: "before-dissolution-direct",
      items: fullItems,
    };
    const direct = (await repo.call("20", "createDirect", input))!;
    const draftInput = { ...input, requestId: "before-dissolution-draft" };
    const draft = (await repo.call("20", "createProposal", draftInput))!;
    const submitted = (await repo.call("21", "submit", {
      humanTaskId: direct.items[0].humanTaskId,
      requestId: "before-dissolution-result",
      sourceType: "DIRECT",
      text: "已完成",
    }))!;
    const count = async () =>
      (
        await pool.query(
          "SELECT (SELECT COUNT(*)::int FROM byai.byai_group_human_task_batch) batches,(SELECT COUNT(*)::int FROM byai.byai_group_human_task) tasks,(SELECT COUNT(*)::int FROM byai.byai_message) messages",
        )
      ).rows[0];
    const before = await count();
    await pool.query("UPDATE byai.byai_session SET state='GROUP_DISSOLVED' WHERE session_id=100");
    try {
      await expect(
        repo.call("20", "createDirect", { ...input, requestId: "dissolved-new-direct" }),
      ).rejects.toThrow("GROUP_SCOPE_MISMATCH");
      await expect(
        repo.call("20", "createProposal", { ...draftInput, requestId: "dissolved-new-proposal" }),
      ).rejects.toThrow("GROUP_SCOPE_MISMATCH");
      await expect(
        repo.call("20", "confirm", { batchId: draft.batchId, expectedRevision: 0 }),
      ).rejects.toThrow("GROUP_SCOPE_MISMATCH");
      const retry = (await repo.call("20", "createDirect", input))!;
      expect(retry.batchId).toBe(direct.batchId);
      expect(retry.items[0]).toMatchObject({
        status: "PENDING_REVIEW",
        latestSubmissionId: submitted.submissionId,
      });
      expect((await repo.call("20", "createProposal", draftInput))!.batchId).toBe(draft.batchId);
      expect(
        (await repo.call("20", "confirm", { batchId: direct.batchId, expectedRevision: 0 }))!
          .cardMessageId,
      ).toBe(direct.cardMessageId);
      expect(await count()).toEqual(before);
    } finally {
      await pool.query("UPDATE byai.byai_session SET state='ACTIVE' WHERE session_id=100");
    }
  });
});
