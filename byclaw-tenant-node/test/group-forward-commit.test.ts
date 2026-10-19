import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { ConnectionManager } from "../src/application/connection-manager.js";
import { snapshot } from "./fixtures.js";
import type { TenantDatabase } from "../src/application/database-ports.js";
import { GroupForwardRepository } from "../src/infrastructure/persistence/group-forward-repository.js";
import { SqlGroupForwardStore } from "../src/infrastructure/persistence/group-forward-prepare.js";
import type {
  ForwardInput,
  TargetLease,
  SourceProof,
  PreparedAttachment,
} from "../src/application/group-forward-types.js";
const { Pool } = createRequire(import.meta.url)("pg");
const url = process.env.FORWARD_TEST_PG;
describe.skipIf(!url)("atomic final forwarding publication", () => {
  let pool: any, store: SqlGroupForwardStore;
  const actor = { userId: "30", enterpriseId: "1" };
  const input = (key = "key"): ForwardInput => ({
    clientRequestId: key,
    mode: "SINGLE",
    messageIds: ["9007199254741001", "9007199254741002"],
    targetSessionIds: ["20", "21"],
  });
  const sql = async (q: string, args: unknown[] = []) => (await pool.query(q, args)).rows;
  beforeAll(async () => {
    const address = new URL(url!);
    if (
      address.hostname !== "127.0.0.1" ||
      address.port !== "15486" ||
      address.pathname !== "/byclaw_forward_test"
    )
      throw new Error("isolated forwarding DB only");
    pool = new Pool({ connectionString: url, max: 5 });
    await sql(
      `CREATE SCHEMA IF NOT EXISTS byai; DROP TABLE IF EXISTS byai.byai_group_chat_forward_item,byai.byai_group_chat_forward_target,byai.byai_group_chat_forward_request CASCADE;`,
    );
    await sql(
      await readFile(
        new URL("../../deploy/migrations/versions/V0.6.0/tenant/V0.6.0__ddl.sql", import.meta.url),
        "utf8",
      ),
    );
    await sql(`CREATE SEQUENCE IF NOT EXISTS byai.seq_any_table START 1000;
     DROP TABLE IF EXISTS byai.byai_session_member,byai.byai_session,byai.byai_message,byai.byai_group_chat_task CASCADE;
     CREATE TABLE byai.byai_session(session_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_type TEXT,state TEXT,creator_id BIGINT,project_id BIGINT,last_seq BIGINT DEFAULT 0,update_time TIMESTAMP);
     CREATE TABLE byai.byai_session_member(byai_session_member_id BIGINT,session_id BIGINT,mem_obj_type TEXT,mem_obj_id BIGINT,com_acct_id BIGINT,mem_name TEXT DEFAULT 'Forwarder');
     CREATE TABLE byai.byai_message(message_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_id BIGINT,usage INTEGER,creator_id BIGINT,creator_name TEXT,message_content TEXT,create_time TIMESTAMP,related_resources TEXT,metadata TEXT,recalled_at TIMESTAMP,archived_at TIMESTAMP,id BIGINT,topic_id BIGINT,message_ref BIGINT,created_seq BIGINT,is_complete BOOLEAN,update_time TIMESTAMP,role TEXT,msg_status INT);
     CREATE TABLE byai.byai_group_chat_task(task_session_id BIGINT,group_session_id BIGINT,initiator_user_id BIGINT);`);
    store = new SqlGroupForwardStore(
      {
        write: async (work: any) => {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const result = await work({
              query: async (q: string, a?: unknown[]) => (await client.query(q, a)).rows,
            });
            await client.query("COMMIT");
            return result;
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }
        },
      },
      "1",
    );
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await sql(`TRUNCATE byai.byai_group_chat_forward_item,byai.byai_group_chat_forward_target,byai.byai_group_chat_forward_request,byai.byai_message,byai.byai_session_member,byai.byai_session;
 INSERT INTO byai.byai_session(session_id,enterprise_id,session_type,state,creator_id,project_id) VALUES(10,1,'hs_as','ACTIVE',30,NULL),(20,1,'hs_as','ACTIVE',30,NULL),(21,1,'hs_as','ACTIVE',30,NULL),(22,2,'hs_as','ACTIVE',30,NULL);
 INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id) VALUES(1,10,'USER',30,1),(2,20,'USER',30,1),(3,21,'USER',30,1);
 INSERT INTO byai.byai_message(message_id,enterprise_id,session_id,usage,creator_id,creator_name,message_content,create_time,related_resources,metadata,recalled_at,archived_at) VALUES(9007199254741001,1,10,1,30,'sender','later','2026-10-16 01:00:00','{}','{}',NULL,NULL),(9007199254741002,1,10,1,30,'sender','earlier','2026-10-16 00:00:00','{}','{}',NULL,NULL);`);
  });
  async function prepared() {
    const operation = await store.prepare(actor, "10", input());
    const targets = await sql(
      "SELECT * FROM byai.byai_group_chat_forward_target WHERE request_id=$1 ORDER BY target_id",
      [operation.requestId],
    );
    return { operation, targets };
  }
  async function frozen() {
    const p = await prepared();
    const lease = await store.claimRequest(
      p.operation.requestId,
      actor,
      "10",
      "source-claim",
      60000,
    );
    await store.freezeSources(lease, { proofs: [], resolutions: [] });
    return p;
  }
  async function ready(index = 0) {
    const p = await frozen();
    const lease = await store.claimTarget(
      p.operation.requestId,
      p.targets[index].target_id,
      actor,
      "10",
      "worker",
      60000,
    );
    return { ...p, lease: await store.markReady(lease) };
  }
  it("oneTargetCommitsAllOrNone", async () => {
    const { lease } = await ready();
    await sql(
      "ALTER TABLE byai.byai_message ADD CONSTRAINT fail_second CHECK (session_id=10 OR message_content<>'later')",
    );
    try {
      await expect(store.commit(lease)).rejects.toThrow();
    } finally {
      await sql("ALTER TABLE byai.byai_message DROP CONSTRAINT fail_second");
    }
    expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=20")).toHaveLength(0);
    expect(
      await sql(
        "SELECT * FROM byai.byai_group_chat_forward_item WHERE target_id=$1 AND bound_message_id IS NOT NULL",
        [lease.targetId],
      ),
    ).toHaveLength(0);
    expect(
      (
        await sql(
          "SELECT state,pending_delivery FROM byai.byai_group_chat_forward_target WHERE target_id=$1",
          [lease.targetId],
        )
      )[0],
    ).toEqual({ state: "READY", pending_delivery: false });
    expect(
      (await sql("SELECT last_seq FROM byai.byai_session WHERE session_id=20"))[0].last_seq,
    ).toBe("0");
    const result = await store.commit(lease);
    expect(result.messageIds).toHaveLength(2);
    const messages = await sql(
      "SELECT * FROM byai.byai_message WHERE session_id=20 ORDER BY created_seq",
    );
    expect(messages.map((m: any) => m.message_content)).toEqual(["earlier", "later"]);
    expect(messages.map((m: any) => m.topic_id)).toEqual(result.messageIds);
    expect(messages.every((m: any) => m.message_ref === null)).toBe(true);
    expect(JSON.parse(messages[0].metadata)).toEqual({
      scene: "GROUP_CHAT",
      kind: "FORWARD_SINGLE",
      forward: {
        forwardId: lease.targetId,
        mode: "SINGLE",
        resourceMode: "SNAPSHOT_ONLY",
        itemCount: 1,
      },
      resourceList: [],
    });
    await sql("DELETE FROM byai.byai_session_member WHERE session_id=10");
    expect(await store.commit(lease)).toEqual(result);
    expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=20")).toHaveLength(2);
  });
  it("differentTargetsFailIndependently", async () => {
    const { lease, targets, operation } = await ready();
    await store.commit(lease);
    const second = await store.markReady(
      await store.claimTarget(
        operation.requestId,
        targets[1].target_id,
        actor,
        "10",
        "worker2",
        60000,
      ),
    );
    await sql("DELETE FROM byai.byai_session_member WHERE session_id=21");
    await expect(store.commit(second)).rejects.toMatchObject({ code: "RESOURCE_NOT_ACCESSIBLE" });
    expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=20")).toHaveLength(2);
    expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=21")).toHaveLength(0);
  });
  it.each([
    "UPDATE byai.byai_message SET recalled_at=CURRENT_TIMESTAMP WHERE session_id=10",
    "DELETE FROM byai.byai_session_member WHERE session_id=10",
    "UPDATE byai.byai_session SET state='GROUP_DISSOLVED' WHERE session_id=20",
  ])("recallOrRemovalBeforeCommitRejects: %s", async (change) => {
    const { lease } = await ready();
    await sql(change);
    await expect(store.commit(lease)).rejects.toMatchObject({ code: "RESOURCE_NOT_ACCESSIBLE" });
    expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=20")).toHaveLength(0);
  });
  it("expiredWorkerCannotPublish", async () => {
    const { lease } = await ready();
    await sql(
      "UPDATE byai.byai_group_chat_forward_target SET lease_until=clock_timestamp()-interval '1 second' WHERE target_id=$1",
      [lease.targetId],
    );
    await expect(store.commit(lease)).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=20")).toHaveLength(0);
  });
  it("expiredLeaseAfterWaitingForTheRealGroupLockCannotPublish", async () => {
    const { lease } = await ready();
    const blocker = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["session:10"]);
      await sql(
        "UPDATE byai.byai_group_chat_forward_target SET lease_until=clock_timestamp()+interval '500 milliseconds' WHERE target_id=$1",
        [lease.targetId],
      );
      // Convert rejection into data while blocked, so no background unhandled rejection can hide an early failure.
      pending = store.commit(lease).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await expect
        .poll(
          async () =>
            Number(
              (
                await sql(
                  "SELECT count(*) AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
                  [pid],
                )
              )[0].n,
            ),
          { timeout: 3000 },
        )
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await sql(
                "SELECT lease_until<clock_timestamp() AS expired FROM byai.byai_group_chat_forward_target WHERE target_id=$1",
                [lease.targetId],
              )
            )[0].expired,
          { timeout: 3000 },
        )
        .toBe(true);
      await blocker.query("ROLLBACK");
      expect(await pending).toMatchObject({ error: { code: "FORWARD_LEASE_LOST" } });
      expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=20")).toHaveLength(0);
      expect(
        (
          await sql(
            "SELECT state,pending_delivery FROM byai.byai_group_chat_forward_target WHERE target_id=$1",
            [lease.targetId],
          )
        )[0],
      ).toEqual({ state: "READY", pending_delivery: false });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });
  it("preservesCurrentMaintenanceAndChecksPersistedTargetBinding", async () => {
    const { lease } = await ready();
    await sql(
      `UPDATE byai.byai_group_chat_forward_target SET checkpoint_json=jsonb_set(checkpoint_json::jsonb,'{maintenance}','{"schemaVersion":1,"delivery":{"future":true}}'::jsonb)::text WHERE target_id=$1`,
      [lease.targetId],
    );
    await expect(store.commit({ ...lease, targetSessionId: "21" })).rejects.toMatchObject({
      code: "RESOURCE_NOT_ACCESSIBLE",
    });
    await store.commit(lease);
    expect(
      JSON.parse(
        (
          await sql(
            "SELECT checkpoint_json FROM byai.byai_group_chat_forward_target WHERE target_id=$1",
            [lease.targetId],
          )
        )[0].checkpoint_json,
      ).maintenance,
    ).toEqual({ schemaVersion: 1, delivery: { future: true } });
  });
  it.each(["SINGLE", "MERGED", "SELECTED_CARD"])(
    "bindsActualMessageAttachmentUrlsAndKeepsCardFilesPrivate: %s",
    async (mode) => {
      let { lease } = await ready();
      const items = await sql(
        "SELECT * FROM byai.byai_group_chat_forward_item WHERE target_id=$1 ORDER BY ordinal",
        [lease.targetId],
      );
      if (mode === "MERGED")
        await sql(
          "UPDATE byai.byai_group_chat_forward_request SET mode='MERGED' WHERE request_id=$1",
          [lease.requestId],
        );
      if (mode === "SELECTED_CARD")
        await sql(
          "UPDATE byai.byai_group_chat_forward_item SET selected_message_id=$1,selected_merged_card=TRUE WHERE target_id=$2",
          [items[0].selected_message_id, lease.targetId],
        );
      const attachments: PreparedAttachment[] = items.map((item: any, index: number) => ({
        targetId: lease.targetId,
        itemId: item.item_id,
        attachmentId: String(800 + index),
        sourceId: "proof",
        candidateIds: [],
        referenceKeys: ["shared"],
      }));
      const proof = {
        sourceId: "proof",
        identity: {
          enterpriseId: "1",
          ownerId: null,
          storageType: "file",
          scopeId: "owner",
          path: "/file.txt",
          immutableVersion: null,
        },
        size: 3,
        sha256: "a".repeat(64),
      };
      const attempts = attachments.map((a) => ({
        sourceId: "proof",
        state: "VERIFIED",
        object: {
          enterpriseId: "1",
          targetSessionId: "20",
          forwardTargetId: lease.targetId,
          itemId: a.itemId,
          attachmentId: a.attachmentId,
          attemptId: "attempt" + a.attachmentId,
          fileName: "file.txt",
          contentType: "text/plain",
          size: 3,
          sha256: proof.sha256,
          createdAt: new Date().toISOString(),
          uploadedFile: {
            fileId: a.attachmentId,
            fileName: "Name" + attachments.indexOf(a),
            filePath: `/.sessions/20/forwards/${a.itemId}/file.txt`,
            fileUrl: `/commonFile/preview?filePath=${encodeURIComponent(`/.sessions/20/forwards/${a.itemId}/file.txt`)}`,
          },
        },
      }));
      await sql(
        "UPDATE byai.byai_group_chat_forward_request SET source_manifest_json=$1 WHERE request_id=$2",
        [
          JSON.stringify({
            version: 1,
            candidates: [],
            slots: [],
            resolutions: [],
            proofs: [proof],
            attachments,
          }),
          lease.requestId,
        ],
      );
      await sql(
        "UPDATE byai.byai_group_chat_forward_target SET state='COPYING',checkpoint_json=$1 WHERE target_id=$2",
        [JSON.stringify({ maintenance: { schemaVersion: 1 } }), lease.targetId],
      );
      lease = { ...lease, state: "COPYING" };
      for (const attempt of attempts) {
        lease = await store.checkpointAttachment(lease, lease.fencingVersion, {
          phase: "RESERVE",
          sourceId: "proof",
          object: { ...attempt.object, size: 0, sha256: null },
        });
        lease = await store.checkpointAttachment(lease, lease.fencingVersion, {
          phase: "VERIFY",
          sourceId: "proof",
          object: attempt.object,
        });
      }
      lease = await store.markReady(lease);
      for (const [index, item] of items.entries())
        await sql(
          "UPDATE byai.byai_group_chat_forward_item SET content=$1,references_json=$2 WHERE item_id=$3",
          [
            "{{shared}}" + "😀".repeat(125),
            JSON.stringify([
              {
                id: "shared",
                resourceId: "opaque",
                resourceName: "Name" + index,
                resourceType: "COMMON_FILE",
              },
            ]),
            item.item_id,
          ],
        );
      const result = await store.commit(lease);
      expect(result.messageIds).toHaveLength(mode === "SINGLE" ? 2 : 1);
      const saved = await sql(
        "SELECT * FROM byai.byai_group_chat_forward_item WHERE target_id=$1 ORDER BY ordinal",
        [lease.targetId],
      );
      for (const [index, item] of saved.entries()) {
        const files = JSON.parse(item.attachments_json),
          refs = JSON.parse(item.references_json);
        expect(files[0].fileId).toBe(String(800 + index));
        expect(files[0].fileUrl).toBe(
          `/commonFile/preview?filePath=${encodeURIComponent(`/.sessions/20/forwards/${item.item_id}/file.txt`)}`,
        );
        expect(refs[0].id).toBe("COMMON_FILE_" + String(800 + index));
        expect(refs[0].resourceId).toBe("/by" + files[0].filePath);
        expect(item.content.startsWith(`{{${refs[0].id}}}`)).toBe(true);
      }
      const messages = await sql(
        "SELECT * FROM byai.byai_message WHERE session_id=20 ORDER BY created_seq",
      );
      const meta = JSON.parse(messages[0].metadata);
      if (mode !== "SINGLE") {
        expect(messages[0].message_content).toBe("聊天记录（2 条）");
        expect(messages[0].related_resources).toBeNull();
        expect(meta.resourceList).toEqual([]);
        expect(meta.forward.mode).toBe(mode === "MERGED" ? "MERGED" : "SINGLE");
        expect(meta.forward.preview).toHaveLength(2);
        expect(meta.forward.preview[0].content.startsWith("Name0")).toBe(true);
        expect(Array.from(meta.forward.preview[0].content)).toHaveLength(120);
      } else expect(JSON.parse(messages[0].related_resources).files[0].fileId).toBe("800");
    },
  );
  it("requiredUnverifiedAttachmentCannotPublish", async () => {
    const { lease } = await ready();
    // A required attachment with no live VERIFIED attempt cannot be authorized by READY alone.
    await sql(
      `UPDATE byai.byai_group_chat_forward_request SET source_manifest_json=$1 WHERE request_id=$2`,
      [
        JSON.stringify({
          version: 1,
          candidates: [],
          slots: [],
          resolutions: [],
          proofs: [
            { sourceId: "proof", identity: { enterpriseId: "1" }, size: 1, sha256: "a".repeat(64) },
          ],
          attachments: [
            {
              targetId: lease.targetId,
              itemId: "item",
              attachmentId: "file",
              sourceId: "proof",
              candidateIds: [],
              referenceKeys: [],
            },
          ],
        }),
        lease.requestId,
      ],
    );
    await expect(store.commit(lease)).rejects.toMatchObject({
      code: "FORWARD_ATTACHMENTS_INCOMPLETE",
    });
    expect(await sql("SELECT * FROM byai.byai_message WHERE session_id=20")).toHaveLength(0);
  });
});
