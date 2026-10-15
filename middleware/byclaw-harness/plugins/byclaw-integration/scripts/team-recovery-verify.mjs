/** Timed recovery through real scoped team files and DSH durable inboxes. */
import { resolveTeamStateRoot } from '../../agent-teams/lib/runtime-state.js'
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { ByClawAsyncTeamGate, ByClawDshSessionRuntime } from '../lib/session-runtime.js'

const workspace = await mkdtemp(join(tmpdir(), 'byclaw-team-recovery-'))
const agents = new Map()
const sessions = new Map()
const wakes = []
const warnings = []
const ctx = {
  root: { on() { return () => {} }, sessions: { get(id) { return sessions.get(id) } } },
  agents: { get(id) { return agents.get(id) } },
  subagents: {},
  logger: { warn(message) { warnings.push(message) } },
}
for (const [id, parent] of [['root'], ['captain', 'root'], ['foreign']]) {
  const sid = SessionId(id)
  const session = Session.create(sid, [], { version: SESSION_FORMAT_VERSION, id: sid, createdAt: 0, isSeeded: false, delegationDepth: parent ? 1 : 0,
    ...(parent ? { parentSession: SessionId(parent) } : {}) })
  sessions.set(id, session)
  agents.set(id, { id: sid, session, status: 'idle', steer(message) {
    // Record the public durable event in this driver fixture. The official
    // profile E2E separately exercises delivery through the real Agent loop.
    const start = session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced').length
    session.append('agent/inbox/spliced', { target: 'next-step', start, inserted: [message] })
    wakes.push({ id, message })
  } })
}
const runtime = new ByClawDshSessionRuntime(ctx, { stateDir: '.agent-teams' })
let turn
let recovery = Promise.resolve()
function begin({ nested = true } = {}) {
  turn?.teamGate.dispose()
  turn = { rootSessionId: 'root', responseSessionId: 'root', workspace,
    context: { isCancelRequested: () => false },
    announcedChildren: new Set(nested ? ['captain'] : []), recoveryNotifiedAgents: new Set() }
  turn.teamGate = new ByClawAsyncTeamGate(600_000, 1_000, notice => {
    recovery = runtime.recoverStalledTurn(turn, notice)
    return recovery
  })
  runtime.active.set('root', turn)
  turn.teamGate.observe({ type: 'tool/call', data: { name: 'byclaw_instantiate_template', callId: 'template' } })
  return turn.teamGate
}
async function tick(ms = 600_000) {
  mock.timers.tick(ms)
  await new Promise(resolve => setImmediate(resolve))
  await recovery
  await new Promise(resolve => setImmediate(resolve))
}
try {
  for (const owner of ['captain', 'foreign']) {
    const dir = join(resolveTeamStateRoot(workspace, '.agent-teams'), `team-${owner}`)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'team.json'), JSON.stringify({
      id: `team-${owner}`, name: `team-${owner}`, captainSessionId: owner,
      createdAt: 1, members: [], tasks: [], taskSeq: 0,
    }))
  }
  mock.timers.enable({ apis: ['setTimeout'] })
  const gate = begin()
  await tick()
  assert.deepEqual(wakes.map(wake => wake.id), ['captain'], 'nested recovery must wake the owning captain, never an unrelated team or routing root')
  assert.deepEqual(wakes[0].message.source, { kind: 'plugin', plugin: 'byclaw-integration' })
  assert.ok(wakes[0].message.content[0].text.includes('team-captain'))
  assert.ok(JSON.stringify(sessions.get('captain').snapshotEvents()).includes('ByClaw 内部运行巡检'),
    'the recovery instruction must enter the durable DSH inbox')
  assert.equal(gate.waiting, true, 'recovery preserves the original command')
  gate.assertHealthy()
  await tick()
  assert.equal(wakes.length, 1, 'an unconsumed inspection must not be enqueued twice')

  const captain = agents.get('captain')
  agents.delete('captain')
  begin()
  await tick()
  assert.equal(wakes.length, 2, 'an unavailable team captain must not silently block recovery')
  assert.equal(wakes.at(-1).id, 'root', 'the live response agent receives the missing-captain recovery request')
  assert.ok(wakes.at(-1).message.content[0].text.includes('team-captain'))
  agents.set('captain', captain)

  const fallbackGate = begin({ nested: false })
  await tick()
  assert.equal(wakes.at(-1).id, 'root', 'an unresolved template without a discovered team wakes its owning response agent')
  fallbackGate.cancel('user stopped task')
  const count = wakes.length
  await tick(1_800_000)
  assert.equal(wakes.length, count, 'cancelled commands cannot send more recovery instructions')

  for (const change of ['cancel', 'progress', 'replace']) {
    const pendingGate = begin()
    mock.timers.tick(600_000)
    // Recovery has entered its real asynchronous filesystem snapshot read.
    // Change ownership synchronously before that read can settle.
    // A second deadline cannot start a concurrent inspection while reading state.
    mock.timers.tick(1_800_000)
    if (change === 'cancel') pendingGate.cancel('cancel during inspection')
    else if (change === 'progress') pendingGate.recordActivity()
    else runtime.active.set('root', { teamGate: new ByClawAsyncTeamGate() })
    await recovery
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(wakes.length, count, `${change} during snapshot I/O must invalidate a stale captain wake`)
    pendingGate.dispose()
  }
  console.log('team recovery ownership, durable inbox, deduplication and cancellation verification passed')
} finally {
  turn?.teamGate.dispose()
  mock.timers.reset()
  await runtime.close()
  await rm(workspace, { recursive: true, force: true })
}
