import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ByClawAsyncTeamGate, ByClawDshSessionRuntime } from '../lib/session-runtime.js'
import { ByClawDshCommandHandler } from '../lib/worker.js'
import { AskAgentCommand, MessageHeader } from '@byclaw/by-framework'
const workspace = await mkdtemp(join(tmpdir(), 'byclaw-cancel-'))
try {
  for (const ids of [[], ['member-a', 'member-b', 'member-c', 'member-d']]) {
    const calls = []
    let resident = [...ids]
    const agent = { id: 'root', session: { id: 'root', header: { cwd: workspace } }, cancel() { calls.push('root') }, whenIdle() { return Promise.resolve() } }
    const ctx = { root: { on() { return () => {} } }, logger: { debug() {}, warn() {} },
      subagents: { async listChildren(id) { assert.equal(id, 'root'); return resident.map(id => ({ id })) },
        async drainContinuableChildren(owner, children) { assert.equal(owner, agent); calls.push(...children); resident = [] } } }
    const runtime = new ByClawDshSessionRuntime(ctx, { stateDir: '.agent-teams' })
    const turn = { teamGate: new ByClawAsyncTeamGate() }
    runtime.active.set('root', turn)
    runtime.messageAgents.set('message', agent)
    await runtime.cancel('message', 'user stop')
    assert.ok(calls.includes('root'))
    assert.deepEqual(calls.filter(id => id !== 'root'), ids, 'team mode drains each member; solo drains none')
    assert.throws(() => turn.teamGate.assertHealthy(), /user stop/)
    const count = calls.length
    await runtime.cancel('message', 'duplicate stop')
    assert.equal(calls.length, count, 'cancel is idempotent')
    await runtime.close()
  }
  const command = new AskAgentCommand(new MessageHeader('m', 's', 't'), 'hello')
  const handler = new ByClawDshCommandHandler({ async ask() { return { answer: '', dshSessionId: 's' } } })
  await assert.rejects(handler.process(command, { isCancelRequested: () => true }), { name: 'TaskCancelledError' })
  console.log('DSH single-agent / team cancellation and Gateway terminal status verification passed')
} finally { await rm(workspace, { recursive: true, force: true }) }
