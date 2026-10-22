import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type HttpServices } from "../src/interfaces/http/app.js";
import { SqlGroupForwardStore } from "../src/infrastructure/persistence/group-forward-prepare.js";
import { config } from "./fixtures.js";

const headers = { "x-enterprise-id": "10", "x-tenant-generation": "7", "x-actor-user-id": "20" };
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
const base = "/internal/v1/group-chats/30";
const operation = { requestId: "9007199254740993", state: "RUNNING", targets: [] };
const uploadedFile = {
  fileId: "88",
  fileName: "文件.txt",
  filePath: "/.sessions/30/forwards/copy/文件.txt",
  fileUrl:
    "/commonFile/preview?filePath=%2F.sessions%2F30%2Fforwards%2Fcopy%2F%E6%96%87%E4%BB%B6.txt",
  mediaType: "text/plain",
  size: 3,
};
function setup() {
  let state = "visible",
    member = true;
  const queries: string[] = [];
  const query = async (sql: string, args: unknown[] = []): Promise<any[]> => {
    queries.push(sql);
    if (sql.includes("FROM byai.byai_session WHERE"))
      return args[0] === "30"
        ? [{ session_id: "30", enterprise_id: "10", session_type: "hs_as", state: "ACTIVE" }]
        : [];
    if (sql.includes("FROM byai.byai_session_member"))
      return member && args[1] === "20" ? [{ mem_obj_id: "20" }] : [];
    if (sql.includes("FROM byai.byai_message"))
      return state !== "deleted" && args.includes("40")
        ? [
            {
              message_id: "40",
              enterprise_id: "10",
              session_id: "30",
              usage: 1,
              recalled_at: state === "recalled" ? new Date() : null,
              archived_at: state === "archived" ? new Date() : null,
            },
          ]
        : [];
    if (sql.includes("JOIN byai.byai_group_chat_forward_target"))
      return [0, 1].map((i) => ({
        item_id: String(70 + i),
        target_id: "60",
        snapshot_version: 1,
        message_ids_json: '["40"]',
        ordinal: i,
        selected_message_id: "100",
        selected_merged_card: false,
        source_message_id: "100",
        content: "{{opaque}}",
        speaker_json: '{"type":"USER","id":"20","name":"Sender"}',
        source_created_at: "2026-10-16T00:00:00Z",
        references_json: JSON.stringify([
          {
            id: "opaque",
            resourceId: "/by" + uploadedFile.filePath,
            resourceName: uploadedFile.fileName,
            resourceType: "COMMON_FILE",
          },
        ]),
        attachments_json: JSON.stringify(i ? [] : [uploadedFile]),
      }));
    throw new Error(`Unexpected source/SQL read: ${sql}`);
  };
  const forwards: any = new SqlGroupForwardStore({ write: async (work) => work({ query }) }, "10");
  forwards.prepare = vi.fn(async () => operation);
  forwards.status = vi.fn(async () => operation);
  forwards.completeText = vi.fn(async () => operation);
  forwards.retry = vi.fn(async () => operation);
  forwards.inspect = vi.fn(async () => ({
    actor: { userId: "20", enterpriseId: "10" },
    sourceSessionId: "30",
  }));
  forwards.listTargets = vi.fn(async () => ({
    pageNum: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    list: [],
  }));
  const services = {
    forwards,
    history: {},
    commands: {},
    sessions: {},
    schema: {},
    connected: () => true,
    ready: () => true,
    provisioned: () => true,
    schemaState: () => ({}),
    health: () => ({}),
  } as unknown as HttpServices;
  const app = createApp(config, services, undefined, { verifyClient: () => {}, logger: false });
  apps.push(app);
  return {
    app,
    forwards,
    queries,
    hide: (value: string) => {
      state = value;
    },
    leave: () => {
      member = false;
    },
  };
}
describe("forwarding HTTP contracts", () => {
  it("returns completed text receipts in the create response and retains accepted work on uncertainty", async () => {
    const s = setup();
    const completed = {
      ...operation,
      state: "SUCCEEDED",
      targets: [{ targetSessionId: "50", state: "SUCCEEDED", messageIds: ["9007199254740994"] }],
    };
    s.forwards.completeText.mockResolvedValueOnce(completed);
    const request = {
      method: "POST" as const,
      url: `${base}/forward-requests`,
      headers,
      payload: {
        clientRequestId: "fast",
        mode: "SINGLE",
        messageIds: ["40"],
        targetSessionIds: ["50"],
      },
    };
    const success = await s.app.inject(request);
    expect(success.statusCode).toBe(202);
    expect(success.json()).toEqual(completed);
    s.forwards.completeText.mockRejectedValueOnce(new Error("COMMIT_UNCERTAIN"));
    const deferred = await s.app.inject(request);
    expect(deferred.statusCode).toBe(202);
    expect(deferred.json()).toEqual(operation);
  });
  it("exposes accepted create, bound status/retry and strict candidate input", async () => {
    const s = setup();
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: `${base}/forward-requests`,
          headers,
          payload: {
            clientRequestId: "k",
            mode: "SINGLE",
            messageIds: ["40"],
            targetSessionIds: ["50"],
          },
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await s.app.inject({ url: `${base}/forward-requests/${operation.requestId}`, headers })
      ).json(),
    ).toEqual(operation);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: `${base}/forward-requests/${operation.requestId}/retry`,
          headers,
          payload: { targetSessionIds: ["50"], actor: "21" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.app.inject({
          url: `${base}/forward-requests/${operation.requestId}`,
          headers: { ...headers, "x-actor-user-id": "21" },
        })
      ).statusCode,
    ).toBe(404);
    for (const payload of [
      { clientRequestId: "k", mode: "SINGLE", messageIds: [40], targetSessionIds: ["50"] },
      {
        clientRequestId: "k",
        mode: "SINGLE",
        messageIds: ["40"],
        targetSessionIds: ["50"],
        enterpriseId: "10",
      },
    ])
      expect(
        (await s.app.inject({ method: "POST", url: `${base}/forward-requests`, headers, payload }))
          .statusCode,
      ).toBe(400);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: `${base}/forward-requests/${operation.requestId}/retry`,
          headers,
          payload: { targetSessionIds: ["50"] },
        })
      ).statusCode,
    ).toBe(200);
    expect((await s.app.inject({ url: `${base}/forward-targets`, headers })).json()).toMatchObject({
      pageNum: 1,
      pageSize: 20,
    });
    for (const suffix of ["?enterpriseId=10", "?pageNum=0", "?pageSize=0", "?pageSize=101"])
      expect(
        (await s.app.inject({ url: `${base}/forward-targets${suffix}`, headers })).statusCode,
      ).toBe(400);
  });
  it("targetMemberNeedsNoSourceMembership and only exposes item-local whitelists", async () => {
    const s = setup();
    const response = await s.app.inject({
      url: `${base}/messages/40/forward-items?pageSize=1`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].attachments).toEqual([
      { ...uploadedFile, cloudResourceId: null },
    ]);
    expect(response.body).not.toMatch(/checkpoint|reservationOwner|attemptId/);
    expect(response.json().items[0].content).toBe("{{opaque}}");
    expect(response.json().hasMore).toBe(true);
    const cursor = response.json().nextCursor;
    expect(
      (
        await s.app.inject({ url: `${base}/messages/40/forward-items?cursor=${cursor}`, headers })
      ).json().items,
    ).toHaveLength(1);
    expect(
      (await s.app.inject({ url: `${base}/messages/41/forward-items?cursor=${cursor}`, headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (await s.app.inject({ url: `${base}/messages/40/forward-items?pageSize=0`, headers }))
        .statusCode,
    ).toBe(400);
    s.leave();
    expect(
      (await s.app.inject({ url: `${base}/messages/40/forward-items`, headers })).statusCode,
    ).toBe(404);
  });
  it("doesNotExposeASpecialAttachmentDownloadRoute", async () => {
    const s = setup();
    expect(
      (await s.app.inject({ url: `${base}/messages/40/forward-attachments/file`, headers }))
        .statusCode,
    ).toBe(404);
  });
  it("recalledArchivedDeletedTargetCannotExpand", async () => {
    for (const state of ["recalled", "archived", "deleted"]) {
      const s = setup();
      s.hide(state);
      for (const route of ["forward-items"])
        expect(
          (await s.app.inject({ url: `${base}/messages/40/${route}`, headers })).statusCode,
        ).toBe(404);
    }
  });
});

// Exercise the real pg/TypeORM row reader; all test DDL/data is rolled back in the isolated local DB.
describe.skipIf(!process.env.FORWARD_TEST_PG)("production forwarding bigint readers", () => {
  it("preserves source, target and message IDs above 2^53 over actual HTTP", async () => {
    const url = new URL(process.env.FORWARD_TEST_PG!);
    if (
      url.hostname !== "127.0.0.1" ||
      url.port !== "15486" ||
      url.pathname !== "/byclaw_forward_test"
    )
      throw new Error("isolated local forwarding DB required");
    const { Database } = await import("../src/infrastructure/persistence/database.js");
    const { snapshot } = await import("./fixtures.js");
    const database = await Database.open(
      snapshot({
        host: url.hostname,
        port: Number(url.port),
        database: "byclaw_forward_test",
        user: decodeURIComponent(url.username),
      }),
      decodeURIComponent(url.password),
    );
    const source = "9007199254740993",
      target = "9007199254740995",
      message = "9007199254740997",
      user = "9007199254740999",
      project = "9007199254741001";
    const rollback = new Error("fixture rollback");
    try {
      await database
        .transaction(async (db) => {
          await db.query("CREATE SCHEMA IF NOT EXISTS byai");
          await db.query(
            "DROP TABLE IF EXISTS byai.byai_group_chat_forward_item,byai.byai_group_chat_forward_target,byai.byai_group_chat_forward_request,byai.byai_message,byai.byai_session_member,byai.byai_session CASCADE",
          );
          for (const statement of `CREATE TABLE byai.byai_session(session_id BIGINT,enterprise_id BIGINT,session_type TEXT,state TEXT,session_name TEXT,project_id BIGINT,update_time TIMESTAMP,create_time TIMESTAMP);
          CREATE TABLE byai.byai_session_member(session_id BIGINT,mem_obj_type TEXT,mem_obj_id BIGINT,com_acct_id BIGINT,user_role TEXT);
          CREATE TABLE byai.byai_message(message_id BIGINT,session_id BIGINT,enterprise_id BIGINT,usage INT,recalled_at TIMESTAMP,archived_at TIMESTAMP,create_time TIMESTAMP);
          CREATE TABLE byai.byai_group_chat_forward_request(request_id BIGINT,enterprise_id BIGINT,snapshot_version INT,backend TEXT);
          CREATE TABLE byai.byai_group_chat_forward_target(target_id BIGINT,request_id BIGINT,enterprise_id BIGINT,target_session_id BIGINT,state TEXT,message_ids_json TEXT,checkpoint_json TEXT);
          CREATE TABLE byai.byai_group_chat_forward_item(item_id BIGINT,target_id BIGINT,request_id BIGINT,enterprise_id BIGINT,bound_message_id BIGINT,selected_message_id BIGINT,selected_merged_card BOOLEAN,source_message_id BIGINT,ordinal INT,content TEXT,speaker_json TEXT,source_created_at TIMESTAMP,references_json TEXT,attachments_json TEXT);`
            .split(";")
            .filter((s) => s.trim()))
            await db.query(statement);
          for (const id of [source, target]) {
            await db.query(
              "INSERT INTO byai.byai_session VALUES($1,10,'hs_as','ACTIVE','team',$2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
              [id, project],
            );
            await db.query(
              "INSERT INTO byai.byai_session_member VALUES($1,'USER',$2,10,'MEMBER')",
              [id, user],
            );
          }
          await db.query(
            "INSERT INTO byai.byai_message VALUES($1,$2,10,1,NULL,NULL,CURRENT_TIMESTAMP)",
            [message, target],
          );
          const stored = {
            uploadedFile: {
              ...uploadedFile,
              filePath: `/.sessions/${target}/forwards/copy/文件.txt`,
            },
            targetSessionId: target,
            forwardTargetId: "9007199254741003",
            itemId: "9007199254741005",
          };
          await db.query(
            "INSERT INTO byai.byai_group_chat_forward_request VALUES(100,10,1,'TENANT')",
          );
          await db.query(
            "INSERT INTO byai.byai_group_chat_forward_target VALUES($1,100,10,$2,'SUCCEEDED',$3,$4)",
            [stored.forwardTargetId, target, JSON.stringify([message]), JSON.stringify({})],
          );
          await db.query(
            "INSERT INTO byai.byai_group_chat_forward_item VALUES($1,$2,100,10,$3,101,FALSE,101,0,'raw',$4,CURRENT_TIMESTAMP,'[]',$5)",
            [
              stored.itemId,
              stored.forwardTargetId,
              message,
              JSON.stringify({ type: "USER", id: user, name: "Member" }),
              JSON.stringify([stored.uploadedFile]),
            ],
          );
          const service = new SqlGroupForwardStore({ write: async (work) => work(db) }, "10");
          const app = createApp(
            config,
            {
              forwards: service,
              commands: {},
              history: {},
              sessions: {},
              schema: {},
              connected: () => true,
              ready: () => true,
              provisioned: () => true,
              schemaState: () => ({}),
              health: () => ({}),
            } as unknown as HttpServices,
            undefined,
            { verifyClient: () => {}, logger: false },
          );
          apps.push(app);
          const auth = { ...headers, "x-actor-user-id": user };
          expect(
            (await service.listTargets({ userId: user, enterpriseId: "10" }, source, 1, 20)).list[0]
              ?.sessionId,
          ).toBe(target);
          const candidates = await app.inject({
            url: `/internal/v1/group-chats/${source}/forward-targets`,
            headers: auth,
          });
          expect(candidates.statusCode).toBe(200);
          expect(candidates.json().list).toEqual([
            {
              sessionId: target,
              name: "team",
              enterpriseId: "10",
              projectId: project,
              role: "MEMBER",
            },
          ]);
          await db.query("UPDATE byai.byai_session SET session_name=$1 WHERE session_id=$2", [
            "literal%_\\",
            target,
          ]);
          expect(
            (
              await service.listTargets(
                { userId: user, enterpriseId: "10" },
                source,
                1,
                20,
                " %_\\ ",
              )
            ).list[0]?.sessionId,
          ).toBe(target);
          const page = await app.inject({
            url: `/internal/v1/group-chats/${target}/messages/${message}/forward-items`,
            headers: auth,
          });
          expect(page.statusCode).toBe(200);
          expect(page.json().items[0].itemId).toBe(stored.itemId);
          expect(page.json().items[0].speaker.id).toBe(user);
          expect(page.json().items[0].attachments).toEqual([
            { ...stored.uploadedFile, cloudResourceId: null },
          ]);
          throw rollback;
        })
        .catch((error) => {
          if (error !== rollback) throw error;
        });
    } finally {
      await database.close();
    }
  });
});
