import { lockBusiness } from "./session-locks.js";
import type { SqlSession } from "../../application/database-ports.js";
import { DomainError } from "../../domain/errors.js";
import type {
  ForwardCheckpoint,
  ForwardMode,
  ForwardOperationState,
  ForwardState,
  TargetLease,
  RequestLease,
} from "../../application/group-forward-types.js";

export interface ForwardRequestRow {
  requestId: string;
  enterpriseId: string;
  backend: "LEGACY" | "TENANT";
  actorUserId: string;
  sourceSessionId: string;
  clientRequestId: string;
  mode: ForwardMode;
  requestHash: string;
  state: ForwardOperationState;
  snapshotVersion: number;
  frozenJson: string;
  sourceManifestJson: string;
  sourcesFrozen: boolean;
  leaseOwner: string | null;
  fencingVersion: string;
  leaseUntil: string | null;
  createTime: string;
  updateTime: string;
}
export interface ForwardTargetRow {
  targetId: string;
  enterpriseId: string;
  requestId: string;
  targetSessionId: string;
  state: ForwardState;
  leaseOwner: string | null;
  fencingVersion: string;
  leaseUntil: string | null;
  checkpointJson: string;
  messageIdsJson: string;
  errorCode: string | null;
  retryable: boolean;
  pendingDelivery: boolean;
  createTime: string;
  updateTime: string;
}
export interface ForwardItemRow {
  itemId: string;
  enterpriseId: string;
  requestId: string;
  targetId: string;
  ordinal: number;
  selectedMessageId: string;
  selectedMergedCard: boolean;
  sourceMessageId: string;
  content: string;
  speakerJson: string;
  sourceCreatedAt: string;
  referencesJson: string;
  attachmentsJson: string;
  boundMessageId: string | null;
  createTime: string;
}
export type NewForwardRequest = Pick<
  ForwardRequestRow,
  | "requestId"
  | "backend"
  | "actorUserId"
  | "sourceSessionId"
  | "clientRequestId"
  | "mode"
  | "requestHash"
  | "frozenJson"
  | "sourceManifestJson"
  | "snapshotVersion"
>;
export type NewForwardTarget = Pick<ForwardTargetRow, "targetId" | "requestId" | "targetSessionId">;
export type NewForwardItem = Pick<
  ForwardItemRow,
  | "itemId"
  | "requestId"
  | "targetId"
  | "ordinal"
  | "selectedMessageId"
  | "selectedMergedCard"
  | "sourceMessageId"
  | "content"
  | "speakerJson"
  | "sourceCreatedAt"
  | "referencesJson"
  | "attachmentsJson"
>;

const camel = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
/** Fixed tenant/session repository; caller supplies a transaction session for atomic final publication.
 * PostgreSQL bigint IDs and CAS versions stay strings, including revisions above 2^53.
 */
export class GroupForwardRepository {
  constructor(
    private readonly db: SqlSession,
    private readonly tenantId: string,
  ) {}
  private async rows<T>(sql: string, parameters: unknown[]): Promise<T[]> {
    return (await this.db.query(sql, parameters)).map((row) => camel(row) as T);
  }
  private async mutate(sql: string, parameters: unknown[]): Promise<boolean> {
    return (await this.db.query(sql + " RETURNING 1", parameters)).length === 1;
  }
  private async fenced(sql: string, parameters: unknown[]): Promise<ForwardTargetRow> {
    const [row] = await this.rows<ForwardTargetRow>(sql + " RETURNING *", parameters);
    if (!row) throw new DomainError("FORWARD_LEASE_LOST");
    return row;
  }
  async insertRequest(row: NewForwardRequest): Promise<void> {
    await this.db.query(
      `INSERT INTO byai.byai_group_chat_forward_request (request_id, enterprise_id, actor_user_id, source_session_id, client_request_id, mode, request_hash, frozen_json, source_manifest_json, snapshot_version, backend) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.requestId,
        this.tenantId,
        row.actorUserId,
        row.sourceSessionId,
        row.clientRequestId,
        row.mode,
        row.requestHash,
        row.frozenJson,
        row.sourceManifestJson,
        row.snapshotVersion,
        row.backend,
      ],
    );
  }
  async insertTarget(row: NewForwardTarget): Promise<void> {
    await this.db.query(
      `INSERT INTO byai.byai_group_chat_forward_target (target_id, enterprise_id, request_id, target_session_id) VALUES ($1, $2, $3, $4)`,
      [row.targetId, this.tenantId, row.requestId, row.targetSessionId],
    );
  }
  async insertItem(row: NewForwardItem): Promise<void> {
    await this.db.query(
      `INSERT INTO byai.byai_group_chat_forward_item (item_id, enterprise_id, request_id, target_id, ordinal, selected_message_id, selected_merged_card, source_message_id, content, speaker_json, source_created_at, references_json, attachments_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.itemId,
        this.tenantId,
        row.requestId,
        row.targetId,
        row.ordinal,
        row.selectedMessageId,
        row.selectedMergedCard,
        row.sourceMessageId,
        row.content,
        row.speakerJson,
        row.sourceCreatedAt,
        row.referencesJson,
        row.attachmentsJson,
      ],
    );
  }
  async request(requestId: string): Promise<ForwardRequestRow | null> {
    const rows = await this.rows<ForwardRequestRow>(
      `SELECT * FROM byai.byai_group_chat_forward_request WHERE enterprise_id=$1 AND request_id=$2`,
      [this.tenantId, requestId],
    );
    return rows[0] ?? null;
  }
  async requestByKey(
    actorUserId: string,
    clientRequestId: string,
  ): Promise<ForwardRequestRow | null> {
    const rows = await this.rows<ForwardRequestRow>(
      `SELECT * FROM byai.byai_group_chat_forward_request WHERE enterprise_id=$1 AND actor_user_id=$2 AND client_request_id=$3`,
      [this.tenantId, actorUserId, clientRequestId],
    );
    return rows[0] ?? null;
  }
  async target(targetId: string): Promise<ForwardTargetRow | null> {
    const rows = await this.rows<ForwardTargetRow>(
      `SELECT * FROM byai.byai_group_chat_forward_target WHERE enterprise_id=$1 AND target_id=$2`,
      [this.tenantId, targetId],
    );
    return rows[0] ?? null;
  }
  async targets(requestId: string): Promise<ForwardTargetRow[]> {
    const rows = await this.rows<ForwardTargetRow>(
      `SELECT * FROM byai.byai_group_chat_forward_target WHERE enterprise_id=$1 AND request_id=$2 ORDER BY target_session_id`,
      [this.tenantId, requestId],
    );
    return rows;
  }
  async items(targetId: string): Promise<ForwardItemRow[]> {
    const rows = await this.rows<ForwardItemRow>(
      `SELECT * FROM byai.byai_group_chat_forward_item WHERE enterprise_id=$1 AND target_id=$2 ORDER BY ordinal`,
      [this.tenantId, targetId],
    );
    return rows;
  }
  /** 调用方使用写事务；先执行同值更新等待在途写入，再以数据库时钟和当前行条件更新租约。 */
  async claimRequest(
    requestId: string,
    owner: string,
    leaseDurationMs: number,
  ): Promise<ForwardRequestRow | null> {
    this.checkLeaseInput(this.tenantId, leaseDurationMs);
    await this.lockRequest(requestId);
    const [row] = await this.rows<ForwardRequestRow>(
      `UPDATE byai.byai_group_chat_forward_request SET lease_owner=$3, lease_until=clock_timestamp() + (CAST($4 AS BIGINT) * INTERVAL '0.001' SECOND), fencing_version=fencing_version+1, update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND request_id=$2 AND state='RUNNING' AND sources_frozen=FALSE AND (lease_until IS NULL OR lease_until <= clock_timestamp()) AND $4 > 0 RETURNING *`,
      [this.tenantId, requestId, owner, leaseDurationMs],
    );
    return row ?? null;
  }
  async freezeSources(
    requestId: string,
    owner: string,
    version: string,
    sourceManifestJson: string,
  ): Promise<void> {
    await this.lockRequest(requestId);
    if (
      !(await this.mutate(
        `UPDATE byai.byai_group_chat_forward_request SET source_manifest_json=$5, sources_frozen=TRUE, fencing_version=fencing_version+1, lease_owner=NULL, lease_until=NULL, update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND request_id=$2 AND state='RUNNING' AND sources_frozen=FALSE AND lease_owner=$3 AND fencing_version=$4 AND lease_until > clock_timestamp()`,
        [this.tenantId, requestId, owner, version, sourceManifestJson],
      ))
    )
      throw new DomainError("FORWARD_LEASE_LOST");
  }
  async claimTarget(
    targetId: string,
    owner: string,
    leaseDurationMs: number,
  ): Promise<ForwardTargetRow | null> {
    this.checkLeaseInput(this.tenantId, leaseDurationMs);
    await this.lockTarget(targetId);
    const [row] = await this.rows<ForwardTargetRow>(
      `UPDATE byai.byai_group_chat_forward_target SET lease_owner=$3, lease_until=clock_timestamp() + (CAST($4 AS BIGINT) * INTERVAL '0.001' SECOND), fencing_version=fencing_version+1, state=CASE WHEN state='READY' THEN 'READY' ELSE 'COPYING' END, update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND target_id=$2 AND state IN ('PENDING','COPYING','READY') AND (lease_until IS NULL OR lease_until <= clock_timestamp()) AND $4 > 0 RETURNING *`,
      [this.tenantId, targetId, owner, leaseDurationMs],
    );
    return row ?? null;
  }
  /** Target checkpoints never replace the independently frozen request source proofs. */
  async checkpoint(
    targetId: string,
    owner: string,
    version: string,
    checkpoint: Pick<
      ForwardCheckpoint,
      "copiedObjects" | "attachmentMapping" | "progress" | "attempts"
    >,
    state: "COPYING" | "READY",
  ): Promise<ForwardTargetRow> {
    await this.lockTarget(targetId);
    return this.fenced(
      `UPDATE byai.byai_group_chat_forward_target SET checkpoint_json=$5, state=$6, fencing_version=fencing_version+1, update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND target_id=$2 AND lease_owner=$3 AND fencing_version=$4 AND lease_until > clock_timestamp() AND ((state='COPYING' AND $6 IN ('COPYING','READY')) OR (state='READY' AND $6='READY'))`,
      [this.tenantId, targetId, owner, version, JSON.stringify(checkpoint), state],
    );
  }
  /** Only call inside the final transaction after message inserts and ordered group locks. */
  async succeedTarget(
    targetId: string,
    owner: string,
    version: string,
    messageIds: readonly string[],
  ): Promise<ForwardTargetRow> {
    await this.lockTarget(targetId);
    return this.fenced(
      `UPDATE byai.byai_group_chat_forward_target SET state='SUCCEEDED', message_ids_json=$5, pending_delivery=TRUE, error_code=NULL, retryable=FALSE, lease_owner=NULL, lease_until=NULL, fencing_version=fencing_version+1, update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND target_id=$2 AND state='READY' AND lease_owner=$3 AND fencing_version=$4 AND lease_until > clock_timestamp()`,
      [this.tenantId, targetId, owner, version, JSON.stringify(messageIds)],
    );
  }
  async failTarget(
    targetId: string,
    owner: string,
    version: string,
    errorCode: string,
    retryable: boolean,
  ): Promise<ForwardTargetRow> {
    await this.lockTarget(targetId);
    return this.fenced(
      `UPDATE byai.byai_group_chat_forward_target SET state='FAILED', error_code=$5, retryable=$6, lease_owner=NULL, lease_until=NULL, fencing_version=fencing_version+1, update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND target_id=$2 AND state IN ('COPYING','READY') AND lease_owner=$3 AND fencing_version=$4 AND lease_until > clock_timestamp()`,
      [this.tenantId, targetId, owner, version, errorCode, retryable],
    );
  }
  async resetFailedTarget(targetId: string): Promise<boolean> {
    return this.mutate(
      `UPDATE byai.byai_group_chat_forward_target SET state='PENDING', error_code=NULL, retryable=FALSE, fencing_version=fencing_version+1, lease_owner=NULL, lease_until=NULL, update_time=CURRENT_TIMESTAMP WHERE enterprise_id=$1 AND target_id=$2 AND state='FAILED' AND retryable=TRUE AND (lease_until IS NULL OR lease_until <= clock_timestamp())`,
      [this.tenantId, targetId],
    );
  }
  async updateRequestState(requestId: string, state: ForwardOperationState): Promise<boolean> {
    return this.mutate(
      `UPDATE byai.byai_group_chat_forward_request SET state=$3, update_time=CURRENT_TIMESTAMP WHERE enterprise_id=$1 AND request_id=$2 AND state <> 'SUCCEEDED'`,
      [this.tenantId, requestId, state],
    );
  }
  async markDelivered(targetId: string): Promise<boolean> {
    return this.mutate(
      `UPDATE byai.byai_group_chat_forward_target SET pending_delivery=FALSE, update_time=CURRENT_TIMESTAMP WHERE enterprise_id=$1 AND target_id=$2 AND state='SUCCEEDED' AND pending_delivery=TRUE`,
      [this.tenantId, targetId],
    );
  }
  async pendingDeliveries(limit: number): Promise<ForwardTargetRow[]> {
    const rows = await this.rows<ForwardTargetRow>(
      `SELECT * FROM byai.byai_group_chat_forward_target WHERE enterprise_id=$1 AND state='SUCCEEDED' AND pending_delivery=TRUE ORDER BY target_id LIMIT $2`,
      [this.tenantId, limit],
    );
    return rows;
  }
  async recoverableTargets(limit: number): Promise<ForwardTargetRow[]> {
    const rows = await this.rows<ForwardTargetRow>(
      `SELECT * FROM byai.byai_group_chat_forward_target WHERE enterprise_id=$1 AND state IN ('PENDING','COPYING','READY') AND (lease_until IS NULL OR lease_until <= clock_timestamp()) ORDER BY target_id LIMIT $2`,
      [this.tenantId, limit],
    );
    return rows;
  }
  async bindItem(
    targetId: string,
    itemId: string,
    owner: string,
    version: string,
    messageId: string,
    attachmentsJson: string,
  ): Promise<boolean> {
    await this.lockTarget(targetId);
    return this.mutate(
      `UPDATE byai.byai_group_chat_forward_item SET bound_message_id=$6, attachments_json=$7 WHERE enterprise_id=$1 AND target_id=$2 AND item_id=$3 AND bound_message_id IS NULL AND EXISTS (SELECT 1 FROM byai.byai_group_chat_forward_target t WHERE t.enterprise_id=$1 AND t.target_id=$2 AND t.state='READY' AND t.lease_owner=$4 AND t.fencing_version=$5 AND t.lease_until > clock_timestamp())`,
      [this.tenantId, targetId, itemId, owner, version, messageId, attachmentsJson],
    );
  }
  /** Uses only the persisted live lease and database clock; caller-provided leaseUntil is not authority. */
  async renewTarget(lease: TargetLease, leaseDurationMs: number): Promise<ForwardTargetRow> {
    this.checkLeaseInput(lease.actor.enterpriseId, leaseDurationMs);
    await this.lockTarget(lease.targetId);
    return this.fenced(
      `UPDATE byai.byai_group_chat_forward_target
       SET lease_until=GREATEST(lease_until, clock_timestamp() + (CAST($9 AS BIGINT) * INTERVAL '0.001' SECOND)), update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND request_id=$2 AND target_id=$3 AND target_session_id=$4
         AND lease_owner=$5 AND fencing_version=$6 AND state IN ('COPYING','READY') AND lease_until > clock_timestamp()
         AND $9 > 0 AND EXISTS (SELECT 1 FROM byai.byai_group_chat_forward_request r
           WHERE r.enterprise_id=$1 AND r.request_id=$2 AND r.actor_user_id=$7 AND r.source_session_id=$8 AND r.state='RUNNING')`,
      [
        this.tenantId,
        lease.requestId,
        lease.targetId,
        lease.targetSessionId,
        lease.owner,
        lease.fencingVersion,
        lease.actor.userId,
        lease.sourceSessionId,
        leaseDurationMs,
      ],
    );
  }
  async renewRequest(lease: RequestLease, leaseDurationMs: number): Promise<ForwardRequestRow> {
    this.checkLeaseInput(lease.actor.enterpriseId, leaseDurationMs);
    await this.lockRequest(lease.requestId);
    const [row] = await this.rows<ForwardRequestRow>(
      `UPDATE byai.byai_group_chat_forward_request
       SET lease_until=GREATEST(lease_until, clock_timestamp() + (CAST($6 AS BIGINT) * INTERVAL '0.001' SECOND)), update_time=CURRENT_TIMESTAMP
       WHERE enterprise_id=$1 AND request_id=$2 AND actor_user_id=$3 AND lease_owner=$4 AND fencing_version=$5
         AND state='RUNNING' AND sources_frozen=FALSE AND lease_until > clock_timestamp() AND $6 > 0 RETURNING *`,
      [
        this.tenantId,
        lease.requestId,
        lease.actor.userId,
        lease.owner,
        lease.fencingVersion,
        leaseDurationMs,
      ],
    );
    if (!row) throw new DomainError("FORWARD_LEASE_LOST");
    return row;
  }
  /** 写事务内先取得请求 Redis 锁再取得目标锁，均持有至事务结束。 */
  async lockRequest(requestId: string): Promise<ForwardRequestRow | null> {
    await lockBusiness(this.db, `forward-request:${requestId}`);
    return (
      (
        await this.rows<ForwardRequestRow>(
          `SELECT * FROM byai.byai_group_chat_forward_request WHERE enterprise_id=$1 AND request_id=$2`,
          [this.tenantId, requestId],
        )
      )[0] ?? null
    );
  }
  async lockTarget(targetId: string): Promise<ForwardTargetRow | null> {
    await lockBusiness(this.db, `forward-target:${targetId}`);
    return (
      (
        await this.rows<ForwardTargetRow>(
          `SELECT * FROM byai.byai_group_chat_forward_target WHERE enterprise_id=$1 AND target_id=$2`,
          [this.tenantId, targetId],
        )
      )[0] ?? null
    );
  }
  async reserveRequest(row: NewForwardRequest): Promise<boolean> {
    return (
      (
        await this.db.query(
          `INSERT INTO byai.byai_group_chat_forward_request (request_id,enterprise_id,actor_user_id,source_session_id,client_request_id,mode,request_hash,frozen_json,source_manifest_json,snapshot_version,backend) VALUES ($1,$2,$3,$4,$5,$6,$7,'{}','{}',1,$8) ON CONFLICT (enterprise_id,actor_user_id,client_request_id) DO NOTHING RETURNING request_id`,
          [
            row.requestId,
            this.tenantId,
            row.actorUserId,
            row.sourceSessionId,
            row.clientRequestId,
            row.mode,
            row.requestHash,
            row.backend,
          ],
        )
      ).length === 1
    );
  }
  async finishPreparation(requestId: string, frozen: unknown, manifest: unknown): Promise<void> {
    await this.db.query(
      `UPDATE byai.byai_group_chat_forward_request SET frozen_json=$3,source_manifest_json=$4 WHERE enterprise_id=$1 AND request_id=$2`,
      [this.tenantId, requestId, JSON.stringify(frozen), JSON.stringify(manifest)],
    );
  }
  async rejectPreparedTarget(targetId: string): Promise<void> {
    await this.db.query(
      `UPDATE byai.byai_group_chat_forward_target SET state='FAILED',error_code='RESOURCE_NOT_ACCESSIBLE',retryable=FALSE WHERE enterprise_id=$1 AND target_id=$2 AND state='PENDING' AND fencing_version=0`,
      [this.tenantId, targetId],
    );
  }
  async live(targetId: string): Promise<boolean> {
    return (
      (
        await this.db.query(
          `SELECT 1 FROM byai.byai_group_chat_forward_target WHERE enterprise_id=$1 AND target_id=$2 AND lease_until>clock_timestamp()`,
          [this.tenantId, targetId],
        )
      ).length > 0
    );
  }
  async liveRequest(requestId: string): Promise<boolean> {
    return (
      (
        await this.db.query(
          `SELECT 1 FROM byai.byai_group_chat_forward_request WHERE enterprise_id=$1 AND request_id=$2 AND lease_until>clock_timestamp()`,
          [this.tenantId, requestId],
        )
      ).length > 0
    );
  }
  async otherLiveTarget(requestId: string, targetId: string): Promise<boolean> {
    return (
      (
        await this.db.query(
          `SELECT 1 FROM byai.byai_group_chat_forward_target WHERE enterprise_id=$1 AND request_id=$2 AND target_id<>$3 AND state IN ('COPYING','READY') AND lease_until>clock_timestamp()`,
          [this.tenantId, requestId, targetId],
        )
      ).length > 0
    );
  }
  async requeueExpired(targetId: string): Promise<void> {
    await this.db.query(
      `UPDATE byai.byai_group_chat_forward_target SET state=CASE WHEN state='READY' THEN 'READY' ELSE 'PENDING' END,lease_owner=NULL,lease_until=NULL,fencing_version=fencing_version+1 WHERE enterprise_id=$1 AND target_id=$2 AND state IN ('PENDING','COPYING','READY') AND (lease_until IS NULL OR lease_until<=clock_timestamp())`,
      [this.tenantId, targetId],
    );
  }
  private checkLeaseInput(enterpriseId: string, leaseDurationMs: number): void {
    if (enterpriseId !== this.tenantId) throw new DomainError("FORWARD_LEASE_LOST");
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0)
      throw new DomainError("FORWARD_INVALID_REQUEST");
  }
}
