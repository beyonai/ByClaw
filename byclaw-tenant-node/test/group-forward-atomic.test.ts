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
} from "../src/application/group-forward-types.js";
const { Pool } = createRequire(import.meta.url)("pg");
const url = process.env.FORWARD_TEST_PG;
describe.skipIf(!url)("atomic owning forwarding transactions", () => {
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
     CREATE TABLE byai.byai_session(session_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_type TEXT,state TEXT,creator_id BIGINT,project_id BIGINT);
     CREATE TABLE byai.byai_session_member(byai_session_member_id BIGINT,session_id BIGINT,mem_obj_type TEXT,mem_obj_id BIGINT,com_acct_id BIGINT);
     CREATE TABLE byai.byai_message(message_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_id BIGINT,usage INTEGER,creator_id BIGINT,creator_name TEXT,message_content TEXT,create_time TIMESTAMP,related_resources TEXT,metadata TEXT,recalled_at TIMESTAMP,archived_at TIMESTAMP,id BIGINT);
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
 INSERT INTO byai.byai_session VALUES(10,1,'hs_as','ACTIVE',30,NULL),(20,1,'hs_as','ACTIVE',30,NULL),(21,1,'hs_as','ACTIVE',30,NULL),(22,2,'hs_as','ACTIVE',30,NULL);
 INSERT INTO byai.byai_session_member VALUES(1,10,'USER',30,1),(2,20,'USER',30,1),(3,21,'USER',30,1);
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
  it("prepareRollsBackAllRowsOnSnapshotFailure", async () => {
    await sql(
      "UPDATE byai.byai_message SET message_content='{{COMMON_FILE_missing}}' WHERE message_id=9007199254741001",
    );
    await expect(store.prepare(actor, "10", input())).rejects.toMatchObject({
      code: "FORWARD_RESOURCE_UNRESOLVABLE",
    });
    expect(await sql("SELECT * FROM byai.byai_group_chat_forward_request")).toHaveLength(0);
    expect(await sql("SELECT * FROM byai.byai_group_chat_forward_target")).toHaveLength(0);
  });
  it("sameRequestReplaysIdsAfterLeavingSourceAndChangedHashConflicts", async () => {
    const { operation, targets } = await prepared();
    await sql(
      "UPDATE byai.byai_group_chat_forward_target SET state='SUCCEEDED',message_ids_json='[\"9007199254741999\"]' WHERE target_id=$1",
      [targets[0].target_id],
    );
    await sql("DELETE FROM byai.byai_session_member WHERE session_id=10");
    const replay = await store.prepare(actor, "10", input());
    expect(replay.requestId).toBe(operation.requestId);
    expect(replay.targets[0]!.messageIds).toEqual(["9007199254741999"]);
    expect(JSON.stringify(await store.status(actor, "10", operation.requestId))).not.toContain(
      "earlier",
    );
    await expect(store.prepare(actor, "10", { ...input(), mode: "MERGED" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
  it("concurrentIdenticalPrepareCreatesOneAtomicSetAndTrueTimelineOrder", async () => {
    const [a, b] = await Promise.all([
      store.prepare(actor, "10", input()),
      store.prepare(actor, "10", input()),
    ]);
    expect(a.requestId).toBe(b.requestId);
    const items = await sql(
      "SELECT * FROM byai.byai_group_chat_forward_item ORDER BY target_id,ordinal",
    );
    expect(items).toHaveLength(4);
    expect(items[0].source_message_id).toBe("9007199254741002");
    expect(new Set(items.map((i: any) => i.item_id)).size).toBe(4);
  });
  it("targetExistenceTenantPermissionFailuresAreIndependentSanitizedReceipts", async () => {
    const operation = await store.prepare(actor, "10", {
      ...input(),
      targetSessionIds: ["20", "22", "999"],
    });
    expect(operation.targets.map((t) => t.state)).toEqual(["PENDING", "FAILED", "FAILED"]);
    expect(operation.targets[1]!.errorCode).toBe(operation.targets[2]!.errorCode);
    expect(operation.targets[1]!.retryable).toBe(false);
    expect(operation.state).toBe("RUNNING");
  });
  it("sourceProofOnlyFreezesOnceAndOneTargetClaimWinsAcrossConnections", async () => {
    const { operation, targets } = await prepared();
    const source = await store.claimRequest(operation.requestId, actor, "10", "source", 60000);
    await store.freezeSources(source, { proofs: [], resolutions: [] });
    await expect(
      store.freezeSources(source, { proofs: [], resolutions: [] }),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    const claims = await Promise.allSettled(
      targets.map((t: any, i: number) =>
        store.claimTarget(operation.requestId, t.target_id, actor, "10", `worker-${i}`, 60000),
      ),
    );
    expect(claims.filter((c) => c.status === "fulfilled")).toHaveLength(1);
  });
  it("expiredReadyRetryPreservesStageAndNeverStealsLiveOrReopensSuccess", async () => {
    const { operation, targets } = await frozen();
    let lease = await store.claimTarget(
      operation.requestId,
      targets[0].target_id,
      actor,
      "10",
      "worker",
      60000,
    );
    lease = await store.markReady(lease);
    await store.retry(actor, "10", operation.requestId, ["20"]);
    expect(
      (
        await sql("SELECT * FROM byai.byai_group_chat_forward_target WHERE target_id=$1", [
          lease.targetId,
        ])
      )[0].fencing_version,
    ).toBe(lease.fencingVersion);
    await sql(
      "UPDATE byai.byai_group_chat_forward_target SET lease_until=clock_timestamp()-INTERVAL '1 second' WHERE target_id=$1",
      [lease.targetId],
    );
    await store.retry(actor, "10", operation.requestId, ["20"]);
    const fresh = await store.claimTarget(
      operation.requestId,
      lease.targetId,
      actor,
      "10",
      "recovery",
      60000,
    );
    expect(fresh.state).toBe("READY");
    expect(BigInt(fresh.fencingVersion)).toBeGreaterThan(BigInt(lease.fencingVersion));
  });
  it("workerCannotReplaceActorTenantOrBinding", async () => {
    const { operation, targets } = await frozen();
    const lease = await store.claimTarget(
      operation.requestId,
      targets[0].target_id,
      actor,
      "10",
      "worker",
      60000,
    );
    for (const bad of [
      { ...lease, actor: { ...actor, userId: "31" } },
      { ...lease, actor: { ...actor, enterpriseId: "2" } },
      { ...lease, targetId: targets[1].target_id },
      { ...lease, sourceSessionId: "20" },
    ])
      await expect(store.markReady(bad)).rejects.toThrow();
  });
  it("concurrentAttachmentPatchesFenceStaleCommandsAndPreserveOtherCopiesAndMaintenance", async () => {
    await sql(
      `UPDATE byai.byai_message SET related_resources='{"files":[{"fileId":"700","fileName":"file"}]}'`,
    );
    const { operation, targets } = await prepared();
    const requestLease = await store.claimRequest(
      operation.requestId,
      actor,
      "10",
      "resolver",
      60000,
    );
    const work = await store.requestWork(requestLease);
    const proofs: SourceProof[] = work.manifest.candidates.map((c, i) => ({
      sourceId: `proof-${i}`,
      identity: {
        enterpriseId: "1",
        ownerId: "30",
        storageType: "minio",
        scopeId: "owner",
        path: `file-${i}`,
        immutableVersion: null,
      },
      size: 3,
      sha256: "a".repeat(64),
    }));
    await store.freezeSources(requestLease, {
      proofs,
      resolutions: work.manifest.candidates.map((c, i) => ({
        candidateId: c.candidateId,
        sourceId: proofs[i]!.sourceId,
      })),
    });
    await sql(
      "UPDATE byai.byai_group_chat_forward_target SET fencing_version=9007199254741001 WHERE target_id=$1",
      [targets[0].target_id],
    );
    let lease = await store.claimTarget(
      operation.requestId,
      targets[0].target_id,
      actor,
      "10",
      "copy",
      60000,
    );
    const target = await store.targetWork(lease);
    const bindings = target.manifest.attachments.filter((a) => a.targetId === lease.targetId);
    await sql(
      "UPDATE byai.byai_group_chat_forward_target SET checkpoint_json=$2 WHERE target_id=$1",
      [lease.targetId, JSON.stringify({ maintenance: { schemaVersion: 1, future: ["retain"] } })],
    );
    const patches = bindings.map((b, i) => ({
      phase: "RESERVE" as const,
      sourceId: b.sourceId,
      object: {
        enterpriseId: "1",
        targetSessionId: "20",
        forwardTargetId: lease.targetId,
        itemId: b.itemId,
        attachmentId: b.attachmentId,
        attemptId: `attempt-${i}`,
        fileName: "file",
        contentType: null,
        size: 0,
        sha256: null,
        createdAt: "2026-10-16T00:00:00Z",
      },
    }));
    const raced = await Promise.allSettled(
      patches.map((p) => store.checkpointAttachment(lease, lease.fencingVersion, p)),
    );
    expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = raced.findIndex((r) => r.status === "fulfilled");
    lease = (raced[winner] as PromiseFulfilledResult<TargetLease>).value;
    const other = winner === 0 ? 1 : 0;
    lease = await store.checkpointAttachment(lease, lease.fencingVersion, patches[other]!);
    for (const patch of patches)
      lease = await store.checkpointAttachment(lease, lease.fencingVersion, {
        ...patch,
        phase: "VERIFY",
        object: {
          ...patch.object,
          size: 3,
          sha256: "a".repeat(64),
          uploadedFile: {
            fileId: patch.object.attachmentId,
            fileName: "file",
            filePath: `/.sessions/20/forwards/${patch.object.itemId}/file`,
          },
        },
      });
    const ready = await store.markReady(lease);
    expect(ready.state).toBe("READY");
    expect(BigInt(ready.fencingVersion)).toBeGreaterThan(9007199254741001n);
    const checkpoint = (await store.targetWork(ready)).target!.checkpoint;
    expect(checkpoint.copiedObjects).toHaveLength(2);
    expect(checkpoint.maintenance).toEqual({ schemaVersion: 1, future: ["retain"] });
  });
  it("discoveryUsesNumericCursorAndBoundedPagesWithoutSourceContent", async () => {
    await prepared();
    const first = await store.discoverWork(null, 1);
    expect(first.candidates).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await store.discoverWork(first.nextCursor, 1);
    expect(second.candidates).toHaveLength(1);
    expect(BigInt(second.candidates[0]!.targetId)).toBeGreaterThan(
      BigInt(first.candidates[0]!.targetId),
    );
    expect(JSON.stringify(first)).not.toContain("earlier");
    expect(() => store.discoverWork(null, 21)).toThrow();
  });
  it("immediate discovery only returns the submitted request", async () => {
    const first = await store.prepare(actor, "10", input("first"));
    await store.prepare(actor, "10", input("second"));
    const page = await store.discoverWork(null, 20, first.requestId);
    expect(page.candidates).toHaveLength(2);
    expect(page.candidates.every((candidate) => candidate.locator.requestId === first.requestId)).toBe(true);
  });
  it("completionAndRetrySerializeAggregateFromCurrentBranches", async () => {
    const { operation, targets } = await frozen();
    let lease = await store.claimTarget(
      operation.requestId,
      targets[0].target_id,
      actor,
      "10",
      "worker",
      60000,
    );
    lease = await store.markReady(lease);
    await sql(
      "UPDATE byai.byai_group_chat_forward_target SET state='FAILED',retryable=TRUE WHERE target_id=$1",
      [targets[1].target_id],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const repo = new GroupForwardRepository(
        { query: async (q, a) => (await client.query(q, a)).rows },
        "1",
      );
      const request = (await repo.lockRequest(operation.requestId))!;
      let retryFinished = false;
      const retry = store.retry(actor, "10", operation.requestId, ["21"]).then((result) => {
        retryFinished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(retryFinished).toBe(false);
      await repo.succeedTarget(lease.targetId, lease.owner, lease.fencingVersion, [
        "9007199254741999",
      ]);
      await store.recompute(repo, request);
      await client.query("COMMIT");
      const result = await retry;
      expect(result.state).toBe("RUNNING");
      expect(result.targets.map((t) => t.state)).toEqual(["SUCCEEDED", "PENDING"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("realConnectionManagerPrecommitFenceRollsBackPreparedRows", async () => {
    let checks = 0;
    const identity = { enterpriseId: "1", generation: "7", dbSandboxRecordId: "80" };
    const database: TenantDatabase = {
      query: sql,
      verifyIdentity: async () => {},
      close: async () => {},
      fresh: async () => database,
      exclusive: async (work) => work(database),
      transaction: async (work, guard) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const value = await work({
            query: async (q, args) => (await client.query(q, args)).rows,
          });
          await guard?.();
          await client.query("COMMIT");
          return value;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
    const manager = new ConnectionManager(identity, {
      snapshot: async () => snapshot({ ...identity, fencingToken: ++checks >= 4 ? "10" : "9" }),
      decrypt: async () => "fixture",
      open: async () => database,
      readAuthority: async () => undefined,
      saveAuthority: async () => {},
    });
    await manager.refresh();
    manager.setSchemaReady(true);
    await expect(
      new SqlGroupForwardStore(manager, "1").prepare(actor, "10", input()),
    ).rejects.toMatchObject({ code: "AUTHORITY_CHANGED" });
    expect(checks).toBe(4);
    expect(await sql("SELECT * FROM byai.byai_group_chat_forward_request")).toHaveLength(0);
    expect(await sql("SELECT * FROM byai.byai_group_chat_forward_target")).toHaveLength(0);
    expect(await sql("SELECT * FROM byai.byai_group_chat_forward_item")).toHaveLength(0);
  });
});
