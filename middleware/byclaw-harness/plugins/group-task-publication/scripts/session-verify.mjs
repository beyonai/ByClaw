/** Optional-plugin eligibility, durable state, awaited session hooks, and teardown. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as PublicationPlugin from '../lib/index.js'
import { GroupTaskPublicationState, publicationSessionSchema, resolveGroupTaskPublicationBinding } from '../lib/index.js'
import { ByClawDshSessionRuntime } from '../../byclaw-integration/lib/session-runtime.js'
import { ByClawSessionMetadataStore } from '@byclaw/dsh-integration'

const binding = { taskId: '900719925474099312345', userCode: 'test-user' }
const command = (extraPayload = {}, header = {}) => ({ header: { sessionId: binding.taskId, userCode: binding.userCode, ...header }, extraPayload })
const hacu = { groupChat: { conversationKey: 'source-group', childSessionId: 'not-the-task-id' } }
for (const groupChat of [undefined, null, {}, { conversationKey: 'group' }, { childSessionId: 'child' }, { conversationKey: ' ', childSessionId: 'child' }]) {
  assert.equal(resolveGroupTaskPublicationBinding(undefined, command({ groupChat })), undefined)
}
assert.deepEqual(resolveGroupTaskPublicationBinding(undefined, command(hacu)), binding)
assert.deepEqual(resolveGroupTaskPublicationBinding(binding, command()), binding)
assert.throws(() => resolveGroupTaskPublicationBinding(binding, command(hacu, { sessionId: 'different' })), /不一致/u)
assert.throws(() => resolveGroupTaskPublicationBinding(binding, command({}, { userCode: 'other-user' })), /不一致/u)
function memoryTable(schema) {
  const records = new Map()
  return {
    records,
    entries: () => records.entries(),
    get: key => records.get(key),
    put: async (key, value) => { records.set(key, structuredClone(schema ? schema.parse(value) : value)) },
    delete: async key => records.delete(key),
  }
}
const table = memoryTable(publicationSessionSchema)
const state = new GroupTaskPublicationState(table)
assert.equal(await state.select(command()), undefined)
await Promise.all([state.select(command(hacu)), state.select(command(hacu))])
assert.deepEqual(await new GroupTaskPublicationState(table).select(command()), binding)
assert.equal(await state.select(command({}, { sessionId: 'changed' })), undefined)
assert.equal(await state.select(command({}, { userCode: 'other-user' })), undefined)

const integrationManifest = JSON.parse(readFileSync(new URL('../../byclaw-integration/package.json', import.meta.url), 'utf8'))
assert.equal(integrationManifest.dependencies['@byclaw/dsh-group-task-publication'], undefined)
const integrationSource = readFileSync(new URL('../../byclaw-integration/src/index.ts', import.meta.url), 'utf8')
assert.ok(integrationSource.includes("ctx.serial('byclaw/session-setup'"))
assert.doesNotMatch(integrationSource, /groupTaskPublication|dsh-group-task-publication/)

// Lifecycle checks start with empty durable storage, independent of the state-selection cases.
table.records.clear()
const ctx = new Context()
const fibers = []
const scopes = []
let closes = 0
class Storage extends Service {
  constructor(ctx) { super(ctx, 'storageDomain') }
  async open(spec) {
    assert.equal(spec.name, 'byclaw_group_publications')
    return { table: () => table, close: async () => { closes++ } }
  }
}
class Projections extends Service {
  constructor(ctx) { super(ctx, 'sessionProjections') }
  register() { return () => {} }
}
const host = { baseUrl: 'https://be.test', userCode: binding.userCode, byRoot: '/by',
  resolveSourcePath: path => path,
  resolveAuthHeaders: async () => { throw new Error('setup must not request credentials or contact BE') },
}
const live = new Map()
const persisted = new Map()
const snapshots = []
const metadataTable = memoryTable()
const runtimeOptions = {
  workspace: '/by/projects', byRoot: '/by', agentPreset: 'standard',
  sessionMetadata: new ByClawSessionMetadataStore(metadataTable), workspaceRegistry: {}, rosterPrompt: '',
  sessionSetup: (agentCtx, command, agent) => ctx.serial('byclaw/session-setup', { agentCtx, agent, command, host }),
}
const runtimeCtx = {
  root: { on: () => () => {} }, agentPresets: { mount: async () => {} },
  sessionPersistence: { async open(id, mode) {
    assert.equal(mode, 'read')
    const saved = persisted.get(id)
    if (saved) return { header: saved.header, inheritedEventCount: 0, read: async () => ({ events: [] }), close: async () => {} }
    const error = new Error('missing'); error.name = 'SessionPersistenceNotFoundError'; throw error
  } },
  agents: { get: id => live.get(id), create: options => factory(options, false), resume: options => factory(options, true) },
}
async function factory(options, resumed) {
  const id = options.sessionId ?? options.resumeSessionId
  const session = resumed ? persisted.get(id) : { id, header: { ...options.meta, createdAt: 10 }, events: [] }
  const agent = { id, session }
  let scope
  fibers.push(await ctx.plugin(Object.assign(inner => {
    scope = createScope(inner, agent)
    // Session setup receives the Agent explicitly; this context has no Agent accessor.
    agent.ctx = scope.ctx
    Object.defineProperty(agent.ctx, 'agent', { get() { throw new Error('Context.agent must not be used') } })
  }, { inject: ['tools', 'systemPrompt', 'sessionProjections'] })))
  scopes.push(scope)
  try { await options.setup(agent.ctx, agent) } catch (error) { await scope.dispose(); throw error }
  snapshots.push({ resumed, agent, get registered() { return new Set(ctx.tools.schemas(agent).map(tool => tool.name)) } })
  live.set(id, agent); persisted.set(id, session)
  return { agent, dispose: async () => { live.delete(id); await scope.dispose() } }
}
let runtime
try {
  fibers.push(await ctx.plugin(SystemPrompt))
  fibers.push(await ctx.plugin(ToolRuntime))
  fibers.push(await ctx.plugin(Projections))
  fibers.push(await ctx.plugin(Storage))
  const selection = { provider: 'test', model: 'test' }
  runtime = new ByClawDshSessionRuntime(runtimeCtx, runtimeOptions)
  const absentHeader = { sessionId: 'extension-absent' }
  await runtime.handleFor(command(hacu, absentHeader), selection)
  assert.equal(snapshots.at(-1).registered.has('prepare_group_task_publication'), false, 'Integration works without the optional plugin')
  let plugin = await ctx.plugin(PublicationPlugin)
  fibers.push(plugin)
  assert.equal(ctx.tools.schemas().length, 0)

  // Hold the durable write to prove that the generic awaited hook fences factory publication.
  const put = table.put
  let releaseWrite
  const writeGate = new Promise(resolve => { releaseWrite = resolve })
  table.put = async (...args) => { await writeGate; await put(...args) }
  const opening = runtime.handleFor(command(hacu), selection)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(live.has(binding.taskId), false)
  releaseWrite()
  const created = await opening
  table.put = put
  assert.equal(snapshots.at(-1).registered.has('prepare_group_task_publication'), true)
  assert.ok([...table.records.values()].some(record => record.binding.taskId === binding.taskId))
  assert.equal(metadataTable.get(binding.taskId).groupTaskPublication, undefined, 'publication never changes Integration metadata')
  const reused = await runtime.handleFor(command(), selection)
  assert.equal(reused.handle.agent, created.handle.agent)

  await plugin.dispose()
  assert.equal(ctx.tools.schemas(created.handle.agent).some(tool => tool.name === 'prepare_group_task_publication'), false)
  assert.equal(closes, 1)
  plugin = await ctx.plugin(PublicationPlugin, { timeoutMs: 10000 }); fibers.push(plugin)
  await runtime.handleFor(command(), selection)
  assert.equal(ctx.tools.schemas(created.handle.agent).filter(tool => tool.name === 'prepare_group_task_publication').length, 1)
  await runtime.close()
  runtime = new ByClawDshSessionRuntime(runtimeCtx, { ...runtimeOptions, sessionMetadata: new ByClawSessionMetadataStore(metadataTable) })
  const resumed = await runtime.handleFor(command(), selection)
  assert.equal(resumed.mode, 'resume')
  assert.equal(snapshots.at(-1).registered.has('prepare_group_task_publication'), true)
  const lateHeader = { sessionId: 'late-session' }
  const normal = await runtime.handleFor(command({}, lateHeader), selection)
  assert.equal(snapshots.at(-1).registered.has('prepare_group_task_publication'), false)
  const late = await runtime.handleFor(command(hacu, lateHeader), selection)
  assert.equal(late.handle.agent, normal.handle.agent)
  assert.equal(snapshots.at(-1).registered.has('prepare_group_task_publication'), true)
  await runtime.handleFor(command({}, lateHeader), selection)
  assert.ok([...table.records.values()].some(record => record.binding.taskId === 'late-session'))
  await assert.rejects(runtime.handleFor(command({}, { userCode: 'other-user' }), selection), /身份不一致/u)
  console.log('optional publication plugin state, awaited setup, resume, and unload verification passed')
} finally {
  await runtime?.close()
  for (const scope of scopes.reverse()) await scope.dispose()
  for (const fiber of fibers.reverse()) await fiber.dispose()
}
