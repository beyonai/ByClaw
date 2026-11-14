import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandService } from "../src/application/command-service.js";
import type { TenantCommand } from "../src/application/command.js";
import type { ConnectionManager } from "../src/application/connection-manager.js";
import type { SqlSession } from "../src/application/database-ports.js";
import { HistoryService, safeMessage } from "../src/application/history.js";
import { first as readRow } from "../src/infrastructure/persistence/sql-utils.js";
import { SqlCommandTransactions } from "../src/infrastructure/persistence/command-repository.js";
import { SqlForwardSourceAuthorityReader } from "../src/infrastructure/persistence/group-forward-source-authority.js";
import { projectGroupTaskAnswer } from "../src/infrastructure/persistence/group-task-answer.js";
import { MirrorInputWriter } from "../src/infrastructure/persistence/mirror-input.js";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";
import { SqlSessionRepository } from "../src/infrastructure/persistence/session-repository.js";
import { historyRoutes } from "../src/interfaces/http/data-routes.js";
import { commandRoutes } from "../src/interfaces/http/command-routes.js";
import { answer, command, event, identity } from "./fixtures.js";

let db: DatabaseSync;
let sql: SqlSession;
let history: HistoryService;
let service: CommandService;
let sequence = 0;
let request = 0;
const execute = (
  operation: TenantCommand["operation"],
  payload: Record<string, unknown>,
  actor = "20",
  requestId = String(++request),
) => service.execute(command({ operation, payload, userId: actor, requestId }));
const open = (actor = "20", agentId = "50") => execute("CREATE_DIRECT_TASK", { agentId }, actor);
const prepare = (
  taskSessionId: string,
  pendingPublicationId: string,
  text: string,
  sourcePaths: string[] = [],
  expectedPendingPublicationId?: string,
) =>
  execute("SAVE_PENDING_PUBLICATION", {
    taskSessionId,
    pendingPublicationId,
    text,
    sourcePaths,
    ...(expectedPendingPublicationId ? { expectedPendingPublicationId } : {}),
  });
const publish = (
  taskSessionId: string,
  pendingPublicationId: string | undefined,
  text: string,
  files: unknown[] = [],
  requestId?: string,
) =>
  execute(
    "PUBLISH_TASK",
    { taskSessionId, ...(pendingPublicationId ? { pendingPublicationId } : {}), text, files },
    "20",
    requestId,
  );

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`ATTACH DATABASE ':memory:' AS byai;
    CREATE TABLE byai.byai_session(session_id TEXT PRIMARY KEY,parent_session_id TEXT,project_id TEXT,enterprise_id TEXT,creator_id TEXT,object_id TEXT,object_type TEXT,session_content TEXT,session_type TEXT,session_name TEXT,state TEXT,last_seq TEXT DEFAULT '0',create_time TEXT,update_time TEXT);
    CREATE TABLE byai.byai_session_ext(ext_id TEXT PRIMARY KEY,session_id TEXT,ext_param_name TEXT,ext_param_code TEXT,ext_param_value TEXT);
    CREATE TABLE byai.byai_session_member(session_id TEXT,mem_obj_type TEXT,mem_obj_id TEXT,com_acct_id TEXT,mem_name TEXT,user_role TEXT);
    CREATE TABLE byai.byai_group_chat_task(task_session_id TEXT PRIMARY KEY,group_session_id TEXT,source_message_id TEXT NOT NULL,dispatch_id TEXT UNIQUE,initiator_user_id TEXT,target_agent_id TEXT,task_name TEXT,status TEXT,turn_status TEXT,publish_message_id TEXT,publish_by TEXT,create_time TEXT,update_time TEXT);
    CREATE TABLE byai.byai_group_human_task(human_task_id TEXT PRIMARY KEY,enterprise_id TEXT,group_session_id TEXT,batch_id TEXT,initiator_user_id TEXT,assignee_user_id TEXT,status TEXT,revision INTEGER,latest_version INTEGER,latest_submission_id TEXT,payload TEXT,create_time TEXT,update_time TEXT);
    CREATE TABLE byai.byai_group_human_task_session(task_session_id TEXT PRIMARY KEY,enterprise_id TEXT,human_task_id TEXT,entry_type TEXT,create_time TEXT);
    CREATE TABLE byai.byai_group_chat_direct_binding(group_session_id TEXT,initiator_user_id TEXT,target_agent_id TEXT,task_session_id TEXT UNIQUE,PRIMARY KEY(group_session_id,initiator_user_id,target_agent_id));
    CREATE TABLE byai.byai_group_chat_pending_publication(task_session_id TEXT PRIMARY KEY,pending_publication_id TEXT UNIQUE,text_content TEXT,source_files_json TEXT,uploaded_files_json TEXT DEFAULT '{}',cloud_resource_id TEXT,create_time TEXT);
    CREATE TABLE byai.byai_group_chat_private_publication(task_session_id TEXT,pending_publication_id TEXT,group_session_id TEXT,message_id TEXT UNIQUE,publisher_user_id TEXT,text_content TEXT,files_json TEXT,create_time TEXT,PRIMARY KEY(task_session_id,pending_publication_id));
    CREATE TABLE byai.byai_group_chat_task_publication(task_session_id TEXT PRIMARY KEY,pending_publication_id TEXT,group_session_id TEXT,message_id TEXT UNIQUE,publisher_user_id TEXT,text_content TEXT,files_json TEXT,create_time TEXT);
    CREATE TABLE byai.byai_group_chat_execution(candidate_session_id TEXT);
    CREATE TABLE byai.byai_group_chat_forward_target(target_id TEXT,enterprise_id TEXT,target_session_id TEXT,state TEXT,checkpoint_json TEXT,message_ids_json TEXT);
    CREATE TABLE byai.byai_group_chat_forward_item(target_id TEXT,enterprise_id TEXT,bound_message_id TEXT,ordinal INTEGER);
    CREATE TABLE byai.byai_message(id TEXT PRIMARY KEY,message_ref TEXT,message_id TEXT UNIQUE,topic_id TEXT,session_id TEXT,enterprise_id TEXT,creator_id TEXT,creator_name TEXT,usage INTEGER,role TEXT,message_content TEXT,final_content TEXT,is_complete INTEGER,msg_status INTEGER,created_seq TEXT,storage_version TEXT,metadata TEXT,related_resources TEXT,recalled_at TEXT,archived_at TEXT,create_time TEXT,update_time TEXT);
    INSERT INTO byai.byai_session(session_id,enterprise_id,project_id,creator_id,session_type,state) VALUES('30','10','60','20','hs_as','ACTIVE');
    INSERT INTO byai.byai_session_member VALUES('30','USER','20','10',NULL,'OWNER'),('30','USER','21','10',NULL,'ADMIN'),('30','AGENT','50','10','员工','MEMBER'),('30','AGENT','51','10','员工','MEMBER');
    INSERT INTO byai.byai_message(id,message_id,session_id,enterprise_id,creator_id,usage,message_content) VALUES('100','100','30','10','20',1,'公开历史');`);
  db.function("nextval", (_name) => String(++sequence));
  sql = {
    lock: async () => {},
    query: async (statement, parameters = []) => {
      const values: any[] = [];
      const adapted = statement.replace(/::text/g, "").replace(/\$(\d+)/g, (_, index) => {
        const value = parameters[Number(index) - 1];
        values.push(
          value instanceof Date
            ? value.toISOString()
            : typeof value === "boolean"
              ? Number(value)
              : (value ?? null),
        );
        return "?";
      });
      return db.prepare(adapted).all(...values);
    },
  };
  service = new CommandService(
    new SqlCommandTransactions({
      write: async (work: (session: SqlSession) => Promise<unknown>) => {
        db.exec("BEGIN");
        try {
          const result = await work(sql);
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as ConnectionManager),
  );
  history = new HistoryService("10", new SqlHistoryRepository(sql, "10"));
});
afterEach(() => db.close());

describe("persistent employee chats", () => {
  it("returns the same session ID in both HTTP response shapes and adopts a historical standalone direct session", async () => {
    for (const id of ["503", "502"]) {
      db.prepare(
        "INSERT INTO byai.byai_session(session_id,parent_session_id,project_id,enterprise_id,creator_id,object_id,session_type,state,create_time) VALUES(?,'30','60','10','20','50','h_as','ACTIVE','2020-01-01')",
      ).run(id);
      db.prepare(
        "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES(?,?,'group_source_session_id','30')",
      ).run(id, id);
    }
    const app = Fastify();
    commandRoutes(app, identity, service);
    try {
      const enter = async (path: string, operation: TenantCommand["operation"], key: string) => {
        const response = await app.inject({
          method: "POST",
          url: `/internal/v1/group-chats/30/${path}`,
          headers: { "x-actor-user-id": "20" },
          payload: command({ operation, requestId: key, payload: { agentId: "50" } }),
        });
        expect(response.statusCode).toBe(200);
        return response.json().data;
      };
      expect(await enter("direct-sessions", "CREATE_DIRECT_SESSION", "old-route")).toMatchObject({
        sessionId: "502",
        parentSessionId: "30",
        objectId: "50",
        sessionType: "h_as",
      });
      expect(await enter("direct-tasks", "CREATE_DIRECT_TASK", "new-route")).toMatchObject({
        taskSessionId: "502",
        status: "PRIVATE",
      });
      const old = command({
        operation: "CREATE_DIRECT_SESSION",
        requestId: "old-receipt",
        payload: { agentId: "50" },
      });
      db.prepare(
        "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES('1','30','node_command:old-receipt',?)",
      ).run(
        JSON.stringify({
          hash: old.requestHash,
          userId: "20",
          result: { data: { sessionId: "503" } },
        }),
      );
      expect(await enter("direct-sessions", "CREATE_DIRECT_SESSION", "old-receipt")).toMatchObject({
        sessionId: "502",
      });
      expect(
        (await new SqlSessionRepository(sql, "10").children("20", "30", 1, 10)).list.map(
          (row) => row.sessionId,
        ),
      ).toEqual(["502"]);
      expect(await history.access("20", "503")).not.toHaveProperty("groupDirectTask");
      await expect(
        new MirrorInputWriter(sql, "10").assertInputAccess(
          event({ sessionId: "503", payload: { userId: "20" } }),
        ),
      ).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    } finally {
      await app.close();
    }
  });
  it("retains one task per group, initiator and employee and only lists the owner's private tasks", async () => {
    const id = (await open()).data.taskSessionId;
    expect((await open()).data.taskSessionId).toBe(id);
    const colleague = (await open("21")).data.taskSessionId;
    const otherAgent = (await open("20", "51")).data.taskSessionId;
    expect(new Set([id, colleague, otherAgent]).size).toBe(3);
    expect((await history.tasks("20", "30")).map((row) => row.taskSessionId).sort()).toEqual(
      [id, otherAgent].sort(),
    );
    expect(await history.access("20", id)).toMatchObject({
      groupDirectTask: { groupSessionId: "30", targetAgentId: "50" },
    });
    await expect(history.access("21", id)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    db.exec("DELETE FROM byai.byai_session_member WHERE mem_obj_id='50'");
    await expect(open()).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(history.access("20", id)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(prepare(id, "703", "removed agent")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });

  it("binds the earliest historical private task even on equal timestamps, preserves its siblings and reopens a closed session", async () => {
    for (const id of ["402", "401"]) {
      db.prepare(
        "INSERT INTO byai.byai_session(session_id,parent_session_id,enterprise_id,creator_id,object_id,session_type,state) VALUES(?,'30','10','20',?,'h_as','CLOSED')",
      ).run(id, id === "401" ? null : "50");
      db.prepare(
        "INSERT INTO byai.byai_group_chat_task(task_session_id,group_session_id,source_message_id,initiator_user_id,target_agent_id,status,turn_status,create_time) VALUES(?,'30','100','20','50','CANCELLED','PRIVATE','2025-01-01')",
      ).run(id);
    }
    expect((await open()).data).toMatchObject({
      taskSessionId: "401",
      status: "PRIVATE",
      turnStatus: "PRIVATE",
    });
    expect(await history.access("20", "401")).toMatchObject({ state: "ACTIVE", objectId: "50" });
    expect((await history.tasks("20", "30")).map((row) => row.taskSessionId)).toEqual(["401"]);
    expect(
      await sql.query(
        "SELECT task_session_id FROM byai.byai_group_chat_task ORDER BY task_session_id",
      ),
    ).toEqual([{ task_session_id: "401" }, { task_session_id: "402" }]);
    await expect(execute("CANCEL_TASK", { taskSessionId: "401" }, "21")).rejects.toThrow();
    await expect(
      service.execute(command({ operation: "DELETE_SESSION", sessionId: "401" })),
    ).rejects.toThrow();
    expect((await open()).data.taskSessionId).toBe("401");
  });

  it("keeps completed ordinary replies private until the initiator confirms a draft", async () => {
    const id = (await open()).data.taskSessionId;
    await projectGroupTaskAnswer(
      sql,
      "10",
      event({ sessionId: id, eventType: "TERMINAL" }),
      answer({ sessionId: id, finalContent: "private answer" }),
    );
    expect(
      await sql.query("SELECT message_content FROM byai.byai_message WHERE session_id='30'"),
    ).toEqual([{ message_content: "公开历史" }]);
  });
  it("keeps a duplicate historical chat readable without letting it send or publish, including stale open-command receipts", async () => {
    const id = (await open()).data.taskSessionId;
    db.prepare(
      "INSERT INTO byai.byai_session(session_id,parent_session_id,enterprise_id,creator_id,object_id,session_type,state) VALUES('402','30','10','20','50','h_as','ACTIVE')",
    ).run();
    db.prepare(
      "INSERT INTO byai.byai_group_chat_task(task_session_id,group_session_id,source_message_id,initiator_user_id,target_agent_id,status,turn_status,create_time) VALUES('402','30','100','20','50','PRIVATE','PRIVATE','2020-01-01')",
    ).run();
    expect(await history.access("20", "402")).not.toHaveProperty("groupDirectTask");
    const children = await new SqlSessionRepository(sql, "10").children("20", "30", 1, 10);
    expect(children.list.map((child) => child.sessionId)).toEqual([id]);
    await expect(prepare("402", "710", "old session")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(
      new MirrorInputWriter(sql, "10").assertInputAccess(
        event({ sessionId: "402", payload: { userId: "20" } }),
      ),
    ).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    const old = command({
      operation: "CREATE_DIRECT_TASK",
      requestId: "old-open",
      payload: { agentId: "50" },
    });
    db.prepare(
      "INSERT INTO byai.byai_session_ext(ext_id,session_id,ext_param_code,ext_param_value) VALUES('1','30','node_command:old-open',?)",
    ).run(
      JSON.stringify({
        hash: old.requestHash,
        userId: "20",
        result: { data: { taskSessionId: "402" } },
      }),
    );
    expect((await service.execute(old)).data.taskSessionId).toBe(id);
  });
});

describe("versioned private publications", () => {
  it("accepts server-resolved mentions but rejects unrelated text even when the original draft is supplied", async () => {
    const id = (await open()).data.taskSessionId;
    const raw = "给[@同事](uid=HUMAN_21)的结果";
    await prepare(id, "711", raw);
    const confirm = (text: string) =>
      execute("PUBLISH_TASK", {
        taskSessionId: id,
        pendingPublicationId: "711",
        preparedText: raw,
        text,
        files: [],
        metadata: { resourceList: [{ id: "HUMAN_21", resourceType: "HUMAN", resourceId: "21" }] },
      });
    await expect(confirm("替换草稿")).rejects.toThrow("PENDING_PUBLICATION_CHANGED");
    expect((await confirm("给{{HUMAN_21}}的结果")).data.text).toBe("给{{HUMAN_21}}的结果");
  });
  it("publishes an independent root message for each confirmed version, and never consumes a later draft on either kind of replay", async () => {
    const id = (await open()).data.taskSessionId;
    await prepare(id, "701", "first");
    const first = await publish(id, "701", "first", [], "publish-first");
    expect(first.data).toMatchObject({
      text: "first",
      pendingPublicationId: "701",
      newlyPublished: true,
    });
    await prepare(id, "702", "second");
    expect((await publish(id, "701", "first", [], "publish-first")).data).toEqual({
      ...first.data,
      newlyPublished: false,
    });
    expect((await publish(id, "701", "different replay")).data).toEqual({
      ...first.data,
      newlyPublished: false,
    });
    expect(await history.pending("20", id)).toMatchObject({
      pendingPublicationId: "702",
      text: "second",
    });
    expect(await history.publication("20", id, "701")).toMatchObject({
      messageId: first.messageId,
      text: "first",
    });
    const second = await publish(id, "702", "second");
    expect(second.data.newlyPublished).toBe(true);
    expect(second.messageId).not.toBe(first.messageId);
    expect(await history.pending("20", id)).toBeNull();
    expect(await history.task("20", id)).toMatchObject({
      status: "PRIVATE",
      turnStatus: "PRIVATE",
      publishMessageId: null,
    });
    expect(
      await sql.query(
        "SELECT message_id,topic_id,message_ref FROM byai.byai_message WHERE usage=2 ORDER BY created_seq",
      ),
    ).toEqual([
      { message_id: first.messageId, topic_id: first.messageId, message_ref: null },
      { message_id: second.messageId, topic_id: second.messageId, message_ref: null },
    ]);
    const row = await readRow(sql, "SELECT * FROM byai.byai_message WHERE message_id=$1", [
      first.messageId,
    ]);
    expect(JSON.parse(safeMessage(row!).metadata)).not.toHaveProperty("taskId");
    expect(JSON.parse(safeMessage({ ...row, recalledAt: new Date() }).metadata)).not.toHaveProperty(
      "taskId",
    );
    const app = Fastify();
    historyRoutes(app, history);
    try {
      const receipt = await app.inject({
        url: `/internal/v1/group-chat/tasks/${id}/publication?pendingPublicationId=701`,
        headers: { "x-actor-user-id": "20" },
      });
      expect(receipt.statusCode).toBe(200);
      expect(receipt.json()).toEqual({
        taskId: id,
        messageId: first.messageId,
        pendingPublicationId: "701",
        text: "first",
        files: [],
      });
    } finally {
      await app.close();
    }
  });

  it("rejects stale or missing versions, text overrides, non-initiators and incomplete upload checkpoints", async () => {
    const id = (await open()).data.taskSessionId;
    await prepare(id, "701", "old");
    await prepare(id, "702", "attachment", ["/by/a.txt"], "701");
    await expect(publish(id, undefined, "attachment")).rejects.toThrow();
    await expect(publish(id, "701", "old")).rejects.toThrow("PENDING_PUBLICATION_CHANGED");
    await expect(publish(id, "702", "override")).rejects.toThrow("PENDING_PUBLICATION_CHANGED");
    await expect(
      execute(
        "PUBLISH_TASK",
        { taskSessionId: id, pendingPublicationId: "702", text: "attachment" },
        "21",
      ),
    ).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(history.publication("21", id, "702")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(publish(id, "702", "attachment")).rejects.toThrow("INVALID_PUBLICATION_FILES");
    await expect(
      execute("DELETE_PENDING_PUBLICATION", { taskSessionId: id, pendingPublicationId: "701" }),
    ).rejects.toThrow("PENDING_PUBLICATION_CHANGED");
    const file = { fileName: "a.txt", filePath: "/group-task-results/private/702/0/a.txt" };
    const checkpoint = (pendingPublicationId: string, uploadedFiles: object) =>
      execute("CHECKPOINT_PUBLICATION", {
        taskSessionId: id,
        pendingPublicationId,
        cloudResourceId: "60",
        uploadedFiles,
      });
    await expect(checkpoint("701", { "/by/a.txt": [file] })).rejects.toThrow(
      "PENDING_PUBLICATION_CHANGED",
    );
    await expect(checkpoint("702", { "/by/unrelated": [file] })).rejects.toThrow(
      "INVALID_PUBLICATION_FILES",
    );
    await checkpoint("702", { "/by/a.txt": [file] });
    const authorized = {
      ...file,
      cloudResourceId: "60",
      resourceAuthorized: true,
      sourcePath: "/by/a.txt",
    };
    await expect(
      publish(id, "702", "attachment", [{ ...authorized, filePath: "/other" }]),
    ).rejects.toThrow("INVALID_PUBLICATION_FILES");
    await expect(
      publish(id, "702", "attachment", [{ ...authorized, fileId: "9007199254740993" }]),
    ).rejects.toThrow("INVALID_PUBLICATION_FILES");
    const result = await publish(id, "702", "attachment", [authorized]);
    expect(result.data.files).toEqual([{ ...file, cloudResourceId: "60" }]);
    const source = await new SqlForwardSourceAuthorityReader(sql, "10").readMessage(
      "21",
      "30",
      result.messageId,
    );
    expect(source.authority?.publicationFiles).toEqual([{ ...file, cloudResourceId: "60" }]);
    await expect(prepare(id, "702", "same version reused")).rejects.toThrow(
      "PENDING_PUBLICATION_CHANGED",
    );
  });
});
