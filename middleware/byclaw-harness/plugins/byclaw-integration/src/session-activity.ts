export type ByClawSessionRuntimeStatus = 'running' | 'waiting_user' | 'idle' | 'failed' | 'cancelled'

export interface ByClawSessionRuntimeSnapshot {
  status: ByClawSessionRuntimeStatus
  rootActive: boolean
  acceptingInput: boolean
  activeAgentCount: number
  activeChildCount: number
  waitingInteractionCount: number
  revision: number
  changedAt: number
}

/** Aggregate DSH root/descendant activity into one user-facing ByClaw session state. */
export class ByClawSessionActivityTracker {
  private readonly activeAgents = new Set<string>()
  private readonly waitingInteractions = new Set<string>()
  private turnActive = false
  private teamActive = false
  private teamActiveChildCount = 0
  private rootFailed = false
  private cancelled = false
  private revision = 0
  private signature: string | undefined
  private currentSnapshot: ByClawSessionRuntimeSnapshot | undefined

  constructor(
    private readonly rootSessionId: string,
    private readonly now: () => number = Date.now,
  ) {}

  observeAgentStatus(sessionId: string, running: boolean): ByClawSessionRuntimeSnapshot | undefined {
    if (running) this.activeAgents.add(sessionId)
    else this.activeAgents.delete(sessionId)
    if (sessionId === this.rootSessionId) this.turnActive = running
    return this.changed()
  }

  /** Explicit integration-turn fallback for runtimes where an agent/status edge is not observable. */
  observeTurnActive(active: boolean): ByClawSessionRuntimeSnapshot | undefined {
    this.turnActive = active
    return this.changed()
  }

  observeTeamActive(active: boolean): ByClawSessionRuntimeSnapshot | undefined {
    this.teamActive = active
    return this.changed()
  }

  /** Reconcile durable team snapshots into the aggregate child count. */
  observeTeamActivity(active: boolean, activeChildCount: number): ByClawSessionRuntimeSnapshot | undefined {
    this.teamActive = active
    this.teamActiveChildCount = Math.max(0, Math.trunc(activeChildCount))
    return this.changed()
  }

  observeWaitingInteraction(sessionId: string, waiting: boolean): ByClawSessionRuntimeSnapshot | undefined {
    if (waiting) this.waitingInteractions.add(sessionId)
    else this.waitingInteractions.delete(sessionId)
    return this.changed()
  }

  observeRootFailure(): ByClawSessionRuntimeSnapshot | undefined {
    this.rootFailed = true
    return this.changed()
  }

  /** A completed cancellation is terminal for this command's activity projection. */
  cancel(): ByClawSessionRuntimeSnapshot | undefined {
    this.cancelled = true
    this.activeAgents.clear()
    this.waitingInteractions.clear()
    this.turnActive = false
    this.teamActive = false
    this.teamActiveChildCount = 0
    return this.changed()
  }

  snapshot(): ByClawSessionRuntimeSnapshot | undefined {
    return this.currentSnapshot === undefined ? undefined : { ...this.currentSnapshot }
  }

  private changed(): ByClawSessionRuntimeSnapshot | undefined {
    if (this.cancelled) {
      const signature = 'cancelled'
      if (this.signature === signature) return undefined
      this.signature = signature
      return this.remember({
        status: 'cancelled', rootActive: false, acceptingInput: true,
        activeAgentCount: 0, activeChildCount: 0, waitingInteractionCount: 0,
        revision: ++this.revision, changedAt: this.now(),
      })
    }
    const eventActiveChildCount = [...this.activeAgents].filter(id => id !== this.rootSessionId).length
    const activeChildCount = Math.max(eventActiveChildCount, this.teamActiveChildCount)
    const rootActive = this.turnActive || this.activeAgents.has(this.rootSessionId)
    const activeAgentCount = activeChildCount + (rootActive ? 1 : 0)
    const waitingInteractionCount = this.waitingInteractions.size
    const status: ByClawSessionRuntimeStatus = activeAgentCount > 0 || this.teamActive
      ? 'running'
      : waitingInteractionCount > 0
        ? 'waiting_user'
        : this.rootFailed ? 'failed' : 'idle'
    const acceptingInput = !rootActive
    const signature = JSON.stringify({
      status,
      rootActive,
      acceptingInput,
      activeAgentCount,
      activeChildCount,
      waitingInteractionCount,
    })
    if (signature === this.signature) return undefined
    this.signature = signature
    this.revision += 1
    return this.remember({
      status,
      rootActive,
      acceptingInput,
      activeAgentCount,
      activeChildCount,
      waitingInteractionCount,
      revision: this.revision,
      changedAt: this.now(),
    })
  }

  private remember(snapshot: ByClawSessionRuntimeSnapshot): ByClawSessionRuntimeSnapshot {
    this.currentSnapshot = snapshot
    return snapshot
  }
}
