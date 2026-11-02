import assert from 'node:assert/strict'
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { deliverToMember } from '../src/members.ts'

const calls = []
const captain = { id: 'captain' }
const signal = new AbortController().signal
const runtime = {
  async [deliverSubagentPrompt](...args) { calls.push(args); return 'accepted' },
  async sendMessage() { throw new Error('model steering must not dispatch FIFO team work') },
}
const outcome = await deliverToMember({ subagents: runtime, logger: { warn() {} } }, captain, 'child', 'first task', signal)
assert.deepEqual(outcome, { ok: true }, 'current runtime must accept host FIFO dispatch')
assert.deepEqual(calls, [[captain, 'child', [{ type: 'text', text: 'first task' }], { kind: 'plugin:dsh-agent-teams' }, signal, 'queue']])
console.log('PASS current runtime queues team dispatch with host attribution')

const { mkdtemp, rm } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const { Context, symbols } = await import('@deepseek-ai/cordis')
const { default: SubagentRuntime, SUBAGENT_DESCRIPTOR_VERSION } = await import('@deepseek-ai/dsh-subagent')
const { AgentRegistry } = await import('@deepseek-ai/dsh-agent')
const { installAgentTeamsReportDeliveryGuard, installRetiredMemberGuard } = await import('../src/members.ts')
const { createTeamDir, recordRetiredMemberIds } = await import('../src/state.ts')
const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-current-runtime-'))
const root = new Context()
try {
  // DSH 0.2.1: the subagent service requires the working-directory collaborator.
  root.provide('workingDirectory', { get: () => workspace })
  await root.plugin(SubagentRuntime)
  const hostRuntime = root.subagents[symbols.original]
  const original = {
    async sendMessage(...args) { calls.push(args); return 'model-accepted' },
    async listChildren() { return [{ id: 'member', kind: 'child' }, { id: 'retired', kind: 'child' }, { id: 'unrelated', kind: 'child' }] },
    async listDescendants() { return this.listChildren() },
    async [deliverSubagentPrompt](...args) { calls.push(args); return 'host-accepted' },
  }
  Object.assign(hostRuntime, original)
  const captainAgent = { id: 'captain', session: { header: { cwd: workspace } } }
  const member = { id: 'member', session: { header: { cwd: workspace, parentSession: 'captain' }, ownEvents() { return [] } } }
  const retired = { id: 'retired', session: { header: { cwd: workspace, parentSession: 'captain' }, ownEvents() { return [] } } }
  const foreign = { id: 'unrelated', session: { header: { cwd: workspace, parentSession: 'captain' }, ownEvents() { return [] } } }
  const fresh = { id: 'not-yet-persisted', session: { header: { cwd: workspace, parentSession: 'captain' }, ownEvents() { return [{ type: 'subagent/descriptor', data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:new-member' } }] } } }
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Team', captainSessionId: 'captain', createdAt: Date.now(),
    members: [{ id: 'member', name: 'Member', status: 'idle', joinedAt: Date.now() }], tasks: [], taskSeq: 0,
  })
  await recordRetiredMemberIds(stateRoot, ['retired'])
  // Read-only live-parent lookup is all these guards need from AgentRegistry.
  await root.plugin(AgentRegistry)
  const agentRegistry = root.agents[symbols.original]
  agentRegistry.get = id => id === 'captain' ? captainAgent : undefined
  const guardScope = root.plugin({ inject: ['subagents', 'agents'], apply(ctx) {
    installAgentTeamsReportDeliveryGuard(ctx, '.agent-teams')
    installRetiredMemberGuard(ctx, '.agent-teams')
  } })
  await guardScope
  await assert.rejects(root.subagents.sendMessage(fresh, 'captain', [], { signal }), /agent_teams_send_message/)
  await assert.rejects(root.subagents.sendMessage(member, 'captain', [], { signal }), /agent_teams_send_message/)
  await assert.rejects(root.subagents.sendMessage(retired, 'captain', [], { signal }), /agent_teams_send_message/)
  assert.equal(await root.subagents.sendMessage(foreign, 'captain', [], { signal }), 'model-accepted')
  await assert.rejects(root.subagents.sendMessage(captainAgent, 'retired', [], { signal }), /retired and cannot be resumed/)
  const retiredDispatch = await deliverToMember({ subagents: root.subagents, logger: { warn() {} } }, captainAgent, 'retired', 'must not resume', signal)
  assert.equal(retiredDispatch.ok, false)
  assert.equal(retiredDispatch.failure.code, 'NOT_RESUMABLE')
  assert.equal((await deliverToMember({ subagents: root.subagents, logger: { warn() {} } }, captainAgent, 'member', 'accepted', signal)).ok, true)
  assert.deepEqual((await root.subagents.listChildren('captain')).map(entry => entry.id), ['member', 'unrelated'])
  assert.deepEqual((await root.subagents.listDescendants('captain')).map(entry => entry.id), ['member', 'unrelated'])
  await guardScope.dispose()
  assert.equal(hostRuntime.sendMessage, original.sendMessage, 'Cordis disposal must restore original public delivery')
  assert.equal(hostRuntime[deliverSubagentPrompt], original[deliverSubagentPrompt], 'Cordis disposal must restore host delivery')
  assert.equal(hostRuntime.listChildren, original.listChildren)
  console.log('PASS current runtime rejects generic member reports, preserves unrelated messages, guards model+host retirement and restores Cordis methods on disposal')
} finally {
  await root.fiber.dispose()
  await rm(workspace, { recursive: true, force: true })
}
