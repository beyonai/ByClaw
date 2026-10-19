import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { GroupForwardRepository } from "../src/infrastructure/persistence/group-forward-repository.js";
import type { TargetLease, RequestLease } from "../src/application/group-forward-types.js";
import type { SqlSession } from "../src/application/database-ports.js";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const url = process.env.FORWARD_TEST_PG;
// Integration fixtures never connect to application configuration or upgrade tenant databases.
describe.skipIf(!url)("forward persistence constraints and fencing", () => {
  let client: any, db: SqlSession, repository: GroupForwardRepository;
  const tenant = "1",
    requestId = "9007199254741001",
    targetId = "9007199254741002";
  beforeAll(async () => {
    const address = new URL(url!);
    if (
      address.hostname !== "127.0.0.1" ||
      address.port !== "15486" ||
      address.pathname !== "/byclaw_forward_test"
    )
      throw new Error("isolated local test database required");
    client = new Client({ connectionString: url });
    await client.connect();
    db = { query: async (sql, parameters) => (await client.query(sql, parameters)).rows };
    await db.query(
      await readFile(
        new URL("../../deploy/migrations/versions/V0.6.0/tenant/V0.6.0__ddl.sql", import.meta.url),
        "utf8",
      ),
    );
    repository = new GroupForwardRepository(db, tenant);
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.query("DELETE FROM byai.byai_group_chat_forward_item");
    await db.query("DELETE FROM byai.byai_group_chat_forward_target");
    await db.query("DELETE FROM byai.byai_group_chat_forward_request");
    await repository.insertRequest({
      requestId,
      backend: "TENANT",
      actorUserId: "30",
      sourceSessionId: "1000",
      clientRequestId: "test-key",
      mode: "SINGLE",
      requestHash: "a".repeat(64),
      frozenJson: '{"content":"frozen"}',
      sourceManifestJson: "[]",
      snapshotVersion: 1,
    });
    await repository.insertTarget({ targetId, requestId, targetSessionId: "2000" });
  });
  it("uniqueRequestBindsActorAndHash", async () => {
    await expect(
      repository.insertRequest({
        requestId: "11",
        backend: "TENANT",
        actorUserId: "30",
        sourceSessionId: "1001",
        clientRequestId: "test-key",
        mode: "MERGED",
        requestHash: "b".repeat(64),
        frozenJson: "{}",
        sourceManifestJson: "[]",
        snapshotVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "23505" });
    const row = await repository.requestByKey("30", "test-key");
    expect(row).toMatchObject({
      requestId,
      backend: "TENANT",
      actorUserId: "30",
      requestHash: "a".repeat(64),
      state: "RUNNING",
    });
    expect(await new GroupForwardRepository(db, "2").requestByKey("30", "test-key")).toBeNull();
    await expect(
      repository.insertTarget({ targetId: "12", requestId, targetSessionId: "2000" }),
    ).rejects.toMatchObject({ code: "23505" });
  });
  const until = () => new Date(Date.now() + 60_000).toISOString();
  it("staleLeaseCannotCheckpointOrOverwriteSuccess", async () => {
    const lease = await repository.claimTarget(targetId, "first", 120_000);
    expect(lease).toMatchObject({ fencingVersion: "1", state: "COPYING" });
    expect(await repository.claimTarget(targetId, "second", 120_000)).toBeNull();
    await db.query(
      "UPDATE byai.byai_group_chat_forward_target SET lease_until=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE target_id=$1",
      [targetId],
    );
    const next = await repository.claimTarget(targetId, "second", 120_000);
    expect(next?.fencingVersion).toBe("2");
    await expect(
      repository.checkpoint(
        targetId,
        "first",
        "1",
        { copiedObjects: [], attachmentMapping: {}, progress: 10 },
        "READY",
      ),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    const ready = await repository.checkpoint(
      targetId,
      "second",
      "2",
      { copiedObjects: [], attachmentMapping: {}, progress: 100 },
      "READY",
    );
    expect(ready.fencingVersion).toBe("3");
    await repository.succeedTarget(targetId, "second", "3", ["9007199254741003"]);
    await expect(
      repository.failTarget(targetId, "second", "3", "COPY_FAILED", true),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    expect(await repository.claimTarget(targetId, "second", 120_000)).toBeNull();
    await expect(
      repository.checkpoint(
        targetId,
        "second",
        "4",
        { copiedObjects: [], attachmentMapping: {}, progress: 1 },
        "COPYING",
      ),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    expect(await repository.target(targetId)).toMatchObject({
      state: "SUCCEEDED",
      messageIdsJson: '["9007199254741003"]',
      pendingDelivery: true,
    });
  });
  it("independentRequestLeaseFreezesProofsOnlyOnce", async () => {
    const lease = await repository.claimRequest(requestId, "resolver", 120_000);
    expect(lease?.fencingVersion).toBe("1");
    expect(await repository.claimRequest(requestId, "other", 120_000)).toBeNull();
    await repository.freezeSources(requestId, "resolver", "1", '[{"sourceId":"proof"}]');
    await expect(repository.freezeSources(requestId, "resolver", "1", "[]")).rejects.toMatchObject({
      code: "FORWARD_LEASE_LOST",
    });
    expect((await repository.request(requestId))?.sourceManifestJson).toBe(
      '[{"sourceId":"proof"}]',
    );
    expect((await repository.target(targetId))?.fencingVersion).toBe("0");
    expect(await repository.claimRequest(requestId, "other", 120_000)).toBeNull();
  });
  it("expiredLeaseAndWrongTenantCannotWrite", async () => {
    await repository.claimTarget(targetId, "worker", 120_000);
    await db.query(
      "UPDATE byai.byai_group_chat_forward_target SET lease_until=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE target_id=$1",
      [targetId],
    );
    await expect(
      repository.checkpoint(
        targetId,
        "worker",
        "1",
        { copiedObjects: [], attachmentMapping: {}, progress: 1 },
        "COPYING",
      ),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    expect(await new GroupForwardRepository(db, "2").target(targetId)).toBeNull();
    await expect(repository.claimTarget(targetId, "worker", 0)).rejects.toMatchObject({
      code: "FORWARD_INVALID_REQUEST",
    });
  });
  it("parentSnapshotCannotCascadeFromSourceDelete", async () => {
    // This fixture also runs after the atomic-prepare fixture; establish only its source-row test columns.
    await db.query(
      "CREATE TABLE IF NOT EXISTS byai.byai_message(id BIGINT,message_id BIGINT,session_id BIGINT,enterprise_id BIGINT,message_content TEXT)",
    );
    await db.query("ALTER TABLE byai.byai_message ADD COLUMN IF NOT EXISTS id BIGINT");
    await repository.insertItem({
      itemId: "9007199254741004",
      requestId,
      targetId,
      ordinal: 0,
      selectedMessageId: "1234",
      selectedMergedCard: true,
      sourceMessageId: "1235",
      content: "frozen original",
      speakerJson: '{"type":"USER","id":"30","name":"Original"}',
      sourceCreatedAt: "2026-10-15T00:00:00Z",
      referencesJson: "[]",
      attachmentsJson: "[]",
    });
    await db.query(
      "INSERT INTO byai.byai_message(id, message_id, session_id, enterprise_id, message_content) VALUES(1234,1234,1000,1,'old selected'),(1235,1235,1000,1,'old inner')",
    );
    await db.query(
      "UPDATE byai.byai_message SET message_content='changed after preparation' WHERE id IN (1234,1235)",
    );
    await db.query("DELETE FROM byai.byai_message WHERE id IN (1234,1235)");
    expect(await repository.items(targetId)).toMatchObject([
      {
        selectedMessageId: "1234",
        selectedMergedCard: true,
        sourceMessageId: "1235",
        content: "frozen original",
        ordinal: 0,
      },
    ]);
    await expect(
      repository.insertItem({
        itemId: "19",
        requestId,
        targetId,
        ordinal: 0,
        selectedMessageId: "1234",
        selectedMergedCard: true,
        sourceMessageId: "1235",
        content: "duplicate",
        speakerJson: "{}",
        sourceCreatedAt: "2026-10-15T00:00:00Z",
        referencesJson: "[]",
        attachmentsJson: "[]",
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("retryOnlyResetsRetryableFailuresAndDeliveryIsIndependent", async () => {
    await repository.claimTarget(targetId, "worker", 120_000);
    await repository.failTarget(targetId, "worker", "1", "TEMPORARY", true);
    expect(await repository.resetFailedTarget(targetId)).toBe(true);
    expect(await repository.resetFailedTarget(targetId)).toBe(false);
    const lease = await repository.claimTarget(targetId, "worker", 120_000);
    const ready = await repository.checkpoint(
      targetId,
      "worker",
      lease!.fencingVersion,
      { copiedObjects: [], attachmentMapping: {}, progress: 100 },
      "READY",
    );
    await repository.succeedTarget(targetId, "worker", ready.fencingVersion, ["31"]);
    expect(await repository.resetFailedTarget(targetId)).toBe(false);
    expect(await repository.pendingDeliveries(10)).toHaveLength(1);
    expect(await repository.markDelivered(targetId)).toBe(true);
    expect(await repository.pendingDeliveries(10)).toHaveLength(0);
    await repository.updateRequestState(requestId, "SUCCEEDED");
    expect((await repository.request(requestId))?.state).toBe("SUCCEEDED");
    expect(await repository.updateRequestState(requestId, "RUNNING")).toBe(false);
  });
  it("rollbackKeepsTargetAndMessageBindingsAtomic", async () => {
    await db.query("BEGIN");
    await repository.claimTarget(targetId, "worker", 120_000);
    await repository.checkpoint(
      targetId,
      "worker",
      "1",
      { copiedObjects: [], attachmentMapping: {}, progress: 100 },
      "READY",
    );
    await repository.succeedTarget(targetId, "worker", "2", ["31"]);
    await db.query("ROLLBACK");
    expect((await repository.target(targetId))?.state).toBe("PENDING");
    expect((await repository.target(targetId))?.messageIdsJson).toBe("[]");
  });
  it("preservesBigintFencesAndReturnsNativeTimestampValuesAsIso", async () => {
    await db.query(
      "UPDATE byai.byai_group_chat_forward_target SET fencing_version=$2 WHERE target_id=$1",
      [targetId, "9007199254740993"],
    );
    const lease = await repository.claimTarget(targetId, "worker", 120_000);
    expect(lease?.fencingVersion).toBe("9007199254740994");
    expect(typeof lease?.leaseUntil).toBe("string");
    expect(lease?.leaseUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await expect(
      repository.checkpoint(
        targetId,
        "worker",
        "9007199254740993",
        { copiedObjects: [], attachmentMapping: {}, progress: 1 },
        "COPYING",
      ),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    const next = await repository.checkpoint(
      targetId,
      "worker",
      "9007199254740994",
      { copiedObjects: [], attachmentMapping: {}, progress: 10 },
      "COPYING",
    );
    expect(next.fencingVersion).toBe("9007199254740995");
  });
  it("bindsOnlyTheCurrentReadyLeaseAndKeepsUploadProgressServerSide", async () => {
    await repository.insertItem({
      itemId: "401",
      requestId,
      targetId,
      ordinal: 0,
      selectedMessageId: "1234",
      selectedMergedCard: false,
      sourceMessageId: "1234",
      content: "frozen",
      speakerJson: "{}",
      sourceCreatedAt: "2026-10-15T00:00:00Z",
      referencesJson: "[]",
      attachmentsJson: "[]",
    });
    expect(await repository.recoverableTargets(10)).toHaveLength(1);
    await repository.claimTarget(targetId, "worker", 120_000);
    expect(await repository.recoverableTargets(10)).toHaveLength(0);
    expect(await repository.bindItem(targetId, "401", "worker", "1", "501", "[]")).toBe(false);
    const object = {
      enterpriseId: "1",
      targetSessionId: "2000",
      forwardTargetId: targetId,
      itemId: "401",
      attachmentId: "601",
      attemptId: "attempt-1",
      fileName: "photo.png",
      contentType: "image/png",
      size: 3,
      sha256: "a".repeat(64),
      createdAt: "2026-10-15T00:00:00Z",
      uploadedFile: {
        fileId: "601",
        fileName: "photo.png",
        filePath: "/.sessions/2000/copy/photo.png",
      },
    };
    await repository.checkpoint(
      targetId,
      "worker",
      "1",
      { copiedObjects: [object], attachmentMapping: { source: "601" }, progress: 100 },
      "READY",
    );
    expect(await repository.bindItem(targetId, "401", "wrong", "2", "501", "[]")).toBe(false);
    expect(await repository.bindItem(targetId, "401", "worker", "1", "501", "[]")).toBe(false);
    expect(
      await repository.bindItem(
        targetId,
        "401",
        "worker",
        "2",
        "501",
        '[{"fileId":"601","fileName":"photo.png","filePath":"/.sessions/2000/copy/photo.png"}]',
      ),
    ).toBe(true);
    expect(await repository.bindItem(targetId, "401", "worker", "2", "502", "[]")).toBe(false);
    expect((await repository.items(targetId))[0]).toMatchObject({
      boundMessageId: "501",
      attachmentsJson:
        '[{"fileId":"601","fileName":"photo.png","filePath":"/.sessions/2000/copy/photo.png"}]',
    });
    expect(
      JSON.parse((await repository.target(targetId))!.checkpointJson).copiedObjects[0],
    ).toMatchObject({
      attemptId: "attempt-1",
    });
    expect(await repository.targets(requestId)).toHaveLength(1);
    expect(await new GroupForwardRepository(db, "2").items(targetId)).toEqual([]);
  });
  it("constraintsRejectCrossTenantAndMismatchedParentRows", async () => {
    await expect(
      new GroupForwardRepository(db, "2").insertTarget({
        targetId: "19",
        requestId,
        targetSessionId: "2001",
      }),
    ).rejects.toMatchObject({ code: "23503" });
    await repository.insertRequest({
      requestId: "999",
      backend: "TENANT",
      actorUserId: "31",
      sourceSessionId: "1000",
      clientRequestId: "test-key",
      mode: "SINGLE",
      requestHash: "a".repeat(64),
      frozenJson: "{}",
      sourceManifestJson: "[]",
      snapshotVersion: 1,
    });
    await new GroupForwardRepository(db, "2").insertRequest({
      requestId: "998",
      backend: "TENANT",
      actorUserId: "30",
      sourceSessionId: "1000",
      clientRequestId: "test-key",
      mode: "SINGLE",
      requestHash: "a".repeat(64),
      frozenJson: "{}",
      sourceManifestJson: "[]",
      snapshotVersion: 1,
    });
    expect((await repository.requestByKey("31", "test-key"))?.requestId).toBe("999");
    await expect(
      repository.insertItem({
        itemId: "401",
        requestId: "999",
        targetId,
        ordinal: 0,
        selectedMessageId: "1234",
        selectedMergedCard: false,
        sourceMessageId: "1234",
        content: "frozen",
        speakerJson: "{}",
        sourceCreatedAt: "2026-10-15T00:00:00Z",
        referencesJson: "[]",
        attachmentsJson: "[]",
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("renewalExtendsDatabaseDeadlineWithoutConsumingTheFence", async () => {
    const deadline = new Date(Date.now() + 300).toISOString();
    await db.query(
      "UPDATE byai.byai_group_chat_forward_target SET fencing_version=$2 WHERE target_id=$1",
      [targetId, "9007199254740993"],
    );
    await db.query(
      "UPDATE byai.byai_group_chat_forward_request SET fencing_version=$2 WHERE request_id=$1",
      [requestId, "9007199254740993"],
    );
    await repository.claimTarget(targetId, "worker", 300);
    await repository.claimRequest(requestId, "resolver", 300);
    const targetLease: TargetLease = {
      requestId,
      targetId,
      actor: { userId: "30", enterpriseId: "1" },
      sourceSessionId: "1000",
      targetSessionId: "2000",
      owner: "worker",
      fencingVersion: "9007199254740994",
      leaseUntil: "2099-01-01T00:00:00Z",
      state: "COPYING",
    };
    const requestLease: RequestLease = {
      requestId,
      actor: { userId: "30", enterpriseId: "1" },
      owner: "resolver",
      fencingVersion: "9007199254740994",
      leaseUntil: "2099-01-01T00:00:00Z",
    };
    const renewedTarget = await repository.renewTarget(targetLease, 3000);
    const renewedRequest = await repository.renewRequest(requestLease, 3000);
    expect(renewedTarget.fencingVersion).toBe("9007199254740994");
    expect(renewedRequest.fencingVersion).toBe("9007199254740994");
    expect(Date.parse(renewedTarget.leaseUntil!)).toBeLessThan(Date.now() + 3500);
    expect(Date.parse(renewedRequest.leaseUntil!)).toBeLessThan(Date.now() + 3500);
    const shorter = await repository.renewTarget(targetLease, 10);
    expect(shorter.leaseUntil).toBe(renewedTarget.leaseUntil);
    await db.query("SELECT pg_sleep(0.4)");
    expect(Date.now()).toBeGreaterThan(Date.parse(deadline));
    await repository.checkpoint(
      targetId,
      "worker",
      "9007199254740994",
      { copiedObjects: [], attachmentMapping: {}, progress: 20 },
      "COPYING",
    );
    await repository.freezeSources(requestId, "resolver", "9007199254740994", "[]");
    await expect(repository.renewTarget(targetLease, 3000)).rejects.toMatchObject({
      code: "FORWARD_LEASE_LOST",
    });
    await expect(repository.renewRequest(requestLease, 3000)).rejects.toMatchObject({
      code: "FORWARD_LEASE_LOST",
    });
  });
  it("renewalRequiresFullPersistedOwnershipAndCannotReacquireExpiryOrSuccess", async () => {
    await repository.claimTarget(targetId, "worker", 120_000);
    await repository.claimRequest(requestId, "resolver", 120_000);
    const targetLease: TargetLease = {
      requestId,
      targetId,
      actor: { userId: "30", enterpriseId: "1" },
      sourceSessionId: "1000",
      targetSessionId: "2000",
      owner: "worker",
      fencingVersion: "1",
      leaseUntil: until(),
      state: "COPYING",
    };
    const requestLease: RequestLease = {
      requestId,
      actor: { userId: "30", enterpriseId: "1" },
      owner: "resolver",
      fencingVersion: "1",
      leaseUntil: until(),
    };
    for (const patch of [
      { requestId: "999" },
      { targetId: "999" },
      { sourceSessionId: "999" },
      { targetSessionId: "999" },
      { owner: "other" },
      { fencingVersion: "0" },
      { actor: { userId: "31", enterpriseId: "1" } },
      { actor: { userId: "30", enterpriseId: "2" } },
    ]) {
      await expect(
        repository.renewTarget({ ...targetLease, ...patch }, 1000),
      ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    }
    for (const invalidDuration of [0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(repository.renewTarget(targetLease, invalidDuration)).rejects.toMatchObject({
        code: "FORWARD_INVALID_REQUEST",
      });
      await expect(repository.renewRequest(requestLease, invalidDuration)).rejects.toMatchObject({
        code: "FORWARD_INVALID_REQUEST",
      });
    }
    for (const patch of [
      { requestId: "999" },
      { owner: "other" },
      { fencingVersion: "0" },
      { actor: { userId: "31", enterpriseId: "1" } },
      { actor: { userId: "30", enterpriseId: "2" } },
    ]) {
      await expect(
        repository.renewRequest({ ...requestLease, ...patch }, 1000),
      ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    }
    await repository.checkpoint(
      targetId,
      "worker",
      "1",
      { copiedObjects: [], attachmentMapping: {}, progress: 100 },
      "READY",
    );
    await repository.succeedTarget(targetId, "worker", "2", ["501"]);
    await expect(
      repository.renewTarget({ ...targetLease, fencingVersion: "3" }, 1000),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    await db.query(
      "UPDATE byai.byai_group_chat_forward_request SET lease_until=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE request_id=$1",
      [requestId],
    );
    await expect(repository.renewRequest(requestLease, 1000)).rejects.toMatchObject({
      code: "FORWARD_LEASE_LOST",
    });
    await repository.insertTarget({ targetId: "999", requestId, targetSessionId: "2001" });
    await repository.claimTarget("999", "worker", 120_000);
    await db.query(
      "UPDATE byai.byai_group_chat_forward_target SET lease_until=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE target_id=$1",
      ["999"],
    );
    await expect(
      repository.renewTarget({ ...targetLease, targetId: "999", targetSessionId: "2001" }, 1000),
    ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
  });
  it("initialClaimsUseDatabaseDurationAndRejectOldAbsoluteDeadlineInput", async () => {
    const target = await repository.claimTarget(targetId, "worker", 1000);
    const request = await repository.claimRequest(requestId, "resolver", 1000);
    expect(target).toMatchObject({ fencingVersion: "1", state: "COPYING" });
    expect(request?.fencingVersion).toBe("1");
    const [clock] = await db.query(
      `SELECT
      EXISTS(SELECT 1 FROM byai.byai_group_chat_forward_target WHERE target_id=$1 AND lease_until > CURRENT_TIMESTAMP AND lease_until <= CURRENT_TIMESTAMP + INTERVAL '2 seconds') AS target_clock,
      EXISTS(SELECT 1 FROM byai.byai_group_chat_forward_request WHERE request_id=$2 AND lease_until > CURRENT_TIMESTAMP AND lease_until <= CURRENT_TIMESTAMP + INTERVAL '2 seconds') AS request_clock`,
      [targetId, requestId],
    );
    expect(clock).toMatchObject({ target_clock: true, request_clock: true });
    const absolute = "2099-01-01T00:00:00Z" as unknown as number;
    await expect(repository.claimTarget(targetId, "worker", absolute)).rejects.toMatchObject({
      code: "FORWARD_INVALID_REQUEST",
    });
    await expect(repository.claimRequest(requestId, "resolver", absolute)).rejects.toMatchObject({
      code: "FORWARD_INVALID_REQUEST",
    });
  });
  it("existingTransactionCannotUseActuallyExpiredLeaseOrFreeze", async () => {
    await repository.insertItem({
      itemId: "401",
      requestId,
      targetId,
      ordinal: 0,
      selectedMessageId: "1234",
      selectedMergedCard: false,
      sourceMessageId: "1234",
      content: "frozen",
      speakerJson: "{}",
      sourceCreatedAt: "2026-10-15T00:00:00Z",
      referencesJson: "[]",
      attachmentsJson: "[]",
    });
    await repository.claimTarget(targetId, "worker", 300);
    await repository.checkpoint(
      targetId,
      "worker",
      "1",
      { copiedObjects: [], attachmentMapping: {}, progress: 100 },
      "READY",
    );
    await repository.claimRequest(requestId, "resolver", 300);
    const targetLease: TargetLease = {
      requestId,
      targetId,
      actor: { userId: "30", enterpriseId: "1" },
      sourceSessionId: "1000",
      targetSessionId: "2000",
      owner: "worker",
      fencingVersion: "2",
      leaseUntil: until(),
      state: "READY",
    };
    const requestLease: RequestLease = {
      requestId,
      actor: { userId: "30", enterpriseId: "1" },
      owner: "resolver",
      fencingVersion: "1",
      leaseUntil: until(),
    };
    await db.query("BEGIN");
    try {
      await db.query("SELECT pg_sleep(0.4)");
      const [clock] = await db.query(
        "SELECT lease_until > CURRENT_TIMESTAMP AS transaction_live, lease_until < clock_timestamp() AS actually_expired FROM byai.byai_group_chat_forward_target WHERE target_id=$1",
        [targetId],
      );
      expect(clock).toMatchObject({ transaction_live: true, actually_expired: true });
      await expect(
        repository.checkpoint(
          targetId,
          "worker",
          "2",
          { copiedObjects: [], attachmentMapping: {}, progress: 100 },
          "READY",
        ),
      ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
      expect(await repository.bindItem(targetId, "401", "worker", "2", "501", "[]")).toBe(false);
      await expect(
        repository.succeedTarget(targetId, "worker", "2", ["501"]),
      ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
      await expect(
        repository.failTarget(targetId, "worker", "2", "EXPIRED", true),
      ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
      await expect(repository.renewTarget(targetLease, 3000)).rejects.toMatchObject({
        code: "FORWARD_LEASE_LOST",
      });
      await expect(repository.renewRequest(requestLease, 3000)).rejects.toMatchObject({
        code: "FORWARD_LEASE_LOST",
      });
      await expect(
        repository.freezeSources(requestId, "resolver", "1", "[]"),
      ).rejects.toMatchObject({ code: "FORWARD_LEASE_LOST" });
    } finally {
      await db.query("ROLLBACK");
    }
  });
  it("lateClaimsInsideExistingTransactionReceiveFutureWallClockDeadlines", async () => {
    await db.query("BEGIN");
    try {
      await db.query("SELECT pg_sleep(0.3)");
      await repository.claimTarget(targetId, "worker", 200);
      await repository.claimRequest(requestId, "resolver", 200);
      const [clock] = await db.query(
        `SELECT
        EXISTS(SELECT 1 FROM byai.byai_group_chat_forward_target WHERE target_id=$1 AND lease_until > clock_timestamp()) AS target_live,
        EXISTS(SELECT 1 FROM byai.byai_group_chat_forward_request WHERE request_id=$2 AND lease_until > clock_timestamp()) AS request_live`,
        [targetId, requestId],
      );
      expect(clock).toMatchObject({ target_live: true, request_live: true });
    } finally {
      await db.query("ROLLBACK");
    }
  });
  it.each(["succeed", "renew", "checkpoint", "bind"])(
    "unchangedTargetRowLockWaitCannotAuthorizeExpired%s",
    async (operation) => {
      await repository.insertItem({
        itemId: "401",
        requestId,
        targetId,
        ordinal: 0,
        selectedMessageId: "1234",
        selectedMergedCard: false,
        sourceMessageId: "1234",
        content: "frozen",
        speakerJson: "{}",
        sourceCreatedAt: "2026-10-15T00:00:00Z",
        referencesJson: "[]",
        attachmentsJson: "[]",
      });
      await repository.claimTarget(targetId, "worker", 1000);
      await repository.checkpoint(
        targetId,
        "worker",
        "1",
        { copiedObjects: [], attachmentMapping: {}, progress: 100 },
        "READY",
      );
      const targetLease: TargetLease = {
        requestId,
        targetId,
        actor: { userId: "30", enterpriseId: "1" },
        sourceSessionId: "1000",
        targetSessionId: "2000",
        owner: "worker",
        fencingVersion: "2",
        leaseUntil: until(),
        state: "READY",
      };
      const blocker = new Client({ connectionString: url });
      await blocker.connect();
      const [identity] = await db.query("SELECT pg_backend_pid() AS pid");
      let pending: Promise<{ value?: unknown; error?: any }> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT target_id FROM byai.byai_group_chat_forward_target WHERE target_id=$1 FOR UPDATE",
          [targetId],
        );
        await db.query("BEGIN");
        pending = (
          operation === "succeed"
            ? repository.succeedTarget(targetId, "worker", "2", ["501"])
            : operation === "checkpoint"
              ? repository.checkpoint(
                  targetId,
                  "worker",
                  "2",
                  { copiedObjects: [], attachmentMapping: {}, progress: 100 },
                  "READY",
                )
              : operation === "bind"
                ? repository.bindItem(targetId, "401", "worker", "2", "501", "[]")
                : repository.renewTarget(targetLease, 3000)
        ).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        let waiting = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const result = await blocker.query(
            "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
            [identity!.pid],
          );
          if (result.rows[0]?.waiting) {
            waiting = true;
            break;
          }
          await blocker.query("SELECT pg_sleep(0.01)");
        }
        expect(waiting).toBe(true);
        await blocker.query(
          "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (lease_until-clock_timestamp())))+0.05) FROM byai.byai_group_chat_forward_target WHERE target_id=$1",
          [targetId],
        );
        await blocker.query("COMMIT");
        const outcome = await pending;
        if (operation === "bind") expect(outcome.value).toBe(false);
        else expect(outcome.error).toMatchObject({ code: "FORWARD_LEASE_LOST" });
        const row = await repository.target(targetId);
        expect(row).toMatchObject({
          state: "READY",
          leaseOwner: "worker",
          fencingVersion: "2",
          messageIdsJson: "[]",
        });
      } finally {
        await blocker.query("ROLLBACK");
        await pending;
        await db.query("ROLLBACK");
        await blocker.end();
      }
    },
  );
  it.each(["freeze", "renew"])(
    "unchangedRequestRowLockWaitCannotAuthorizeExpired%s",
    async (operation) => {
      await repository.claimRequest(requestId, "resolver", 1000);
      const requestLease: RequestLease = {
        requestId,
        actor: { userId: "30", enterpriseId: "1" },
        owner: "resolver",
        fencingVersion: "1",
        leaseUntil: until(),
      };
      const blocker = new Client({ connectionString: url });
      await blocker.connect();
      const [identity] = await db.query("SELECT pg_backend_pid() AS pid");
      let pending: Promise<{ value?: unknown; error?: any }> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT request_id FROM byai.byai_group_chat_forward_request WHERE request_id=$1 FOR UPDATE",
          [requestId],
        );
        await db.query("BEGIN");
        pending = (
          operation === "freeze"
            ? repository.freezeSources(
                requestId,
                "resolver",
                "1",
                '[{"sourceId":"must-not-freeze"}]',
              )
            : repository.renewRequest(requestLease, 3000)
        ).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        let waiting = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const result = await blocker.query(
            "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
            [identity!.pid],
          );
          if (result.rows[0]?.waiting) {
            waiting = true;
            break;
          }
          await blocker.query("SELECT pg_sleep(0.01)");
        }
        expect(waiting).toBe(true);
        await blocker.query(
          "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (lease_until-clock_timestamp())))+0.05) FROM byai.byai_group_chat_forward_request WHERE request_id=$1",
          [requestId],
        );
        await blocker.query("COMMIT");
        expect((await pending).error).toMatchObject({ code: "FORWARD_LEASE_LOST" });
        expect(await repository.request(requestId)).toMatchObject({
          state: "RUNNING",
          leaseOwner: "resolver",
          fencingVersion: "1",
          sourcesFrozen: false,
          sourceManifestJson: "[]",
        });
      } finally {
        await blocker.query("ROLLBACK");
        await pending;
        await db.query("ROLLBACK");
        await blocker.end();
      }
    },
  );
});
