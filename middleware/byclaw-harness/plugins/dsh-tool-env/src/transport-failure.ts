import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { RemoteOperationError } from '@deepseek-ai/dsh-ssh/protocol'

const environmentFailures = new WeakSet<Error>()
const applicationErrors = new WeakSet<Error>()
const failureObserver = new AsyncLocalStorage<(error: Error) => void>()

/** Include failures which a preparation provider handles locally instead of rethrowing. */
export function observeEnvironmentFailures<T>(observer: (error: Error) => void, work: () => T): T {
  return failureObserver.run(observer, work)
}

/** Preserve provider error identity while recording its tool-environment origin. */
export function markEnvironmentFailure(error: Error): Error {
  environmentFailures.add(error)
  failureObserver.getStore()?.(error)
  return error
}

/** Filesystem and subprocess providers may wrap the original SSH error. */
export function isEnvironmentFailure(error: unknown): boolean {
  const visiting = new Set<Error>()
  const visit = (value: unknown): boolean => {
    if (!(value instanceof Error) || visiting.has(value)) return false
    if (environmentFailures.has(value)) return true
    visiting.add(value)
    try {
      // A mixed aggregate must not hide an unrelated policy/configuration failure.
      if (value instanceof AggregateError) {
        return value.errors.length > 0 && value.errors.every(visit)
          && (value.cause === undefined || visit(value.cause))
      }
      return visit(value.cause)
    } finally { visiting.delete(value) }
  }
  return visit(error)
}

/** Connection loss can leave a dispatched operation with an unknown outcome. */
export class ToolEnvironmentTransportError extends Error {
  override readonly name = 'ToolEnvironmentTransportError'
}

/** Classify transport outcomes without relabeling application or authority failures. */
export function isToolTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error) || applicationErrors.has(error) || error instanceof RemoteOperationError || /digest|host key|permission denied|TOOL_LEASE_|Beyond-Token|unauthorized|(?:HTTP |-> )(?:401|403|407)\b/i.test(error.message)) return false
  return /TOOL_ENV_(?:UNAVAILABLE|OUTCOME_UNKNOWN)|SSH helper disconnected|SSH connection (?:is closed|is closing|closed before|lost)|bridge .* is not reachable|sshd .* is not reachable|tool environment is not available \(.*(?:not reachable|ECONNRESET|ECONNREFUSED|ETIMEDOUT)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up/i.test(error.message)
}

/** Preserve the actual reason while removing credentials from model-visible diagnostics. */
export function toolFailureReason(error: unknown): string {
  const seen = new Set<Error>()
  const messages = new Set<string>()
  const collect = (value: unknown): void => {
    if (value instanceof Error) {
      if (seen.has(value)) return
      seen.add(value)
      messages.add(value.message)
      if (value instanceof AggregateError) value.errors.forEach(collect)
    } else messages.add(String(value))
  }
  collect(error)
  const message = [...messages].join('\n')
  return message.replace(/\b(?:https?|wss?):\/\/[^\s)"'<>]+/giu, raw => {
    try {
      const url = new URL(raw)
      url.username = ''
      url.password = ''
      url.search = url.search ? '?redacted' : ''
      url.hash = ''
      return url.toString()
    } catch { return '[redacted URL]' }
  }).replace(/((?:Authorization|Beyond-Token|Sso-Token)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/giu, '$1[redacted]')
}

export function toolTransportError(error: unknown, dispatched: boolean): Error {
  if (error instanceof ToolEnvironmentTransportError) return error
  if (!isToolTransportFailure(error)) {
    const reason = toolFailureReason(error)
    // Native tools already convert application errors to failed tool results.
    // Preserve error identity/code for existing providers unless redaction is needed.
    if (error instanceof Error && reason === error.message) return error
    const redacted = error instanceof RemoteOperationError
      ? new RemoteOperationError(reason, error.code) : new Error(reason)
    redacted.cause = error
    applicationErrors.add(redacted)
    return redacted
  }
  const code = dispatched ? 'TOOL_ENV_OUTCOME_UNKNOWN' : 'TOOL_ENV_UNAVAILABLE'
  return new ToolEnvironmentTransportError(`${code}: ${toolFailureReason(error)}`, { cause: error })
}

interface LeaseReleaseTask {
  closing(): boolean
  started: boolean
  run(): Promise<void>
}

interface LeaseWarningScope {
  report(warning: string, late: boolean): void
  settled: boolean
  releases: Set<LeaseReleaseTask>
}

const leaseWarnings = new AsyncLocalStorage<LeaseWarningScope>()

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'byclaw-tool-env-warning': { kind: 'byclaw-tool-env-warning'; callId?: ToolCallId }
  }
}

/** Preparation has no tools/execute warning collector of its own. */
export async function observeLeaseWarnings<T>(observer: (warning: string, late: boolean) => void, work: () => T): Promise<Awaited<T>> {
  const scope: LeaseWarningScope = { report: observer, settled: false, releases: new Set() }
  try { return await leaseWarnings.run(scope, work) } finally {
    try {
      // A destroyed socket may emit close on the next tick. Do not wait for live streams.
      await Promise.all([...scope.releases].filter(task => task.started || task.closing()).map(task => task.run()))
    } finally { scope.settled = true }
  }
}

/** Bind asynchronous close/release work to the stream's original warning scope. */
export function trackLeaseRelease(closing: () => boolean, release: () => Promise<void>): () => Promise<void> {
  const scope = leaseWarnings.getStore()
  let pending: Promise<void> | undefined
  const task: LeaseReleaseTask = { closing, started: false, run: AsyncLocalStorage.bind(() => {
    task.started = true
    return pending ??= Promise.resolve().then(release).finally(() => { scope?.releases.delete(task) })
  }) }
  scope?.releases.add(task)
  return task.run
}

/** Native injection queues context without waking an idle/cancelled conversation. */
export function injectLeaseWarning(ctx: Context, agent: { inject(message: UserMessage): void } | undefined,
  warning: string, signal?: AbortSignal, callId?: ToolCallId): void {
  if (signal?.aborted) return
  try {
    agent?.inject(createUserMessage({ content: [{ type: 'text', text: warning }],
      source: { kind: 'byclaw-tool-env-warning', ...(callId === undefined ? {} : { callId }) } }))
  } catch (error) {
    ctx.logger('byclaw-tool-env').warn(`Unable to queue lease warning: ${toolFailureReason(error)}`)
  }
}

/** Attach cleanup diagnostics without changing a tool's successful value/schema. */
export function registerLeaseWarnings(ctx: Context): void {
  ctx.on('tools/execute', async (execution, next) => {
    const warnings: string[] = []
    const result = await observeLeaseWarnings((warning, late) => {
      if (late) injectLeaseWarning(ctx, execution.agent, warning, execution.signal, execution.callId)
      else warnings.push(warning)
    }, next)
    if (warnings.length === 0) return result
    return { ...result, additionalContexts: [
      ...result.additionalContexts ?? [],
      createUserMessage({ content: [{ type: 'text', text: warnings.join('\n') }], source: { kind: 'tool', callId: execution.callId } }),
    ] }
  }, { prepend: true })
}

export function reportLeaseWarning(error: unknown, operationCompleted = true): string {
  const status = operationCompleted ? '操作已成功完成' : '流已关闭，租约归还失败不改变远程操作结果'
  const warning = `TOOL_ENV_LEASE_RELEASE_FAILED: ${status}，请勿因租约归还失败而重放操作。租约归还失败：${toolFailureReason(error)}`
  const scope = leaseWarnings.getStore()
  scope?.report(warning, scope.settled)
  return warning
}

export function withLeaseFailure(primary: Error, cleanup: unknown): Error {
  const ErrorClass = primary instanceof ToolEnvironmentTransportError ? ToolEnvironmentTransportError : Error
  const message = `${primary.message}\n租约归还失败：${toolFailureReason(cleanup)}`
  const result = primary instanceof RemoteOperationError
    ? new RemoteOperationError(message, primary.code) : new ErrorClass(message)
  result.cause = new AggregateError([primary, cleanup], 'Operation and lease release failed')
  if (!(primary instanceof ToolEnvironmentTransportError)) applicationErrors.add(result)
  return result
}
