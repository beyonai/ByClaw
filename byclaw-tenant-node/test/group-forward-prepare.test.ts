import { describe, expect, it } from "vitest";
import {
  completeManifest,
  mergeAttachment,
  assertReady,
} from "../src/application/group-forward-manifest.js";
import type {
  SourceProof,
  TargetLease,
  ForwardUploadedFile,
} from "../src/application/group-forward-types.js";
const actor = { userId: "30", enterpriseId: "1" };
const proof: SourceProof = {
  sourceId: "source",
  identity: {
    enterpriseId: "1",
    ownerId: "30",
    storageType: "minio",
    scopeId: "owner",
    path: "file",
    immutableVersion: null,
  },
  size: 3,
  sha256: "a".repeat(64),
};
const lease: TargetLease = {
  requestId: "100",
  targetId: "200",
  actor,
  sourceSessionId: "10",
  targetSessionId: "20",
  owner: "claim",
  fencingVersion: "9007199254741001",
  leaseUntil: "2099-01-01T00:00:00Z",
  state: "COPYING",
};
const object = (attachmentId = "a1"): ForwardUploadedFile => ({
  enterpriseId: "1",
  targetSessionId: "20",
  forwardTargetId: "200",
  itemId: "300",
  attachmentId,
  attemptId: "attempt",
  fileName: "file",
  contentType: null,
  size: 0,
  sha256: null,
  createdAt: "2026-01-01T00:00:00Z",
});
const manifest = () => ({
  version: 1 as const,
  candidates: [
    {
      candidateId: "c0",
      itemKey: "opaque",
      selectedMessageId: "50",
      kind: "UPLOADED_FILE" as const,
      address: { currentItemId: null, origin: "RELATED_FILE" as const, key: "0" },
    },
  ],
  slots: [{ candidateId: "c0", targetId: "200", itemId: "300", attachmentId: "a1" }],
  proofs: [],
  resolutions: [],
  attachments: [],
});
describe("durable forwarding preparation manifest", () => {
  it("sourceProofOnlyFreezesOnceAndAssociationsAreExplicit", () => {
    const frozen = completeManifest(
      manifest(),
      { proofs: [proof], resolutions: [{ candidateId: "c0", sourceId: "source" }] },
      actor,
      ["200"],
    );
    expect(frozen.attachments).toEqual([
      {
        targetId: "200",
        itemId: "300",
        attachmentId: "a1",
        sourceId: "source",
        candidateIds: ["c0"],
        referenceKeys: [],
      },
    ]);
    expect(() =>
      completeManifest(
        manifest(),
        { proofs: [proof], resolutions: [{ candidateId: "unknown", sourceId: "source" }] },
        actor,
        ["200"],
      ),
    ).toThrow();
  });
  it("currentManifestPreservesMaintenanceAndRequiresReservedExactAttempt", () => {
    const frozen = completeManifest(
      manifest(),
      { proofs: [proof], resolutions: [{ candidateId: "c0", sourceId: "source" }] },
      actor,
      ["200"],
    );
    const reserved = mergeAttachment(
      { maintenance: { schemaVersion: 1, future: ["keep"] } },
      frozen,
      lease,
      { phase: "RESERVE", sourceId: "source", object: object() },
    );
    expect(() => assertReady(reserved, frozen, lease)).toThrow();
    const verified = mergeAttachment(reserved, frozen, lease, {
      phase: "VERIFY",
      sourceId: "source",
      object: {
        ...object(),
        size: 3,
        sha256: proof.sha256,
        uploadedFile: { fileId: "700", fileName: "file", filePath: "/.sessions/20/copy/file" },
      },
    });
    expect(verified.maintenance).toEqual(reserved.maintenance);
    expect(verified.progress).toBe(100);
    expect(() => assertReady(verified, frozen, lease)).not.toThrow();
    expect(() =>
      mergeAttachment(reserved, frozen, lease, {
        phase: "VERIFY",
        sourceId: "source",
        object: {
          ...object(),
          attemptId: "other",
          size: 3,
          sha256: proof.sha256,
          uploadedFile: { fileId: "700", fileName: "file", filePath: "/.sessions/20/copy/file" },
        },
      }),
    ).toThrow();
  });
  it("sameClaimCannotReplaceAnInflightAttempt", () => {
    const frozen = completeManifest(
      manifest(),
      { proofs: [proof], resolutions: [{ candidateId: "c0", sourceId: "source" }] },
      actor,
      ["200"],
    );
    const current = mergeAttachment({}, frozen, lease, {
      phase: "RESERVE",
      sourceId: "source",
      object: object(),
    });
    const replacement = {
      ...object(),
      attemptId: "other",
    };
    expect(() =>
      mergeAttachment(current, frozen, lease, {
        phase: "RESERVE",
        sourceId: "source",
        object: replacement,
      }),
    ).toThrow("FORWARD_ATTEMPT_CONFLICT");
    expect(() =>
      mergeAttachment(
        current,
        frozen,
        { ...lease, owner: "fresh-claim" },
        { phase: "RESERVE", sourceId: "source", object: replacement },
      ),
    ).not.toThrow();
  });
  it("supersededWorkerCannotVerifyTheReplacementAttempt", () => {
    const frozen = completeManifest(
      manifest(),
      { proofs: [proof], resolutions: [{ candidateId: "c0", sourceId: "source" }] },
      actor,
      ["200"],
    );
    const current = mergeAttachment({}, frozen, lease, {
      phase: "RESERVE",
      sourceId: "source",
      object: object(),
    });
    const nextLease = { ...lease, owner: "next-worker" };
    const replacement = { ...object(), attemptId: "replacement" };
    const reserved = mergeAttachment(current, frozen, nextLease, {
      phase: "RESERVE",
      sourceId: "source",
      object: replacement,
    });
    expect(reserved.attempts?.[0]?.state).toBe("SUPERSEDED");
    expect(() =>
      mergeAttachment(reserved, frozen, lease, {
        phase: "VERIFY",
        sourceId: "source",
        object: {
          ...object(),
          size: 3,
          sha256: proof.sha256,
          uploadedFile: { fileId: "700", fileName: "file", filePath: "/.sessions/20/old/file" },
        },
      }),
    ).toThrow("FORWARD_SOURCE_CHANGED");
    const verified = mergeAttachment(reserved, frozen, nextLease, {
      phase: "VERIFY",
      sourceId: "source",
      object: {
        ...replacement,
        size: 3,
        sha256: proof.sha256,
        uploadedFile: {
          fileId: "701",
          fileName: "file",
          filePath: "/.sessions/20/replacement/file",
        },
      },
    });
    expect(() => assertReady(verified, frozen, nextLease)).not.toThrow();
    expect(verified.copiedObjects?.map((file) => file.attemptId)).toEqual(["replacement"]);
  });
  it("durableBudgetCountsLogicalCopiesAcrossTargetsAndNotRetryAttempts", () => {
    const initial = manifest();
    for (let i = 1; i < 6; i++)
      initial.slots.push({
        candidateId: "c0",
        targetId: String(200 + i),
        itemId: String(300 + i),
        attachmentId: `a${i + 1}`,
      });
    expect(() =>
      completeManifest(
        initial,
        {
          proofs: [{ ...proof, size: 2147483648 }],
          resolutions: [{ candidateId: "c0", sourceId: "source" }],
        },
        actor,
        initial.slots.map((s) => s.targetId),
      ),
    ).toThrow("FORWARD_REQUEST_TOO_LARGE");
  });
});
