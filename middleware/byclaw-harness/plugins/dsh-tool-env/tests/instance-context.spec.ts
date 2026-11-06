import assert from 'node:assert/strict'
import { it as test } from 'vitest'
import { instanceRefsFor } from '../src/instance-context.ts'
test('trusted explicit capability bindings preserve mapping and order without addresses', () => {
  assert.deepEqual(instanceRefsFor({ sandboxId: 'provider-id', mappingId: 'map-1', instanceBindings: { default: ['editor'], 'browser.automation': ['browser', 'browser'] } }, 'browser.automation'), [{ sandboxId: 'provider-id', mappingId: 'map-1', instance: 'browser' }])
})
test('missing and corrupt optional context disable references without guessing', () => {
  for (const value of [undefined, {}, { sandboxId: 'a', instanceBindings: { default: ['x', 1] } }]) assert.deepEqual(instanceRefsFor(value, 'browser.automation'), [])
  assert.deepEqual(instanceRefsFor({ sandboxId: 'a', instanceBindings: { 'browser.automation': ['b'] } }), [])
})
test('unknown versions disable references while presentation descriptors remain optional', () => {
  assert.deepEqual(instanceRefsFor({ version: 99, sandboxId: 'a', instanceBindings: { default: ['x'] } }), [])
  assert.deepEqual(instanceRefsFor({ version: 1, sandboxId: 'a', instanceBindings: { default: ['x'] }, instanceDescriptors: {} }), [{ sandboxId: 'a', instance: 'x' }])
})
