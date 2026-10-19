import type { ConnectionManager } from "../../application/connection-manager.js";
import type { SqlSession } from "../../application/database-ports.js";
import type {
  ForwardOperationLocator,
  TargetLease,
} from "../../application/group-forward-types.js";
import {
  maintenance,
  pendingMessages,
  recordDelivery,
  type RecoveryCategory,
  type RecoveryPage,
  type DeliveryLease,
  type DeliveryOutcome,
  type CurrentDelivery,
} from "../../application/group-forward-maintenance.js";
import { GroupForwardRepository } from "./group-forward-repository.js";
import { camel, first } from "./sql-utils.js";
import { SqlHistoryRepository } from "./history-repository.js";
import { displayMessages } from "../../application/history/timeline-format.js";
import { positiveId } from "../../application/group-forward-snapshot.js";
import { DomainError } from "../../domain/errors.js";
const fail = (code = "FORWARD_LEASE_LOST"): never => {
  throw new DomainError(code);
};
const instant = (v: any) => new Date(v).getTime();
/** Bound service maintenance never borrows the original actor's group membership or source capability. */
export class GroupForwardRecoveryStore {
  constructor(
    private readonly connection: Pick<ConnectionManager, "write">,
    private readonly tenant: string,
  ) {}
  private run<T>(work: (db: SqlSession, repo: GroupForwardRepository) => Promise<T>): Promise<T> {
    return this.connection.write((db) => work(db, new GroupForwardRepository(db, this.tenant)));
  }
  private async bound(
    db: SqlSession,
    repo: GroupForwardRepository,
    locator: ForwardOperationLocator,
    targetId: string,
  ) {
    if (locator.enterpriseId !== this.tenant || locator.backend !== "TENANT")
      fail("RESOURCE_NOT_ACCESSIBLE");
    const request = await repo.lockRequest(positiveId(locator.requestId));
    const target = await repo.lockTarget(positiveId(targetId));
    if (
      !request ||
      request.backend !== "TENANT" ||
      !target ||
      target.requestId !== request.requestId
    )
      return fail("RESOURCE_NOT_ACCESSIBLE");
    // Database wall time is sampled only after request and target locks have been acquired.
    const clock = await first(db, "SELECT clock_timestamp() AS now");
    return {
      request,
      target,
      now: new Date(clock!.now),
      checkpoint: JSON.parse(target.checkpointJson),
    };
  }
  async scan(
    category: RecoveryCategory,
    after: string | null,
    limit: number,
  ): Promise<RecoveryPage> {
    if (
      !["WORK", "DELIVERY"].includes(category) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      fail("FORWARD_INVALID_REQUEST");
    if (after) positiveId(after);
    const predicate =
      category === "WORK"
        ? "t.state IN ('PENDING','COPYING','READY') AND (t.lease_until IS NULL OR t.lease_until<=clock_timestamp())"
        : "t.state='SUCCEEDED' AND t.pending_delivery=TRUE AND (t.lease_until IS NULL OR t.lease_until<=clock_timestamp())";
    return this.run(async (db) => {
      const rows = (
        await db.query(
          `SELECT t.target_id,r.request_id,r.sources_frozen FROM byai.byai_group_chat_forward_target t JOIN byai.byai_group_chat_forward_request r ON r.request_id=t.request_id AND r.enterprise_id=t.enterprise_id WHERE t.enterprise_id=$1 AND r.backend='TENANT' AND t.target_id>$2 AND ${predicate} ORDER BY t.target_id LIMIT $3`,
          [this.tenant, after ?? "0", limit],
        )
      ).map(camel);
      return {
        candidates: rows.map((r) => ({
          locator: {
            enterpriseId: this.tenant,
            requestId: r.requestId,
            backend: "TENANT" as const,
          },
          targetId: r.targetId,
          sourcesFrozen: r.sourcesFrozen,
        })),
        nextCursor: rows.length === limit ? rows.at(-1)!.targetId : null,
      };
    });
  }
  private duration(owner: string, duration: number) {
    if (
      typeof owner !== "string" ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(owner) ||
      !Number.isSafeInteger(duration) ||
      duration < 1 ||
      duration > 300000
    )
      fail("FORWARD_INVALID_REQUEST");
  }
  private ticket(locator: ForwardOperationLocator, t: any, checkpoint: any): DeliveryLease {
    return {
      locator,
      targetId: t.targetId,
      owner: t.leaseOwner,
      fencingVersion: String(t.fencingVersion),
      leaseUntil: new Date(t.leaseUntil).toISOString(),
      pendingMessageIds: pendingMessages(checkpoint, JSON.parse(t.messageIdsJson)),
    };
  }
  private checkDelivery(t: any, l: DeliveryLease, now: Date) {
    if (
      t.state !== "SUCCEEDED" ||
      !t.pendingDelivery ||
      t.leaseOwner !== l.owner ||
      String(t.fencingVersion) !== l.fencingVersion ||
      instant(t.leaseUntil) <= +now
    )
      fail();
  }
  async claimDelivery(
    locator: ForwardOperationLocator,
    targetId: string,
    owner: string,
    duration: number,
  ): Promise<DeliveryLease | null> {
    this.duration(owner, duration);
    return this.run(async (db, repo) => {
      const { target: t, now, checkpoint } = await this.bound(db, repo, locator, targetId);
      if (
        t.state !== "SUCCEEDED" ||
        !t.pendingDelivery ||
        (t.leaseUntil && instant(t.leaseUntil) > +now)
      )
        return null;
      const until = new Date(+now + duration);
      const m = maintenance(checkpoint);
      m.delivery ??= { messages: [] };
      m.delivery.owner = owner;
      m.delivery.leaseUntil = until.toISOString();
      const rows = await db.query(
        "UPDATE byai.byai_group_chat_forward_target SET lease_owner=$3,lease_until=$4,fencing_version=fencing_version+1,checkpoint_json=$5 WHERE enterprise_id=$1 AND target_id=$2 RETURNING *",
        [this.tenant, targetId, owner, until, JSON.stringify(checkpoint)],
      );
      return this.ticket(locator, camel(rows[0]!), checkpoint);
    });
  }
  async delivery(lease: DeliveryLease, messageId: string): Promise<CurrentDelivery | null> {
    positiveId(messageId);
    return this.run(async (db, repo) => {
      const {
        target: t,
        now,
        checkpoint,
      } = await this.bound(db, repo, lease.locator, lease.targetId);
      this.checkDelivery(t, lease, now);
      if (!pendingMessages(checkpoint, JSON.parse(t.messageIdsJson)).includes(messageId))
        fail("RESOURCE_NOT_ACCESSIBLE");
      const binding = await first(
        db,
        "SELECT item_id FROM byai.byai_group_chat_forward_item WHERE enterprise_id=$1 AND target_id=$2 AND bound_message_id=$3 LIMIT 1",
        [this.tenant, t.targetId, messageId],
      );
      if (!binding) fail("RESOURCE_NOT_ACCESSIBLE");
      const session = await first(
        db,
        "SELECT * FROM byai.byai_session WHERE enterprise_id=$1 AND session_id=$2",
        [this.tenant, t.targetSessionId],
      );
      if (
        !session ||
        session.sessionType !== "hs_as" ||
        ["CLOSED", "GROUP_DISSOLVED", "GROUP_CHAT_ROUTING", "GROUP_CHAT_DISPATCH"].includes(
          session.state,
        )
      )
        return null;
      const row = await first(
        db,
        "SELECT * FROM byai.byai_message WHERE enterprise_id=$1 AND session_id=$2 AND message_id=$3",
        [this.tenant, t.targetSessionId, messageId],
      );
      if (!row || row.archivedAt != null || ![1, 2].includes(row.usage)) return null;
      const history = new SqlHistoryRepository(db, this.tenant);
      const messages = await displayMessages(history, [row]);
      const recipients = (await history.members(t.targetSessionId))
        .filter((m) => m.memObjType === "USER")
        .map((m) => String(m.memObjId));
      return {
        targetId: t.targetId,
        enterpriseId: this.tenant,
        sessionId: t.targetSessionId,
        messages,
        userRecipientIds: recipients,
      };
    });
  }
  async markDelivered(
    lease: DeliveryLease,
    messageId: string,
    outcome: DeliveryOutcome,
  ): Promise<DeliveryLease> {
    if (!["ENQUEUED", "SUPPRESSED"].includes(outcome)) fail("FORWARD_INVALID_REQUEST");
    return this.run(async (db, repo) => {
      const {
        target: t,
        now,
        checkpoint,
      } = await this.bound(db, repo, lease.locator, lease.targetId);
      this.checkDelivery(t, lease, now);
      const ids = JSON.parse(t.messageIdsJson);
      if (!ids.includes(positiveId(messageId))) fail("RESOURCE_NOT_ACCESSIBLE");
      recordDelivery(checkpoint, messageId, outcome, now);
      const pending = pendingMessages(checkpoint, ids).length > 0;
      const m = maintenance(checkpoint);
      if (!pending) {
        m.delivery.owner = null;
        m.delivery.leaseUntil = null;
      }
      const rows = await db.query(
        "UPDATE byai.byai_group_chat_forward_target SET checkpoint_json=$3,pending_delivery=$4,fencing_version=fencing_version+1,lease_owner=CASE WHEN $4 THEN lease_owner ELSE NULL END,lease_until=CASE WHEN $4 THEN lease_until ELSE NULL END WHERE enterprise_id=$1 AND target_id=$2 RETURNING *",
        [this.tenant, t.targetId, JSON.stringify(checkpoint), pending],
      );
      return {
        ...this.ticket(
          lease.locator,
          { ...camel(rows[0]!), leaseOwner: lease.owner, leaseUntil: lease.leaseUntil },
          checkpoint,
        ),
      };
    });
  }
  async renewDelivery(lease: DeliveryLease, duration: number): Promise<DeliveryLease> {
    this.duration(lease.owner, duration);
    return this.run(async (db, repo) => {
      const {
        target: t,
        now,
        checkpoint,
      } = await this.bound(db, repo, lease.locator, lease.targetId);
      this.checkDelivery(t, lease, now);
      const until = new Date(Math.max(instant(t.leaseUntil), +now + duration));
      maintenance(checkpoint).delivery.leaseUntil = until.toISOString();
      await db.query(
        "UPDATE byai.byai_group_chat_forward_target SET lease_until=$3,checkpoint_json=$4 WHERE enterprise_id=$1 AND target_id=$2",
        [this.tenant, t.targetId, until, JSON.stringify(checkpoint)],
      );
      return { ...lease, leaseUntil: until.toISOString() };
    });
  }
  async failRequest(
    lease: import("../../application/group-forward-types.js").RequestLease,
    code: string,
    retryable: boolean,
  ): Promise<void> {
    if (
      !/^(RESOURCE_NOT_ACCESSIBLE|FORWARD_[A-Z_]+)$/.test(code) ||
      lease.actor.enterpriseId !== this.tenant
    )
      fail("FORWARD_INVALID_REQUEST");
    return this.run(async (db, repo) => {
      const r = await repo.lockRequest(positiveId(lease.requestId));
      const clock = await first(db, "SELECT clock_timestamp() AS now");
      if (!r) return fail();
      if (
        r.backend !== "TENANT" ||
        r.actorUserId !== lease.actor.userId ||
        r.sourcesFrozen ||
        r.leaseOwner !== lease.owner ||
        r.fencingVersion !== lease.fencingVersion ||
        instant(r.leaseUntil) <= instant(clock!.now)
      )
        fail();
      const targets = (await repo.targets(r.requestId)).sort((a, b) =>
        BigInt(a.targetId) < BigInt(b.targetId) ? -1 : 1,
      );
      for (const t of targets) {
        await repo.lockTarget(t.targetId);
        if (t.state === "PENDING")
          await db.query(
            "UPDATE byai.byai_group_chat_forward_target SET state='FAILED',error_code=$3,retryable=$4,fencing_version=fencing_version+1 WHERE enterprise_id=$1 AND target_id=$2",
            [this.tenant, t.targetId, code, retryable],
          );
      }
      await db.query(
        "UPDATE byai.byai_group_chat_forward_request SET lease_owner=NULL,lease_until=NULL,fencing_version=fencing_version+1,state='FAILED' WHERE enterprise_id=$1 AND request_id=$2",
        [this.tenant, r.requestId],
      );
    });
  }
  async failTarget(lease: TargetLease, code: string, retryable: boolean): Promise<void> {
    if (!/^(RESOURCE_NOT_ACCESSIBLE|FORWARD_[A-Z_]+)$/.test(code)) fail("FORWARD_INVALID_REQUEST");
    const locator: ForwardOperationLocator = {
      enterpriseId: this.tenant,
      requestId: lease.requestId,
      backend: "TENANT",
    };
    return this.run(async (db, repo) => {
      const { request: r, target: t, now } = await this.bound(db, repo, locator, lease.targetId);
      if (
        r.actorUserId !== lease.actor.userId ||
        r.sourceSessionId !== lease.sourceSessionId ||
        t.targetSessionId !== lease.targetSessionId ||
        t.leaseOwner !== lease.owner ||
        t.fencingVersion !== lease.fencingVersion ||
        instant(t.leaseUntil) <= +now ||
        !["COPYING", "READY"].includes(t.state)
      )
        fail();
      if (!(await repo.failTarget(t.targetId, lease.owner, lease.fencingVersion, code, retryable)))
        fail();
      const targets = await repo.targets(r.requestId);
      const state = targets.some((v) => ["PENDING", "COPYING", "READY"].includes(v.state))
        ? "RUNNING"
        : targets.every((v) => v.state === "SUCCEEDED")
          ? "SUCCEEDED"
          : targets.some((v) => v.state === "SUCCEEDED")
            ? "PARTIAL_FAILED"
            : "FAILED";
      await repo.updateRequestState(r.requestId, state);
    });
  }
}
