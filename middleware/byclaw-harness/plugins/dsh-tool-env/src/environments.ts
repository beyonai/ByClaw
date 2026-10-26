/**
 * Several tool environments (B) per user, selected per Agent.
 *
 * One process (A) may run employees with different needs: a video employee
 * wants a media toolchain, a writer a small image. An environment is a sandbox
 * spec (BE's `service_key`) backed by its own `ToolEnvConnection`; an Agent is
 * bound to one (the spec its employee selects), its descendants inherit the
 * binding, and everything else uses the default spec. Only one B exists per
 * spec and user.
 *
 * DSH runs an Agent's whole driver, tool executions included, inside
 * `agents.withInitiator(agent, …)`, so every file, process or sandbox request a
 * tool makes can be attributed to the Agent that issued it. The router mounted
 * as `ctx.ssh` uses that to pick the environment; the pool keeps the facts
 * (identity, connection state, activity) the idle reporter needs per B.
 */
import type { Socket } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SshStreamEndpoint } from '@deepseek-ai/dsh-ssh/schemas'
import type { z } from 'zod'
import type { ToolEnvConnection, ToolEnvConnectionOptions } from './connection.ts'

export const DEFAULT_ENVIRONMENT = 'default'

/** What the pool reports about one environment; the idle reporter turns it into stream entries. */
export interface ToolEnvironmentStatus {
  name: string
  /** BE sandbox type (serviceKey) or OpenSandbox image, once known. */
  serviceKey: string
  /** B's identity on the platform, once it has been started from this process. */
  sandboxId: string | undefined
  connected: boolean
  /** A launch or reconnect is in flight. */
  starting: boolean
  /** Requests in flight plus open process streams; `> 0` means B is in use right now. */
  inflight: number
  lastActiveAt: number
}

/** The subset of a live Agent registry the pool reads: who runs now, who owns whom. */
export interface AgentLineage {
  currentInitiator?(): { id: string } | undefined
  list(): ReadonlyArray<{ id: string }>
  isOwnedBy(child: string, owner: string): boolean
}

export interface ToolEnvironmentsOptions {
  /** Build the connection for a spec, lazily; creation does not start B. */
  create: (name: string) => ToolEnvConnection
  /** The spec unbound Agents use. */
  defaultName?: string
  /** Whether a non-default spec can be served (only backends that take a spec per launch); default: none. */
  accepts?: (name: string) => boolean
  lineage?: () => AgentLineage | undefined
}

/**
 * Per-user pool of tool environments plus the Agent → environment bindings.
 * Mounted as `ctx.toolEnvironments`.
 */
export class ToolEnvironments extends Service {
  private readonly connections = new Map<string, ToolEnvConnection>()
  private readonly bindings = new Map<string, string>()
  readonly defaultName: string

  constructor(ctx: Context, private readonly options: ToolEnvironmentsOptions) {
    super(ctx, 'toolEnvironments')
    this.defaultName = options.defaultName ?? DEFAULT_ENVIRONMENT
  }

  /** Whether this process can serve `name`; what it cannot falls back to the default at bind time. */
  has(name: string): boolean {
    return name === this.defaultName || (name.trim() !== '' && (this.options.accepts?.(name) ?? false))
  }

  /** Specs that have been touched so far, the default first once it exists. */
  get names(): string[] {
    return [...this.connections.keys()]
  }

  /** The connection for `name`, created on first use (creation does not start B). */
  get(name: string = this.defaultName): ToolEnvConnection {
    const key = this.has(name) ? name : this.defaultName
    let connection = this.connections.get(key)
    if (connection === undefined) {
      connection = this.options.create(key)
      this.connections.set(key, connection)
    }
    return connection
  }

  /** Environments that have been touched; others cost nothing and are not listed. */
  list(): ToolEnvironmentStatus[] {
    return [...this.connections.entries()].map(([name, connection]) => ({ name, ...connection.status() }))
  }

  /**
   * Bind an Agent to an environment. Descendants inherit it unless bound
   * themselves. Returns the disposer; an unknown name binds to the default.
   */
  bind(agentId: string, name: string): () => void {
    const resolved = this.has(name) ? name : this.defaultName
    this.bindings.set(agentId, resolved)
    return () => { if (this.bindings.get(agentId) === resolved) this.bindings.delete(agentId) }
  }

  /** The environment an Agent's requests go to: its own binding, else the nearest bound owner's, else the default. */
  environmentOf(agentId: string | undefined): string {
    const lineage = this.options.lineage?.()
    const seen = new Set<string>()
    for (let cursor = agentId; cursor !== undefined && !seen.has(cursor); cursor = ownerOf(lineage, cursor)) {
      seen.add(cursor)
      const bound = this.bindings.get(cursor)
      if (bound !== undefined) return bound
    }
    return this.defaultName
  }

  /** The environment of the Agent whose driver is running on this async path, else the default. */
  current(): ToolEnvConnection {
    return this.get(this.environmentOf(this.options.lineage?.()?.currentInitiator?.()?.id))
  }

  /** Every Agent currently bound (directly) to `name`. */
  boundAgents(name: string): string[] {
    return [...this.bindings.entries()].filter(([, bound]) => bound === name).map(([id]) => id)
  }
}

function ownerOf(lineage: AgentLineage | undefined, agentId: string): string | undefined {
  if (lineage === undefined) return undefined
  return lineage.list().find(candidate => candidate.id !== agentId && lineage.isOwnedBy(agentId, candidate.id))?.id
}

/** What `ctx.ssh` consumers call; the same surface `ToolEnvConnection` offers. */
export interface ToolEnvRequester {
  request<T>(method: string, params: unknown, result: z.ZodType<T>, signal?: AbortSignal, wait?: boolean): Promise<T>
  connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket>
  readonly ready: Promise<unknown>
  readonly connected: boolean
  readonly ptcLaunch: ToolEnvConnectionOptions['ptcLaunch']
  whenConnected(key: string, operation: () => Promise<void>): Promise<void>
  dispose(): Promise<void>
}

/**
 * `ctx.ssh` for a process with several environments: every call goes to the
 * environment of the Agent that is running, so DSH's fs, subprocess, sandbox
 * and PTC providers need no change. Lifecycle (idle pause, close) belongs to
 * the connections themselves.
 */
export class ToolEnvRouter extends Service implements ToolEnvRequester {
  constructor(ctx: Context, private readonly environments: ToolEnvironments) {
    super(ctx, 'ssh')
  }

  request<T>(method: string, params: unknown, result: z.ZodType<T>, signal?: AbortSignal, wait = false): Promise<T> {
    return this.environments.current().request(method, params, result, signal, wait)
  }

  connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    return this.environments.current().connectStream(endpoint, signal)
  }

  get ready(): Promise<unknown> {
    return this.environments.current().ready
  }

  get connected(): boolean {
    return this.environments.current().connected
  }

  get ptcLaunch(): ToolEnvConnectionOptions['ptcLaunch'] {
    return this.environments.current().ptcLaunch
  }

  whenConnected(key: string, operation: () => Promise<void>): Promise<void> {
    return this.environments.current().whenConnected(key, operation)
  }

  /** Consumers call this when remote cleanup is unconfirmed; it only drops the current environment's connection. */
  dispose(): Promise<void> {
    return this.environments.current().dispose()
  }
}
