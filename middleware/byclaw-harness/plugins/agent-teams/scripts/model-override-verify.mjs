import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { createAgentTeamsModelOverrideService, taskExecutionModel } from '../src/model-overrides.ts'
import { installMemberSelectionRuntime, memberLabel, resolveMemberLlmSelection } from '../src/members.ts'
import { createTeamDir, readTeam } from '../src/state.ts'

const baseline = { provider: 'employee-provider', model: 'employee-model', reasoningEffort: 'high' }
const override = { provider: 'conversation-provider', model: 'conversation-model' }
const nextOverride = { provider: 'next-provider', model: 'next-model', reasoningEffort: 'low' }

const resolutionCalls = []
const resolvingCtx = { llm: { async resolveCallConfig(config) {
  resolutionCalls.push(config)
  if (config.provider === 'template-provider' && config.reasoningEffort !== undefined) {
    throw new Error('template model does not support the captain effort')
  }
  return {
    ...config,
    ...config.provider === 'template-provider' && config.reasoningEffort === undefined
      ? { reasoningEffort: 'template-default' }
      : {},
  }
} } }
const resolvingCaptain = {
  options: { provider: 'fallback-provider', model: 'fallback-model' },
  session: { requestHeader() { return { config: {
    provider: 'captain-provider', model: 'captain-model', reasoningEffort: 'minimal',
  } } } },
}
assert.deepEqual(
  await resolveMemberLlmSelection(resolvingCtx, resolvingCaptain, {}),
  { provider: 'captain-provider', model: 'captain-model', reasoningEffort: 'minimal' },
  'an ordinary member on the exact captain route inherits its effort',
)
assert.deepEqual(
  await resolveMemberLlmSelection(resolvingCtx, resolvingCaptain, {
    provider: 'template-provider', model: 'template-model',
  }),
  { provider: 'template-provider', model: 'template-model', reasoningEffort: 'template-default' },
  'a cross-route template baseline uses the target model default instead of the captain effort',
)
assert.deepEqual(
  await resolveMemberLlmSelection(resolvingCtx, resolvingCaptain, { defaultModel: 'member-default' }),
  { provider: 'captain-provider', model: 'member-default' },
  'a plugin-level model override also clears an effort belonging to the captain model',
)
assert.deepEqual(resolutionCalls, [
  { provider: 'captain-provider', model: 'captain-model', reasoningEffort: 'minimal' },
  { provider: 'template-provider', model: 'template-model' },
  { provider: 'captain-provider', model: 'member-default' },
])

const service = createAgentTeamsModelOverrideService()
service.set('captain', override)
assert.deepEqual(service.get('captain'), override)
assert.notEqual(service.get('captain'), service.get('captain'), 'service reads must be defensive copies')
assert.deepEqual(taskExecutionModel(override), {
  source: 'conversation-override', provider: 'conversation-provider', model: 'conversation-model',
}, 'a model switch without Thinking must not inherit the prior route effort')
service.set('captain', undefined)
assert.equal(service.get('captain'), undefined)

const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-model-override-'))
const root = new Context()
try {
  root.provide('systemPrompt', {
    section() { return () => undefined },
    variable() { return () => undefined },
  })
  await root.plugin(AgentRegistry)
  const childScopes = new Map()
  const descriptors = new Map()
  const factory = async (ownerCtx, options) => {
    const id = String(options.sessionId ?? options.resumeSessionId)
    const scope = ownerCtx.plugin({ inject: ['systemPrompt'], apply() {} })
    await scope
    childScopes.set(id, scope.ctx)
    const descriptor = descriptors.get(id)
    const agent = {
      id,
      status: 'idle',
      session: {
        header: { cwd: workspace, parentSession: 'captain' },
        ownEvents() { return descriptor === undefined ? [] : [descriptor] },
      },
    }
    const commit = await options.setup?.(scope.ctx, agent)
    commit?.commit()
    return { agent, dispose: () => scope.dispose() }
  }
  root.agents.setFactory({ createAgent: factory, resume: factory })
  const plugin = root.plugin({ name: 'selection verifier', inject: ['agents', 'systemPrompt'], apply(ctx) {
    ctx.provide('subagents', {})
  } })
  await plugin
  const runtime = installMemberSelectionRuntime(plugin.ctx, '.agent-teams')
  const member = {
    id: 'member-session', name: 'Writer', provider: baseline.provider, model: baseline.model,
    reasoningEffort: baseline.reasoningEffort, joinedAt: Date.now(), status: 'idle',
  }
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'Team', captainSessionId: 'captain', createdAt: Date.now(),
    members: [member], tasks: [], taskSeq: 0,
  })
  const descriptor = {
    type: 'subagent/descriptor',
    data: {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable', provider: 'spawn', label: memberLabel('team', member.name),
      agentProvider: baseline.provider, agentModel: baseline.model,
      agentReasoningEffort: baseline.reasoningEffort,
    },
  }
  descriptors.set(member.id, descriptor)

  const fresh = await runtime.withPending('captain', descriptor.data.label, override, member, () => (
    plugin.ctx.agents.create({ sessionId: member.id })
  ))
  const childCtx = childScopes.get(member.id)
  const callConfig = async () => {
    await childCtx.waterfall('system-prompt/assemble', {}, {}, () => ({ variables: {} }))
    return childCtx.waterfall('agent/request', {}, () => ({ provider: 'fallback', model: 'fallback', reasoningEffort: 'max' }))
  }
  assert.deepEqual(await callConfig(), override, 'fresh welcome request must use conversation override')

  // Hold prompt assembly open, switch current, then finish: the in-flight
  // request must retain its assembled snapshot and only the next step changes.
  let finishAssembly
  const assembling = childCtx.waterfall('system-prompt/assemble', {}, {}, () => new Promise(resolve => { finishAssembly = resolve }))
  await Promise.resolve()
  await runtime.withNextRequest('captain', descriptor.data.label, member.id, nextOverride, member, async () => undefined)
  finishAssembly({ variables: {} })
  await assembling
  assert.deepEqual(
    await childCtx.waterfall('agent/request', {}, () => ({ provider: 'fallback', model: 'fallback' })),
    override,
    'changing current must not overwrite the already assembled request snapshot',
  )
  assert.deepEqual(await callConfig(), nextOverride, 'live member next step must use the new effective selection')
  runtime.restoreBaseline(member.id, baseline)
  assert.deepEqual(await callConfig(), baseline, 'idle boundary must restore the member durable baseline')

  await fresh.dispose()
  childScopes.delete(member.id)
  let resumed
  await runtime.withNextRequest('captain', descriptor.data.label, member.id, override, member, async () => {
    resumed = await plugin.ctx.agents.resume({ resumeSessionId: member.id })
  })
  const resumedCtx = childScopes.get(member.id)
  const resumedConfig = async () => {
    await resumedCtx.waterfall('system-prompt/assemble', {}, {}, () => ({ variables: {} }))
    return resumedCtx.waterfall('agent/request', {}, () => ({ provider: 'fallback', model: 'fallback' }))
  }
  assert.deepEqual(await resumedConfig(), override, 'cold-resumed next request must consume the task override')
  runtime.restoreBaseline(member.id)
  assert.deepEqual(await resumedConfig(), baseline, 'cold-resumed member must recover descriptor baseline')
  await resumed.dispose()

  const legacy = await readTeam(join(workspace, '.agent-teams'), 'team')
  assert.ok(legacy, 'legacy team tasks without executionModel remain readable')
  const corruptDir = join(workspace, '.agent-teams', 'corrupt')
  await mkdir(join(corruptDir, 'inbox'), { recursive: true })
  await writeFile(join(corruptDir, 'team.json'), JSON.stringify({
    id: 'corrupt', name: 'Corrupt', captainSessionId: 'captain', createdAt: Date.now(),
    members: [], taskSeq: 1,
    tasks: [{
      id: 't1', subject: 'bad route', status: 'pending', dependencies: [], attempt: 0,
      executionModel: { source: 'conversation-override', provider: '', model: 'x' },
      createdAt: Date.now(), updatedAt: Date.now(),
    }],
  }))
  await assert.rejects(
    readTeam(join(workspace, '.agent-teams'), 'corrupt'),
    /invalid AgentTeams state/,
    'malformed persisted executionModel must be rejected at the durable boundary',
  )
  console.log('PASS conversation override: fresh/live/cold selection, atomic assembly, effort clearing and baseline restore')
} finally {
  await root.fiber.dispose()
  await rm(workspace, { recursive: true, force: true })
}
