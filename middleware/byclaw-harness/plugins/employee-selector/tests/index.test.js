import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dump } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { apply, employeeComposition } from '../src/index.js'

const standardRows = [
  { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'p' } },
  { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
]

function presets() {
  const registered = new Map()
  return {
    registered,
    readDocument: async id => {
      assert.equal(id, 'standard')
      return { agentPreset: 'standard', content: dump(standardRows, { schema: entryListSchema }) }
    },
    register: async definition => {
      assert.ok(!registered.has(definition.id), `duplicate ${definition.id}`)
      registered.set(definition.id, definition)
      return async () => { registered.delete(definition.id) }
    },
  }
}

test('composes the standard preset without its persona, plus the employee binding', async () => {
  const rows = await employeeComposition(presets(), 'byclaw-employee-7', 'file:///binding.js')
  assert.deepEqual(rows.map(row => row.id), ['tool-bash', 'byclaw-employee-binding'])
  assert.deepEqual(rows[1], { id: 'byclaw-employee-binding', name: 'file:///binding.js', config: { templateId: 'byclaw-employee-7' } })
})

test('registers one preset per authorized employee and follows authorization changes', async () => {
  const agentPresets = presets()
  let employees = [{ template_id: 'byclaw-employee-1', name: 'A', description: 'one' }]
  const effects = []
  const ctx = {
    agentPresets,
    byclawEmployeeRoots: { list: () => employees },
    effect: callback => effects.push(callback()),
    logger: { info() {}, warn() {}, error(message) { throw new Error(message) } },
  }
  await apply(ctx)
  assert.deepEqual([...agentPresets.registered.keys()], ['byclaw-employee-1'])
  assert.deepEqual(agentPresets.registered.get('byclaw-employee-1'), {
    id: 'byclaw-employee-1', name: 'A', description: '数字员工 · one', order: -10,
    plugins: [standardRows[1], { id: 'byclaw-employee-binding', name: new URL('../src/binding.js', import.meta.url).href,
      config: { templateId: 'byclaw-employee-1' } }],
  })
  for (const dispose of effects) dispose()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(agentPresets.registered.size, 0, 'unloading the plugin unregisters its presets')
  employees = []
})
