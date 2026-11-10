/** Deterministic employee execution routing before the DSH model gets the request. */
import { createHash } from 'node:crypto'
import type { AskAgentCommand, AgentContext } from '@byclaw/by-framework'
import { CodexEventAdapter, type CodingEvent } from './cli-event-adapter.ts'

export type ExecutionType = 'CODEX_CLI' | 'CLAUDE_CLI' | 'UNITY'
export type ExecutionKind = 'codex' | 'claude' | 'unity'

export interface ExecutionDefinition {
  executionType: ExecutionType
  templateKey: string
  executor: ExecutionKind
}

/** The allowlisted execution registry. Commands are deliberately not configurable from user input. */
export const EXECUTION_DEFINITIONS: Readonly<Record<ExecutionType, ExecutionDefinition>> = {
  CODEX_CLI: { executionType: 'CODEX_CLI', templateKey: 'coding', executor: 'codex' },
  CLAUDE_CLI: { executionType: 'CLAUDE_CLI', templateKey: 'coding', executor: 'claude' },
  UNITY: { executionType: 'UNITY', templateKey: 'unity', executor: 'unity' },
}

export interface ExecutionSandbox {
  acquire(actor: string, templateKey: string, requestId: string): Promise<{ leaseId: string; workspaceRoot: string }>
  execute(actor: string, leaseId: string, argv: readonly string[], cwd?: string, signal?: AbortSignal, onStdout?: (chunk: string) => void): Promise<{ exitCode: number | null; stdout: string; stderr: string }>
  releaseActor(actor: string): Promise<{ retainedLeases: string[]; retainedAllocations: string[] }>
}

export interface ExecutionTarget { resourceId: string; kind: 'employee' | 'group'; text: string }
export interface ExecutionResult { answer: string; finalAnswer: string; executor: ExecutionKind; executionType: ExecutionType; codexThreadId?: string }
export interface ExecutionRouteEvent extends CodingEvent { employeeId: string; executionType: ExecutionType }
export interface ExecutionRouterEnvironment {
  BYCLAW_AGENT_EXECUTION_MAP?: string
  CODEX_EXEC_TIMEOUT_MS?: string
}
export interface ExecutionRouterOptions {
  userCode: string
  environment: () => Readonly<ExecutionRouterEnvironment>
  resolveTarget: (command: AskAgentCommand, text: string) => ExecutionTarget | undefined
  prepareContext: (command: AskAgentCommand, target: ExecutionTarget) => string
  sandbox: () => ExecutionSandbox | undefined
  emit: (command: AskAgentCommand, context: AgentContext, event: ExecutionRouteEvent) => Promise<void>
  onActivityChange?: () => void
}

/** A routed failure rejects; only an unmatched request may call DSH. */
export async function dispatchExecutionAsk<T>(router: ByClawExecutionRouter | undefined, command: AskAgentCommand, context: AgentContext, text: string, dsh: () => Promise<T>): Promise<T | ExecutionResult> {
  return await router?.ask(command, context, text) ?? await dsh()
}

/** Parse the JSON object that maps authorized employee IDs to allowlisted execution types. */
export function parseAgentExecutionMap(value: string | undefined): ReadonlyMap<string, ExecutionType> {
  const normalized = value?.trim() ?? ''
  if (normalized === '') return new Map()
  let parsed: unknown
  try { parsed = JSON.parse(normalized) as unknown }
  catch (error) { throw new Error('BYCLAW_AGENT_EXECUTION_MAP must be a JSON object', { cause: error }) }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('BYCLAW_AGENT_EXECUTION_MAP must be a JSON object')
  const result = new Map<string, ExecutionType>()
  for (const [employeeId, rawType] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^\d+$/u.test(employeeId)) throw new Error('BYCLAW_AGENT_EXECUTION_MAP keys must be numeric employee IDs')
    if (typeof rawType !== 'string' || !(rawType in EXECUTION_DEFINITIONS)) throw new Error(`BYCLAW_AGENT_EXECUTION_MAP contains unknown executionType for employee ${employeeId}`)
    result.set(employeeId, rawType as ExecutionType)
  }
  return result
}

// Task text is always a positional argument, never interpolated into shell source.
// Credentials and image defaults are read in B, not copied from the host to the prompt.
export const CODEX_EXEC_SCRIPT = [
  'set -eu',
  'work=$1; shift',
  'mkdir -p -- "$work"; cd -- "$work"',
  'if [ -n "${CODEX_MODEL:-}" ]; then set -- --model "$CODEX_MODEL" "$@"; fi',
  'if [ -n "${CODEX_BASE_URL:-}" ]; then',
  '  provider=$(printf \'%s\' "$CODEX_BASE_URL" | python3 -c \'import json,sys; print("model_providers.byclaw.base_url=" + json.dumps(sys.stdin.read()))\')',
  '  set -- -c "$provider" "$@"',
  'fi',
  'exec codex exec --json --skip-git-repo-check -c \'approval_policy="never"\' --sandbox danger-full-access "$@"',
].join('\n')

interface Request {
  messageId: string
  fingerprint: string
  control: AbortController
  promise: Promise<ExecutionResult>
  settled: boolean
}

export class ByClawExecutionRouter {
  private readonly requests = new Map<string, Request>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private closed = false

  constructor(private readonly options: ExecutionRouterOptions) {
    parseAgentExecutionMap(options.environment().BYCLAW_AGENT_EXECUTION_MAP)
  }

  get activeCount(): number { return [...this.requests.values()].filter(request => !request.settled).length }

  async ask(command: AskAgentCommand, context: AgentContext, text: string): Promise<ExecutionResult | undefined> {
    const env = this.options.environment()
    const executionMap = parseAgentExecutionMap(env.BYCLAW_AGENT_EXECUTION_MAP)
    if (!executionMap.size) return undefined
    if (command.header.userCode !== this.options.userCode) throw new Error('EXECUTION_USER_SCOPE_MISMATCH')
    const target = this.options.resolveTarget(command, text)
    if (target?.kind !== 'employee') return undefined
    const executionType = executionMap.get(target.resourceId)
    if (executionType === undefined) return undefined
    if (this.closed) throw new Error('EXECUTION_ROUTER_CLOSED')
    if (!target.text.trim()) throw new Error('EXECUTION_TEXT_REQUIRED')
    const prompt = this.options.prepareContext(command, target)
    if (Buffer.byteLength(prompt, 'utf8') > 64 * 1024) throw new Error('EXECUTION_INPUT_TOO_LARGE')
    const identity = JSON.stringify([command.header.userCode, command.header.sessionId, target.resourceId, executionType])
    const key = JSON.stringify([identity, command.header.messageId])
    const fingerprint = createHash('sha256').update(prompt).digest('hex')
    const previous = this.requests.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('EXECUTION_REQUEST_CONFLICT')
      return previous.promise
    }
    const timeout = Number(env.CODEX_EXEC_TIMEOUT_MS ?? 300000)
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 900000) throw new Error('EXECUTION_INVALID_TIMEOUT')
    const control = new AbortController()
    const queued = this.queues.get(identity) ?? Promise.resolve()
    const request: Request = { messageId: command.header.messageId, fingerprint, control, settled: false, promise: Promise.resolve(undefined as never) }
    request.promise = queued.catch(() => {}).then(() => this.execute(command, context, target, prompt, identity, executionType, control, timeout))
      .finally(() => {
        request.settled = true
        this.options.onActivityChange?.()
        if (this.queues.get(identity) === request.promise) this.queues.delete(identity)
        const settled = [...this.requests].filter(([, value]) => value.settled)
        for (const [old] of settled.slice(0, Math.max(0, settled.length - 128))) this.requests.delete(old)
      })
    this.requests.set(key, request)
    this.queues.set(identity, request.promise)
    this.options.onActivityChange?.()
    return request.promise
  }

  private async execute(command: AskAgentCommand, context: AgentContext, target: ExecutionTarget, prompt: string, identity: string, executionType: ExecutionType, control: AbortController, timeout: number): Promise<ExecutionResult> {
    const definition = EXECUTION_DEFINITIONS[executionType]
    if (definition.executor !== 'codex') throw new Error(`EXECUTOR_NOT_IMPLEMENTED:${executionType}`)
    const signal = AbortSignal.any([control.signal, AbortSignal.timeout(timeout)])
    const check = () => { if (context.isCancelRequested?.()) control.abort(new Error('EXECUTION_CANCELLED')) }
    check()
    const timer = setInterval(check, 50)
    timer.unref()
    const actor = `execution:${createHash('sha256').update(JSON.stringify([identity, command.header.messageId])).digest('hex')}`
    let forwarding = Promise.resolve()
    let forwardingError: unknown
    const emit = (event: CodingEvent) => {
      forwarding = forwarding.then(() => this.options.emit(command, context, { ...event, employeeId: target.resourceId, executionType }))
        .catch(error => { forwardingError = error; control.abort(new Error('EXECUTION_EVENT_FORWARDING_FAILED')) })
    }
    const parser = new CodexEventAdapter(emit)
    let sandbox: ExecutionSandbox | undefined
    try {
      signal.throwIfAborted()
      sandbox = this.options.sandbox()
      if (!sandbox) throw new Error('EXECUTION_SANDBOX_UNAVAILABLE')
      emit({ kind: 'tool', id: 'sandbox', phase: 'start', title: `申请 ${definition.templateKey} 工具沙箱` })
      const lease = await sandbox.acquire(actor, definition.templateKey, executionType)
      signal.throwIfAborted()
      emit({ kind: 'tool', id: 'sandbox', phase: 'success', title: `申请 ${definition.templateKey} 工具沙箱` })
      emit({ kind: 'tool', id: 'exec', phase: 'start', title: 'Codex 执行任务' })
      const cwd = `${lease.workspaceRoot}/.sessions/codex-${createHash('sha256').update(identity).digest('hex')}`
      const result = await sandbox.execute(actor, lease.leaseId, ['sh', '-c', CODEX_EXEC_SCRIPT, 'byclaw-codex', cwd, '--', prompt], lease.workspaceRoot, signal, chunk => parser.write(chunk))
      signal.throwIfAborted()
      const answer = parser.finish(result.exitCode)
      emit({ kind: 'tool', id: 'exec', phase: 'success', title: 'Codex 执行任务' })
      await forwarding
      if (forwardingError) throw forwardingError
      return { answer, finalAnswer: answer, executor: definition.executor, executionType, ...(parser.threadId === undefined ? {} : { codexThreadId: parser.threadId }) }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const code = forwardingError ? 'EXECUTION_EVENT_FORWARDING_FAILED'
        : message.startsWith('EXECUTOR_NOT_IMPLEMENTED:') ? message
        : signal.aborted ? (control.signal.aborted ? 'EXECUTION_CANCELLED' : 'EXECUTION_TIMEOUT') : 'EXECUTION_FAILED'
      emit({ kind: 'tool', id: 'exec', phase: 'error', title: code })
      await forwarding
      throw new Error(code, { cause: error })
    } finally {
      clearInterval(timer)
      if (sandbox) {
        const cleanup = await sandbox.releaseActor(actor)
        if (cleanup.retainedLeases.length || cleanup.retainedAllocations.length) throw new Error('EXECUTION_CLEANUP_RETAINED')
      }
    }
  }

  cancel(messageId: string): void {
    for (const request of this.requests.values()) if (!request.settled && request.messageId === messageId) request.control.abort(new Error('EXECUTION_CANCELLED'))
  }

  async close(): Promise<void> {
    this.closed = true
    for (const request of this.requests.values()) if (!request.settled) request.control.abort(new Error('EXECUTION_SHUTDOWN'))
    await Promise.allSettled([...this.requests.values()].map(request => request.promise))
  }
}
