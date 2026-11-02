import { disposableRedis } from "./support/disposable-redis.js";
import type { RedisLease } from "../src/infrastructure/coordination/redis-leases.js";
import { describe, it, expect } from "vitest";
import { pendingMessages, recordDelivery } from "../src/application/group-forward-maintenance.js";

describe("durable forward maintenance", () => {
  it("partialDeliveredBatchResumesWithoutRecreate", () => {
    const checkpoint: any = { unrelated: { retained: true } };
    recordDelivery(checkpoint, "901", "ENQUEUED", new Date(0));
    expect(pendingMessages(checkpoint, ["901", "902"])).toEqual(["902"]);
    expect(checkpoint.unrelated).toEqual({ retained: true });
    recordDelivery(checkpoint, "902", "SUPPRESSED", new Date(0));
    expect(pendingMessages(checkpoint, ["901", "902"])).toEqual([]);
  });
  it("rejects unknown maintenance versions", () => {
    expect(() => pendingMessages({ maintenance: { schemaVersion: 99 } } as any, ["901"])).toThrow(
      "FORWARD_MAINTENANCE_INVALID",
    );
  });
});

import { beforeAll, beforeEach, afterAll } from "vitest";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { GroupForwardRecoveryStore } from "../src/infrastructure/persistence/group-forward-recovery.js";
const { Pool } = createRequire(import.meta.url)("pg");
const pg = process.env.FORWARD_TEST_PG;
describe.skipIf(!pg)("real owning-db recovery", () => {
  let coordination: Awaited<ReturnType<typeof disposableRedis>>;
  let pool: any, store: GroupForwardRecoveryStore;
  const locator = { enterpriseId: "1", requestId: "100", backend: "TENANT" as const };
  const sql = async (q: string, a: unknown[] = []) => (await pool.query(q, a)).rows;
  beforeAll(async () => {
    const address = new URL(pg!);
    if (
      address.hostname !== "127.0.0.1" ||
      address.port !== "15486" ||
      address.pathname !== "/byclaw_forward_test"
    )
      throw new Error("isolated forwarding DB only");
    coordination = await disposableRedis();
    pool = new Pool({ connectionString: pg, max: 5 });
    await sql("DROP SCHEMA IF EXISTS byai CASCADE");
    await sql(
      await readFile(
        new URL(
          "../../deploy/migrations/versions/V0.6.0/tenant/V0.6.0__baseline__ddl.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await sql(`DROP TABLE IF EXISTS byai.byai_session,byai.byai_session_member,byai.byai_message,byai.byai_group_chat_task,byai.byai_group_chat_message_ack CASCADE;
      CREATE TABLE byai.byai_session(session_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_type TEXT,state TEXT);
      CREATE TABLE byai.byai_session_member(byai_session_member_id BIGINT,session_id BIGINT,mem_obj_type TEXT,mem_obj_id BIGINT,com_acct_id BIGINT,user_role TEXT);
      CREATE TABLE byai.byai_message(message_id BIGINT PRIMARY KEY,session_id BIGINT,enterprise_id BIGINT,usage INT,message_content TEXT,metadata TEXT,related_resources TEXT,creator_id BIGINT,creator_name TEXT,create_time TIMESTAMP,recalled_at TIMESTAMP,recalled_by BIGINT,archived_at TIMESTAMP,is_complete BOOLEAN);
      CREATE TABLE byai.byai_group_chat_task(task_session_id BIGINT,group_session_id BIGINT,create_time TIMESTAMP);
      CREATE TABLE byai.byai_group_chat_message_ack(session_id BIGINT,message_id BIGINT,user_id BIGINT,user_name TEXT,acknowledged_at TIMESTAMP);`);
    store = new GroupForwardRecoveryStore(
      {
        write: async (work: any) => {
          const c = await pool.connect();
          const held = new Map<string, RedisLease>();
          try {
            await c.query("BEGIN");
            const r = await work({
              lock: async (key: string) => {
                if (!held.has(key))
                  held.set(key, await coordination.locks.acquire(`tenant:1:${key}`));
              },
              query: async (q: string, a?: unknown[]) => {
                return (await c.query(q, a)).rows;
              },
            });
            for (const lease of held.values()) await lease.check();
            await c.query("COMMIT");
            return r;
          } catch (e) {
            await c.query("ROLLBACK");
            throw e;
          } finally {
            c.release();
            for (const lease of [...held.values()].reverse()) await lease.release();
          }
        },
      },
      "1",
    );
  });
  afterAll(async () => {
    await pool?.end();
    await coordination?.close();
  });
  beforeEach(async () => {
    await sql(`TRUNCATE byai.byai_group_chat_forward_item,byai.byai_group_chat_forward_target,byai.byai_group_chat_forward_request,byai.byai_session,byai.byai_session_member,byai.byai_message;
      INSERT INTO byai.byai_group_chat_forward_request(request_id,enterprise_id,actor_user_id,backend,source_session_id,client_request_id,mode,request_hash,snapshot_version,frozen_json) VALUES(100,1,30,'TENANT',10,'key','SINGLE',repeat('a',64),1,'{}');
      INSERT INTO byai.byai_group_chat_forward_target(target_id,enterprise_id,request_id,target_session_id,state,message_ids_json,pending_delivery) VALUES(200,1,100,20,'SUCCEEDED','["901","902"]',true);
      INSERT INTO byai.byai_group_chat_forward_item(item_id,enterprise_id,request_id,target_id,ordinal,selected_message_id,selected_merged_card,source_message_id,content,speaker_json,source_created_at,references_json,attachments_json,bound_message_id) VALUES(300,1,100,200,0,101,false,101,'originalBody','{}',CURRENT_TIMESTAMP,'[]','[]',901),(301,1,100,200,1,102,false,102,'originalBody','{}',CURRENT_TIMESTAMP,'[]','[]',902);
      INSERT INTO byai.byai_session VALUES(20,1,'hs_as','ACTIVE');
      INSERT INTO byai.byai_session_member VALUES(1,20,'USER',31,1,'MEMBER'),(2,20,'AGENT',40,1,'MEMBER'),(3,20,'USER',32,2,'MEMBER');
      INSERT INTO byai.byai_message VALUES(901,20,1,1,'originalBody','{"scene":"GROUP_CHAT","kind":"FORWARD_SINGLE","forward":{"forwardId":"200","mode":"SINGLE","resourceMode":"SNAPSHOT_ONLY","itemCount":1},"resourceList":[]}','{}',30,'former actor',CURRENT_TIMESTAMP,NULL,NULL,NULL,true),(902,20,1,1,'originalBody','{"scene":"GROUP_CHAT","kind":"FORWARD_SINGLE"}','{}',30,'former actor',CURRENT_TIMESTAMP,NULL,NULL,NULL,true);`);
  });
  it("actorLeftButCurrentRecipientsStillReceiveSafeProjection", async () => {
    const lease = (await store.claimDelivery(locator, "200", "delivery", 60000))!;
    const result = await store.delivery(lease, "901");
    expect(result!.userRecipientIds).toEqual(["31"]);
    expect(result!.messages[0]!.canAcknowledge).toBe(false);
    expect(result!.messages[0]!.acknowledgements).toEqual([]);
    await expect(
      store.delivery({ ...lease, locator: { ...locator, requestId: "101" } }, "901"),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_ACCESSIBLE" });
  });
  it("recalledBeforeRetryNeverRebroadcastsBody", async () => {
    let lease = (await store.claimDelivery(locator, "200", "delivery", 60000))!;
    lease = await store.markDelivered(lease, "901", "ENQUEUED");
    await sql(
      "UPDATE byai.byai_message SET recalled_at=CURRENT_TIMESTAMP,recalled_by=31 WHERE message_id=902",
    );
    const recalled = await store.delivery(lease, "902");
    expect(JSON.stringify(recalled)).not.toContain("originalBody");
    expect(recalled!.messages[0]!.recalled).toBe(true);
    await sql("UPDATE byai.byai_message SET archived_at=CURRENT_TIMESTAMP WHERE message_id=902");
    expect(await store.delivery(lease, "902")).toBeNull();
    await store.markDelivered(lease, "902", "SUPPRESSED");
    expect(
      (await sql("SELECT pending_delivery FROM byai.byai_group_chat_forward_target"))[0]
        .pending_delivery,
    ).toBe(false);
    expect((await sql("SELECT count(*) FROM byai.byai_message"))[0].count).toBe("2");
  });
  it("partialDeliveredBatchResumesWithoutRecreate and stale acknowledgement is fenced", async () => {
    const old = (await store.claimDelivery(locator, "200", "old", 60000))!;
    await store.markDelivered(old, "901", "ENQUEUED");
    await expect(store.markDelivered(old, "902", "ENQUEUED")).rejects.toMatchObject({
      code: "FORWARD_LEASE_LOST",
    });
    await sql("UPDATE byai.byai_group_chat_forward_target SET lease_until='2000-01-01'");
    const resumed = (await store.claimDelivery(locator, "200", "new", 60000))!;
    expect(resumed.pendingMessageIds).toEqual(["902"]);
    await store.markDelivered(resumed, "902", "ENQUEUED");
    expect((await sql("SELECT count(*) FROM byai.byai_message"))[0].count).toBe("2");
  });
  it("bounded scans reject tenant substitution and enforce the batch ceiling", async () => {
    expect((await store.scan("DELIVERY", null, 1)).candidates[0]?.locator).toEqual(locator);
    expect((await store.scan("DELIVERY", "200", 1)).candidates).toEqual([]);
    await expect(store.scan("WORK", null, 21)).rejects.toMatchObject({
      code: "FORWARD_INVALID_REQUEST",
    });
    await expect(store.claimDelivery(locator, "200", null as any, 60000)).rejects.toMatchObject({
      code: "FORWARD_INVALID_REQUEST",
    });
    await expect(
      store.claimDelivery({ ...locator, enterpriseId: "2" }, "200", "x", 60000),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_ACCESSIBLE" });
  });
  it("source failure persists sanitized branches and rejects a stale request owner", async () => {
    await sql(
      "UPDATE byai.byai_group_chat_forward_target SET state='PENDING',pending_delivery=false,message_ids_json='[]'",
    );
    await sql(
      "UPDATE byai.byai_group_chat_forward_request SET lease_owner='source',lease_until=clock_timestamp()+interval '1 minute',fencing_version=1",
    );
    const lease = {
      requestId: "100",
      actor: { userId: "30", enterpriseId: "1" },
      owner: "source",
      fencingVersion: "1",
      leaseUntil: "2099-01-01T00:00:00Z",
    };
    await store.failRequest(lease, "FORWARD_SOURCE_UNAVAILABLE", true);
    expect((await sql("SELECT state FROM byai.byai_group_chat_forward_request"))[0].state).toBe(
      "FAILED",
    );
    expect(
      (await sql("SELECT error_code,retryable FROM byai.byai_group_chat_forward_target"))[0],
    ).toEqual({ error_code: "FORWARD_SOURCE_UNAVAILABLE", retryable: true });
    await expect(store.failRequest(lease, "FORWARD_SOURCE_CHANGED", false)).rejects.toMatchObject({
      code: "FORWARD_LEASE_LOST",
    });
  });
});
