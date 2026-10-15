import type { GroupPublicContext } from './group-context.ts'
import type { GroupCoordinationSpec, GroupExternalExecution } from './group-scope.ts'

/**
 * Durable AgentTeams state types.
 *
 * A team is one directory under the state root holding `team.json` plus an
 * `inbox/` of per-agent JSONL mailboxes. Members are continuable subagents
 * whose durable child session ids are recorded in the team file, so a team
 * survives harness restarts.
 * @module dsh-agent-teams/types
 */

/** Task lifecycle statuses in progression order. */
export type TaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Statuses after which a task can no longer be claimed or worked on. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled']

/** Team-level execution gate. Controlled teams remain draft until validated. */
export type TeamLifecycle = 'draft' | 'running'

/** One successful real tool invocation associated with the current task attempt. */
export interface ToolReceipt {
  /** Completion-policy key (`tool:<name>` or `skill:<name>`). */
  key: string
  tool: string
  callId: string
  recordedAt: number
}

interface TaskFailureBase {
  code: string
  message: string
  recordedAt: number
}

/** Serializable dispatch or terminal model-request failure attached to the affected task. */
export type TaskFailure =
  | (TaskFailureBase & { phase: 'dispatch'; provider?: never; status?: never })
  | (TaskFailureBase & { phase: 'model'; provider: string; status?: number })
  /** Legacy model failures written before failure phases were introduced. */
  | (TaskFailureBase & { phase?: undefined; provider: string; status?: number })

/** One task of a team's task list. */
export interface TeamTask {
  /** Original attempt is suspended until its linked assistance result returns. */
  externalExecution?: GroupExternalExecution
  waitingAssistance?: string
  waitingUser?: GroupTaskBlocker
  inputRevision?: string
  outputInputRevision?: string
  outputOriginalInputRevision?: string
  outputConfirmedBy?: string
  /** Stable task id within the team (`t1`, `t2`, …). */
  id: string
  /** Brief title for the task. */
  subject: string
  /** What needs to be done. */
  description?: string
  status: TaskStatus
  /** Member name (or `captain`) the task is assigned to; unassigned tasks await a claim. */
  assignee?: string
  /** External session that appended this independent work item, when any. */
  requesterSessionId?: string
  /**
   * Model route explicitly selected by the owning conversation for this task
   * batch. This is an execution-time snapshot, not the member's durable
   * baseline route.
   */
  executionModel?: TaskExecutionModel
  /** Task ids that must reach `completed` before this task can be claimed. */
  dependencies: string[]
  /** Human-readable, non-empty completion contract in controlled mode. */
  acceptanceCriteria?: string
  /** Successful tool/skill receipt keys required before controlled completion. */
  requiredTools?: string[]
  /** Receipts recorded from the real Harness tool pipeline for the current attempt. */
  receipts?: ToolReceipt[]
  /** Last dispatch or terminal model-request failure, when the attempt ended before a task update. */
  lastFailure?: TaskFailure
  /** The worker's written result, set when the task completes or fails. */
  output?: string
  /** Monotonic execution generation. Reassignment/retry invalidates every older attempt. */
  attempt?: number
  /** Capability for the current claimed/in-progress attempt. Members must present it when updating. */
  attemptId?: string
  /** Opaque generation for a revocation/handoff that has not started its next attempt yet. */
  handoffId?: string
  /** A handoff is quiescing the old owner; the scheduler must not dispatch it yet. */
  reassigning?: boolean
  createdAt: number
  updatedAt: number
}

/** A conversation-scoped route frozen onto one asynchronously executed DAG. */
export interface TaskExecutionModel {
  source: 'conversation-override'
  provider: string
  model: string
  reasoningEffort?: string
}

/** Member lifecycle status. */
export type MemberStatus = 'idle' | 'working' | 'removed'

/** Frozen ByClaw employee facts attached to a materialized member. */
export interface ByClawMemberSource {
  kind: 'byclaw-digital-employee'
  employeeId: string
  employeeCode: string
  workerAgentType: string
  createType?: string
  integrationType?: string
  /** Authoritative ByClaw AI-model instance id used to derive this frozen member route. */
  modelId?: string
  version?: string
  description?: string
  capabilities?: string
  persona?: string
  skills: Array<{ code: string; path: string }>
}

/** One team member: a continuable subagent plus its team-side record. */
export interface TeamMember {
  /** Durable continuable subagent session id (empty until spawned). */
  id: string
  /** Unique display name inside the team. */
  name: string
  /** Role description, e.g. `researcher`, `engineer`, `reviewer`. */
  role?: string
  /** Resolved LLM provider route captured when this member was created. */
  provider?: string
  /** Resolved model captured when this member was created. */
  model?: string
  /** Resolved reasoning effort captured from the captain's current session. */
  reasoningEffort?: string
  /** Member execution runtime: `in-process` (default) or `claude-code` (external CLI bridge). */
  runtime?: 'in-process' | 'claude-code' | 'byclaw-worker'
  /** Optional frozen enterprise resource snapshot used to compose this member. */
  source?: ByClawMemberSource
  joinedAt: number
  status: MemberStatus
}

/** One mailbox message. */
export interface TeamMessage {
  id: string
  /** `captain` or a member name. */
  from: string
  /** `captain` or a member name. */
  to: string
  content: string
  /** Route of the recipient's active task when this message was persisted. */
  executionModel?: TaskExecutionModel
  ts: number
  /** Process-local delivery lease; prevents fallback and direct delivery racing. */
  deliveryClaimedAt?: number
  /** Set after the durable message was accepted by the recipient's live Harness inbox. */
  deliveredAt?: number
  /** Set once the recipient has consumed or been shown the durable fallback. */
  readAt?: number
  /** Attempt-scoped terminal report identity used to suppress repeat captain wakes. */
  settlementKey?: string
}

export interface TeamSettlementDispatch {
  key: string
  dispatchedAt: number
}

/** The full durable team record. */
export interface GroupAssistanceRequest {
  id: string
  taskId: string
  attemptId: string
  requesterId: string
  requesterName: string
  objective: string
  inputs?: string
  status: 'pending' | 'completed' | 'blocked'
  requestKey?: string
  inputRevision?: string
  inputsDigest?: string
  messageId?: string
  resolutionInputRevision?: string
  createdAt?: number
  blockingReason?: GroupTaskBlocker['reason']
  result?: string
}

export interface TeamState {
  inputRevision?: string
  groupContextSnapshot?: GroupPublicContext
  summary?: GroupTaskSummary
  assistanceRequests?: GroupAssistanceRequest[]
  /** Server-owned ByClaw task scope; absent for ordinary Harness teams. */
  groupCoordination?: GroupCoordinationSpec
  /** User stop closes scheduler admission until the next explicit user command. */
  stoppedAt?: number
  /** Original team name. */
  name: string
  /** Sanitized directory id; the team's stable identity. */
  id: string
  /** Team purpose/goal. */
  description?: string
  /** Session id of the captain agent that owns this team. */
  captainSessionId: string
  /** Global expert-team template that owns this reusable runtime, when any. */
  templateId?: string
  createdAt: number
  /** Whether deterministic workflow gates are enabled for this team generation. */
  controlledWorkflow?: boolean
  /** Controlled workflow dispatch gate; legacy records without this field behave as running. */
  lifecycle?: TeamLifecycle
  /** Teammates only; the captain is implicit (the owning session). */
  members: TeamMember[]
  tasks: TeamTask[]
  /** Monotonic task id counter. */
  taskSeq: number
  /** Recently delivered terminal reports; archived with the team for restart-safe deduplication. */
  settlementDispatches?: TeamSettlementDispatch[]
}


/** A task is suspended for an actual user input, not automatically retried. */
export interface GroupTaskBlocker {
  reason: 'missing_user_input' | 'outside_scope' | 'no_progress'
  message: string
  inputRevision: string
  requestId?: string
}

export interface GroupTaskSummaryInitial {
  title: string
  goal: string
  deliverables: string[]
  assignments: Array<{ taskId: string; member: string; employeeId?: string; deliverable: string }>
  inputRevision: string
}

export interface GroupTaskSummaryOutcome {
  inputRevision: string
  status: 'running' | 'completed' | 'blocked'
  completed: Array<{ taskId: string; member: string; deliverable: string; output: string }>
  incomplete: Array<{ taskId: string; member: string; deliverable: string; status: string }>
  blockers: Array<{ taskId: string; reason: string; message: string }>
}

export interface GroupTaskSummary {
  schemaVersion: 'byclaw.group-task-summary/v1'
  initial: GroupTaskSummaryInitial
  final?: GroupTaskSummaryOutcome
  assignmentHistory?: Array<{ taskId: string; member: string; employeeId?: string; reassignedAtInputRevision: string }>
}
