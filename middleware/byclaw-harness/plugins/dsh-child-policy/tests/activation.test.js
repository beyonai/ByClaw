import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, startPolicyContinuable } from '../lib/index.js'

function fixture() {
  const events = [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'member' } }]
  const seen = [], cleanups = [], rootEffects = []
  const child = { id: 'child', session: { ownEvents: () => events, append: (type, data) => events.push({ type, data }) } }
  const childCtx = {
    systemPrompt: { getSectionOrder: () => 10, section: value => { seen.push(['persona', value.text]); return () => seen.push(['dispose-persona']) } },
    tools: { restrict: value => { seen.push(['tools', value]); return () => seen.push(['dispose-tools']) } },
    effect: action => { const dispose = action(); cleanups.push(dispose); return dispose },
  }
  const agents = {
    create: async options => { const prepared = await options.setup(childCtx, child); prepared?.commit(); seen.push(['published']); return child },
    resume: async options => { const prepared = await options.setup(childCtx, child); prepared?.commit(); return child },
  }
  const ctx = {
    agents,
    effect: action => { const dispose = action(); rootEffects.push(dispose); return dispose },
    subagents: {
      getProvider: () => ({ prepareContinuable() {} }),
      startActivation: async spec => { child.id = spec.childId; await agents.create({}); return { childId: child.id, result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} } },
    },
  }
  apply(ctx)
  return { ctx, child, agents, seen, events, rootEffects, cleanups }
}
const spec = () => ({ provider: 'spawn', label: 'member', signal: new AbortController().signal,
  request: { parent: {}, prompt: [], persona: 'Member only', toolFilter: { deny: ['captain-tool'] } } })

test('persona and tool policy are applied before publication and restored on resume', async () => {
  const h = fixture()
  const activation = await startPolicyContinuable(h.ctx, spec())
  assert.equal(activation.childId, h.child.id)
  assert.deepEqual(h.seen.slice(0, 3), [['persona', 'Member only'], ['tools', { deny: ['captain-tool'] }], ['published']])
  assert.equal(h.events.filter(event => event.type === 'byclaw/child-policy').length, 1)
  for (const dispose of h.cleanups.splice(0)) dispose()
  h.seen.length = 0
  await h.agents.resume({})
  assert.deepEqual(h.seen, [['persona', 'Member only'], ['tools', { deny: ['captain-tool'] }]])
  assert.equal(h.events.filter(event => event.type === 'byclaw/child-policy').length, 1)
  for (const dispose of h.rootEffects.reverse()) dispose()
})

test('a provider unable to enforce policy is rejected before activation', async () => {
  const h = fixture()
  h.ctx.subagents.getProvider = () => ({})
  await assert.rejects(startPolicyContinuable(h.ctx, spec()), /local continuable provider/)
  assert.deepEqual(h.seen, [])
  for (const dispose of h.rootEffects.reverse()) dispose()
})
