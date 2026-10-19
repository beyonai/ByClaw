import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SqlForwardSourceAuthorityReader } from "../src/infrastructure/persistence/group-forward-source-authority.js";
let db: DatabaseSync;
let reader: SqlForwardSourceAuthorityReader;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`ATTACH DATABASE ':memory:' AS byai;
    CREATE TABLE byai.byai_session(session_id TEXT,enterprise_id TEXT,session_type TEXT,state TEXT,creator_id TEXT,project_id TEXT);
    CREATE TABLE byai.byai_session_member(session_id TEXT,mem_obj_type TEXT,mem_obj_id TEXT,com_acct_id TEXT);
    CREATE TABLE byai.byai_message(message_id TEXT,enterprise_id TEXT,session_id TEXT,usage INTEGER,creator_id TEXT,creator_name TEXT,message_content TEXT,create_time TEXT,related_resources TEXT,metadata TEXT,recalled_at TEXT,archived_at TEXT);
    CREATE TABLE byai.byai_group_chat_task(task_session_id TEXT,group_session_id TEXT,initiator_user_id TEXT);
    CREATE TABLE byai.byai_group_chat_task_publication(task_session_id TEXT,group_session_id TEXT,message_id TEXT,files_json TEXT);
    CREATE TABLE byai.byai_group_chat_forward_item(item_id TEXT,enterprise_id TEXT,target_id TEXT,bound_message_id TEXT,ordinal INTEGER,source_message_id TEXT,content TEXT,speaker_json TEXT,source_created_at TEXT,references_json TEXT,attachments_json TEXT);
    CREATE TABLE byai.byai_group_chat_forward_target(target_id TEXT,enterprise_id TEXT,target_session_id TEXT,state TEXT,checkpoint_json TEXT,message_ids_json TEXT);
    INSERT INTO byai.byai_session VALUES('30','10','hs_as','ACTIVE','99','50');
    INSERT INTO byai.byai_session_member VALUES('30','USER','20','10');
    INSERT INTO byai.byai_message VALUES('9007199254740993','10','30',1,'21','sender','body','2026-10-16T00:00:00Z','{}','{}',NULL,NULL);`);
  reader = new SqlForwardSourceAuthorityReader(
    {
      query: async (sql, parameters = []) => {
        const values: any[] = [];
        const adapted = sql.replace(/\$(\d+)/g, (_, index) => {
          values.push(parameters[Number(index) - 1]);
          return "?";
        });
        return db.prepare(adapted).all(...values);
      },
    },
    "10",
  );
});
afterEach(() => db.close());
it("reads actual source tenant and preserves bigint strings without sender ownership inference", async () => {
  const source = await reader.readMessage("20", "30", "9007199254740993");
  expect(source.id).toBe("9007199254740993");
  expect(source.authority?.actor).toEqual({ userId: "20", enterpriseId: "10" });
  expect(source.speaker.id).toBe("21");
  expect(source.authority?.sourceSessionId).toBe("30");
});
it.each([null, "11"])("reads historical message enterprise %s using authorized session", async (enterprise) => {
  db.prepare("UPDATE byai.byai_message SET enterprise_id=?").run(enterprise);
  const source = await reader.readMessage("20", "30", "9007199254740993");
  expect(source.id).toBe("9007199254740993");
  expect(source.authority?.actor.enterpriseId).toBe("10");
});
it("rejects a message belonging to another session", async () => {
  db.exec("UPDATE byai.byai_message SET session_id='31'");
  await expect(reader.readMessage("20", "30", "9007199254740993")).rejects.toMatchObject({
    code: "RESOURCE_NOT_ACCESSIBLE",
  });
});
it("rejects a source group belonging to another tenant", async () => {
  db.exec("UPDATE byai.byai_session SET enterprise_id='11'");
  await expect(reader.readMessage("20", "30", "9007199254740993")).rejects.toMatchObject({
    code: "RESOURCE_NOT_ACCESSIBLE",
  });
});
it("published cloud files are available to authorized group members without private task access", async () => {
  db.exec(`INSERT INTO byai.byai_group_chat_task VALUES('40','30','22');
    INSERT INTO byai.byai_group_chat_task_publication VALUES('40','30','9007199254740993','[{"filePath":"/published.txt","cloudResourceId":"60"}]');
    UPDATE byai.byai_message SET metadata='{"scene":"GROUP_CHAT","kind":"TASK_RESULT","taskId":"40","files":[{"filePath":"/published.txt","cloudResourceId":"60"}]}';`);
  const source = await reader.readMessage("20", "30", "9007199254740993");
  expect(source.authority?.publicationFiles[0]?.cloudResourceId).toBe("60");
  expect(source.authority?.publicationFiles[0]?.fileId).toBeUndefined();
});
it("rejects private task upload sessions even for their initiator", async () => {
  db.exec(`INSERT INTO byai.byai_session VALUES('40','10','h_as','GROUP_TASK','20',NULL);
    INSERT INTO byai.byai_group_chat_task VALUES('40','30','20');`);
  await expect(reader.requireUploadSession("20", "40")).rejects.toMatchObject({
    code: "RESOURCE_NOT_ACCESSIBLE",
  });
});
it("current forwarded card resolves stored item attachment without original message rows", async () => {
  db.exec(
    `UPDATE byai.byai_message SET metadata='{"scene":"GROUP_CHAT","kind":"FORWARD_MERGED"}';`,
  );
  const common = {
    fileId: "72",
    fileName: "file.txt",
    filePath: "/.sessions/30/forwards/copy/file.txt",
    fileUrl:
      "/commonFile/preview?style=minio&bucketName=byclaw-owner&filePath=%2F.sessions%2F30%2Fforwards%2Fcopy%2Ffile.txt",
    size: 4,
  };
  const cloud = {
    fileName: "published.txt",
    filePath: "/group-forward-files/copy/published.txt",
    cloudResourceId: "60",
    size: 5,
  };
  db.prepare(
    "INSERT INTO byai.byai_group_chat_forward_target VALUES('70','10','30','SUCCEEDED',?,?)",
  ).run(JSON.stringify({}), JSON.stringify(["9007199254740993"]));
  db.prepare(
    "INSERT INTO byai.byai_group_chat_forward_item VALUES('71','10','70','9007199254740993',0,'999','old provenance',?,?,'[]',?)",
  ).run(
    JSON.stringify({ type: "USER", id: "23", name: "original" }),
    "2026-10-16T00:00:00Z",
    JSON.stringify([common, cloud]),
  );
  const source = await reader.readMessage("20", "30", "9007199254740993");
  expect(source.mergedItems[0]?.id).toBe("999");
  expect(source.mergedItems[0]?.authority?.selectedMessageId).toBe("9007199254740993");
  expect(source.mergedItems[0]?.relatedResources.files).toEqual([
    { fileId: "72", fileName: "file.txt", filePath: common.filePath },
  ]);
  expect(source.mergedItems[0]?.authority?.publicationFiles[0]?.cloudResourceId).toBe("60");
  expect(source.mergedItems[0]?.metadata.files).toEqual([
    { fileName: "published.txt", filePath: cloud.filePath, cloudResourceId: "60" },
  ]);
  db.exec("UPDATE byai.byai_group_chat_forward_target SET state='FAILED'");
  await expect(reader.readMessage("20", "30", "9007199254740993")).rejects.toMatchObject({
    code: "FORWARD_RESOURCE_UNRESOLVABLE",
  });
});
it("typed folders keep their name with no candidate or remote authority request", async () => {
  db.exec(
    `UPDATE byai.byai_message SET metadata='{"resourceList":[{"id":"COMMON_FOLDER_opaque","resourceType":"COMMON_FOLDER","resourceId":"/private","resourceName":"folder"}]}';`,
  );
  const source = await reader.readMessage("20", "30", "9007199254740993");
  const { freezeSource } = await import("../src/application/group-forward-snapshot.js");
  expect(freezeSource({ userId: "20", enterpriseId: "10" }, "30", [source]).candidates).toEqual([]);
});

it("ordinary forwarded single remains ordinary while retaining current ordinary item file authority", async () => {
  db.exec(`UPDATE byai.byai_message SET metadata='{"scene":"GROUP_CHAT","kind":"FORWARD_SINGLE"}';
    INSERT INTO byai.byai_group_chat_forward_target VALUES('70','10','30','SUCCEEDED','{"copiedObjects":[]}','["9007199254740993"]');
    INSERT INTO byai.byai_group_chat_forward_item VALUES('71','10','70','9007199254740993',0,'999','body','{"type":"USER","id":"23","name":"original"}','2026-10-16T00:00:00Z','[]','[]');`);
  const source = await reader.readMessage("20", "30", "9007199254740993");
  expect(source.mergedItems).toEqual([]);
  expect(source.authority?.currentItemId).toBe("71");
  expect(source.id).toBe("9007199254740993");
  expect(source.content).toBe("body");
  expect(source.speaker.id).toBe("21");
  const { freezeSource } = await import("../src/application/group-forward-snapshot.js");
  const frozen = freezeSource({ userId: "20", enterpriseId: "10" }, "30", [source]);
  expect(frozen.items[0]?.selectedMergedCard).toBe(false);
  expect(frozen.items[0]?.speaker.id).toBe("21");
});

it("private task ancestor cannot authorize an ordinary-looking child upload session", async () => {
  db.exec(`ALTER TABLE byai.byai_session ADD COLUMN parent_session_id TEXT;
    INSERT INTO byai.byai_session VALUES('40','10','h_as','GROUP_TASK','20',NULL,NULL);
    INSERT INTO byai.byai_session VALUES('41','10','h_as','ACTIVE','20',NULL,'40');
    INSERT INTO byai.byai_group_chat_task VALUES('40','30','20');`);
  await expect(reader.requireUploadSession("20", "41")).rejects.toMatchObject({
    code: "RESOURCE_NOT_ACCESSIBLE",
  });
});
it("bounded resourceCode parsing preserves numeric dataset hint without persisting secrets", async () => {
  db.prepare("UPDATE byai.byai_message SET metadata=?").run(
    JSON.stringify({
      resourceList: [
        {
          id: "KG_DOC_FILE_x",
          resourceId: "opaque",
          resourceName: "label",
          resourceType: "KG_DOC_FILE",
          resourceCode: JSON.stringify({ datasetId: 60, directoryPath: "/file", token: "secret" }),
        },
      ],
    }),
  );
  const source = await reader.readMessage("20", "30", "9007199254740993");
  expect(source.resourceList[0]?.datasetId).toBe("60");
  expect(JSON.stringify(source)).not.toContain("secret");
});
it("uses only a matching surviving publication checkpoint for missing historical cloud binding", async () => {
  db.exec(`ALTER TABLE byai.byai_group_chat_task_publication ADD COLUMN pending_publication_id TEXT;
    CREATE TABLE byai.byai_group_chat_pending_publication(task_session_id TEXT,pending_publication_id TEXT,cloud_resource_id TEXT,uploaded_files_json TEXT);
    INSERT INTO byai.byai_group_chat_task_publication VALUES('40','30','9007199254740993','[{"filePath":"/published.txt"}]','44');
    INSERT INTO byai.byai_group_chat_pending_publication VALUES('40','44','60','{"/by/private.txt":[{"filePath":"/published.txt"}]}');
    UPDATE byai.byai_message SET metadata='{"scene":"GROUP_CHAT","kind":"TASK_RESULT","taskId":"40","files":[{"filePath":"/published.txt"}]}';`);
  expect(
    (await reader.readMessage("20", "30", "9007199254740993")).authority?.publicationFiles[0]
      ?.cloudResourceId,
  ).toBe("60");
  db.exec("UPDATE byai.byai_group_chat_pending_publication SET pending_publication_id='45'");
  expect(
    (await reader.readMessage("20", "30", "9007199254740993")).authority?.publicationFiles[0]
      ?.cloudResourceId,
  ).toBeUndefined();
});
it("name-only references use the snapshot byte limit rather than the attachment count limit", async () => {
  const refs = Array.from({ length: 101 }, (_, index) => ({
    id: `COMMON_FOLDER_${index}`,
    resourceType: "COMMON_FOLDER",
    resourceId: `/folder${index}`,
    resourceName: `folder${index}`,
  }));
  db.prepare("UPDATE byai.byai_message SET metadata=?").run(JSON.stringify({ resourceList: refs }));
  expect((await reader.readMessage("20", "30", "9007199254740993")).resourceList).toHaveLength(101);
});
