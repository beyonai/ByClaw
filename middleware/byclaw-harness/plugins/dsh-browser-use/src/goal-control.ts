/** Broker-owned control state. Revocation is checked again immediately before dispatch. */
export interface GoalControlState {
  runId: string
  sessionId: string
  generation: number
  status: 'running' | 'pausing' | 'paused' | 'cancelled'
  deadline: number
  pauseDeadline?: number
  decisions: number
  actions: number
}
export interface GoalTicket { runId: string; generation: number }
export function goalError(code: string): Error & { code: string; fatal: false; recoverable: true } {
  return Object.assign(new Error(code), { code, fatal: false as const, recoverable: true as const })
}
export class BrowserGoalControl {
  #state: GoalControlState | undefined
  #leaseId: string | undefined
  #inFlight = 0
  #unguided = 0
  #maxPauseMs = 120_000
  state(): GoalControlState | undefined {
    if (this.#state && this.#state.status !== 'cancelled' && (Date.now() >= this.#state.deadline || (this.#state.pauseDeadline !== undefined && Date.now() >= this.#state.pauseDeadline))) {
      this.#state.status = 'cancelled'
      this.#state.generation++
    }
    return this.#state ? { ...this.#state } : undefined
  }
  start(leaseId: string, sessionId: string, runId: string, maxRunMs: number, maxPauseMs: number): GoalControlState {
    if (this.#state || this.#unguided) throw goalError('browser-goal-busy')
    this.#leaseId = leaseId
    this.#maxPauseMs = maxPauseMs
    this.#state = { runId, sessionId, generation: 0, status: 'running', deadline: Date.now() + maxRunMs, decisions: 0, actions: 0 }
    return { ...this.#state }
  }
  assertLease(leaseId: string, runId: string): void {
    if (this.#leaseId !== leaseId || this.#state?.runId !== runId) throw goalError('browser-goal-owner-mismatch')
  }
  control(runId: string, generation: number, command: 'pause' | 'resume' | 'cancel'): GoalControlState {
    const state = this.state()
    if (!state || state.runId !== runId || state.generation !== generation) throw goalError('browser-goal-control-stale')
    if (state.status === 'cancelled') throw goalError('browser-goal-cancelled')
    const live = this.#state!
    if (command === 'resume' && live.status !== 'paused') throw goalError('browser-goal-not-paused')
    live.generation++
    if (command === 'cancel') live.status = 'cancelled'
    else if (command === 'resume') { live.status = 'running'; delete live.pauseDeadline }
    else { live.status = this.#inFlight ? 'pausing' : 'paused'; live.pauseDeadline = Date.now() + this.#maxPauseMs }
    return { ...live }
  }
  assertTicket(leaseId: string, ticket: GoalTicket): void {
    const state = this.state()
    if (this.#leaseId !== leaseId || !state || state.runId !== ticket.runId || state.generation !== ticket.generation || state.status !== 'running') throw goalError('browser-goal-control-stale')
  }
  enter(leaseId: string, ticket?: GoalTicket): () => void {
    const state = this.state()
    if (!state) {
      if (ticket) throw goalError('browser-goal-ended')
      this.#unguided++
      return () => { this.#unguided-- }
    }
    if (this.#leaseId !== leaseId || !ticket || ticket.runId !== state.runId) throw goalError('browser-goal-busy')
    if (state.status !== 'running' || ticket.generation !== state.generation) throw goalError('browser-goal-control-stale')
    this.#inFlight++
    const runId = state.runId
    return () => {
      if (this.#state?.runId !== runId) return
      this.#inFlight--
      if (this.#state?.status === 'pausing' && !this.#inFlight) this.#state.status = 'paused'
    }
  }
  progress(leaseId: string, runId: string, decisions: number, actions: number): void {
    this.assertLease(leaseId, runId)
    this.#state!.decisions = decisions
    this.#state!.actions = actions
  }
  finish(leaseId: string): void {
    if (this.#leaseId !== leaseId) return
    this.#inFlight = 0
    this.#state = undefined
    this.#leaseId = undefined
  }
}
