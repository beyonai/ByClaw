import type { SqlSession } from "../../application/database-ports.js";
import type {
  CommitResult,
  TargetLease,
  ForwardSourceManifest,
  DurableCheckpoint,
  ForwardReference,
  ForwardItem,
  ForwardAttachment,
} from "../../application/group-forward-types.js";
import {
  requireSource,
  requireTarget,
  type GroupIdentity,
} from "../../application/group-forward-eligibility.js";
import { assertReady, assertBudgets } from "../../application/group-forward-manifest.js";
import { projectText } from "../../application/group-forward-snapshot.js";
import { createHash } from "node:crypto";
import { DomainError } from "../../domain/errors.js";
import { GroupForwardRepository, type ForwardRequestRow } from "./group-forward-repository.js";
import { lockSessions } from "./session-locks.js";
import { first, nextId, insert } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";

const denied = (): never => {
  throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
};
const lost = (): never => {
  throw new DomainError("FORWARD_LEASE_LOST");
};
/** Caller owns ConnectionManager.write; every insert/index/binding/receipt shares that SqlSession. */
export async function commitForward(
  db: SqlSession,
  repo: GroupForwardRepository,
  tenant: string,
  lease: TargetLease,
  recompute: (repo: GroupForwardRepository, request: ForwardRequestRow) => Promise<void>,
): Promise<CommitResult> {
  const r = await repo.lockRequest(lease.requestId);
  const before = await repo.target(lease.targetId);
  if (
    !r ||
    !before ||
    r.backend !== "TENANT" ||
    r.enterpriseId !== tenant ||
    lease.actor.enterpriseId !== tenant ||
    r.actorUserId !== lease.actor.userId ||
    r.sourceSessionId !== lease.sourceSessionId ||
    before.requestId !== r.requestId ||
    before.targetSessionId !== lease.targetSessionId
  )
    return denied();
  await lockSessions(db, [r.sourceSessionId, before.targetSessionId]);
  // Committed receipts remain replayable after source removal. The request lock serializes every branch mutation.
  if (before.state === "SUCCEEDED")
    return {
      targetId: before.targetId,
      messageIds: JSON.parse(before.messageIdsJson),
      state: "SUCCEEDED",
      pendingDelivery: before.pendingDelivery,
    };
  const groups = new Map<string, any>();
  for (const id of [r.sourceSessionId, before.targetSessionId].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  )) {
    const group = await first(
      db,
      "SELECT session_id,enterprise_id,session_type,state,project_id FROM byai.byai_session WHERE session_id=$1 FOR UPDATE",
      [id],
    );
    const member = await first(
      db,
      "SELECT mem_obj_id,mem_name FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3 FOR UPDATE",
      [id, r.actorUserId, tenant],
    );
    groups.set(id, { group, member });
  }
  const source = groups.get(r.sourceSessionId),
    target = groups.get(before.targetSessionId);
  requireSource(lease.actor, source.group as GroupIdentity, !!source.member);
  requireTarget(
    lease.actor,
    source.group as GroupIdentity,
    target.group as GroupIdentity,
    !!target.member,
  );
  const t = await repo.lockTarget(before.targetId);
  if (
    !t ||
    t.requestId !== r.requestId ||
    t.targetSessionId !== before.targetSessionId ||
    t.state !== "READY" ||
    lease.state !== "READY" ||
    t.leaseOwner !== lease.owner ||
    t.fencingVersion !== lease.fencingVersion ||
    r.state !== "RUNNING" ||
    !r.sourcesFrozen ||
    !(await repo.live(t.targetId))
  )
    return lost();
  const selected: string[] = JSON.parse(r.frozenJson).selectedMessageIds;
  // These outer rows also serialize generic direct UPDATE/DELETE writers that do not use advisory locks.
  for (const id of [...selected].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))) {
    const m = await first(
      db,
      "SELECT usage,recalled_at,archived_at FROM byai.byai_message WHERE enterprise_id=$1 AND session_id=$2 AND message_id=$3 FOR UPDATE",
      [tenant, r.sourceSessionId, id],
    );
    if (!m || m.recalledAt || m.archivedAt || ![1, 2].includes(m.usage)) return denied();
  }
  const manifest: ForwardSourceManifest = JSON.parse(r.sourceManifestJson),
    checkpoint: DurableCheckpoint = JSON.parse(t.checkpointJson);
  assertBudgets(manifest, [...new Set(manifest.attachments.map((a) => a.targetId))]);
  assertReady(checkpoint, manifest, lease);
  const items: ForwardItem[] = (await repo.items(t.targetId)).map((i) => ({
    itemId: i.itemId,
    selectedMessageId: i.selectedMessageId,
    selectedMergedCard: i.selectedMergedCard,
    sourceMessageId: i.sourceMessageId,
    ordinal: i.ordinal,
    content: i.content,
    speaker: JSON.parse(i.speakerJson),
    createdAt: i.sourceCreatedAt,
    resourceList: JSON.parse(i.referencesJson),
    attachments: [],
  }));
  if (
    !items.length ||
    items.length > 100 ||
    items.some((i) => !selected.includes(i.selectedMessageId))
  )
    return denied();
  const batches =
    r.mode === "MERGED"
      ? [items]
      : [...new Set(items.map((i) => i.selectedMessageId))].map((id) =>
          items.filter((i) => i.selectedMessageId === id),
        );
  const messageIds: string[] = [];
  for (const batch of batches) {
    const id = await nextId(db, tenant),
      merged = r.mode === "MERGED" || batch[0]!.selectedMergedCard;
    if (!merged && batch.length !== 1) return denied();
    const bound = batch.map((item) => bindAttachments(item, manifest, checkpoint, lease));
    const forward: Record<string, unknown> = {
      forwardId: t.targetId,
      mode: r.mode,
      resourceMode: "SNAPSHOT_ONLY",
      itemCount: bound.length,
    };
    if (merged) {
      forward.title = "聊天记录";
      forward.preview = bound.slice(0, 3).map((i) => ({
        speakerName: i.speaker.name,
        content: Array.from(projectText(i)).slice(0, 120).join(""),
      }));
    }
    await insert(db, "byai_message", {
      id,
      message_id: id,
      session_id: t.targetSessionId,
      enterprise_id: tenant,
      creator_id: r.actorUserId,
      creator_name: target.member.memName ?? r.actorUserId,
      usage: 1,
      role: "user",
      message_ref: null,
      message_content: merged ? `聊天记录（${bound.length} 条）` : bound[0]!.content,
      metadata: JSON.stringify({
        scene: "GROUP_CHAT",
        kind: merged ? "FORWARD_MERGED" : "FORWARD_SINGLE",
        forward,
        resourceList: merged ? [] : bound[0]!.resourceList,
        files: merged ? [] : bound[0]!.attachments.filter((f) => f.cloudResourceId),
      }),
      related_resources:
        !merged && bound[0]!.attachments.length
          ? JSON.stringify({ files: bound[0]!.attachments.filter((f) => !f.cloudResourceId) })
          : null,
      created_seq: await nextSequence(db, tenant, t.targetSessionId),
      is_complete: true,
      msg_status: 0,
      create_time: new Date(),
      update_time: new Date(),
    });
    await indexGroupMessage(db, tenant, id, null);
    for (const item of bound) {
      if (
        !(await repo.bindItem(
          t.targetId,
          item.itemId,
          lease.owner,
          lease.fencingVersion,
          id,
          JSON.stringify(item.attachments),
        ))
      )
        return lost();
      await db.query(
        "UPDATE byai.byai_group_chat_forward_item SET references_json=$1,content=$6 WHERE enterprise_id=$2 AND target_id=$3 AND item_id=$4 AND bound_message_id=$5",
        [JSON.stringify(item.resourceList), tenant, t.targetId, item.itemId, id, item.content],
      );
    }
    messageIds.push(id);
  }
  const saved = await repo.succeedTarget(t.targetId, lease.owner, lease.fencingVersion, messageIds);
  // Success does not rewrite checkpoint_json: retain current upload progress and delivery journals byte-for-byte.
  await recompute(repo, r);
  return {
    targetId: t.targetId,
    messageIds,
    state: "SUCCEEDED",
    pendingDelivery: saved.pendingDelivery,
  };
}
export function bindAttachments(
  item: ForwardItem,
  manifest: ForwardSourceManifest,
  checkpoint: DurableCheckpoint,
  lease: TargetLease,
): ForwardItem {
  const bindings = manifest.attachments.filter(
    (a) => a.targetId === lease.targetId && a.itemId === item.itemId,
  );
  const references = new Map<string, ForwardAttachment>();
  const attachments: ForwardAttachment[] = bindings.map((b) => {
    const uploaded = checkpoint.attempts!.find(
      (a) =>
        a.state === "VERIFIED" &&
        a.sourceId === b.sourceId &&
        a.object.itemId === item.itemId &&
        a.object.attachmentId === b.attachmentId,
    )!.object;
    const file = uploaded.uploadedFile;
    if (!file?.filePath || !file.fileName) return lost();
    const result: ForwardAttachment = {
      fileId: typeof file.fileId === "string" ? file.fileId : null,
      fileName: String(file.fileName),
      filePath: String(file.filePath),
      fileUrl: typeof file.fileUrl === "string" ? file.fileUrl : null,
      cloudResourceId: typeof file.cloudResourceId === "string" ? file.cloudResourceId : null,
      mediaType: typeof file.mediaType === "string" ? file.mediaType : null,
      size: uploaded.size,
    };
    b.referenceKeys.forEach((key) => references.set(key, result));
    return result;
  });
  const replacements = new Map<string, string>();
  const resourceList: ForwardReference[] = item.resourceList.map((ref) => {
    const file = references.get(ref.id);
    if (!file) return ref;
    const type = file.cloudResourceId ? "KG_DOC_FILE" : "COMMON_FILE";
    const selector =
      file.fileId ??
      createHash("sha256").update(`${file.cloudResourceId}:${file.filePath}`).digest("hex");
    const id = `${type}_${selector}`;
    replacements.set(ref.id, id);
    return {
      id,
      resourceId: file.cloudResourceId
        ? file.filePath
        : file.filePath.startsWith("/by/")
          ? file.filePath
          : `/by${file.filePath}`,
      resourceName: file.fileName,
      resourceType: type,
      resourceCode: file.cloudResourceId
        ? JSON.stringify({ datasetId: file.cloudResourceId, directoryPath: file.filePath })
        : null,
      extData: null,
    };
  });
  const content = item.content.replace(/\{\{([^{}]+)}}/g, (token, key) =>
    replacements.has(key) ? `{{${replacements.get(key)}}}` : token,
  );
  return { ...item, content, resourceList, attachments };
}
