import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as selector from '../src/index.js'

test('employee presets retain standard capabilities, bind their own identity, and unregister on disposal', async t => {
  const definitions = [], removed = [], mounted = []
  const root = new Context()
  t.after(() => root.fiber.dispose())
  await root.plugin({ apply(ctx) {
    ctx.provide('byclawEmployeeRoots', {
      list: () => [{ template_id: 'byclaw-employee-1', name: 'Researcher', description: 'Research' }],
    })
    ctx.provide('agentPresets', {
      readDocument: async () => ({ content: '- id: persona\n  name: persona\n- id: tool-bash\n  name: tool-bash\n' }),
      register: async definition => { definitions.push(definition); return async () => { removed.push(definition.id) } },
      mount: async (_ctx, id) => { mounted.push(id) },
    })
  } })
  const active = root.plugin(selector)
  await active
  const capabilities = definitions.find(definition => definition.id.startsWith('byclaw-employee-capabilities-'))
  const employee = definitions.find(definition => definition.id === 'byclaw-employee-1')
  assert.deepEqual(capabilities.plugins.map(row => row.id), ['tool-bash'])
  assert.deepEqual(mounted, [capabilities.id])
  assert.deepEqual(employee.plugins.map(row => row.id), ['byclaw-employee-binding'])
  assert.equal(employee.plugins[0].config.templateId, 'byclaw-employee-1')
  assert.equal(employee.plugins[0].config.capabilitiesId, capabilities.id)
  assert.deepEqual(removed, [capabilities.id], 'the retained composition must not stay selectable')
  await active.dispose()
  assert.deepEqual(removed, [capabilities.id, 'byclaw-employee-1'])
})
