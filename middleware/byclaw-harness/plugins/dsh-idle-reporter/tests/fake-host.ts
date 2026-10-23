import type { Context } from '@deepseek-ai/cordis'

type Listener = (...args: any[]) => unknown

export class FakeAgent {
  /** Quiescence of an idle-status Agent; pending models maintenance work. */
  idle: Promise<void> = Promise.resolve()
  constructor(readonly id: string, public status: 'idle' | 'running' = 'idle') {}
  /** Like the real loop, a running turn (even one blocked on the user) does not settle. */
  whenIdle(): Promise<void> {
    return this.status === 'running' ? new Promise<void>(() => undefined) : this.idle
  }
}

export interface FakeJob {
  id: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  owner?: FakeAgent
}

/** Mirrors the visibility rule of the real registry: `list()` = unowned, `list(id)` = unowned + that session's. */
export class FakeJobs {
  jobs: FakeJob[] = []
  readonly listeners: Array<{ filter: unknown; listener: (event: { type: string }) => void }> = []
  list(caller?: string): Array<{ id: string; status: FakeJob['status'] }> {
    return this.jobs
      .filter(job => job.owner === undefined || job.owner.id === caller)
      .map(job => ({ id: job.id, status: job.status }))
  }
  readonly events = {
    subscribe: (filter: unknown, listener: (event: { type: string }) => void): () => void => {
      this.listeners.push({ filter, listener })
      return () => undefined
    },
  }
  /** Deliver one registry event; the default is a visible-set change. */
  changed(type = 'registered'): void {
    for (const { listener } of this.listeners) listener({ type })
  }
}

/** Host-row context stand-in: records listeners and serves `agents` / `jobs`. */
export class FakeHost {
  readonly listeners = new Map<string, Array<{ fn: Listener; options: unknown }>>()
  readonly live: FakeAgent[] = []
  readonly ownerOf = new Map<string, FakeAgent>()
  readonly logs: Array<[level: string, message: string]> = []
  readonly effects: Array<() => unknown> = []
  jobs: FakeJobs | undefined
  private pendingInject: ((ctx: { jobs: FakeJobs }) => void) | undefined

  readonly agents = {
    list: () => [...this.live],
    isOwnedBy: (id: string, owner: FakeAgent) => this.ownerOf.get(id) === owner,
    get: (id: string) => this.live.find(agent => agent.id === id),
  }

  readonly logger = {
    info: (message: string) => { this.logs.push(['info', message]) },
    warn: (message: string) => { this.logs.push(['warn', message]) },
    error: (message: string) => { this.logs.push(['error', message]) },
  }

  get ctx(): Context {
    return this as unknown as Context
  }

  on(name: string, fn: Listener, options?: unknown): () => boolean {
    const list = this.listeners.get(name) ?? []
    list.push({ fn, options })
    this.listeners.set(name, list)
    return () => true
  }

  get(name: string): unknown {
    return name === 'jobs' ? this.jobs : undefined
  }

  inject(deps: string[], callback: (ctx: { jobs: FakeJobs }) => void): void {
    // The tool-environment pool is never provided here: that injection stays pending, as in a process without the plugin.
    if (deps.join() === 'toolEnvironments') return
    if (deps.join() !== 'jobs') throw new Error(`unexpected inject ${deps.join()}`)
    if (this.jobs !== undefined) callback({ jobs: this.jobs })
    else this.pendingInject = callback
  }

  effect(execute: () => unknown): void {
    const disposer = execute()
    if (typeof disposer === 'function') this.effects.push(disposer as () => unknown)
  }

  async dispose(): Promise<void> {
    for (const disposer of this.effects.splice(0).reverse()) await disposer()
  }

  provideJobs(jobs: FakeJobs): void {
    this.jobs = jobs
    this.pendingInject?.({ jobs })
    this.pendingInject = undefined
  }

  emit(name: string, ...args: unknown[]): void {
    for (const { fn } of this.listeners.get(name) ?? []) fn(...args)
  }

  /** Run a waterfall through the registered listeners in order, ending in `last`. */
  waterfall<T>(name: string, payload: unknown, last: () => Promise<T>): Promise<T> {
    const chain = this.listeners.get(name) ?? []
    const step = (index: number): Promise<T> => {
      const entry = chain[index]
      if (entry === undefined) return last()
      return entry.fn(payload, () => step(index + 1)) as Promise<T>
    }
    return step(0)
  }

  add(agent: FakeAgent, owner?: FakeAgent): FakeAgent {
    this.live.push(agent)
    if (owner !== undefined) this.ownerOf.set(agent.id, owner)
    this.emit('agent/created', { agent })
    return agent
  }

  remove(agent: FakeAgent): void {
    this.live.splice(this.live.indexOf(agent), 1)
    this.ownerOf.delete(agent.id)
    this.emit('agent/disposed', { agent })
  }

  setStatus(agent: FakeAgent, status: 'idle' | 'running'): void {
    agent.status = status
    this.emit('agent/status', { agent, status })
  }

  approval(agent: FakeAgent, type: 'approval/asked' | 'approval/decided', id: string): void {
    this.emit('session/event', { id: agent.id }, { type, seq: 1, time: 0, data: { id } })
  }
}
