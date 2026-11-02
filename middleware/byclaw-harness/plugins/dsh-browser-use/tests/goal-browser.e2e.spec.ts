import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, vi } from 'vitest'
import { startBrowserd } from '../src/browserd.js'
import { BrowserBrokerClient } from '../src/broker-client.js'
import { runBrowserGoal } from '../src/goal-runner.js'
import { resolveGoalConfig } from '../src/goal-config.js'
import { decideGoal } from '../src/goal-decision.js'
import type { GoalControlState } from '../src/goal-control.js'
import { acquireAutomationLock } from '../src/automation-lock.js'

const executablePath = [process.env.BYCLAW_BROWSER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find(p => p && existsSync(p))
;(executablePath ? it : it.skip)('runs observed fill/select/click through actual broker and Chromium using mocked Jev', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'goal-browser-e2e-'))
  const server = createServer((_req, res) => { res.end('<!doctype html><title>Goal fixture</title><input aria-label="Query"><select aria-label="City"><option value="a">A</option><option value="b">B</option></select><button type="button" onclick="document.querySelector(\'p\').textContent=\'Saved\'">Save</button><p>Ready</p>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const startUrl = `http://127.0.0.1:${address.port}/`, lease = { leaseId: 'lease', capability: 'test-capability' }, secret = 'test-secret'
  vi.stubEnv('BYCLAW_BROWSER_JEV_ENABLED', 'true')
  const daemon = await startBrowserd({ socketPath: join(directory, 'broker.sock'), secret, executablePath, headless: true })
  const broker = new BrowserBrokerClient({ socketPath: join(directory, 'broker.sock'), secret })
  try {
    await broker.open(lease, { startUrl, allowSubmit: true, allowedDomains: ['127.0.0.1'], viewerSessionId: 'session' })
    await broker.goal(lease, { command: 'start', runId: 'run', maxRunMs: 20000, maxPauseMs: 1000 })
    const events: string[] = []
    const result = await runBrowserGoal({ runId: 'run', input: { operation: 'runGoal', goal: '输入 supplied，选择 B，点击 Save', successText: 'Saved' },
      config: { ...resolveGoalConfig({}), maxRunMs: 20000 }, allowSubmit: true, text: { generate: async () => 'supplied' },
      signal: new AbortController().signal, log: e => { events.push(e) },
      decide: (goal, page, history, candidates, options) => decideGoal(goal, page, history, candidates, { ...options, env: { AI_GATEWAY_API_KEY: 'test-key' },
        fetchImpl: async (_url, request) => {
          const body = JSON.parse(request!.body as string)
          const op = page.text.includes('Saved') ? 'DONE' : !page.elements.some(e => e.value === 'supplied') ? 'TYPE_TEXT'
            : !page.elements.some(e => e.selectedValue === 'b') ? 'SELECT' : 'CLICK'
          const answers: Record<string, unknown> = {}
          for (const [name, question] of Object.entries(body.questions) as [string, any][]) {
            const keys = Object.keys(question.criteria), choice = name === 'operation' ? op : keys[0]!
            answers[name] = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? 1 : 0])) }
          }
          return new Response(JSON.stringify({ model: 'typesafe-ai/jev', answers }))
        } }),
      scope: {
        inspect: s => broker.inspect(lease, s, 'compact'),
        check: async (semanticToken, ticket, s) => { await broker.goal(lease, { command: 'check', ...ticket, semanticToken }, s) },
        act: (action, semanticToken, ticket, s) => broker.act(lease, action, s, { semanticToken, ticket }),
        state: s => broker.goal(lease, { command: 'state', runId: 'run' }, s) as Promise<GoalControlState>,
        progress: async (decisions, actions, s) => { await broker.goal(lease, { command: 'progress', runId: 'run', decisions, actions }, s) },
        saveDownload: async path => path,
      },
    })
    expect(result).toMatchObject({ status: 'verified', actions: 3, decisions: 4, textCalls: 1 })
    expect(result.steps.map(s => s.operation)).toEqual(['TYPE_TEXT', 'SELECT', 'CLICK'])
    expect(events.filter(e => e === 'action_completed')).toHaveLength(3)
  } finally {
    server.closeAllConnections()
    await broker.closeLease(lease).catch(() => {}); broker.dispose(); await daemon.close()
    await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('shares an OS lock and releases it on cancellation and completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'goal-lock-')), path = join(directory, 'lock')
  const signal = new AbortController().signal
  try {
    const release = await acquireAutomationLock(path, signal, 1000)
    await expect(acquireAutomationLock(path, signal, 50)).rejects.toThrow('browser-automation-busy')
    await release()
    const next = await acquireAutomationLock(path, signal, 1000)
    const abort = new AbortController(), waiting = acquireAutomationLock(path, abort.signal, 1000)
    abort.abort(); await expect(waiting).rejects.toThrow()
    await next()
    await (await acquireAutomationLock(path, signal, 1000))()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
