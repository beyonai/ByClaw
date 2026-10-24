/**
 * One reporter per tool environment (B) of this process.
 *
 * With `@byclaw/dsh-tool-env` the user's commands run in separate sandboxes,
 * one per environment name, and it is those that a reclaim rule must judge.
 * This process knows what B does not: which Agents are bound to it, whether
 * they run a turn or own a background job, and whether the connection has
 * requests or process streams open. Each started environment therefore gets an
 * `IdleReporter` of its own, identified by B's sandbox id, whose busy rule is
 * the Agent rule scoped to that environment or'ed with the connection's own use.
 * An environment that is released (its id disappears) stops being reported;
 * a new id is a new reporter.
 */
import { computeActivity, type Activity } from './activity.ts'
import type { ActivityObservation } from './observe.ts'
import { IdleReporter, type IdleReporterOptions } from './reporter.ts'

/** What `ctx.toolEnvironments` exposes (duck-typed; the plugin is optional). */
export interface ToolEnvironmentsView {
  readonly defaultName: string
  list(): ReadonlyArray<{
    name: string
    serviceKey: string
    sandboxId: string | undefined
    connected: boolean
    starting: boolean
    inflight: number
  }>
  environmentOf(agentId: string | undefined): string
}

export type EnvironmentReporterOptions = Omit<IdleReporterOptions, 'sandboxId' | 'activity' | 'fields' | 'whenIdle'>

export class ToolEnvironmentReporters {
  private readonly reporters = new Map<string, { sandboxId: string; reporter: IdleReporter }>()
  private closed = false

  constructor(
    private readonly environments: ToolEnvironmentsView,
    private readonly observation: ActivityObservation,
    private readonly options: EnvironmentReporterOptions,
  ) {}

  /** Names currently reported, with the sandbox id each entry carries. */
  get active(): ReadonlyMap<string, { sandboxId: string; reporter: IdleReporter }> {
    return this.reporters
  }

  /** Start or stop reporters as environments appear, change identity or go away, then re-evaluate the live ones. */
  changed(): void {
    if (this.closed) return
    this.sync()
    for (const entry of this.reporters.values()) entry.reporter.changed()
  }

  async flush(): Promise<void> {
    await Promise.all([...this.reporters.values()].map(entry => entry.reporter.flush()))
  }

  close(): void {
    this.closed = true
    for (const entry of this.reporters.values()) entry.reporter.close()
    this.reporters.clear()
  }

  private sync(): void {
    const seen = new Set<string>()
    for (const status of this.environments.list()) {
      if (status.sandboxId === undefined) continue
      seen.add(status.name)
      const existing = this.reporters.get(status.name)
      if (existing?.sandboxId === status.sandboxId) continue
      existing?.reporter.close()
      const reporter = new IdleReporter({
        ...this.options,
        sandboxId: status.sandboxId,
        fields: { kind: 'tool-env', environment: status.name, sandboxType: status.serviceKey },
        activity: () => this.activityOf(status.name),
        whenIdle: () => this.observation.whenIdle(),
      })
      this.reporters.set(status.name, { sandboxId: status.sandboxId, reporter })
      reporter.start()
      this.options.logger.info(`reporting tool environment "${status.name}" (${status.sandboxId}) to ${this.options.streamKey}`)
    }
    for (const [name, entry] of this.reporters) {
      if (seen.has(name)) continue
      entry.reporter.close()
      this.reporters.delete(name)
      this.options.logger.info(`tool environment "${name}" (${entry.sandboxId}) is gone; no longer reported`)
    }
  }

  private activityOf(name: string): Activity {
    const scoped = computeActivity(this.observation.facts(), {
      includes: agentId => this.environments.environmentOf(agentId) === name,
      includeUnowned: name === this.environments.defaultName,
    })
    const status = this.environments.list().find(candidate => candidate.name === name)
    const inUse = status !== undefined && (status.inflight > 0 || status.starting)
    return inUse ? { ...scoped, busy: true } : scoped
  }
}
