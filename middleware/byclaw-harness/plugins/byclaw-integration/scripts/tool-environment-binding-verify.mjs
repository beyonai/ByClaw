/** Tool-sandbox binding verification: the employee's selection, binding, snapshot parsing. */

import assert from 'node:assert/strict'
import { bindTemplateEnvironment } from '../src/tool-environment-binding.ts'
import { parseByClawDigitalEmployee } from '../src/resources.ts'

// bindTemplateEnvironment binds the selected spec, falls back to the default for one this host
// cannot serve, and does nothing without a pool or without a selection.
const log = { infos: [], warns: [], info(message) { this.infos.push(message) }, warn(message) { this.warns.push(message) } }
const bound = []
const binder = {
  defaultName: 'byclaw-dsh-tools',
  has: name => name === 'byclaw-dsh-tools' || name === 'byclaw-dsh-tools-media',
  bind: (id, name) => { bound.push([id, name]); return () => { bound.pop() } },
}
bindTemplateEnvironment(binder, 'a1', { id: 't1', toolSandbox: 'byclaw-dsh-tools-media' }, log)
assert.deepEqual(bound, [['a1', 'byclaw-dsh-tools-media']])
bindTemplateEnvironment(binder, 'a2', { id: 't2', toolSandbox: 'quantum' }, log)
assert.deepEqual(bound.at(-1), ['a2', 'byclaw-dsh-tools'])
assert.ok(log.warns[0].includes('"quantum"'))
const dispose = bindTemplateEnvironment(binder, 'a3', { id: 't3' }, log)
dispose()
assert.equal(bound.length, 2)
assert.equal(typeof bindTemplateEnvironment(undefined, 'a4', { id: 't4', toolSandbox: 'byclaw-dsh-tools-media' }, log), 'function')
assert.equal(bound.length, 2)
assert.equal(typeof bindTemplateEnvironment(binder, 'a5', { id: 't5', toolSandbox: '  ' }, log), 'function')
assert.equal(bound.length, 2)
assert.ok(log.infos.some(line => line.includes('spec=byclaw-dsh-tools-media')))

// parseByClawDigitalEmployee reads the selection from advancedSettings or a top-level field.
const base = { resourceId: '11', resourceName: 'Video', workerAgentType: 'BYCLAW_EXE' }
assert.equal(parseByClawDigitalEmployee({ ...base, advancedSettings: JSON.stringify({ toolSandbox: 'byclaw-dsh-tools-media', other: 1 }) }).toolSandbox, 'byclaw-dsh-tools-media')
assert.equal(parseByClawDigitalEmployee({ ...base, toolSandbox: 'gpu', advancedSettings: JSON.stringify({ toolSandbox: 'media' }) }).toolSandbox, 'gpu')
assert.equal(parseByClawDigitalEmployee(base).toolSandbox, undefined)

console.log('tool-environment-binding verify: ok')
