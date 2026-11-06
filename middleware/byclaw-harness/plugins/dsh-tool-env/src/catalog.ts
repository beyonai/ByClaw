import { instanceRefsFor, type SandboxInstanceContext } from './instance-context.ts'
import { randomUUID } from 'node:crypto'

export interface SandboxTemplate {
  templateKey: string
  serviceKey: string
  capabilities: readonly string[]
  enabled: boolean
}
export interface SandboxResult { exitCode: number | null; stdout: string; stderr: string }
/** Every operation, including the manifest handshake, is performed by the SSH runtime. */
export interface SandboxRuntime {
  handshake(): Promise<unknown>
  identity?(): { sandboxId?: string; workspaceRoot?: string; instanceContext?: SandboxInstanceContext }
  execute(argv: readonly string[], cwd?: string, signal?: AbortSignal): Promise<SandboxResult>
  release(destroy?: boolean): Promise<void>
}
export interface ExecutionLease {
  leaseId: string
  handleId: string
  templateKey: string
  serviceKey: string
  sandboxId?: string
  instanceContext?: SandboxInstanceContext
  workspaceRoot: string
  operations: { protocol: 'ssh'; exposure: 'private' }
}
interface Handle {
  id: string
  template: SandboxTemplate
  runtime: Promise<SandboxRuntime>
  references: Set<string>
  inflight: number
  pendingAcquires: number
  cleanupActors: Set<string>
  failedCleanup?: SandboxRuntime
  closing?: Promise<void>
}
interface ActorCleanup { retainedLeases: string[]; retainedAllocations: string[] }
interface OwnedLease { actor: string; handle: Handle; public: ExecutionLease; inflight: number }

/** Per-user catalog. Each template owns an independent SSH connection and compute backend. */
export class ToolSandboxManager {
  private readonly handles = new Map<string, Handle>()
  private readonly leases = new Map<string, OwnedLease>()
  private readonly requests = new Map<string, Promise<ExecutionLease>>()
  private readonly verified = new Set<string>()
  private readonly failed = new Set<string>()
  private readonly actorReleases = new Map<string, Promise<ActorCleanup>>()
  private readonly executions = new Map<string, Set<Promise<SandboxResult>>>()
  private disposed = false
  private readonly actorEpochs = new Map<string, number>()
  private refreshPending: Promise<void> | undefined
  private readonly leaseReleases = new Map<string, Promise<{ released: boolean; remainingReferences: number }>>()
  constructor(
    private templates: readonly SandboxTemplate[],
    private readonly create: (template: SandboxTemplate) => Promise<SandboxRuntime>,
    private readonly event: (value: Record<string, string>) => void = () => {},
    private readonly loadCatalog?: () => Promise<readonly SandboxTemplate[]>,
  ) {
    const keys = new Set<string>(), services = new Set<string>()
    for (const t of templates) {
      if (!/^[a-z][a-z0-9-]{0,48}$/u.test(t.templateKey) || !t.serviceKey || keys.has(t.templateKey) || services.has(t.serviceKey)) throw new Error('INVALID_TEMPLATE_CATALOG')
      keys.add(t.templateKey); services.add(t.serviceKey)
    }
  }
  catalog() {
    return this.templates.map(t => ({ ...t, available: t.enabled && !this.failed.has(t.templateKey), verification: this.failed.has(t.templateKey) ? 'failed' : this.verified.has(t.templateKey) ? 'verified' : 'not-yet-verified', operations: { protocol: 'ssh', exposure: 'private' } }))
  }
  /** Existing leases finish normally; publication changes apply to every new acquisition. */
  refreshCatalog(): Promise<void> {
    if (!this.loadCatalog) return Promise.resolve()
    if (this.refreshPending) return this.refreshPending
    this.refreshPending = this.loadCatalog().then(templates => {
      const keys = new Set<string>(), services = new Set<string>()
      for (const t of templates) {
        if (!/^[a-z][a-z0-9-]{0,48}$/u.test(t.templateKey) || !t.serviceKey || keys.has(t.templateKey) || services.has(t.serviceKey)) throw new Error('INVALID_TEMPLATE_CATALOG')
        keys.add(t.templateKey); services.add(t.serviceKey)
      }
      for (const template of templates) {
        const previous = this.templates.find(t => t.templateKey === template.templateKey)
        if (JSON.stringify(previous) !== JSON.stringify(template)) {
          this.verified.delete(template.templateKey); this.failed.delete(template.templateKey)
        }
      }
      this.templates = templates
    }).finally(() => { this.refreshPending = undefined })
    return this.refreshPending
  }
  acquire(actor: string, templateKey: string, requestId: string): Promise<ExecutionLease> {
    if (this.disposed) return Promise.reject(new Error('MANAGER_DISPOSED'))
    const epoch = this.actorEpochs.get(actor) ?? 0
    if (this.loadCatalog) return this.refreshCatalog().then(() => {
      if (this.disposed) throw new Error('MANAGER_DISPOSED')
      if ((this.actorEpochs.get(actor) ?? 0) !== epoch) throw new Error('ACTOR_RELEASING')
      return this.acquireCurrent(actor, templateKey, requestId)
    })
    return this.acquireCurrent(actor, templateKey, requestId)
  }
  private acquireCurrent(actor: string, templateKey: string, requestId: string): Promise<ExecutionLease> {
    if (this.actorReleases.has(actor)) return Promise.reject(new Error('ACTOR_RELEASING'))
    if (!actor || !requestId || requestId.length > 160) return Promise.reject(new Error('INVALID_REQUEST_ID'))
    const key = JSON.stringify([actor, templateKey, requestId])
    const previous = this.requests.get(key)
    if (previous) return previous.then(lease => {
      if (!this.leases.has(lease.leaseId)) throw new Error('REQUEST_ALREADY_RELEASED')
      return lease
    })
    const pending = this.acquireOnce(actor, templateKey)
    this.requests.set(key, pending)
    pending.catch(() => { if (this.requests.get(key) === pending) this.requests.delete(key) })
    return pending
  }
  private async acquireOnce(actor: string, templateKey: string): Promise<ExecutionLease> {
    const template = this.templates.find(t => t.templateKey === templateKey && t.enabled)
    if (!template) throw new Error('TEMPLATE_UNAVAILABLE')
    let handle = this.handles.get(templateKey)
    if (handle && (handle.template.serviceKey !== template.serviceKey
      || JSON.stringify([...handle.template.capabilities].sort()) !== JSON.stringify([...template.capabilities].sort()))) throw new Error('TEMPLATE_CHANGED_WITH_ACTIVE_LEASES')
    if (handle?.failedCleanup) throw new Error('ALLOCATION_CLEANUP_REQUIRED')
    if (handle?.closing) { await handle.closing; return this.acquireOnce(actor, templateKey) }
    if (!handle) {
      const id = randomUUID()
      handle = { id, template, references: new Set(), inflight: 0, pendingAcquires: 0, cleanupActors: new Set(), runtime: Promise.resolve(undefined as never) }
      const selected = handle
      this.handles.set(templateKey, selected)
      this.event({ phase: 'creating', templateKey, handleId: id })
      selected.runtime = Promise.resolve().then(() => this.create(template)).then(async runtime => {
        try {
          const raw = await runtime.handshake()
          const manifest = raw as { contract?: string; purpose?: string; operations?: { protocol?: string; exposure?: string }; capabilities?: unknown }
          if (!manifest || manifest.contract !== 'byclaw.tool-sandbox/v1' || manifest.purpose !== templateKey
            || manifest.operations?.protocol !== 'ssh' || manifest.operations.exposure !== 'private'
            || !Array.isArray(manifest.capabilities) || !template.capabilities.every(c => (manifest.capabilities as unknown[]).includes(c))) throw new Error('CONTRACT_INCOMPATIBLE')
          this.failed.delete(templateKey)
          this.verified.add(templateKey)
          this.event({ phase: 'ready', templateKey, handleId: id })
          return runtime
        } catch (error) {
          try { await runtime.release(true) }
          catch {
            selected.failedCleanup = runtime
            this.event({ phase: 'ownership-retained', origin: 'allocation-failed', templateKey, handleId: id })
          }
          throw error
        }
      }).catch(error => {
        this.verified.delete(templateKey)
        this.failed.add(templateKey)
        if (!selected.failedCleanup && this.handles.get(templateKey) === selected) this.handles.delete(templateKey)
        this.event({ phase: 'failed', templateKey, handleId: id }); throw error
      })
    }
    // Reserve before the await, even for an already-ready runtime. A concurrent
    // last lease return must not close compute that this acquisition now owns.
    handle.cleanupActors.add(actor)
    handle.pendingAcquires++
    try {
      const runtime = await handle.runtime
      const leaseId = randomUUID()
      const value: ExecutionLease = { leaseId, handleId: handle.id, templateKey, serviceKey: template.serviceKey, workspaceRoot: '/by', ...runtime.identity?.(), operations: { protocol: 'ssh', exposure: 'private' } }
      handle.references.add(leaseId); this.leases.set(leaseId, { actor, handle, public: value, inflight: 0 })
      this.event({ phase: 'leased', templateKey, handleId: handle.id, leaseId })
      return value
    } finally { handle.pendingAcquires-- }
  }
  instanceRefs(actor: string, leaseId: string, capability?: string) {
    return instanceRefsFor(this.owned(actor, leaseId).public.instanceContext, capability)
  }
  async execute(actor: string, leaseId: string, argv: readonly string[], cwd?: string, signal?: AbortSignal): Promise<SandboxResult> {
    if (this.actorReleases.has(actor)) throw new Error('ACTOR_RELEASING')
    const lease = this.owned(actor, leaseId)
    const { handle } = lease
    if (handle.closing || !argv.length || argv.some(v => typeof v !== 'string' || v.includes('\0'))) throw new Error('INVALID_EXECUTION')
    handle.inflight++; lease.inflight++
    const running = (async () => {
      try { return await (await handle.runtime).execute(argv, cwd, signal) }
      finally { handle.inflight--; lease.inflight-- }
    })()
    const executions = this.executions.get(actor) ?? new Set<Promise<SandboxResult>>()
    this.executions.set(actor, executions); executions.add(running)
    try { return await running }
    finally { executions.delete(running); if (!executions.size) this.executions.delete(actor) }
  }
  async release(actor: string, leaseId: string, origin: 'tool' | 'task-end' = 'tool'): Promise<{ released: boolean; remainingReferences: number }> {
    this.owned(actor, leaseId)
    const previous = this.leaseReleases.get(leaseId)
    if (previous) return previous
    const pending = this.releaseOnce(actor, leaseId, origin)
    this.leaseReleases.set(leaseId, pending)
    void pending.finally(() => { if (this.leaseReleases.get(leaseId) === pending) this.leaseReleases.delete(leaseId) }).catch(() => {})
    return pending
  }
  private async releaseOnce(actor: string, leaseId: string, origin: 'tool' | 'task-end'): Promise<{ released: boolean; remainingReferences: number }> {
    const lease = this.owned(actor, leaseId)
    const { handle } = lease
    if (lease.inflight > 0) throw new Error('LEASE_BUSY')
    if (handle.references.size === 1 && handle.pendingAcquires === 0) {
      if (handle.inflight > 0) throw new Error('LEASE_BUSY')
      this.event({ phase: 'releasing', origin, templateKey: handle.template.templateKey, handleId: handle.id })
      handle.closing = (async () => {
        try {
          await (await handle.runtime).release(origin === 'tool')
          this.leases.delete(leaseId); handle.references.delete(leaseId)
          if (this.handles.get(handle.template.templateKey) === handle) this.handles.delete(handle.template.templateKey)
          this.event({ phase: 'released', origin, templateKey: handle.template.templateKey, handleId: handle.id })
        } catch (error) {
          delete handle.closing
          this.event({ phase: 'release-failed', origin, templateKey: handle.template.templateKey, handleId: handle.id })
          throw error
        }
      })()
      await handle.closing
      return { released: true, remainingReferences: 0 }
    }
    this.leases.delete(leaseId); handle.references.delete(leaseId)
    this.event({ phase: 'lease-returned', origin, templateKey: handle.template.templateKey, handleId: handle.id, leaseId })
    return { released: false, remainingReferences: handle.references.size + handle.pendingAcquires }
  }
  /** Await this actor's pending allocations, then return only its leases at the real turn boundary. */
  releaseActor(actor: string): Promise<ActorCleanup> {
    const previous = this.actorReleases.get(actor)
    if (previous) return previous
    this.actorEpochs.set(actor, (this.actorEpochs.get(actor) ?? 0) + 1)
    const pending = (async () => {
      await Promise.allSettled([...this.requests.entries()].filter(([key]) => (JSON.parse(key) as string[])[0] === actor).map(([, value]) => value))
      await Promise.allSettled([...(this.executions.get(actor) ?? [])])
      const retainedLeases: string[] = []
      const retainedAllocations: string[] = []
      for (const [leaseId, lease] of [...this.leases]) {
        if (lease.actor !== actor) continue
        try { await this.release(actor, leaseId, 'task-end') }
        catch {
          if (!this.leases.has(leaseId)) continue
          retainedLeases.push(leaseId)
          this.event({ phase: 'ownership-retained', origin: 'task-end', actor, templateKey: lease.handle.template.templateKey, handleId: lease.handle.id, leaseId })
        }
      }
      for (const handle of [...this.handles.values()]) {
        if (!handle.failedCleanup || !handle.cleanupActors.has(actor)) continue
        try { await this.cleanupFailedAllocation(handle, 'task-end') }
        catch { retainedAllocations.push(handle.id) }
      }
      return { retainedLeases, retainedAllocations }
    })()
    this.actorReleases.set(actor, pending)
    void pending.finally(() => { if (this.actorReleases.get(actor) === pending) this.actorReleases.delete(actor) }).catch(() => {})
    return pending
  }
  private cleanupFailedAllocation(handle: Handle, origin: 'task-end' | 'dispose'): Promise<void> {
    if (handle.closing) return handle.closing
    const runtime = handle.failedCleanup
    if (!runtime) return Promise.resolve()
    this.event({ phase: 'releasing', origin, templateKey: handle.template.templateKey, handleId: handle.id })
    handle.closing = (async () => {
      await Promise.resolve() // Publish the closing promise before a provider can throw synchronously.
      try {
        await runtime.release(true)
        delete handle.failedCleanup
        if (this.handles.get(handle.template.templateKey) === handle) this.handles.delete(handle.template.templateKey)
        this.event({ phase: 'released', origin, templateKey: handle.template.templateKey, handleId: handle.id })
      } catch (error) {
        delete handle.closing
        this.event({ phase: 'ownership-retained', origin, templateKey: handle.template.templateKey, handleId: handle.id })
        throw error
      }
    })()
    return handle.closing
  }
  private owned(actor: string, leaseId: string): OwnedLease {
    const lease = this.leases.get(leaseId)
    if (!lease || lease.actor !== actor) throw new Error('LEASE_FORBIDDEN')
    return lease
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled([...this.requests.values()])
    const actors = new Set([...this.leases.values()].map(lease => lease.actor))
    await Promise.all([...actors].map(actor => this.releaseActor(actor)))
    await Promise.allSettled([...this.handles.values()].filter(handle => handle.failedCleanup).map(handle => this.cleanupFailedAllocation(handle, 'dispose')))
    if (this.handles.size || this.leases.size) throw new Error('TOOL_SANDBOX_CLEANUP_RETAINED')
    this.requests.clear()
  }
}
