import { requireId } from "../domain/values.js";
import { DomainError } from "../domain/errors.js";
import { canonical } from "../domain/json.js";
import type {
  AttachmentCheckpointPatch,
  DurableCheckpoint,
  ForwardActor,
  ForwardSourceManifest,
  FreezeCompletion,
  PreparedAttachment,
  ForwardUploadedFile,
  TargetLease,
} from "./group-forward-types.js";
const fail = (code = "FORWARD_RESOURCE_UNRESOLVABLE"): never => {
  throw new DomainError(code);
};
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
export const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
export function assertBudgets(
  manifest: ForwardSourceManifest,
  targetIds: readonly string[],
  maxFile = 2147483648,
): void {
  let total = 0;
  for (const target of targetIds) {
    const copies = manifest.attachments.filter((a) => a.targetId === target);
    if (copies.length > 100) fail("FORWARD_TOO_MANY_ATTACHMENTS");
    let size = 0;
    for (const copy of copies) {
      const proof = manifest.proofs.find((p) => p.sourceId === copy.sourceId) ?? fail();
      if (
        !Number.isSafeInteger(proof.size) ||
        proof.size < 0 ||
        proof.size > Math.min(maxFile, 2147483648)
      )
        fail("FORWARD_FILE_TOO_LARGE");
      size += proof.size;
    }
    if (size > 2147483648) fail("FORWARD_TARGET_TOO_LARGE");
    total += size;
  }
  if (total > 10737418240) fail("FORWARD_REQUEST_TOO_LARGE");
}
/** Completion addresses every prepared candidate exactly once; only unresolved display references may be name-only. */
export function completeManifest(
  initial: ForwardSourceManifest,
  completion: FreezeCompletion,
  actor: ForwardActor,
  targetIds: readonly string[],
  maxFile = 2147483648,
): ForwardSourceManifest {
  if (
    !Array.isArray(completion.proofs) ||
    !Array.isArray(completion.resolutions) ||
    completion.proofs.length > initial.candidates.length ||
    completion.resolutions.length !== initial.candidates.length ||
    !unique(completion.proofs.map((p) => p.sourceId)) ||
    !unique(completion.resolutions.map((r) => r.candidateId))
  )
    fail();
  for (const proof of completion.proofs) {
    if (proof.identity?.ownerId !== null) requireId(proof.identity?.ownerId);
    if (
      proof.identity?.immutableVersion !== null &&
      (typeof proof.identity?.immutableVersion !== "string" ||
        proof.identity.immutableVersion.length > 4096)
    )
      fail();
    if (
      !proof.sourceId ||
      proof.sourceId.length > 128 ||
      proof.identity?.enterpriseId !== actor.enterpriseId ||
      !/^[a-f0-9]{64}$/.test(proof.sha256) ||
      !Number.isSafeInteger(proof.size) ||
      proof.size < 0
    )
      fail();
    for (const value of [proof.identity.storageType, proof.identity.scopeId, proof.identity.path])
      if (
        typeof value !== "string" ||
        !value ||
        value.length > 4096 ||
        /[\u0000-\u001f]/.test(value) ||
        /https?:\/\//i.test(value) ||
        /[?#]/.test(value)
      )
        fail();
  }
  const attachments: PreparedAttachment[] = [];
  for (const candidate of initial.candidates) {
    const result =
      completion.resolutions.find((r) => r.candidateId === candidate.candidateId) ?? fail();
    if (result.sourceId === null) {
      if (candidate.kind !== "UNRESOLVED_REFERENCE") fail();
      continue;
    }
    if (!completion.proofs.some((p) => p.sourceId === result.sourceId)) fail();
    for (const slot of initial.slots.filter(
      (s) => s.candidateId === candidate.candidateId && targetIds.includes(s.targetId),
    )) {
      const existing = attachments.find(
        (a) =>
          a.targetId === slot.targetId &&
          a.itemId === slot.itemId &&
          a.sourceId === result.sourceId,
      );
      const ref = candidate.address.origin === "RESOURCE_REFERENCE" ? [candidate.address.key] : [];
      if (existing) {
        const index = attachments.indexOf(existing);
        attachments[index] = {
          ...existing,
          candidateIds: [...existing.candidateIds, candidate.candidateId],
          referenceKeys: [...existing.referenceKeys, ...ref],
        };
      } else
        attachments.push({
          targetId: slot.targetId,
          itemId: slot.itemId,
          attachmentId: slot.attachmentId,
          sourceId: result.sourceId,
          candidateIds: [candidate.candidateId],
          referenceKeys: ref,
        });
    }
  }
  if (completion.proofs.some((p) => !completion.resolutions.some((r) => r.sourceId === p.sourceId)))
    fail();
  // Distinct IDs cannot disguise the same physical identity to bypass within-item alias consolidation.
  if (!unique(completion.proofs.map((p) => canonical(p.identity)))) fail();
  const result = {
    ...initial,
    proofs: [...completion.proofs],
    resolutions: [...completion.resolutions],
    attachments,
  };
  assertBudgets(result, targetIds, maxFile);
  return result;
}
function immutableLocation(a: ForwardUploadedFile, b: ForwardUploadedFile): boolean {
  return [
    "enterpriseId",
    "targetSessionId",
    "forwardTargetId",
    "itemId",
    "attachmentId",
    "attemptId",
    "fileName",
    "createdAt",
  ].every((k) => (a as any)[k] === (b as any)[k]);
}
function location(object: ForwardUploadedFile, lease: TargetLease): void {
  const parts = [object.itemId, object.attachmentId, object.attemptId];
  if (
    object.enterpriseId !== lease.actor.enterpriseId ||
    object.forwardTargetId !== lease.targetId ||
    object.targetSessionId !== lease.targetSessionId ||
    parts.some((p) => typeof p !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(p)) ||
    !object.fileName?.trim() ||
    [".", ".."].includes(object.fileName) ||
    object.fileName.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(object.fileName) ||
    !Number.isFinite(Date.parse(object.createdAt))
  )
    fail("FORWARD_INVALID_UPLOAD");
}
/** Preserve delivery progress while merging one fenced upload attempt. */

export function mergeAttachment(
  current: DurableCheckpoint,
  manifest: ForwardSourceManifest,
  lease: TargetLease,
  patch: AttachmentCheckpointPatch,
): DurableCheckpoint {
  if (lease.state !== "COPYING" || !["RESERVE", "VERIFY"].includes(patch.phase))
    fail("FORWARD_LEASE_LOST");
  const object = patch.object;
  location(object, lease);
  const binding =
    manifest.attachments.find(
      (a) =>
        a.targetId === lease.targetId &&
        a.itemId === object.itemId &&
        a.attachmentId === object.attachmentId &&
        a.sourceId === patch.sourceId,
    ) ?? fail();
  const proof = manifest.proofs.find((p) => p.sourceId === binding.sourceId) ?? fail();
  const attempts = [...(current.attempts ?? [])];
  const activeIndex = attempts.findIndex(
    (a) =>
      a.object.itemId === object.itemId &&
      a.object.attachmentId === object.attachmentId &&
      a.state !== "SUPERSEDED",
  );
  const active = attempts[activeIndex];
  if (patch.phase === "RESERVE") {
    if (object.sha256 !== null || object.size !== 0) fail();
    if (attempts.some((a) => a.object.attemptId === object.attemptId && (!active || a !== active)))
      fail("FORWARD_ATTEMPT_CONFLICT");
    if (active) {
      if (active.object.attemptId === object.attemptId) {
        if (!immutableLocation(active.object, object) || active.state !== "RESERVED")
          fail("FORWARD_ATTEMPT_CONFLICT");
        return current;
      }
      if (active.state === "VERIFIED" || active.reservationOwner === lease.owner)
        fail("FORWARD_ATTEMPT_CONFLICT");
      attempts[activeIndex] = { ...active, state: "SUPERSEDED" };
    }
    attempts.push({
      sourceId: patch.sourceId,
      object,
      state: "RESERVED",
      reservationOwner: lease.owner,
    });
  } else {
    if (
      !active ||
      active.reservationOwner !== lease.owner ||
      active.state !== "RESERVED" ||
      active.sourceId !== patch.sourceId ||
      !immutableLocation(active.object, object) ||
      object.size !== proof.size ||
      object.sha256 !== proof.sha256 ||
      !object.uploadedFile?.fileName ||
      !object.uploadedFile?.filePath
    )
      fail("FORWARD_SOURCE_CHANGED");
    attempts[activeIndex] = { ...active, sourceId: patch.sourceId, object, state: "VERIFIED" };
  }
  const copiedObjects = attempts.filter((a) => a.state === "VERIFIED").map((a) => a.object);
  const attachmentMapping: Record<string, string> = {};
  for (const copied of copiedObjects) {
    const b =
      manifest.attachments.find(
        (a) =>
          a.itemId === copied.itemId &&
          a.attachmentId === copied.attachmentId &&
          a.targetId === lease.targetId,
      ) ?? fail();
    for (const key of b.referenceKeys)
      attachmentMapping[JSON.stringify([b.itemId, key])] = b.attachmentId;
  }
  return {
    ...current,
    attempts,
    copiedObjects,
    attachmentMapping,
    progress: Math.floor(
      (100 * copiedObjects.length) /
        Math.max(1, manifest.attachments.filter((a) => a.targetId === lease.targetId).length),
    ),
  };
}
export function assertReady(
  current: DurableCheckpoint,
  manifest: ForwardSourceManifest,
  lease: TargetLease,
): void {
  for (const binding of manifest.attachments.filter((a) => a.targetId === lease.targetId)) {
    const proof = manifest.proofs.find((p) => p.sourceId === binding.sourceId) ?? fail();
    const copies = (current.attempts ?? []).filter(
      (a) =>
        a.state === "VERIFIED" &&
        a.object.itemId === binding.itemId &&
        a.object.attachmentId === binding.attachmentId &&
        a.sourceId === binding.sourceId,
    );
    if (copies.length !== 1) fail("FORWARD_ATTACHMENTS_INCOMPLETE");
    const object = copies[0]!.object;
    location(object, lease);
    if (
      object.size !== proof.size ||
      object.sha256 !== proof.sha256 ||
      !object.uploadedFile?.fileName ||
      !object.uploadedFile?.filePath
    )
      fail("FORWARD_SOURCE_CHANGED");
  }
  if (
    (current.attempts ?? []).some(
      (a) =>
        a.state !== "SUPERSEDED" &&
        !manifest.attachments.some(
          (b) =>
            b.targetId === lease.targetId &&
            b.itemId === a.object.itemId &&
            b.attachmentId === a.object.attachmentId &&
            b.sourceId === a.sourceId,
        ),
    )
  )
    fail();
}
