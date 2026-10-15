import type { BrowserAction, BrowserActionResult, BrowserInspection } from './protocol.js'
import type { GoalControlState, GoalTicket } from './goal-control.js'
import type { BrowserTurnAgent } from './turn-identity.js'
export interface BrowserGoalInput {
  operation: 'runGoal'
  goal: string
  startUrl?: string
  allowedDomains?: readonly string[]
  allowSubmit?: boolean
  maxSteps?: number
  maxRunMs?: number
  successText?: string
  successUrl?: string
}
export interface BrowserTextContext {
  goal: string
  field: { name: string; role?: string; value?: string }
  page: { title: string; text: string }
  recentActions: string[]
}
export interface BrowserTextService { generate(context: BrowserTextContext, signal: AbortSignal): Promise<string> }
/** Bind once per goal to the trusted caller, never to model-supplied tool arguments. */
export interface BrowserTextServiceFactory { forAgent(agent: BrowserTurnAgent | undefined): BrowserTextService }
export interface GoalConfig {
  maxSteps: number; maxDecisions: number; maxRunMs: number; maxPauseMs: number; maxQueueWaitMs: number
  maxTextCalls: number; minConfidence: number; lockPath: string
}
export interface GoalScope {
  inspect(signal: AbortSignal): Promise<BrowserInspection>
  check(semanticToken: string, ticket: GoalTicket, signal: AbortSignal): Promise<void>
  act(action: BrowserAction, semanticToken: string, ticket: GoalTicket, signal: AbortSignal): Promise<BrowserActionResult>
  state(signal: AbortSignal): Promise<GoalControlState>
  progress(decisions: number, actions: number, signal: AbortSignal): Promise<void>
  saveDownload(path: string, name: string): Promise<string>
}
export interface GoalResult {
  runId: string
  status: 'reported_done' | 'verified' | 'blocked' | 'needs_user' | 'failed' | 'cancelled'
  reason: string
  actions: number
  decisions: number
  textCalls: number
  elapsedMs: number
  jevMs: number
  textMs: number
  browserMs: number
  inputTokens: number
  outputTokens: number
  downloads: { name: string; path: string; size: number }[]
  steps: { operation: string; target?: number; dispatched: boolean }[]
  observation?: BrowserInspection
}
