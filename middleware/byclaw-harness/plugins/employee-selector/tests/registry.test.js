import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

test('employee presets inherit standard tools, bind their own identity, and unregister on disposal', async () => {
  const definitions = [], effects = [], removed = []
  const ctx = {
    byclawEmployeeRoots: { list: () => [{ template_id: 'employee-1', name: 'Researcher', description: 'Research' }] },
    agentPresets: {
      readDocument: async () => ({ content: '- id: persona\n  name: persona\n- id: tool-bash\n  name: tool-bash\n' }),
      register: async definition => { definitions.push(definition); return async () => { removed.push(definition.id) } },
    },
    effect: action => { effects.push(action()); },
    logger: { info() {}, error(error) { throw new Error(error) } },
  }
  await apply(ctx)
  assert.deepEqual(definitions[0].plugins.map(row => row.id), ['tool-bash', 'byclaw-employee-binding'])
  assert.equal(definitions[0].plugins[1].config.templateId, 'employee-1')
  for (const dispose of effects.reverse()) await dispose()
  assert.deepEqual(removed, ['employee-1'])
})
