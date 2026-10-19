/**
 * Sandboxed Bash provider that explicitly forwards the complete host
 * environment after DSH's ambient credential scrub, and — merged in from the
 * standalone `@byclaw/dsh-bash-rtk` plugin — routes eligible commands through
 * rtk (Rust Token Killer) to compress tool output and save tokens. The two
 * transforms touch disjoint `ShellExecSpec` fields (`env` vs `command`) and
 * compose without interaction; see `ForwardingSandboxBashExecutor.resolve()`.
 *
 * It additionally guards build-class commands against memory exhaustion: they
 * take a concurrency slot, get a memory-derived `MAKEFLAGS`, and are marked as
 * the preferred OOM victim so a compile that exhausts memory is killed instead
 * of the agent. See {@link ./guard-runtime guard-runtime.ts} for the moving
 * parts and {@link ./capability capability.ts} for how the enforcement tier is
 * derived per host.
 *
 * **Transform order is load-bearing.** `resolve()` applies rtk wrapping first
 * and the guard prefix second. The guard prefix contains `>` and `;`, both in
 * rtk's metacharacter set, so prepending it first would disqualify every
 * command from rtk routing and silently forfeit output compression —
 * `cargo build` and `go build` are both heavy and rtk-eligible, so the two
 * transforms really do meet.
 *
 * @module @byclaw/dsh-bash-provider
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import type { Config } from '@deepseek-ai/dsh-bash-sandbox'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createRedis } from '@byclaw/by-framework'
import { assertBrowserCommandAllowed } from './browser-command-policy.ts'
import { createFileLockIo } from './file-lock-io.ts'
import {
  DEFAULT_GUARD_CONFIG,
  type GuardConfig,
  type GuardStatus,
  GuardRuntime,
  renderGuardStatus,
} from './guard-runtime.ts'
import { DEFAULT_GUARD_SETTINGS } from './guard-wrap.ts'
import { wrapWithRtk } from './rtk-wrap.ts'
import {
  DEFAULT_SLOT_SETTINGS,
  type SlotRedisClient,
  SlotPool,
  fileLockBackend,
  redisBackend,
  selectBackend,
} from './slot-lease.ts'

export { assertBrowserCommandAllowed, DirectBrowserAccessDeniedError } from './browser-command-policy.ts'
export { wrapWithRtk } from './rtk-wrap.ts'
export { GuardRuntime, renderGuardStatus } from './guard-runtime.ts'

/** Plugin name used in diagnostics. */
export const name = 'byclaw-bash-provider'

/** Extend the upstream config so cordis plugin() accepts our additions. */
declare module '@deepseek-ai/dsh-bash-local' {
  interface Config {
    rtkAvailable?: boolean
    /** Master switch for the build guard; false makes every guard transform the identity. */
    buildGuardEnabled?: boolean
    /** Concurrent heavy commands allowed across the coordination domain. */
    buildSlots?: number
    /** How long a heavy command waits for a slot before proceeding unrationed, in seconds. */
    slotWaitSecs?: number
    /** Estimated peak memory of one compile job, in MiB. */
    memPerJobMb?: number
    /** `oom_score_adj` applied to build processes, 1..1000. */
    oomScoreAdj?: number
    /** Whether to apply the `ulimit -v` address-space backstop. Off by default. */
    ulimitEnabled?: boolean
    /** Directory for single-host slot locks when Redis is unreachable. */
    slotLockDir?: string
  }
}

/** Default directory for single-host slot locks. */
const DEFAULT_SLOT_LOCK_DIR = '/tmp/byclaw-build-slots'

/** Tool names that carry a shell command this guard should inspect. */
const BASH_TOOL_NAMES: ReadonlySet<string> = new Set(['bash', 'terminal', 'bash_persistent'])

/**
 * Whether a tool call is a shell invocation.
 *
 * @param name - the tool name.
 * @returns true for the shell tools whose arguments carry a command.
 */
function isBashTool(name: string): boolean {
  return BASH_TOOL_NAMES.has(name)
}

/**
 * Extract the `command` argument from a tool call.
 *
 * Arguments cross the pipeline as `unknown` (each tool validates its own
 * schema), so this narrows defensively rather than trusting a shape.
 *
 * @param args - the parsed tool arguments.
 * @returns the command, or undefined when absent or not a string.
 */
function commandArgument(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  const command = (args as { command: unknown }).command
  return typeof command === 'string' ? command : undefined
}

/**
 * Whether a shell call was asked to run in the background.
 *
 * Background calls are deliberately left unguarded. `tools/post-execute` fires
 * when the job is *started*, not when it finishes, so a background build would
 * take a slot and give it back milliseconds later while the compile ran on
 * unrationed. That is worse than not rationing it: the slot count would read as
 * free while real builds were in flight, so foreground builds would be admitted
 * against capacity that is already spoken for. Rationing background jobs needs
 * a completion signal this hook pair does not provide.
 *
 * @param args - the parsed tool arguments.
 * @returns true when the call requested background execution.
 */
function isBackgroundCall(args: unknown): boolean {
  if (typeof args !== 'object' || args === null || !('run_in_background' in args)) return false
  return (args as { run_in_background: unknown }).run_in_background === true
}

/**
 * Extract the exit code from a settled tool result.
 *
 * The bash tool returns `{ kind: 'foreground', exitCode, ... }`, but a
 * background start, an error result, or a future shape change may carry no
 * exit code at all. An absent code degrades the OOM verdict to `suspected`
 * rather than producing a wrong one.
 *
 * @param result - the settled execution result.
 * @returns the exit code, or undefined when it is not present.
 */
function exitCodeOf(result: unknown): number | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const value = 'value' in result ? (result as { value: unknown }).value : undefined
  if (typeof value !== 'object' || value === null || !('exitCode' in value)) return undefined
  const exitCode = (value as { exitCode: unknown }).exitCode
  return typeof exitCode === 'number' ? exitCode : undefined
}

/**
 * Fold plugin config onto the guard defaults.
 *
 * @param config - the resolved plugin config.
 * @returns the guard configuration.
 */
function guardConfigFrom(config: Config): GuardConfig {
  return {
    enabled: config.buildGuardEnabled ?? DEFAULT_GUARD_CONFIG.enabled,
    guard: {
      oomScoreAdj: config.oomScoreAdj ?? DEFAULT_GUARD_SETTINGS.oomScoreAdj,
      memPerJobMb: config.memPerJobMb ?? DEFAULT_GUARD_SETTINGS.memPerJobMb,
      maxJobs: DEFAULT_GUARD_SETTINGS.maxJobs,
      ulimitEnabled: config.ulimitEnabled ?? DEFAULT_GUARD_SETTINGS.ulimitEnabled,
    },
    slots: {
      ...DEFAULT_SLOT_SETTINGS,
      slots: config.buildSlots ?? DEFAULT_SLOT_SETTINGS.slots,
      waitMs: config.slotWaitSecs === undefined
        ? DEFAULT_SLOT_SETTINGS.waitMs
        : config.slotWaitSecs * 1000,
    },
  }
}

/** Probe for the `rtk` binary on PATH; absence degrades to the identity transform. */
function resolveRtk(): boolean {
  try {
    const result = spawnSync('rtk', ['--version'], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    /* v8 ignore next -- spawnSync throws only on a broken runtime, not a missing binary */
    return false
  }
}

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u
const REFRESH_INTERVAL_MS = 5_000
const REDIS_REFRESH_TIMEOUT_MS = 1_000

/** Redis commands required for resolving one user's runtime environment. */
export interface RuntimeEnvironmentRedis {
  get(key: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string>>
}

export interface RuntimeEnvironmentRedisClient extends RuntimeEnvironmentRedis {
  status?: string
  options?: {
    clusterRetryStrategy?: (times: number, reason?: Error) => number | null
  }
  on(event: 'error', listener: (error: unknown) => void): unknown
  disconnect(reconnect?: boolean): void
}

export interface RuntimeEnvironmentRedisOptions {
  connectTimeout: number
  maxRetriesPerRequest: number
  retryStrategy(times: number): null
  reconnectOnError(error: Error): false
}

export interface RuntimeEnvironmentLogger {
  warn(message: string): void
}

function disableClusterRetries(client: RuntimeEnvironmentRedisClient): void {
  // by-framework nests caller options under Cluster.redisOptions. Override
  // ioredis' public top-level Cluster strategy synchronously as well, before
  // the event loop can schedule another cluster connection round.
  if (client.options?.clusterRetryStrategy !== undefined) {
    client.options.clusterRetryStrategy = () => null
  }
}

/** Construct the production Redis client with node and cluster retries disabled. */
export function createRuntimeRedisClient(
  options: RuntimeEnvironmentRedisOptions,
): RuntimeEnvironmentRedisClient {
  const client = createRedis(options) as RuntimeEnvironmentRedisClient
  disableClusterRetries(client)
  return client
}

class RedisRefreshTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Redis environment refresh timed out after ${String(timeoutMs)}ms`)
  }
}

class RedisPrivateEnvironmentError extends Error {
  constructor(readonly kind: 'json' | 'schema') {
    super(kind === 'json'
      ? 'Redis private environment is not valid JSON'
      : 'Redis private environment has an invalid payload')
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function privateEnvironment(raw: string | null): Record<string, string> {
  if (raw === null || raw.trim() === '') return {}
  let decoded: unknown
  try {
    decoded = JSON.parse(raw) as unknown
  } catch {
    throw new RedisPrivateEnvironmentError('json')
  }
  const payload = record(decoded)
  if (payload === undefined || !Object.hasOwn(payload, 'params')) {
    throw new RedisPrivateEnvironmentError('schema')
  }
  const params = record(payload?.['params'])
  if (params === undefined) throw new RedisPrivateEnvironmentError('schema')
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (ENVIRONMENT_NAME.test(key) && typeof value === 'string') environment[key] = value
  }
  return environment
}

function loginEnvironment(hash: Readonly<Record<string, string>>): Record<string, string> {
  const aliases: Readonly<Record<string, string>> = {
    'Beyond-Token': 'BEYOND_TOKEN',
    'Sso-Token': 'SSO_TOKEN',
    WHALE_AGENT_AUTHORIZATION: 'WHALE_AGENT_AUTHORIZATION',
    userCode: 'USER_CODE',
    userId: 'USER_ID',
    userName: 'USER_NAME',
  }
  const environment: Record<string, string> = {}
  for (const [field, name] of Object.entries(aliases)) {
    const value = hash[field]
    if (typeof value === 'string' && value !== '') environment[name] = value
  }
  return environment
}

/** Load the current user's private parameters and login identity from Redis. */
export async function loadRedisEnvironment(
  redis: RuntimeEnvironmentRedis,
  userCode: string,
): Promise<Record<string, string>> {
  const normalizedUserCode = userCode.trim()
  if (normalizedUserCode === '') return {}
  const userId = (await redis.get(`SHARE_BFM_USER_CODE_${normalizedUserCode}`))?.trim() ?? ''
  const privateParams = privateEnvironment(await redis.get(`byai:user:private_params:${normalizedUserCode}`))
  const loginAuth = userId === '' ? {} : loginEnvironment(await redis.hgetall(`user:${userId}:login:auth`))
  return { ...privateParams, ...loginAuth }
}

/** Best-effort, last-good runtime Redis environment with a hard per-refresh deadline. */
export class RedisRuntimeEnvironment {
  private readonly createClient: (options: RuntimeEnvironmentRedisOptions) => RuntimeEnvironmentRedisClient
  private readonly logger: RuntimeEnvironmentLogger
  private readonly timeoutMs: number
  private client: RuntimeEnvironmentRedisClient | undefined
  private environment: Record<string, string> = {}
  private refreshing: Promise<void> | undefined
  private cancelRefresh: (() => void) | undefined
  private closed = false

  constructor(options: {
    createClient(options: RuntimeEnvironmentRedisOptions): RuntimeEnvironmentRedisClient
    logger: RuntimeEnvironmentLogger
    timeoutMs?: number
  }) {
    this.createClient = options.createClient
    this.logger = options.logger
    this.timeoutMs = options.timeoutMs ?? REDIS_REFRESH_TIMEOUT_MS
  }

  /** Return a defensive snapshot of the last complete successful refresh. */
  current(): Record<string, string> {
    return { ...this.environment }
  }

  /** Refresh once; all construction, connection, command, and parsing failures fail open. */
  refresh(userCode: string): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.refreshing !== undefined) return this.refreshing
    const operation = this.refreshOnce(userCode)
      .catch((error: unknown) => {
        this.discardClient()
        if (!this.closed) this.logger.warn(this.failureMessage(error))
      })
      .finally(() => {
        if (this.refreshing === operation) this.refreshing = undefined
      })
    this.refreshing = operation
    return operation
  }

  /** Stop current I/O immediately; disposal never waits for a Redis retry loop. */
  close(): void {
    this.closed = true
    this.cancelRefresh?.()
    this.discardClient()
  }

  private redisClient(): RuntimeEnvironmentRedisClient {
    if (this.client?.status === 'end') this.discardClient()
    if (this.client !== undefined) return this.client
    const client = this.createClient({
      connectTimeout: this.timeoutMs,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      reconnectOnError: () => false,
    })
    disableClusterRetries(client)
    // ioredis otherwise prints an "Unhandled error event" line independently
    // of the command rejection that refresh() already logs in sanitized form.
    client.on('error', () => undefined)
    this.client = client
    return client
  }

  private async refreshOnce(userCode: string): Promise<void> {
    const normalizedUserCode = userCode.trim()
    if (normalizedUserCode === '') {
      this.environment = {}
      return
    }
    const client = this.redisClient()
    const loading = loadRedisEnvironment(client, normalizedUserCode)
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancelled = Symbol('redis-refresh-cancelled')
    let cancel: (() => void) | undefined
    try {
      const environment = await Promise.race([
        loading,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            client.disconnect(false)
            if (this.client === client) this.client = undefined
            reject(new RedisRefreshTimeoutError(this.timeoutMs))
          }, this.timeoutMs)
        }),
        new Promise<typeof cancelled>((resolve) => {
          cancel = () => resolve(cancelled)
          this.cancelRefresh = cancel
        }),
      ])
      if (environment !== cancelled && !this.closed) this.environment = environment
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (this.cancelRefresh === cancel) this.cancelRefresh = undefined
    }
  }

  private discardClient(): void {
    const client = this.client
    this.client = undefined
    client?.disconnect(false)
  }

  private failureMessage(error: unknown): string {
    const suffix = '; retaining last-good values'
    if (error instanceof RedisRefreshTimeoutError) {
      return `[byclaw-bash-provider] Redis environment refresh timed out after ${String(error.timeoutMs)}ms${suffix}`
    }
    if (error instanceof RedisPrivateEnvironmentError) {
      const detail = error.kind === 'json'
        ? 'Redis private environment is not valid JSON'
        : 'Redis private environment has an invalid payload'
      return `[byclaw-bash-provider] ${detail}${suffix}`
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return `[byclaw-bash-provider] Redis environment refresh failed (${detail})${suffix}`
  }
}

/**
 * Copy every defined parent variable and apply explicit caller overrides.
 * @param parentEnv - environment owned by the DSH host process.
 * @param requestEnv - optional values deliberately supplied by an in-process caller.
 * @param runtimeEnv - last-good Redis values, which override other ordinary entries.
 * @returns a string-only environment map suitable for `ShellExecRequest.env`.
 */
export function forwardEnvironment(
  parentEnv: Readonly<NodeJS.ProcessEnv>,
  requestEnv?: Readonly<Record<string, string>>,
  runtimeEnv?: Readonly<Record<string, string>>,
): Record<string, string> {
  const forwarded: Record<string, string> = {}
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value !== undefined) forwarded[key] = value
  }
  return { ...forwarded, ...requestEnv, ...runtimeEnv }
}

/**
 * Preserve the shipped sandbox executor while opting every host environment
 * variable into the subprocess seam's explicit post-scrub overlay, and
 * routing eligible commands through rtk to compress their output.
 */
export class ForwardingSandboxBashExecutor extends SandboxBashExecutor {
  private readonly runtimeEnvironment: RedisRuntimeEnvironment
  private readonly rtkAvailable: boolean
  readonly guard: GuardRuntime

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.rtkAvailable = config.rtkAvailable ?? resolveRtk()
    this.guard = new GuardRuntime(guardConfigFrom(config))
    this.runtimeEnvironment = new RedisRuntimeEnvironment({
      createClient: createRuntimeRedisClient,
      logger: ctx.logger,
    })
    ctx.effect(() => {
      const timer = setInterval(() => {
        void this.runtimeEnvironment.refresh(process.env['USER_CODE'] ?? '')
      }, REFRESH_INTERVAL_MS)
      void this.runtimeEnvironment.refresh(process.env['USER_CODE'] ?? '')
      return () => {
        clearInterval(timer)
        this.runtimeEnvironment.close()
      }
    }, 'byclaw-bash-provider.redis-runtime')

    // Widen the slot pool past in-process once a shared backend answers.
    // Deliberately not awaited: construction must not block on a network probe,
    // and until it resolves the guard rations correctly, just more narrowly.
    void this.widenCoordination(ctx, config)

    // `tools` is not in this executor's static inject: a Bash provider that
    // refused to load because the tool registry was not up yet would take the
    // whole shell surface down for an observability feature. Deferring instead
    // means the guard's admission and OOM reporting attach when the registry
    // appears, and are simply absent if it never does.
    void ctx.inject(['tools'], toolsCtx => { this.registerGuardHooks(toolsCtx) })
  }

  /**
   * Attach slot admission, OOM sampling and the status tool.
   *
   * @param ctx - a context with the `tools` service available.
   */
  private registerGuardHooks(ctx: Context): void {
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (isBashTool(exec.name) && !isBackgroundCall(exec.arguments)) {
        const command = commandArgument(exec.arguments)
        if (command !== undefined && this.guard.isGuarded(command)) {
          // Awaiting here IS the admission control: the dispatch does not
          // proceed until a slot frees or the wait deadline passes.
          await this.guard.beginCommand(String(exec.callId))
        }
      }
      return next()
    })

    ctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      if (!isBashTool(exec.name)) return decision

      const verdict = await this.guard.endCommand(String(exec.callId), exitCodeOf(result))
      if (verdict?.advisory === undefined) return decision
      if (decision.kind !== 'accept') return decision

      // Appended as context rather than substituted into the output: the
      // command's own stderr is what the model needs to read, and the advisory
      // explains how to interpret it.
      return {
        ...decision,
        additionalContexts: [
          ...decision.additionalContexts ?? [],
          createUserMessage({
            content: [{ type: 'text', text: verdict.advisory }],
            source: { kind: 'plugin', plugin: name },
          }),
        ],
      }
    })

    ctx.effect(
      () => ctx.tools.register(defineTool({
        name: 'build_guard_status',
        description: 'Read-only: report the build memory guard\'s current enforcement tier, coordination backend, slot occupancy, derived parallelism, and every reason it falls short of full enforcement. Use this to check whether builds are actually rationed and OOM-protected on this host.',
        parameters: {},
        output: {
          schema: { type: 'object', additionalProperties: true, properties: {} },
          render: (_args, value) => [{
            type: 'text',
            text: renderGuardStatus(value as unknown as GuardStatus),
          }],
        },
        // GuardStatus is JSON-shaped but declares no index signature, which the
        // `additionalProperties: true` schema's inferred payload type requires.
        execute: async () => this.guard.status() as unknown as Record<string, JsonValue>,
      })),
      'byclaw-bash-provider.build-guard-status',
    )
  }

  /**
   * Replace the initial in-process slot pool with the widest backend that
   * actually answers here.
   *
   * @param ctx - plugin context, for logging the outcome.
   * @param config - resolved plugin config.
   */
  private async widenCoordination(ctx: Context, config: Config): Promise<void> {
    const guardConfig = guardConfigFrom(config)
    if (!guardConfig.enabled) return

    const backend = await selectBackend({
      redis: async () => {
        const client = createRuntimeRedisClient({
          connectTimeout: REDIS_REFRESH_TIMEOUT_MS,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
          reconnectOnError: () => false,
        }) as unknown as SlotRedisClient & { disconnect?: () => void }
        // Prove reachability before adopting it: a client that never connects
        // would make every acquisition fail and silently narrow the domain.
        await client.set('byclaw:build-slots:probe', '1', 'PX', 1000, 'NX')
        ctx.effect(() => () => client.disconnect?.(), 'byclaw-bash-provider.slot-redis')
        return redisBackend(client, guardConfig.slots, 'byclaw:build-slots', randomUUID())
      },
      fileLock: () => fileLockBackend(
        createFileLockIo(),
        config.slotLockDir ?? DEFAULT_SLOT_LOCK_DIR,
      ),
    })

    this.guard.adoptPool(new SlotPool(backend, guardConfig.slots))
    ctx.logger?.info?.(
      `build guard: tier ${this.guard.capability.tier}, coordination ${backend.kind}`,
    )
  }

  private withRuntimeEnvironment(spec: ShellExecSpec): ShellExecSpec {
    return {
      ...spec,
      env: { ...spec.env, ...this.runtimeEnvironment.current() },
    }
  }

  /**
   * Resolve a Bash request with the complete current host environment, route
   * the result through rtk when eligible, and guard it when it is a build.
   *
   * The two command transforms are ordered, not interchangeable: rtk decides
   * eligibility by scanning for shell metacharacters, and the guard prefix
   * contains `>` and `;`. Applying the guard first would make every command
   * look complex to rtk and silently disable output compression. Applying rtk
   * first leaves both transforms in force.
   *
   * @param request - caller request whose explicit entries override the host.
   * @returns the shipped sandboxed Bash spec with the forwarding overlay, the
   *   rtk-wrapped source for an eligible command, and the guard prefix and
   *   `MAKEFLAGS` for a build.
   */
  override resolve(request: ShellExecRequest): ShellExecSpec {
    assertBrowserCommandAllowed(request.command)
    const spec = super.resolve({
      ...request,
      env: forwardEnvironment(process.env, request.env),
    })

    const routed = wrapWithRtk(spec.command, this.rtkAvailable)
    if (!this.guard.isGuarded(request.command)) return { ...spec, command: routed }

    return {
      ...spec,
      command: this.guard.wrap(routed),
      // The caller's own MAKEFLAGS wins: an explicit choice is not overridden.
      env: { ...this.guard.environment(), ...spec.env },
    }
  }

  /** Refresh Redis immediately before each foreground command. */
  override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    await this.runtimeEnvironment.refresh(process.env['USER_CODE'] ?? '')
    return super.run(this.withRuntimeEnvironment(spec))
  }

  /** Background commands use the last-good cache while triggering an asynchronous refresh. */
  override start(spec: ShellExecSpec): ShellProcess {
    void this.runtimeEnvironment.refresh(process.env['USER_CODE'] ?? '')
    return super.start(this.withRuntimeEnvironment(spec))
  }
}

export default ForwardingSandboxBashExecutor
