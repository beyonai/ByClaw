/** Deterministic employee execution routing before the DSH model gets the request. */
import { createHash } from 'node:crypto'
import type { AskAgentCommand, AgentContext } from '@byclaw/by-framework'
import { CodexEventAdapter, type CodingEvent, type CodexEventSnapshot } from './cli-event-adapter.ts'
import { summarizeCodingDiagnostic, type CodingDiagnosticSummary } from './coding-diagnostics.ts'
import { CODING_WORKSPACE_RUNNER, codingFinalOutput, codingRunManifest, type CodingContext } from './coding-context.ts'
import type { FileChangesSummaryPayload } from './file-changes.ts'

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
  executeWithDeployment?: ExecutionSandbox['execute']
  releaseActor(actor: string): Promise<{ retainedLeases: string[]; retainedAllocations: string[] }>
}

export interface ExecutionTarget { resourceId: string; kind: 'employee' | 'group'; text: string }
export interface ExecutionResult { answer: string; finalAnswer: string; executor: ExecutionKind; executionType: ExecutionType; codexThreadId?: string }
export interface ExecutionRouteEvent extends CodingEvent {
  employeeId: string
  executionType: ExecutionType
  origin: 'runtime' | 'cli'
  sequence: number
}
export interface ExecutionDiagnostic {
  sessionId: string
  messageId: string
  traceId: string
  employeeId: string
  executionType: ExecutionType
  templateKey: string
  stage: 'queue' | 'sandbox' | 'exec' | 'first_stdout' | 'first_activity' | 'cleanup' | 'request' | 'stderr' | 'native_error'
  status: 'start' | 'waiting' | 'success' | 'error'
  elapsedMs: number
  totalElapsedMs: number
  exitCode?: number | null
  reason?: string
  diagnostic?: CodingDiagnosticSummary
  nativeDiagnostic?: CodingDiagnosticSummary
  stderrDiagnostic?: CodingDiagnosticSummary
  nativeErrorType?: 'error' | 'turn.failed'
  native?: CodexEventSnapshot & { stdoutBytes: number }
}
export interface ExecutionRouterEnvironment {
  BYCLAW_AGENT_EXECUTION_MAP?: string
  CODEX_EXEC_TIMEOUT_MS?: string
  BYCLAW_DEPLOY_ENABLED?: string | undefined
}
export interface ExecutionRouterOptions {
  userCode: string
  environment: () => Readonly<ExecutionRouterEnvironment>
  deploymentEnabled?: () => Promise<boolean>
  resolveTarget: (command: AskAgentCommand, text: string) => ExecutionTarget | undefined
  prepareContext: (command: AskAgentCommand, target: ExecutionTarget, lease: {
    sandbox: ExecutionSandbox; actor: string; leaseId: string; workspaceRoot: string; signal: AbortSignal; identity: string
  }) => CodingContext | Promise<CodingContext>
  emitFileChanges?: (command: AskAgentCommand, context: AgentContext, payload: FileChangesSummaryPayload, workspace: string) => Promise<void>
  sandbox: () => ExecutionSandbox | undefined
  emit: (command: AskAgentCommand, context: AgentContext, event: ExecutionRouteEvent) => Promise<void>
  onActivityChange?: () => void
  log?: (entry: ExecutionDiagnostic) => void
  /** Internal test seam; deployments use the fixed 10-second status interval. */
  progressIntervalMs?: number
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
    const identity = JSON.stringify([command.header.userCode, command.header.sessionId, target.resourceId, executionType])
    const key = JSON.stringify([identity, command.header.messageId])
    const fingerprint = createHash('sha256').update(JSON.stringify([target.text, command.content, command.header.metadata, command.extraPayload])).digest('hex')
    const previous = this.requests.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('EXECUTION_REQUEST_CONFLICT')
      return previous.promise
    }
    // Zero leaves the whole task open until completion, cancellation or failure.
    const timeout = Number(env.CODEX_EXEC_TIMEOUT_MS ?? 0)
    if (!Number.isInteger(timeout) || (timeout !== 0 && timeout < 1000) || timeout > 2_147_483_647) throw new Error('EXECUTION_INVALID_TIMEOUT')
    const control = new AbortController()
    const queued = this.queues.get(identity) ?? Promise.resolve()
    const queuedAt = performance.now()
    const request: Request = { messageId: command.header.messageId, fingerprint, control, settled: false, promise: Promise.resolve(undefined as never) }
    request.promise = queued.catch(() => {}).then(() => this.execute(command, context, target, identity, executionType, control, timeout, queuedAt))
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

  private async execute(command: AskAgentCommand, context: AgentContext, target: ExecutionTarget, identity: string, executionType: ExecutionType, control: AbortController, timeout: number, queuedAt: number): Promise<ExecutionResult> {
    const definition = EXECUTION_DEFINITIONS[executionType]
    if (definition.executor !== 'codex') throw new Error(`EXECUTOR_NOT_IMPLEMENTED:${executionType}`)
    const signal = timeout === 0 ? control.signal : AbortSignal.any([control.signal, AbortSignal.timeout(timeout)])
    const check = () => { if (context.isCancelRequested?.()) control.abort(new Error('EXECUTION_CANCELLED')) }
    check()
    const timer = setInterval(check, 50)
    timer.unref()
    const actor = `execution:${createHash('sha256').update(JSON.stringify([identity, command.header.messageId])).digest('hex')}`
    let forwarding = Promise.resolve()
    let forwardingError: unknown
    let sequence = 0
    let stdoutBytes = 0
    const emit = (event: CodingEvent, origin: ExecutionRouteEvent['origin'] = 'runtime') => {
      const routed: ExecutionRouteEvent = { ...event, employeeId: target.resourceId, executionType, origin, sequence: ++sequence }
      forwarding = forwarding.then(async () => {
        if (!forwardingError) await this.options.emit(command, context, routed)
      }).catch(error => { forwardingError = error; control.abort(new Error('EXECUTION_EVENT_FORWARDING_FAILED')) })
    }
    const log = (stage: ExecutionDiagnostic['stage'], status: ExecutionDiagnostic['status'], startedAt: number, extra: Pick<ExecutionDiagnostic, 'exitCode' | 'reason' | 'diagnostic' | 'stderrDiagnostic' | 'nativeErrorType'> = {}) => {
      const now = performance.now()
      // Only allowlisted fields reach the logger. No prompt, argv, stdout, stderr or Error object.
      try { this.options.log?.({ sessionId: String(command.header.sessionId), messageId: String(command.header.messageId),
        traceId: context.traceId, employeeId: target.resourceId, executionType, templateKey: definition.templateKey,
        stage, status, elapsedMs: Math.round(now - startedAt), totalElapsedMs: Math.round(now - queuedAt),
        ...(['exec', 'request', 'stderr', 'native_error'].includes(stage)
          ? { native: { ...parser.snapshot(), stdoutBytes }, ...(parser.diagnostic === undefined ? {} : { nativeDiagnostic: parser.diagnostic }) } : {}),
        ...extra }) } catch { /* Logging cannot break a task. */ }
    }
    let stage: { id: 'sandbox' | 'exec' | 'cleanup'; title: string; startedAt: number } | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const updateStage = (phase: CodingEvent['phase'], reason?: string) => {
      if (!stage) return
      const elapsedMs = Math.round(performance.now() - stage.startedAt)
      emit({ kind: 'tool', id: stage.id, phase, title: stage.title,
        detail: `${reason === undefined ? '' : `${reason}；`}已耗时 ${Math.floor(elapsedMs / 1000)} 秒`,
        output: { stage: stage.id, elapsedMs, ...(reason === undefined ? {} : { reason }) } })
    }
    const startStage = (id: 'sandbox' | 'exec' | 'cleanup', title: string) => {
      if (heartbeat) clearInterval(heartbeat)
      stage = { id, title, startedAt: performance.now() }
      updateStage('start'); log(id, 'start', stage.startedAt)
      heartbeat = setInterval(() => {
        if (!stage || forwardingError) return
        updateStage('start'); log(stage.id, 'waiting', stage.startedAt)
      }, this.options.progressIntervalMs ?? 10_000)
      heartbeat.unref()
    }
    const endStage = (phase: 'success' | 'error', reason?: string, extra: Pick<ExecutionDiagnostic, 'exitCode' | 'diagnostic' | 'stderrDiagnostic'> = {}) => {
      if (heartbeat) clearInterval(heartbeat)
      if (!stage) return
      updateStage(phase, reason); log(stage.id, phase, stage.startedAt, { ...extra, ...(reason === undefined ? {} : { reason }) })
      stage = undefined
    }
    let executionStarted = queuedAt
    let firstActivity = false
    let prepared: CodingContext | undefined
    const parser = new CodexEventAdapter(event => emit(event, 'cli'), () => {
      if (!firstActivity) { firstActivity = true; log('first_activity', 'success', executionStarted) }
    }, event => {
      if (event.type === 'byclaw.workspace') {
        const statuses: Record<string, string> = { waiting: '等待共享执行锁', resumed: '已续接 Codex 会话',
          'skills-started': '准备内置 Skill 和当前员工关联 Skill', 'skills-ready': '员工 Skill 已准备，未变化的版本复用缓存',
          created: '已准备 Codex 工作空间', recreated: '原生状态缺失或工作目录变化，重建 Codex 会话', partial: '文件变更扫描不完整，部分文件未纳入展示' }
        const detail = statuses[String(event.status)]
        if (detail) emit({ kind: 'progress', id: `workspace-${sequence + 1}`, title: 'Codex 上下文', phase: 'success', detail })
      } else if (event.type === 'byclaw.file_changes') {
        if (!prepared) throw new Error('EXECUTION_UNEXPECTED_FILE_CHANGES')
        const workspace = String(event.workspace)
        if (![prepared.workspace.cwd, prepared.workspace.sessionRoot].includes(workspace)) throw new Error('EXECUTION_FILE_SCOPE_MISMATCH')
        const payload = validateFileChanges(event.payload, String(command.header.sessionId))
        forwarding = forwarding.then(async () => {
          if (!forwardingError) await this.options.emitFileChanges?.(command, context, payload, workspace)
        }).catch(error => { forwardingError = error; control.abort(new Error('EXECUTION_EVENT_FORWARDING_FAILED')) })
      }
    }, nativeErrorType => log('native_error', 'error', executionStarted, { nativeErrorType }))
    let sandbox: ExecutionSandbox | undefined
    let result: ExecutionResult | undefined
    let failure: Error | undefined
    let processOutcome: Pick<ExecutionDiagnostic, 'exitCode' | 'diagnostic' | 'stderrDiagnostic'> = {}
    const failureCode = () => forwardingError ? 'EXECUTION_EVENT_FORWARDING_FAILED'
      : signal.aborted ? (control.signal.aborted ? 'EXECUTION_CANCELLED' : 'EXECUTION_TIMEOUT') : 'EXECUTION_FAILED'
    log('queue', 'success', queuedAt)
    try {
      signal.throwIfAborted()
      sandbox = this.options.sandbox()
      if (!sandbox) throw new Error('EXECUTION_SANDBOX_UNAVAILABLE')
      startStage('sandbox', `申请 ${definition.templateKey} 工具沙箱`)
      const lease = await sandbox.acquire(actor, definition.templateKey, executionType)
      signal.throwIfAborted()
      endStage('success')
      startStage('exec', 'Codex 执行任务')
      prepared = await this.options.prepareContext(command, target, { sandbox, actor, ...lease, signal, identity })
      signal.throwIfAborted()
      const prompt = prepared.prompt
      if (Buffer.byteLength(prompt, 'utf8') > 64 * 1024) throw new Error('EXECUTION_INPUT_TOO_LARGE')
      const argv = ['python3', '-c', CODING_WORKSPACE_RUNNER, JSON.stringify(codingRunManifest(prepared, identity, String(command.header.messageId))), prompt, lease.workspaceRoot]
      executionStarted = performance.now()
      let firstStdout = false
      const deployment = await this.options.deploymentEnabled?.() ?? this.options.environment().BYCLAW_DEPLOY_ENABLED === '1'
      const execute = deployment ? sandbox.executeWithDeployment : sandbox.execute
      if (!execute) throw new Error('EXECUTION_DEPLOYMENT_UNAVAILABLE')
      const processResult = await execute.call(sandbox, actor, lease.leaseId, argv, lease.workspaceRoot, signal, chunk => {
        stdoutBytes += Buffer.byteLength(chunk, 'utf8')
        if (!firstStdout && chunk) { firstStdout = true; log('first_stdout', 'success', executionStarted) }
        parser.write(chunk)
      })
      const stderrDiagnostic = summarizeCodingDiagnostic(processResult.stderr)
      // Keep both sources. Prefer a classified native error over unrelated stderr warnings.
      const diagnostic = parser.diagnostic && parser.diagnostic.category !== 'unknown' ? parser.diagnostic
        : stderrDiagnostic && stderrDiagnostic.category !== 'unknown' ? stderrDiagnostic
        : parser.diagnostic ?? stderrDiagnostic
      processOutcome = { exitCode: processResult.exitCode, ...(diagnostic === undefined ? {} : { diagnostic }),
        ...(stderrDiagnostic === undefined ? {} : { stderrDiagnostic }) }
      if (stderrDiagnostic) log('stderr', 'success', executionStarted, { diagnostic: stderrDiagnostic, stderrDiagnostic, exitCode: processResult.exitCode })
      signal.throwIfAborted()
      if (processResult.exitCode !== 0) {
        const reason = /(?:^|\n)((?:EXECUTION|CODEX)_[A-Z_]{1,80})(?:\r?\n|$)/u.exec(processResult.stderr)?.[1]
        if (reason) throw new Error(reason)
      }
      const output = codingFinalOutput(parser.finish(processResult.exitCode), prepared?.publication !== undefined)
      let answer = output.answer
      endStage('success', undefined, processOutcome)
      await forwarding
      if (forwardingError) throw forwardingError
      if (output.publication !== undefined) {
        signal.throwIfAborted()
        emit({ kind: 'tool', id: 'publication', title: '准备群任务成果，等待确认', phase: 'start' })
        try {
          await prepared!.publication!.prepare(output.publication, signal)
          emit({ kind: 'tool', id: 'publication', title: '准备群任务成果，等待确认', phase: 'success' })
          answer += '\n\n群任务成果已准备，等待你确认后发送。'
        } catch {
          emit({ kind: 'tool', id: 'publication', title: '准备群任务成果，等待确认', phase: 'error', detail: '准备结果未确认，请查询原待发布卡片；不能声称已经发布，不自动重试。' })
          throw new Error('EXECUTION_PUBLICATION_UNCONFIRMED')
        }
        await forwarding
        if (forwardingError) throw forwardingError
      }
      result = { answer, finalAnswer: answer, executor: definition.executor, executionType, ...(parser.threadId === undefined ? {} : { codexThreadId: parser.threadId }) }
    } catch (error) {
      const code = failureCode()
      const knownReason = error instanceof Error ? /^(?:CODEX|EXECUTION|SANDBOX)_[A-Z_]+/u.exec(error.message)?.[0] : undefined
      failure = new Error(code, { cause: new Error(knownReason ?? code) })
      parser.abort(code)
      endStage('error', knownReason ?? code, processOutcome)
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      if (sandbox) {
        startStage('cleanup', '归还 coding 工具沙箱租约')
        try {
          const cleanup = await sandbox.releaseActor(actor)
          if (cleanup.retainedLeases.length || cleanup.retainedAllocations.length) throw new Error('EXECUTION_CLEANUP_RETAINED')
          endStage('success')
        } catch {
          endStage('error', 'EXECUTION_CLEANUP_RETAINED')
          failure ??= new Error('EXECUTION_CLEANUP_RETAINED')
        }
      }
      await forwarding
      clearInterval(timer)
    }
    check()
    if (forwardingError) failure = new Error('EXECUTION_EVENT_FORWARDING_FAILED')
    else if (signal.aborted) failure ??= new Error(failureCode())
    if (failure) {
      const diagnostic = processOutcome.diagnostic ?? parser.diagnostic
      log('request', 'error', queuedAt, { ...processOutcome, reason: failure.cause instanceof Error ? failure.cause.message : failure.message,
        ...(diagnostic === undefined ? {} : { diagnostic }) })
      throw failure
    }
    log('request', 'success', queuedAt, processOutcome)
    return result!
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

/** Only the original bounded 3016 shape and safe relative paths may reach UserFS UI. */
function validateFileChanges(value: unknown, sessionId: string): FileChangesSummaryPayload {
  const payload = value as FileChangesSummaryPayload | undefined
  if (!payload || payload.type !== 'file_changes' || payload.version !== 2 || payload.sessionId !== sessionId
    || !Array.isArray(payload.files) || payload.files.length > 20000) throw new Error('EXECUTION_INVALID_FILE_CHANGES')
  for (const file of payload.files) {
    if (!/^[a-f0-9-]{36}$/iu.test(file.uuid) || !file.path || file.path.startsWith('/') || /[\\\u0000]/u.test(file.path)
      || file.path.split('/').some(part => part === '..' || part === '.')
      || !['added', 'modified', 'deleted'].includes(file.changeType) || typeof file.binary !== 'boolean'
      || ![file.additions, file.deletions].every(n => Number.isSafeInteger(n) && n >= 0)
      || !Array.isArray(file.sources) || file.sources.some(source => source !== 'write')) throw new Error('EXECUTION_INVALID_FILE_CHANGES')
  }
  return { ...payload, summary: { total: payload.files.length,
    added: payload.files.filter(file => file.changeType === 'added').length,
    modified: payload.files.filter(file => file.changeType === 'modified').length,
    deleted: payload.files.filter(file => file.changeType === 'deleted').length } }
}
