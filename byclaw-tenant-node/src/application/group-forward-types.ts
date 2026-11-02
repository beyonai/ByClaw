/** IDs remain decimal strings across HTTP and persistence boundaries. */
export type ForwardMode = "SINGLE" | "MERGED";
export type ForwardState = "PENDING" | "COPYING" | "READY" | "SUCCEEDED" | "FAILED";
/** Request outcome summarizes its independent target branches. */
export type ForwardOperationState = "RUNNING" | "SUCCEEDED" | "PARTIAL_FAILED" | "FAILED";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type LocatorCandidate = Readonly<Record<string, JsonValue>>;
export interface ForwardActor {
  readonly userId: string;
  readonly enterpriseId: string;
}
export interface ForwardInput {
  readonly clientRequestId: string;
  readonly mode: ForwardMode;
  readonly messageIds: readonly string[];
  readonly targetSessionIds: readonly string[];
}
export interface ForwardReference {
  readonly id: string;
  readonly resourceId: string | null;
  readonly resourceName: string;
  readonly resourceType: string | null;
  readonly resourceCode?: string | null;
  readonly extData?: string | null;
}
export interface ForwardSpeaker {
  readonly type: "USER" | "AGENT";
  readonly id: string;
  readonly name: string;
}
export interface ForwardAttachment {
  readonly fileId: string | null;
  readonly fileName: string;
  readonly filePath: string;
  readonly fileUrl: string | null;
  readonly cloudResourceId: string | null;
  readonly mediaType: string | null;
  readonly size: number;
}
export interface ForwardItemTemplate {
  readonly sourceKey: string;
  readonly selectedMessageId: string;
  readonly selectedMergedCard: boolean;
  readonly sourceMessageId: string;
  readonly ordinal: number;
  readonly content: string;
  readonly speaker: ForwardSpeaker;
  readonly createdAt: string;
  readonly resourceList: readonly ForwardReference[];
}
export interface ForwardItem extends Omit<ForwardItemTemplate, "sourceKey"> {
  readonly itemId: string;
  readonly attachments: readonly ForwardAttachment[];
}
export type SourceKind =
  | "UPLOADED_FILE"
  | "KNOWLEDGE_FILE"
  | "USER_WORKSPACE_FILE"
  | "UNRESOLVED_REFERENCE";
export interface SourceCandidate {
  readonly itemKey: string;
  readonly selectedMessageId: string;
  readonly kind: SourceKind;
  readonly locatorCandidate: LocatorCandidate;
  readonly address?: CandidateAddress;
}
export interface FrozenSource {
  readonly selectedMessageIds: readonly string[];
  readonly items: readonly ForwardItemTemplate[];
  readonly candidates: readonly SourceCandidate[];
  readonly snapshotVersion: number;
}
/** Raw metadata is server-only candidate data and never enters a public reference. */
export interface SourceMessage {
  id: string;
  timelineOrdinal: number;
  content: string;
  speaker: ForwardSpeaker;
  createdAt: string;
  resourceList: Record<string, JsonValue>[];
  relatedResources: Record<string, JsonValue>;
  metadata: Record<string, JsonValue>;
  mergedItems: SourceMessage[];
  authority?: SourceAuthority;
}
export interface SourceIdentity {
  readonly enterpriseId: string;
  readonly ownerId: string | null;
  readonly storageType: string;
  readonly scopeId: string;
  readonly path: string;
  readonly immutableVersion: string | null;
}
export interface SourceProof {
  readonly sourceId: string;
  readonly identity: SourceIdentity;
  readonly size: number;
  readonly sha256: string;
}
export interface TargetLease {
  readonly requestId: string;
  readonly targetId: string;
  readonly actor: ForwardActor;
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly owner: string;
  readonly fencingVersion: string;
  readonly leaseUntil: string;
  readonly state: ForwardState;
}
export interface RequestLease {
  readonly requestId: string;
  readonly actor: ForwardActor;
  readonly owner: string;
  readonly fencingVersion: string;
  readonly leaseUntil: string;
}
export interface ForwardUploadedFile {
  readonly enterpriseId: string;
  readonly targetSessionId: string;
  readonly forwardTargetId: string;
  readonly itemId: string;
  readonly attachmentId: string;
  readonly attemptId: string;
  readonly fileName: string;
  readonly contentType: string | null;
  readonly size: number;
  readonly sha256: string | null;
  readonly createdAt: string;
  readonly uploadedFile?: Record<string, unknown>;
}
export interface ForwardCheckpoint {
  readonly sourceProofs: readonly SourceProof[];
  readonly copiedObjects: readonly ForwardUploadedFile[];
  readonly attachmentMapping: Readonly<Record<string, string>>;
  readonly progress: number;
  readonly attempts?: readonly ForwardCopyAttempt[];
}
export interface ForwardTarget {
  readonly targetSessionId: string;
  readonly state: ForwardState;
  readonly messageIds: readonly string[];
  readonly errorCode: string | null;
  readonly retryable: boolean;
}
export interface ForwardOperation {
  readonly requestId: string;
  readonly state: ForwardOperationState;
  readonly targets: readonly ForwardTarget[];
}
export interface CommitResult {
  readonly targetId: string;
  readonly messageIds: readonly string[];
  readonly state: ForwardState;
  readonly pendingDelivery: boolean;
}
export interface SafeDelivery {
  readonly targetId: string;
  readonly messages: readonly LocatorCandidate[];
  readonly userRecipientIds: readonly string[];
  readonly enterpriseId: string;
}
export interface CommittedTargetBinding {
  readonly targetId: string;
  readonly enterpriseId: string;
  readonly requestId: string;
}
export type ForwardPhase = "RESOLVE" | "COPY" | "COMMIT" | "DELIVERY";
export interface ForwardExecutionContext {
  readonly actor: ForwardActor;
  readonly backend: ForwardBackend;
  readonly requestId: string;
  readonly targetId: string | null;
  readonly lease: TargetLease | null;
  readonly phase: ForwardPhase;
  readonly permissions: readonly string[];
}
export type CreateRequest = ForwardInput;
export interface RetryRequest {
  readonly targetSessionIds: readonly string[];
}
export interface TargetItem {
  readonly sessionId: string;
  readonly name: string;
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly role: string;
}
export interface TargetPage {
  readonly pageNum: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly list: readonly TargetItem[];
}
export type OperationResponse = ForwardOperation;
export interface ItemPage {
  readonly items: readonly ForwardItem[];
  readonly pageSize: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** Backend selection is server-owned, never a client fallback hint. */
export type ForwardBackend = "LEGACY" | "TENANT";
export interface CandidateAddress {
  currentItemId: string | null;
  origin: "RESOURCE_REFERENCE" | "RELATED_FILE" | "PUBLISHED_FILE";
  key: string;
}
export interface SourceAuthority {
  actor: ForwardActor;
  backend: ForwardBackend;
  sourceSessionId: string;
  selectedMessageId: string;
  projectId: string | null;
  currentItemId: string | null;
  scene: string | null;
  kind: string | null;
  publicationFiles: LocatorCandidate[];
}
export interface AttachmentCheckpointPatch {
  phase: "RESERVE" | "VERIFY";
  sourceId: string;
  object: ForwardUploadedFile;
}
export interface ForwardCopyAttempt {
  reservationOwner?: string;
  sourceId: string;
  object: ForwardUploadedFile;
  state: "RESERVED" | "VERIFIED" | "SUPERSEDED";
}

/** A server-minted owning-store locator; never accepted from a public forwarding request. */
export interface ForwardOperationLocator {
  readonly enterpriseId: string;
  readonly requestId: string;
  readonly backend: ForwardBackend;
}
export interface PreparedCandidate {
  readonly candidateId: string;
  readonly itemKey: string;
  readonly selectedMessageId: string;
  readonly kind: SourceKind;
  readonly address: CandidateAddress;
}
export interface PreparedSlot {
  readonly candidateId: string;
  readonly targetId: string;
  readonly itemId: string;
  readonly attachmentId: string;
}
export interface CandidateResolution {
  readonly candidateId: string;
  readonly sourceId: string | null;
}
export interface FreezeCompletion {
  readonly proofs: readonly SourceProof[];
  readonly resolutions: readonly CandidateResolution[];
}
export interface PreparedAttachment {
  readonly targetId: string;
  readonly itemId: string;
  readonly attachmentId: string;
  readonly sourceId: string;
  readonly candidateIds: readonly string[];
  readonly referenceKeys: readonly string[];
}
export interface ForwardSourceManifest {
  readonly version: 1;
  readonly candidates: readonly PreparedCandidate[];
  readonly slots: readonly PreparedSlot[];
  readonly proofs: readonly SourceProof[];
  readonly resolutions: readonly CandidateResolution[];
  readonly attachments: readonly PreparedAttachment[];
}
/** Untouched extension keys survive every high-level mutation, including future maintenance journals. */
export interface DurableCheckpoint extends Record<string, unknown> {
  copiedObjects?: ForwardUploadedFile[];
  attachmentMapping?: Record<string, string>;
  progress?: number;
  attempts?: ForwardCopyAttempt[];
}
export interface ForwardWork {
  readonly locator: ForwardOperationLocator;
  readonly actor: ForwardActor;
  readonly sourceSessionId: string;
  readonly frozen: Omit<FrozenSource, "candidates">;
  readonly manifest: ForwardSourceManifest;
  readonly sourcesFrozen: boolean;
  readonly target: {
    targetId: string;
    targetSessionId: string;
    state: ForwardState;
    checkpoint: DurableCheckpoint;
    items: ForwardItem[];
  } | null;
}

export interface WorkCandidate {
  deliveryOnly?: boolean;
  locator: ForwardOperationLocator;
  targetId: string;
  sourcesFrozen: boolean;
}
export interface WorkPage {
  candidates: WorkCandidate[];
  nextCursor: string | null;
  hasMore: boolean;
}
export interface TargetIdentity {
  targetId: string;
  targetSessionId: string;
  state: ForwardState;
}
