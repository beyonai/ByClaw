import { setTimeout as delay } from 'node:timers/promises'
import { decideGoal, goalActionSpace } from './goal-decision.js'
import type { BrowserGoalInput, BrowserTextService, GoalConfig, GoalResult, GoalScope } from './goal-types.js'
import type { GoalTicket } from './goal-control.js'
import type { BrowserInspection } from './protocol.js'

export interface GoalRunnerOptions {
  runId: string; input: BrowserGoalInput; config: GoalConfig; scope: GoalScope; signal: AbortSignal
  allowSubmit: boolean; text: BrowserTextService
  decide?: typeof decideGoal
  log?: (event: string, data: Record<string, unknown>) => void
}
function code(error: unknown): string {
  const value = (error as { code?: string })?.code ?? (error instanceof Error ? error.message : '')
  return /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : 'browser-goal-failed'
}
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => undefined); signal.throwIfAborted() }
  let abort: () => void = () => {}
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([operation, interrupted]) }
  finally { signal.removeEventListener('abort', abort) }
}
/** A bounded loop: only confirmed pre-dispatch stale decisions may be retried. */
export async function runBrowserGoal(o: GoalRunnerOptions): Promise<GoalResult> {
  const started = Date.now(), maxMs = o.input.maxRunMs ?? o.config.maxRunMs
  const remoteCancel = new AbortController(), monitorStop = new AbortController()
  const signal = AbortSignal.any([o.signal, AbortSignal.timeout(maxMs), remoteCancel.signal])
  // Controls use a separate broker lane, so a cancel can interrupt a pending model request.
  const monitor = (async () => {
    while (!monitorStop.signal.aborted) {
      await delay(200, undefined, { signal: monitorStop.signal })
      const state = await abortable(o.scope.state(monitorStop.signal), monitorStop.signal)
      if (state.status === 'cancelled') { remoteCancel.abort(new Error('browser-goal-cancelled')); return }
    }
  })().catch(() => {
    if (!monitorStop.signal.aborted) remoteCancel.abort(new Error('browser-goal-control-unavailable'))
  })
  const result: GoalResult = { runId: o.runId, status: 'failed', reason: 'budget_exhausted', actions: 0, decisions: 0, textCalls: 0,
    elapsedMs: 0, jevMs: 0, textMs: 0, browserMs: 0, inputTokens: 0, outputTokens: 0, downloads: [], steps: [] }
  let page: BrowserInspection | undefined, cache: { key: string; value: string } | undefined
  let noProgress = 0, waits = 0, oldGeneration = -1
  const history: string[] = []
  const log = (event: string, data: Record<string, unknown> = {}) => o.log?.(event, { runId: o.runId, ...data })
  const observe = async () => {
    const now = Date.now()
    page = await o.scope.inspect(signal)
    result.browserMs += Date.now() - now
    if (!page.semanticToken) throw new Error('browser-goal-semantic-state-required')
    result.observation = page
    log('observed', { elements: page.elements.length })
  }
  const ticket = async (): Promise<GoalTicket> => {
    for (;;) {
      signal.throwIfAborted()
      const state = await o.scope.state(signal)
      if (state.status === 'cancelled') throw new Error('browser-goal-cancelled')
      if (state.status === 'running') return { runId: state.runId, generation: state.generation }
      await delay(100, undefined, { signal })
    }
  }
  log('started')
  try {
    while (result.decisions < o.config.maxDecisions && result.actions < (o.input.maxSteps ?? o.config.maxSteps)) {
      const turn = await ticket()
      if (oldGeneration !== turn.generation) { page = undefined; cache = undefined; oldGeneration = turn.generation }
      await observe()
      const observed = page!
      const candidates = goalActionSpace(observed, o.allowSubmit)
      const now = Date.now()
      log('jev_request', { decision: result.decisions + 1, candidates: Object.keys(candidates).length })
      result.decisions++
      const selected = await abortable((o.decide ?? decideGoal)(o.input.goal, observed, history, candidates, { signal }), signal)
      result.jevMs += Date.now() - now
      result.inputTokens += selected.usage?.input_tokens ?? 0
      result.outputTokens += selected.usage?.output_tokens ?? 0
      log('jev_response', { decision: result.decisions, operation: selected.operation, confidence: selected.confidence, elapsedMs: Date.now() - now, usage: selected.usage })
      await o.scope.progress(result.decisions, result.actions, signal)
      if (selected.confidence < o.config.minConfidence) { result.reason = 'low_confidence'; break }
      try {
        const current = await ticket()
        if (current.generation !== turn.generation) continue
        await o.scope.check(observed.semanticToken!, turn, signal)
        if (selected.operation === 'BLOCKED') { result.status = 'needs_user'; result.reason = 'model_blocked'; break }
        if (selected.operation === 'DONE') {
          await observe()
          const currentPage = page!
          // A new state after the decision needs another decision, even for DONE.
          if (currentPage.semanticToken !== observed.semanticToken) continue
          const matches = (!o.input.successText || currentPage.text.includes(o.input.successText))
            && (!o.input.successUrl || currentPage.url === o.input.successUrl)
          if (!matches) { result.status = 'blocked'; result.reason = 'success_condition_unmet' }
          else { result.status = o.input.successText || o.input.successUrl ? 'verified' : 'reported_done'; result.reason = 'done' }
          break
        }
        const chosen = selected.target
        let action = chosen?.action ?? { kind: 'wait' as const, milliseconds: 100 }
        if (!chosen && selected.operation !== 'WAIT') throw new Error('browser-goal-invalid-target')
        if (action.kind === 'fill') {
          if (result.textCalls >= o.config.maxTextCalls) { result.reason = 'text_budget_exhausted'; break }
          const context = { goal: o.input.goal, field: { name: chosen!.element!.name, ...(chosen!.element!.role ? { role: chosen!.element!.role } : {}), ...(chosen!.element!.value !== undefined ? { value: chosen!.element!.value } : {}) }, page: { title: observed.title, text: observed.text.slice(0, 6000) }, recentActions: history.slice(-6) }
          const key = JSON.stringify(context), textStart = Date.now()
          if (cache?.key !== key) {
            result.textCalls++
            log('text_request', { call: result.textCalls })
            const value = await abortable(o.text.generate(context, signal), signal)
            signal.throwIfAborted()
            if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('browser-goal-text-invalid')
            cache = { key, value }
            log('text_response', { call: result.textCalls, elapsedMs: Date.now() - textStart })
          }
          result.textMs += Date.now() - textStart
          action = { ...action, value: cache.value }
        }
        // Re-check authorization and semantic state after every model request.
        if ((await ticket()).generation !== turn.generation) continue
        const actionStart = Date.now()
        log('action_requested', { operation: selected.operation, target: chosen?.element?.index })
        let acted
        try { acted = await o.scope.act(action, observed.semanticToken!, turn, signal) }
        catch (error) {
          if (['browser-observation-stale', 'browser-goal-control-stale'].includes(code(error))) throw error
          delete result.observation
          result.reason = /denied/.test(code(error)) ? code(error) : 'execution_unknown'
          result.status = /denied/.test(code(error)) ? 'blocked' : 'failed'
          log('action_unknown', { reason: result.reason })
          break
        }
        result.browserMs += Date.now() - actionStart
        result.actions++
        delete result.observation
        cache = undefined
        result.steps.push({ operation: selected.operation, ...(chosen?.element ? { target: chosen.element.index } : {}), dispatched: acted.dispatched !== false })
        log('action_completed', { step: result.actions, operation: selected.operation, dispatched: acted.dispatched !== false })
        // Persist execution before any post-action observation; never replay this mutation.
        history.push(`${selected.operation} ${chosen?.label ?? ''}: ${acted.changed ? 'changed' : 'unchanged'}`)
        for (const file of acted.downloads ?? (acted.download ? [acted.download] : [])) {
          result.downloads.push({ ...file, path: await o.scope.saveDownload(file.path, file.name) })
        }
        await o.scope.progress(result.decisions, result.actions, signal)
        noProgress = acted.changed || acted.textDrift ? 0 : noProgress + 1
        waits = selected.operation === 'WAIT' ? waits + 1 : 0
        if (noProgress >= 8 || waits >= 10) { result.status = 'blocked'; result.reason = 'no_progress'; break }
        await delay(action.kind === 'fill' && chosen?.element?.role === 'combobox' ? 200 : 50, undefined, { signal })
      } catch (error) {
        if (['browser-observation-stale', 'browser-goal-control-stale'].includes(code(error))) { log('stale'); continue }
        throw error
      }
    }
  } catch (error) {
    result.reason = signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'deadline_exceeded' : remoteCancel.signal.aborted ? code(remoteCancel.signal.reason) : 'cancelled') : code(error)
    result.status = result.reason === 'cancelled' || result.reason === 'browser-goal-cancelled' ? 'cancelled'
      : /text-(unavailable|invalid)|needs-user/.test(result.reason) ? 'needs_user' : 'failed'
  }
  if (!result.observation && !signal.aborted && result.reason !== 'execution_unknown') {
    try { if ((await o.scope.state(signal)).status === 'running') await observe() } catch { /* Keep completed step evidence. */ }
  }
  monitorStop.abort()
  await monitor
  result.elapsedMs = Date.now() - started
  log('finished', { status: result.status, reason: result.reason, actions: result.actions, decisions: result.decisions, textCalls: result.textCalls, elapsedMs: result.elapsedMs, jevMs: result.jevMs, textMs: result.textMs, browserMs: result.browserMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
  return result
}
