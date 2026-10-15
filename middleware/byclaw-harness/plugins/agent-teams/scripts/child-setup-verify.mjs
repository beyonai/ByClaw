import assert from 'node:assert/strict'
import { Context, symbols } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { registerContinuableChildSetup } from '../src/child-setup.ts'

const ctx = new Context()
await ctx.plugin(AgentRegistry)
const order = []
const owners = []
const childScopes = []
const createdAgents = []
const setupAgents = []
const descriptor = { type: 'subagent/descriptor', data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'test' } }
const factory = async (ownerCtx, options) => {
  owners.push(ownerCtx)
  const scope = ownerCtx.plugin(function child() {})
  await scope
  childScopes.push(scope)
  const events = []
  const agent = { session: { ownEvents() { return events } } }
  createdAgents.push(agent)
  // Resume loads its persisted descriptor before setup; fresh setup appends it.
  if (options.resumeSessionId) events.push(descriptor)
  agent.session.append = () => events.push(descriptor)
  try {
    const commit = await options.setup?.(scope.ctx, agent)
    commit?.commit()
    order.push('published')
    return { agent, dispose: () => scope.dispose() }
  } catch (error) {
    await scope.dispose()
    throw error
  }
}
ctx.agents.setFactory({ createAgent: factory, resume: factory })
const registrantA = ctx.plugin({ name: 'registrant A', inject: ['agents'], apply() {} })
const registrantB = ctx.plugin({ name: 'registrant B', inject: ['agents'], apply() {} })
const caller = ctx.plugin({ name: 'caller', inject: ['agents'], apply() {} })
await Promise.all([registrantA, registrantB, caller])
const registry = ctx.agents[symbols.original]
const initialCreate = registry.create
const disposeA = registerContinuableChildSetup(registrantA.ctx, (_childCtx, child) => {
  setupAgents.push(child)
  order.push('setup A')
  return () => order.push('dispose A')
})
const disposeB = registerContinuableChildSetup(registrantB.ctx, () => {
  order.push('setup B')
  return () => order.push('dispose B')
})
const fresh = await caller.ctx.agents.create({ sessionId: 'fresh', setup(childCtx, child) {
  assert.equal(child, createdAgents.at(-1), 'the wrapped setup must preserve the AgentSetup agent argument')
  order.push('original setup')
  child.session.append()
  return { commit() { order.push('original commit') } }
} })
assert.deepEqual(order, ['original setup', 'setup A', 'setup B', 'original commit', 'published'])
assert.equal(setupAgents[0], fresh.agent, 'continuable setup must receive the unpublished Agent explicitly')
assert.equal(owners[0].fiber, caller.ctx.fiber, 'factory must retain accessing caller ownership')
assert.notEqual(owners[0].fiber, registrantA.ctx.fiber, 'registrant must not own the child')
disposeA()
assert.equal(order.filter(x => x === 'dispose A').length, 1, 'unregister revokes resident child contributions immediately')
await fresh.dispose()
assert.equal(order.filter(x => x === 'dispose A').length, 1)
assert.equal(order.filter(x => x === 'dispose B').length, 1)
order.length = 0
disposeA()
const resumed = await caller.ctx.agents.resume({ resumeSessionId: 'cold', setup() {
  order.push('resume original')
  return { commit() { order.push('resume commit') } }
} })
assert.deepEqual(order, ['resume original', 'setup B', 'resume commit', 'published'])
assert.equal(owners.at(-1).fiber, caller.ctx.fiber)
await resumed.dispose()
disposeB()
assert.equal(registry.create, initialCreate, 'last registration restores the original factory surface')

order.length = 0
const disposeBeforeFailure = registerContinuableChildSetup(registrantB.ctx, () => () => order.push('rollback preceding setup'))
const disposeFailing = registerContinuableChildSetup(registrantA.ctx, () => { throw new Error('missing skill') })
await assert.rejects(caller.ctx.agents.resume({ resumeSessionId: 'failure' }), /missing skill/)
assert.equal(order.includes('published'), false, 'setup failure must not publish a child')
disposeFailing()
assert.equal(order.filter(x => x === 'rollback preceding setup').length, 1)
disposeBeforeFailure()

order.length = 0
const disposeCommitSetup = registerContinuableChildSetup(registrantA.ctx, () => () => order.push('rollback commit setup'))
await assert.rejects(caller.ctx.agents.resume({ resumeSessionId: 'commit-failure', setup() {
  return { commit() { throw new Error('commit rejected') } }
} }), /commit rejected/)
assert.deepEqual(order, ['rollback commit setup'])
disposeCommitSetup()

order.length = 0
const disposeOrdinarySetup = registerContinuableChildSetup(registrantA.ctx, () => {
  order.push('unexpected continuation setup')
  return () => {}
})
const ordinary = await caller.ctx.agents.create({ sessionId: 'ordinary', setup() {
  return { commit() { order.push('ordinary commit') } }
} })
assert.deepEqual(order, ['ordinary commit', 'published'], 'ordinary agent setup must remain untouched')
await ordinary.dispose()
disposeOrdinarySetup()
order.length = 0

let releaseSetup
const enteredSetup = new Promise(resolve => { releaseSetup = resolve })
let finishSetup
const pausedSetup = new Promise(resolve => { finishSetup = resolve })
const disposeInFlight = registerContinuableChildSetup(registrantA.ctx, async () => {
  releaseSetup()
  await pausedSetup
  return () => order.push('dispose abandoned')
})
const inFlight = caller.ctx.agents.resume({ resumeSessionId: 'abandoned' })
await enteredSetup
disposeInFlight()
finishSetup()
await assert.rejects(inFlight, /unloaded before publication/)
assert.equal(order.filter(x => x === 'dispose abandoned').length, 1)
assert.equal(order.includes('published'), false)
let finishOriginal
const originalPause = new Promise(resolve => { finishOriginal = resolve })
let enteredOriginal
const originalStarted = new Promise(resolve => { enteredOriginal = resolve })
const disposeBeforeOriginal = registerContinuableChildSetup(registrantA.ctx, () => () => {})
const originalInFlight = caller.ctx.agents.resume({ resumeSessionId: 'original-abandoned', async setup() {
  enteredOriginal()
  await originalPause
} })
await originalStarted
disposeBeforeOriginal()
finishOriginal()
await assert.rejects(originalInFlight, /unloaded before publication/)
await ctx.fiber.dispose()
console.log('PASS child setup: real Cordis caller ownership, create/resume ordering, commit, disposal, HMR, rollback and unload race')
