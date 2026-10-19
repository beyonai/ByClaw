import { describe, it, expect, vi } from 'vitest'
import { runBrowserGoal, type GoalRunnerOptions } from '../src/goal-runner.js'
import { goalActionSpace, decideGoal } from '../src/goal-decision.js'
import { BrowserGoalControl } from '../src/goal-control.js'
import { resolveGoalConfig, browserGoalEnabled } from '../src/goal-config.js'
import type { BrowserInspection } from '../src/protocol.js'

const page: BrowserInspection = { url: 'https://example.test/', title: 'Search', text: 'Results ready', semanticToken: 's1', elements: [
  { index: 1, tag: 'button', name: 'Search', disabled: false, clickable: true },
  { index: 2, tag: 'input', name: 'Search query', disabled: false, editable: true },
] }
function fixture(): GoalRunnerOptions {
  const config = { ...resolveGoalConfig({}), maxSteps: 5, maxDecisions: 8 }
  return { runId: 'run', input: { operation: 'runGoal', goal: 'Search user supplied query' }, config, signal: new AbortController().signal,
    allowSubmit: false, text: { generate: vi.fn(async () => 'user supplied query') },
    scope: { inspect: vi.fn(async () => page), check: vi.fn(async () => {}), act: vi.fn(async () => ({ changed: true, dispatched: true })),
      state: vi.fn(async () => ({ runId: 'run', sessionId: 'session', generation: 0, status: 'running', deadline: Date.now() + 10000, actions: 0, decisions: 0 })),
      progress: vi.fn(async () => {}), saveDownload: vi.fn(async () => '/saved/file') },
    decide: vi.fn(async () => ({ operation: 'DONE', confidence: 1, target: undefined, usage: undefined })), log: vi.fn(),
  }
}
const selected = (operation: string) => ({ operation, confidence: 1, target: Object.values(goalActionSpace(page, false)).find(c => c.operation === operation), usage: undefined })
describe('bounded Jev goal runner', () => {
  it('defaults off and validates deployment budgets', () => {
    expect(browserGoalEnabled({})).toBe(false)
    expect(browserGoalEnabled({ BYCLAW_BROWSER_JEV_ENABLED: 'true' })).toBe(true)
    expect(() => resolveGoalConfig({ BYCLAW_BROWSER_GOAL_MAX_STEPS: '0' })).toThrow()
  })
  it('separates model DONE from verified page predicates', async () => {
    const o = fixture()
    expect(await runBrowserGoal(o)).toMatchObject({ status: 'reported_done', actions: 0, decisions: 1 })
    o.input.successText = 'Results ready'
    expect(await runBrowserGoal(o)).toMatchObject({ status: 'verified' })
    o.input.successUrl = 'https://wrong.test/'
    expect(await runBrowserGoal(o)).toMatchObject({ status: 'blocked', reason: 'success_condition_unmet' })
  })
  it('reselects before dispatch on text drift, never replays an ambiguous mutation', async () => {
    const o = fixture(); o.decide = vi.fn(async () => selected('CLICK'))
    vi.mocked(o.scope.check).mockRejectedValueOnce(Object.assign(new Error('stale'), { code: 'browser-observation-stale' }))
    vi.mocked(o.scope.act).mockRejectedValue(new Error('transport failed after click'))
    expect(await runBrowserGoal(o)).toMatchObject({ status: 'failed', reason: 'execution_unknown', decisions: 2, actions: 0 })
    expect(o.scope.act).toHaveBeenCalledTimes(1)
  })
  it('stops on low confidence, blocked, and exhausted budgets without side effects', async () => {
    const o = fixture(); o.decide = vi.fn(async () => ({ ...selected('CLICK'), confidence: 0.1 }))
    expect(await runBrowserGoal(o)).toMatchObject({ reason: 'low_confidence', actions: 0 })
    o.decide = vi.fn(async () => selected('BLOCKED'))
    expect(await runBrowserGoal(o)).toMatchObject({ status: 'needs_user', actions: 0 })
    o.decide = vi.fn(async () => selected('CLICK')); o.input.maxSteps = 1
    expect(await runBrowserGoal(o)).toMatchObject({ reason: 'budget_exhausted', actions: 1 })
  })
  it('calls text helper only for fill and rechecks after it; saves downloads immediately', async () => {
    const o = fixture(); o.decide = vi.fn().mockResolvedValueOnce(selected('TYPE_TEXT')).mockResolvedValue(selected('DONE'))
    vi.mocked(o.scope.act).mockResolvedValue({ changed: true, download: { path: '/tmp/file', name: 'file', size: 5 } })
    const result = await runBrowserGoal(o)
    expect(result).toMatchObject({ status: 'reported_done', actions: 1, textCalls: 1, downloads: [{ path: '/saved/file' }] })
    expect(o.scope.act).toHaveBeenCalledWith({ kind: 'fill', element: 2, value: 'user supplied query' }, 's1', { runId: 'run', generation: 0 }, expect.any(AbortSignal))
    expect(vi.mocked(o.scope.saveDownload).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(o.scope.inspect).mock.invocationCallOrder[1]!)
  })
  it('does not repeat a completed action after post-action inspection failure', async () => {
    const o = fixture(); o.decide = vi.fn(async () => selected('CLICK'))
    vi.mocked(o.scope.inspect).mockResolvedValueOnce(page).mockRejectedValue(new Error('observe-failed'))
    expect(await runBrowserGoal(o)).toMatchObject({ status: 'failed', actions: 1, steps: [{ dispatched: true }] })
    expect(o.scope.act).toHaveBeenCalledTimes(1)
  })
  it('invalidates in-flight decisions on pause/resume and on cancellation', async () => {
    const o = fixture(); let generation = 0
    o.scope.state = vi.fn(async () => ({ runId: 'run', sessionId: 'session', generation, status: 'running', deadline: Date.now() + 10000, actions: 0, decisions: 0 }))
    o.decide = vi.fn().mockImplementationOnce(async () => { generation = 2; return selected('CLICK') }).mockResolvedValue(selected('DONE'))
    expect(await runBrowserGoal(o)).toMatchObject({ decisions: 2, actions: 0 })
    expect(o.scope.act).not.toHaveBeenCalled()
    o.scope.state = vi.fn(async () => ({ runId: 'run', sessionId: 'session', generation: 3, status: 'cancelled', deadline: Date.now(), actions: 0, decisions: 0 }))
    expect(await runBrowserGoal(o)).toMatchObject({ status: 'cancelled' })
  })
  it('keeps submit/password/hidden targets out of the candidate set', () => {
    const candidates = goalActionSpace({ ...page, elements: [
      { index: 3, tag: 'button', name: 'Submit', disabled: false, clickable: true, submit: true },
      { index: 4, tag: 'input', name: 'Password', disabled: false, editable: true, type: 'password' },
      { index: 5, tag: 'button', name: 'Hidden', disabled: false, clickable: true, visible: false },
    ] }, false)
    expect(candidates).toEqual({})
  })
  it('consumes only the target head matching operation, in one Jev request', async () => {
    const candidates = goalActionSpace(page, false); let calls = 0
    const result = await decideGoal('click Search', page, [], candidates, { env: { AI_GATEWAY_API_KEY: 'test' }, fetchImpl: async (_url, request) => {
      calls++; const body = JSON.parse(request!.body as string)
      expect(body.questions).toHaveProperty('operation'); expect(body.questions).toHaveProperty('type_text_target')
      expect(body.state.page.elements).toContainEqual(expect.objectContaining({ name: 'Search query', editable: true }))
      return new Response(JSON.stringify({ model: 'typesafe-ai/jev', answers: {
        operation: { type: 'choice', choice: 'CLICK', confidence: 1, probabilities: { CLICK: 1, TYPE_TEXT: 0, WAIT: 0, DONE: 0, BLOCKED: 0 } },
        click_target: { type: 'choice', choice: 'click_1', confidence: 1, probabilities: { click_1: 1 } },
        type_text_target: { broken: true },
      } }))
    } })
    expect(calls).toBe(1); expect(result.target?.action).toEqual({ kind: 'click', element: 1 })
  })
})

describe('broker control generation fencing', () => {
  it('waits for dispatched activity before granting manual control and rejects old generations', () => {
    const control = new BrowserGoalControl()
    control.start('lease', 'session', 'run', 10000, 1000)
    const leave = control.enter('lease', { runId: 'run', generation: 0 })
    expect(control.control('run', 0, 'pause').status).toBe('pausing')
    expect(() => control.assertTicket('lease', { runId: 'run', generation: 0 })).toThrow()
    expect(() => control.control('run', 1, 'resume')).toThrow()
    leave(); expect(control.state()?.status).toBe('paused')
    expect(control.control('run', 1, 'resume').generation).toBe(2)
    expect(() => control.enter('another')).toThrow('browser-goal-busy')
    expect(() => control.control('old-run', 2, 'cancel')).toThrow()
    control.control('run', 2, 'cancel'); expect(control.state()?.status).toBe('cancelled')
    control.finish('lease'); expect(control.state()).toBeUndefined()
  })
})

it('bounds uncooperative model requests by the goal deadline', async () => {
  const o = fixture(); o.input.maxRunMs = 25; o.decide = () => new Promise(() => {})
  expect(await runBrowserGoal(o)).toMatchObject({ status: 'failed', reason: 'deadline_exceeded', actions: 0 })
})

it('bounds graceful browser-server shutdown and kills only its owned server on timeout', async () => {
  const { closeOwnedBrowserServer } = await import('../src/browser-close.js')
  const kill = vi.fn(async () => {})
  await closeOwnedBrowserServer({ close: async () => {}, kill }, 20)
  expect(kill).not.toHaveBeenCalled()
  await closeOwnedBrowserServer({ close: () => new Promise(() => {}), kill }, 20)
  expect(kill).toHaveBeenCalledTimes(1)
})

it('handles a cancellation raised synchronously by a model request without an unhandled rejection', async () => {
  const o = fixture(), cancelled = new AbortController(); o.signal = cancelled.signal
  o.decide = async () => { cancelled.abort(); throw new Error('model-aborted') }
  expect(await runBrowserGoal(o)).toMatchObject({ status: 'cancelled', actions: 0 })
})

it('remote cancellation interrupts a pending model call without waiting for the model timeout', async () => {
  const o = fixture(); let cancel = false
  o.scope.state = async () => ({ runId: 'run', sessionId: 'session', generation: cancel ? 1 : 0, status: cancel ? 'cancelled' : 'running', deadline: Date.now() + 10000, actions: 0, decisions: 0 })
  o.decide = () => { cancel = true; return new Promise(() => {}) }
  expect(await runBrowserGoal(o)).toMatchObject({ status: 'cancelled', actions: 0 })
})
