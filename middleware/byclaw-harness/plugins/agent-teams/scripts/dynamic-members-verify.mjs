import { resolveTeamStateRoot } from '../lib/runtime-state.js'
/** Exercise roster selection through the real tools and durable team state. */
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { readTeam } from '../lib/state.js'
import { deleteTeamTemplate, writeTeamTemplate } from '../lib/catalog.js'

const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-dynamic-'))
const catalogDir = join(workspace, 'catalog')
const stateRoot = resolveTeamStateRoot(workspace, '.agent-teams')
const definitions = new Map()
const live = new Map()
const starts = []
const pendingSelections = []
let leaseDepth = 0
let rejectCatalog = false
let failSpawn = false
const ctx = {
  effect(setup) { return setup() },
  on() { return () => {} },
  get(name) {
    if (name !== 'byclawGenerationLease') return undefined
    return { async read(_dir, operation) {
      if (rejectCatalog) throw new Error('catalog admission closed')
      leaseDepth++
      try { return await operation() } finally { leaseDepth-- }
    } }
  },
  tools: { register(tool) { definitions.set(tool.name, tool) } },
  agents: { get(id) { return live.get(id) } },
  llm: { async resolveCallConfig(config) {
    if (config.provider === 'expert' && config.reasoningEffort !== undefined) {
      throw new Error('expert model does not support the captain effort')
    }
    return {
      ...config,
      ...config.provider === 'expert' && config.reasoningEffort === undefined
        ? { reasoningEffort: 'expert-default' }
        : {},
    }
  } },
  subagents: {
    async sendMessage(parent, childId, content, options) { return this[deliverSubagentPrompt](parent, childId, content, { kind: 'subagent', sessionId: parent.id }, options.signal, 'steer') },
    getProvider() { return { prepareContinuable() {}, inheritsParentContext: false, capabilities: { persona: true, toolFilter: true } } },
    list() { return ['spawn'] },
    async startContinuable(request) {
      if (failSpawn) throw new Error('spawn failed')
      starts.push({ ...request, leaseDepth })
      return { childId: `child-${starts.length}`, messageId: `welcome-${starts.length}` }
    },
    async listChildren() { return [] },
    async listDescendants() { return [] },
    async [deliverSubagentPrompt]() { throw new Error('draft teams must not dispatch work') },
    interrupt() {},
  },
  logger: { debug() {}, warn() {} },
}
registerAgentTeamsTools(ctx, {
  memberSelectionRuntime: {
    withPending: async (_parent, _label, selection, _member, operation) => {
      pendingSelections.push(selection)
      return operation()
    },
    withNextRequest: async (_parent, _label, _child, _selection, _member, operation) => operation(),
    restoreBaseline() {},
  },
  modelOverrides: { get() {
    return { provider: 'captain', model: 'captain-model', reasoningEffort: 'minimal' }
  } },
  stateDir: '.agent-teams', memberProvider: 'spawn', controlledWorkflow: true,
  maxTaskAttempts: 2, catalogDir,
})
function captain(id) {
  const agent = {
    id, status: 'idle', options: { provider: 'captain', model: 'captain-model' },
    session: {
      header: { cwd: workspace }, snapshotEvents() { return [] }, ownEvents() { return [] }, append() {},
      requestHeader() { return { config: { provider: 'captain', model: 'captain-model', reasoningEffort: 'minimal' } } },
    },
  }
  live.set(id, agent)
  return agent
}
const call = (agent, name, args) => definitions.get(`agent_teams_${name}`).execute(args, {
  agent, signal: new AbortController().signal,
})
const source = {
  kind: 'byclaw-digital-employee', employeeId: 'employee-1', employeeCode: 'engineer',
  workerAgentType: 'BYCLAW_DSH', modelId: 'model-1', persona: 'Build carefully.',
  skills: [{ code: 'engineering', path: '/trusted/engineering' }],
}
try {
  await writeTeamTemplate(catalogDir, {
    id: 'delivery', name: 'Delivery', members: [
      { name: 'engineer', role: 'implementation', provider: 'expert', model: 'expert-model', source },
      { name: 'reviewer', role: 'review' },
    ],
  })
  const lazy = captain('lazy')
  const catalog = await call(lazy, 'list_templates', {})
  const catalogText = definitions.get('agent_teams_list_templates').output.render({}, catalog).map(block => block.text).join('\n')
  assert.match(catalogText, /engineer.*implementation.*expert\/expert-model/)
  assert.match(catalogText, /reviewer.*review/)
  const empty = await call(lazy, 'create', { name: 'Lazy', template_id: 'delivery', template_members: [] })
  assert.equal(starts.length, 0, 'empty selection must not start template members')
  assert.equal(empty.member_count, 0)
  assert.equal((await readTeam(stateRoot, empty.team_id)).lifecycle, 'draft')

  const added = await call(lazy, 'add_member', { name: 'engineer', template_member: 'engineer' })
  assert.equal(added.provider, 'expert')
  assert.equal(added.model, 'expert-model')
  assert.equal(added.reasoning_effort, 'expert-default')
  assert.deepEqual(starts[0].request.agentOptions, {
    provider: 'expert', model: 'expert-model', reasoningEffort: 'expert-default',
  }, 'the durable template baseline uses the target model default')
  assert.deepEqual(pendingSelections[0], {
    provider: 'captain', model: 'captain-model', reasoningEffort: 'minimal',
  }, 'the fresh member request still receives the current conversation model override')
  const member = (await readTeam(stateRoot, empty.team_id)).members[0]
  assert.equal(member.role, 'implementation')
  assert.deepEqual(member.source, source, 'dynamic template members retain enterprise persona and Skills')
  assert.equal(starts[0].leaseDepth, 1, 'catalog generation must remain admitted through spawn')
  await assert.rejects(call(lazy, 'add_member', { name: 'engineer', template_member: 'engineer' }), /already been used/)
  await assert.rejects(call(lazy, 'add_member', { name: 'ghost', template_member: 'missing' }), /not found/)
  await assert.rejects(call(lazy, 'add_member', { name: 'ghost', template_member: ' ' }), /empty/)
  await assert.rejects(call(lazy, 'add_member', { name: 'captain', template_member: 'reviewer' }), /reserved/)
  await assert.rejects(call(lazy, 'add_member', { name: 'invalid-route', template_member: 'engineer', provider: 'alternate' }), /requires an explicit member model/)
  assert.equal(starts.length, 1)

  const reuse = await call(lazy, 'create', { name: 'Lazy again', template_id: 'delivery' })
  assert.equal(reuse.reused, true)
  assert.equal(reuse.team_id, empty.team_id)
  assert.equal(reuse.member_count, 1)
  assert.equal(starts.length, 1, 'reuse must not silently expand a partial roster')
  const renamed = await call(lazy, 'add_member', {
    name: 'qa', template_member: 'reviewer', role: 'focused review', provider: 'alternate', model: 'alternate-model',
  })
  assert.equal(renamed.provider, 'alternate')
  assert.equal((await readTeam(stateRoot, empty.team_id)).members[1].role, 'focused review')
  const custom = await call(lazy, 'add_member', { name: 'custom', role: 'research' })
  assert.equal(custom.provider, 'captain')
  assert.equal((await readTeam(stateRoot, empty.team_id)).members[2].source, undefined)

  const selected = captain('selected')
  const subset = await call(selected, 'create', {
    name: 'Subset', template_id: 'delivery', template_members: [' engineer '],
  })
  assert.equal(subset.member_count, 1, 'create returns the persisted count after spawning')
  const subsetTeam = await readTeam(stateRoot, subset.team_id)
  assert.deepEqual(subsetTeam.members.map(member => member.name), ['engineer'])
  assert.deepEqual(subsetTeam.members[0].source, source)

  const legacy = await call(captain('legacy'), 'create', { name: 'Legacy', template_id: 'delivery' })
  assert.equal(legacy.member_count, 2, 'omitting selection preserves full roster creation')
  assert.deepEqual((await readTeam(stateRoot, legacy.team_id)).members.map(member => member.name), ['engineer', 'reviewer'])
  const plain = captain('plain')
  await call(plain, 'create', { name: 'Plain' })
  await assert.rejects(call(plain, 'add_member', { name: 'engineer', template_member: 'engineer' }), /template/)
  await call(plain, 'add_member', { name: 'engineer' })

  for (const [name, args, error] of [
    ['unknown', { template_id: 'delivery', template_members: ['engineer', 'missing'] }, /not found/],
    ['duplicate', { template_id: 'delivery', template_members: ['engineer', ' engineer '] }, /duplicate/],
    ['blank', { template_id: 'delivery', template_members: [' '] }, /empty/],
    ['no-template', { template_members: [] }, /template_id/],
  ]) {
    const before = starts.length
    await assert.rejects(call(captain(name), 'create', { name, ...args }), error)
    assert.equal(await readTeam(stateRoot, name), undefined, 'bad selection must not leave a team behind')
    assert.equal(starts.length, before)
  }
  const beforeFailures = starts.length
  rejectCatalog = true
  await assert.rejects(call(lazy, 'add_member', { name: 'blocked', template_member: 'reviewer' }), /admission closed/)
  rejectCatalog = false
  failSpawn = true
  await assert.rejects(call(lazy, 'add_member', { name: 'failed', template_member: 'reviewer' }), /spawn failed/)
  failSpawn = false
  await deleteTeamTemplate(catalogDir, 'delivery')
  await assert.rejects(call(lazy, 'add_member', { name: 'revoked', template_member: 'reviewer' }), /not found/)
  assert.equal(starts.length, beforeFailures)
  assert.deepEqual((await readTeam(stateRoot, empty.team_id)).members.map(member => member.name), ['engineer', 'qa', 'custom'])
  console.log('PASS dynamic roster: empty/subset/full creation, incremental members, template routes/Skills, reuse and failure admission')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
