import type {
  CommitResult,
  ForwardActor,
  ForwardInput,
  ForwardOperation,
  ForwardOperationLocator,
  TargetLease,
  RequestLease,
  FreezeCompletion,
  AttachmentCheckpointPatch,
  ForwardWork,
  WorkPage,
  TargetIdentity,
  TargetPage,
  ItemPage,
} from "./group-forward-types.js";
/** The owning adapter supplies short guarded transactions; HTTP never receives generic SQL/checkpoint authority. */
export interface GroupForwardService {
  readonly recovery: import("./group-forward-maintenance.js").ForwardRecoveryPort;
  listTargets(
    actor: ForwardActor,
    source: string,
    page: number,
    size: number,
    keyword?: string,
  ): Promise<TargetPage>;
  items(
    actor: ForwardActor,
    group: string,
    message: string,
    size: number,
    cursor?: string,
  ): Promise<ItemPage>;

  commit(lease: TargetLease): Promise<CommitResult>;
  discoverWork(after: string | null, limit: number): Promise<WorkPage>;
  inspectTarget(requestId: string, targetId: string): Promise<TargetIdentity>;
  prepare(actor: ForwardActor, sourceId: string, input: ForwardInput): Promise<ForwardOperation>;
  status(actor: ForwardActor, sourceId: string, requestId: string): Promise<ForwardOperation>;
  retry(
    actor: ForwardActor,
    sourceId: string,
    requestId: string,
    groups: readonly string[],
  ): Promise<ForwardOperation>;
  inspect(
    requestId: string,
  ): Promise<{ locator: ForwardOperationLocator; actor: ForwardActor; sourceSessionId: string }>;
  claimRequest(
    requestId: string,
    actor: ForwardActor,
    source: string,
    owner: string,
    duration: number,
  ): Promise<RequestLease>;
  claimTarget(
    requestId: string,
    targetId: string,
    actor: ForwardActor,
    source: string,
    owner: string,
    duration: number,
  ): Promise<TargetLease>;
  renewRequest(lease: RequestLease, duration: number): Promise<RequestLease>;
  renewTarget(lease: TargetLease, duration: number): Promise<TargetLease>;
  freezeSources(lease: RequestLease, completion: FreezeCompletion): Promise<void>;
  checkpointAttachment(
    lease: TargetLease,
    expectedVersion: string,
    patch: AttachmentCheckpointPatch,
  ): Promise<TargetLease>;
  markReady(lease: TargetLease): Promise<TargetLease>;
  requestWork(lease: RequestLease): Promise<ForwardWork>;
  targetWork(lease: TargetLease): Promise<ForwardWork>;
  source(lease: RequestLease | TargetLease, selected: string): Promise<unknown>;
}
