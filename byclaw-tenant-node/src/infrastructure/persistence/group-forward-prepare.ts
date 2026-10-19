import { GroupForwardRecoveryStore } from "./group-forward-recovery.js";
import {
  GroupChatForwardTargetQueryService,
  GroupChatForwardMessageQuery,
} from "./group-forward-query.js";
import { SqlHistoryRepository } from "./history-repository.js";
import { commitForward } from "./group-forward-commit.js";
import { lockSessions } from "./session-locks.js";
import type { ConnectionManager } from "../../application/connection-manager.js";
import type { SqlSession } from "../../application/database-ports.js";
import type {
  ForwardActor,
  ForwardInput,
  ForwardOperation,
  ForwardOperationLocator,
  TargetLease,
  RequestLease,
  FreezeCompletion,
  AttachmentCheckpointPatch,
  ForwardSourceManifest,
  ForwardWork,
  WorkPage,
  TargetIdentity,
  DurableCheckpoint,
} from "../../application/group-forward-types.js";
import {
  normalizeInput,
  freezeSource,
  positiveId,
} from "../../application/group-forward-snapshot.js";
import {
  requireSource,
  requireTarget,
  type GroupIdentity,
} from "../../application/group-forward-eligibility.js";
import {
  completeManifest,
  assertBudgets,
  mergeAttachment,
  assertReady,
} from "../../application/group-forward-manifest.js";
import { canonicalHash } from "../../interfaces/contracts/group-forward.js";
import { DomainError } from "../../domain/errors.js";
import {
  GroupForwardRepository,
  type ForwardRequestRow,
  type ForwardTargetRow,
} from "./group-forward-repository.js";
import { SqlForwardSourceAuthorityReader } from "./group-forward-source-authority.js";
import { first, nextId } from "./sql-utils.js";
const denied = (): never => {
  throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
};
const lost = (): never => {
  throw new DomainError("FORWARD_LEASE_LOST");
};
const numeric = (a: string, b: string) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
const actorOf = (r: ForwardRequestRow): ForwardActor => ({
  userId: r.actorUserId,
  enterpriseId: r.enterpriseId,
});
const manifestOf = (r: ForwardRequestRow): ForwardSourceManifest =>
  JSON.parse(r.sourceManifestJson);
export function targetLease(r: ForwardRequestRow, t: ForwardTargetRow): TargetLease {
  if (!t.leaseOwner || !t.leaseUntil) return lost();
  return {
    requestId: r.requestId,
    targetId: t.targetId,
    actor: actorOf(r),
    sourceSessionId: r.sourceSessionId,
    targetSessionId: t.targetSessionId,
    owner: t.leaseOwner,
    fencingVersion: t.fencingVersion,
    leaseUntil: t.leaseUntil,
    state: t.state,
  };
}
export function requestLease(r: ForwardRequestRow): RequestLease {
  if (!r.leaseOwner || !r.leaseUntil) return lost();
  return {
    requestId: r.requestId,
    actor: actorOf(r),
    owner: r.leaseOwner,
    fencingVersion: r.fencingVersion,
    leaseUntil: r.leaseUntil,
  };
}
/** All business rows, source reads and mutations use the exact connection.write transaction session. */
export class SqlGroupForwardStore {
  readonly recovery: GroupForwardRecoveryStore;
  constructor(
    private readonly connection: Pick<ConnectionManager, "write">,
    readonly tenantId: string,
  ) {
    positiveId(tenantId);
    this.recovery = new GroupForwardRecoveryStore(connection, tenantId);
  }
  private run<T>(work: (db: SqlSession, repo: GroupForwardRepository) => Promise<T>): Promise<T> {
    return this.connection.write((db) => work(db, new GroupForwardRepository(db, this.tenantId)));
  }
  listTargets(actor: ForwardActor, source: string, page: number, size: number, keyword?: string) {
    this.checkActor(actor);
    return this.run((db) =>
      new GroupChatForwardTargetQueryService(
        this.tenantId,
        new SqlHistoryRepository(db, this.tenantId),
        (sql, args) => db.query(sql, args),
      ).listTargets(actor.userId, source, page, size, keyword),
    );
  }
  items(actor: ForwardActor, group: string, message: string, size: number, cursor?: string) {
    this.checkActor(actor);
    return this.run((db) =>
      new GroupChatForwardMessageQuery(db, this.tenantId).items(
        actor.userId,
        group,
        message,
        size,
        cursor,
      ),
    );
  }

  private checkActor(actor: ForwardActor): void {
    positiveId(actor.userId);
    if (actor.enterpriseId !== this.tenantId) denied();
  }
  private async request(repo: GroupForwardRepository, id: string): Promise<ForwardRequestRow> {
    const r = await repo.lockRequest(positiveId(id));
    if (!r || r.backend !== "TENANT") return denied();
    return r;
  }
  private binding(r: ForwardRequestRow, actor: ForwardActor, source: string): void {
    this.checkActor(actor);
    if (r.actorUserId !== actor.userId || r.sourceSessionId !== source) denied();
  }
  private async group(
    db: SqlSession,
    actor: ForwardActor,
    id: string,
  ): Promise<{ group: GroupIdentity | null; member: boolean }> {
    const group = await first(
      db,
      `SELECT session_id,enterprise_id,session_type,state FROM byai.byai_session WHERE session_id=$1 FOR UPDATE`,
      [id],
    );
    const member = await first(
      db,
      `SELECT mem_obj_id FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3 FOR UPDATE`,
      [id, actor.userId, actor.enterpriseId],
    );
    return { group: group as unknown as GroupIdentity | null, member: member !== null };
  }
  private async eligible(
    db: SqlSession,
    r: ForwardRequestRow,
    targets: readonly string[],
    allowTargetFailure = false,
  ): Promise<Set<string>> {
    const actor = actorOf(r);
    await lockSessions(db, [r.sourceSessionId, ...targets]);
    const groups = new Map<string, Awaited<ReturnType<SqlGroupForwardStore["group"]>>>();
    for (const id of [...new Set([r.sourceSessionId, ...targets])].sort(numeric))
      groups.set(id, await this.group(db, actor, id));
    const source = groups.get(r.sourceSessionId)!;
    requireSource(actor, source.group, source.member);
    const valid = new Set<string>();
    for (const id of targets) {
      const target = groups.get(id)!;
      try {
        requireTarget(actor, source.group!, target.group, target.member);
        valid.add(id);
      } catch (e) {
        if (
          !allowTargetFailure ||
          !(e instanceof DomainError) ||
          e.code !== "RESOURCE_NOT_ACCESSIBLE"
        )
          throw e;
      }
    }
    return valid;
  }
  private async operation(
    repo: GroupForwardRepository,
    r: ForwardRequestRow,
  ): Promise<ForwardOperation> {
    return {
      requestId: r.requestId,
      state: r.state,
      targets: (await repo.targets(r.requestId)).map((t) => ({
        targetSessionId: t.targetSessionId,
        state: t.state,
        messageIds: JSON.parse(t.messageIdsJson),
        errorCode: t.errorCode,
        retryable: t.retryable,
      })),
    };
  }
  /** Caller holds the request lock before changing any target; recomputation never races a stale branch snapshot. */
  async recompute(repo: GroupForwardRepository, r: ForwardRequestRow): Promise<void> {
    const targets = await repo.targets(r.requestId);
    const states = targets.map((t) => t.state);
    r.state = states.some((s) => ["PENDING", "COPYING", "READY"].includes(s))
      ? "RUNNING"
      : states.every((s) => s === "SUCCEEDED")
        ? "SUCCEEDED"
        : states.some((s) => s === "SUCCEEDED")
          ? "PARTIAL_FAILED"
          : "FAILED";
    await repo.updateRequestState(r.requestId, r.state);
  }
  prepare(actor: ForwardActor, sourceId: string, raw: ForwardInput): Promise<ForwardOperation> {
    this.checkActor(actor);
    positiveId(sourceId);
    const input = normalizeInput(raw);
    const hash = canonicalHash(actor, sourceId, input);
    return this.run(async (db, repo) => {
      let previous = await repo.requestByKey(actor.userId, input.clientRequestId);
      if (previous) {
        if (previous.requestHash !== hash || previous.backend !== "TENANT")
          throw new DomainError("IDEMPOTENCY_CONFLICT");
        this.binding(previous, actor, sourceId);
        return this.operation(repo, previous);
      }
      const requestId = await nextId(db, this.tenantId);
      const won = await repo.reserveRequest({
        requestId,
        backend: "TENANT",
        actorUserId: actor.userId,
        sourceSessionId: sourceId,
        clientRequestId: input.clientRequestId,
        mode: input.mode,
        requestHash: hash,
        frozenJson: "{}",
        sourceManifestJson: "{}",
        snapshotVersion: 1,
      });
      if (!won) {
        previous = (await repo.requestByKey(actor.userId, input.clientRequestId)) ?? denied();
        if (previous.requestHash !== hash || previous.backend !== "TENANT")
          throw new DomainError("IDEMPOTENCY_CONFLICT");
        this.binding(previous, actor, sourceId);
        return this.operation(repo, previous);
      }
      const request = await this.request(repo, requestId);
      const eligible = await this.eligible(db, request, input.targetSessionIds, true);
      // The history timeline is create_time then message_id, not selected-ID/input ordering.
      const order = (
        await db.query(
          `SELECT message_id FROM byai.byai_message WHERE enterprise_id=$1 AND session_id=$2 AND message_id=ANY($3::bigint[]) ORDER BY create_time ASC,message_id ASC FOR UPDATE`,
          [this.tenantId, sourceId, input.messageIds],
        )
      ).map((r) => String(r.message_id));
      if (order.length !== input.messageIds.length) denied();
      const reader = new SqlForwardSourceAuthorityReader(db, this.tenantId);
      const messages = [];
      for (const id of order) {
        const message = await reader.readMessage(actor.userId, sourceId, id);
        messages.push({ ...message, timelineOrdinal: messages.length });
      }
      const frozen = freezeSource(actor, sourceId, messages);
      const candidates = frozen.candidates.map((c, index) => {
        if (!c.address) denied();
        return {
          candidateId: `c${index}`,
          itemKey: c.itemKey,
          selectedMessageId: c.selectedMessageId,
          kind: c.kind,
          address: c.address!,
        };
      });
      const slots: ForwardSourceManifest["slots"][number][] = [];
      for (const group of input.targetSessionIds) {
        const targetId = await nextId(db, this.tenantId);
        await repo.insertTarget({ targetId, requestId, targetSessionId: group });
        if (!eligible.has(group)) {
          await repo.rejectPreparedTarget(targetId);
          continue;
        }
        for (const template of frozen.items) {
          const itemId = await nextId(db, this.tenantId);
          await repo.insertItem({
            itemId,
            requestId,
            targetId,
            ordinal: template.ordinal,
            selectedMessageId: template.selectedMessageId,
            selectedMergedCard: template.selectedMergedCard,
            sourceMessageId: template.sourceMessageId,
            content: template.content,
            speakerJson: JSON.stringify(template.speaker),
            sourceCreatedAt: template.createdAt,
            referencesJson: JSON.stringify(template.resourceList),
            attachmentsJson: "[]",
          });
          for (const c of candidates.filter((c) => c.itemKey === template.sourceKey))
            slots.push({
              candidateId: c.candidateId,
              targetId,
              itemId,
              attachmentId: await nextId(db, this.tenantId),
            });
        }
      }
      const { candidates: _transient, ...snapshot } = frozen;
      await repo.finishPreparation(requestId, snapshot, {
        version: 1,
        candidates,
        slots,
        proofs: [],
        resolutions: [],
        attachments: [],
      });
      await this.recompute(repo, request);
      return this.operation(repo, request);
    });
  }
  commit(lease: TargetLease) {
    this.checkActor(lease.actor);
    return this.run((db, repo) =>
      commitForward(db, repo, this.tenantId, lease, (rows, request) =>
        this.recompute(rows, request),
      ),
    );
  }
  status(actor: ForwardActor, source: string, requestId: string): Promise<ForwardOperation> {
    return this.run(async (_db, repo) => {
      const r = await this.request(repo, requestId);
      this.binding(r, actor, source);
      return this.operation(repo, r);
    });
  }
  /** Service-only discovery returns immutable identity, not source content or arbitrary user authority. */
  inspect(
    requestId: string,
  ): Promise<{ locator: ForwardOperationLocator; actor: ForwardActor; sourceSessionId: string }> {
    return this.run(async (_db, repo) => {
      const r = await this.request(repo, requestId);
      return {
        locator: { enterpriseId: this.tenantId, requestId: r.requestId, backend: r.backend },
        actor: actorOf(r),
        sourceSessionId: r.sourceSessionId,
      };
    });
  }
  discoverWork(after: string | null, limit: number): Promise<WorkPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new DomainError("FORWARD_INVALID_REQUEST");
    if (after !== null) positiveId(after);
    return this.run(async (db, _repo) => {
      const rows = await db.query(
        `SELECT t.target_id,t.request_id,r.sources_frozen FROM byai.byai_group_chat_forward_target t JOIN byai.byai_group_chat_forward_request r ON r.enterprise_id=t.enterprise_id AND r.request_id=t.request_id WHERE t.enterprise_id=$1 AND r.backend='TENANT' AND r.state='RUNNING' AND t.target_id>$2 AND t.state IN ('PENDING','COPYING','READY') AND (t.lease_until IS NULL OR t.lease_until<=clock_timestamp()) AND (r.sources_frozen=TRUE OR r.lease_until IS NULL OR r.lease_until<=clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM byai.byai_group_chat_forward_target live WHERE live.enterprise_id=t.enterprise_id AND live.request_id=t.request_id AND live.state IN ('COPYING','READY') AND live.lease_until>clock_timestamp()) ORDER BY t.target_id LIMIT $3`,
        [this.tenantId, after ?? "0", limit + 1],
      );
      const more = rows.length > limit;
      const page = rows.slice(0, limit).map((r) => ({
        locator: {
          enterpriseId: this.tenantId,
          requestId: String(r.request_id),
          backend: "TENANT" as const,
        },
        targetId: String(r.target_id),
        sourcesFrozen: r.sources_frozen === true,
      }));
      return { candidates: page, nextCursor: more ? page.at(-1)!.targetId : null, hasMore: more };
    });
  }
  inspectTarget(requestId: string, targetId: string): Promise<TargetIdentity> {
    return this.run(async (_db, repo) => {
      const r = await this.request(repo, requestId);
      const t = await repo.target(positiveId(targetId));
      if (!t || t.requestId !== r.requestId) return denied();
      return { targetId: t.targetId, targetSessionId: t.targetSessionId, state: t.state };
    });
  }
  private owner(owner: string, duration: number): void {
    if (
      typeof owner !== "string" ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(owner) ||
      !Number.isSafeInteger(duration) ||
      duration <= 0
    )
      throw new DomainError("FORWARD_INVALID_REQUEST");
  }
  claimRequest(
    requestId: string,
    actor: ForwardActor,
    source: string,
    owner: string,
    duration: number,
  ): Promise<RequestLease> {
    this.owner(owner, duration);
    return this.run(async (db, repo) => {
      const r = await this.request(repo, requestId);
      this.binding(r, actor, source);
      await this.eligible(db, r, []);
      return requestLease((await repo.claimRequest(requestId, owner, duration)) ?? lost());
    });
  }
  private async checkedRequest(
    repo: GroupForwardRepository,
    lease: RequestLease,
  ): Promise<ForwardRequestRow> {
    const r = await this.request(repo, lease.requestId);
    if (
      r.actorUserId !== lease.actor.userId ||
      r.enterpriseId !== lease.actor.enterpriseId ||
      r.leaseOwner !== lease.owner ||
      r.fencingVersion !== lease.fencingVersion ||
      r.state !== "RUNNING" ||
      r.sourcesFrozen ||
      !(await repo.liveRequest(r.requestId))
    )
      lost();
    return r;
  }
  private async checkedTarget(
    db: SqlSession,
    repo: GroupForwardRepository,
    lease: TargetLease,
    newWork = true,
  ): Promise<[ForwardRequestRow, ForwardTargetRow]> {
    const r = await this.request(repo, lease.requestId);
    this.binding(r, lease.actor, lease.sourceSessionId);
    if (newWork) await this.eligible(db, r, [lease.targetSessionId]);
    const t = await repo.lockTarget(lease.targetId);
    if (
      !t ||
      t.requestId !== r.requestId ||
      t.targetSessionId !== lease.targetSessionId ||
      t.leaseOwner !== lease.owner ||
      t.fencingVersion !== lease.fencingVersion ||
      t.state !== lease.state ||
      !r.sourcesFrozen ||
      r.state !== "RUNNING" ||
      !(await repo.live(t.targetId))
    )
      lost();
    return [r, t!];
  }
  renewRequest(lease: RequestLease, duration: number): Promise<RequestLease> {
    return this.run(async (db, repo) => {
      const r = await this.checkedRequest(repo, lease);
      await this.eligible(db, r, []);
      return requestLease(await repo.renewRequest(lease, duration));
    });
  }
  freezeSources(lease: RequestLease, completion: FreezeCompletion): Promise<void> {
    return this.run(async (db, repo) => {
      const r = await this.checkedRequest(repo, lease);
      await this.eligible(db, r, []);
      const valid = (await repo.targets(r.requestId))
        .filter((t) => t.state !== "FAILED")
        .map((t) => t.targetId);
      const manifest = completeManifest(manifestOf(r), completion, actorOf(r), valid);
      await repo.freezeSources(
        r.requestId,
        lease.owner,
        lease.fencingVersion,
        JSON.stringify(manifest),
      );
    });
  }
  claimTarget(
    requestId: string,
    targetId: string,
    actor: ForwardActor,
    source: string,
    owner: string,
    duration: number,
  ): Promise<TargetLease> {
    this.owner(owner, duration);
    return this.run(async (db, repo) => {
      const r = await this.request(repo, requestId);
      this.binding(r, actor, source);
      const before = await repo.target(targetId);
      if (!before || before.requestId !== requestId || !r.sourcesFrozen || r.state !== "RUNNING")
        return lost();
      await this.eligible(db, r, [before.targetSessionId]);
      await repo.lockTarget(targetId);
      if (await repo.otherLiveTarget(requestId, targetId)) return lost();
      return targetLease(r, (await repo.claimTarget(targetId, owner, duration)) ?? lost());
    });
  }
  renewTarget(lease: TargetLease, duration: number): Promise<TargetLease> {
    return this.run(async (db, repo) => {
      const [r] = await this.checkedTarget(db, repo, lease);
      return targetLease(r, await repo.renewTarget(lease, duration));
    });
  }
  checkpointAttachment(
    lease: TargetLease,
    expectedVersion: string,
    patch: AttachmentCheckpointPatch,
  ): Promise<TargetLease> {
    return this.run(async (db, repo) => {
      if (expectedVersion !== lease.fencingVersion) lost();
      const [r, t] = await this.checkedTarget(db, repo, lease);
      const manifest = manifestOf(r);
      assertBudgets(manifest, [...new Set(manifest.attachments.map((a) => a.targetId))]);
      const checkpoint = mergeAttachment(JSON.parse(t.checkpointJson), manifest, lease, patch);
      return targetLease(
        r,
        await repo.checkpoint(
          t.targetId,
          lease.owner,
          lease.fencingVersion,
          checkpoint as any,
          "COPYING",
        ),
      );
    });
  }
  markReady(lease: TargetLease): Promise<TargetLease> {
    return this.run(async (db, repo) => {
      const [r, t] = await this.checkedTarget(db, repo, lease);
      if (!["COPYING", "READY"].includes(t.state)) lost();
      const manifest = manifestOf(r);
      assertBudgets(manifest, [...new Set(manifest.attachments.map((a) => a.targetId))]);
      const checkpoint: DurableCheckpoint = JSON.parse(t.checkpointJson);
      assertReady(checkpoint, manifest, lease);
      return targetLease(
        r,
        await repo.checkpoint(
          t.targetId,
          lease.owner,
          lease.fencingVersion,
          {
            ...checkpoint,
            progress: 100,
            copiedObjects: checkpoint.copiedObjects ?? [],
            attachmentMapping: checkpoint.attachmentMapping ?? {},
          } as any,
          "READY",
        ),
      );
    });
  }
  private async work(
    repo: GroupForwardRepository,
    r: ForwardRequestRow,
    t: ForwardTargetRow | null,
  ): Promise<ForwardWork> {
    return {
      locator: { enterpriseId: this.tenantId, requestId: r.requestId, backend: r.backend },
      actor: actorOf(r),
      sourceSessionId: r.sourceSessionId,
      frozen: JSON.parse(r.frozenJson),
      manifest: manifestOf(r),
      sourcesFrozen: r.sourcesFrozen,
      target: t
        ? {
            targetId: t.targetId,
            targetSessionId: t.targetSessionId,
            state: t.state,
            checkpoint: JSON.parse(t.checkpointJson),
            items: (await repo.items(t.targetId)).map((i) => ({
              itemId: i.itemId,
              selectedMessageId: i.selectedMessageId,
              selectedMergedCard: i.selectedMergedCard,
              sourceMessageId: i.sourceMessageId,
              ordinal: i.ordinal,
              content: i.content,
              speaker: JSON.parse(i.speakerJson),
              createdAt: i.sourceCreatedAt,
              resourceList: JSON.parse(i.referencesJson),
              attachments: JSON.parse(i.attachmentsJson),
            })),
          }
        : null,
    };
  }
  requestWork(lease: RequestLease): Promise<ForwardWork> {
    return this.run(async (db, repo) => {
      const r = await this.checkedRequest(repo, lease);
      await this.eligible(db, r, []);
      return this.work(repo, r, null);
    });
  }
  targetWork(lease: TargetLease): Promise<ForwardWork> {
    return this.run(async (db, repo) => {
      const [r, t] = await this.checkedTarget(db, repo, lease);
      return this.work(repo, r, t);
    });
  }
  source(lease: RequestLease | TargetLease, selected: string): Promise<unknown> {
    return this.run(async (db, repo) => {
      const r =
        "targetId" in lease
          ? (await this.checkedTarget(db, repo, lease))[0]
          : await this.checkedRequest(repo, lease);
      if (!JSON.parse(r.frozenJson).selectedMessageIds.includes(selected)) denied();
      return new SqlForwardSourceAuthorityReader(db, this.tenantId).readMessage(
        r.actorUserId,
        r.sourceSessionId,
        selected,
      );
    });
  }
  retry(
    actor: ForwardActor,
    source: string,
    requestId: string,
    groups: readonly string[],
  ): Promise<ForwardOperation> {
    return this.run(async (db, repo) => {
      const r = await this.request(repo, requestId);
      this.binding(r, actor, source);
      const targets = await repo.targets(requestId);
      if (
        groups.length > 10 ||
        new Set(groups).size !== groups.length ||
        groups.some((g) => !targets.some((t) => t.targetSessionId === positiveId(g)))
      )
        denied();
      const eligible = [];
      for (const t of targets.filter((t) => groups.includes(t.targetSessionId))) {
        if (t.state === "SUCCEEDED" || (t.state === "FAILED" && !t.retryable)) continue;
        if (await repo.live(t.targetId)) continue;
        eligible.push(t);
      }
      if (eligible.length) {
        await this.eligible(
          db,
          r,
          eligible.map((t) => t.targetSessionId),
        );
        for (const t of eligible.sort((a, b) => numeric(a.targetId, b.targetId))) {
          await repo.lockTarget(t.targetId);
          if (t.state === "FAILED") await repo.resetFailedTarget(t.targetId);
          else await repo.requeueExpired(t.targetId);
        }
        await this.recompute(repo, r);
      }
      return this.operation(repo, r);
    });
  }
}
