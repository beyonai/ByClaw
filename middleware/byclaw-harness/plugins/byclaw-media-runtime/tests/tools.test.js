import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mountMediaPlugin } from '../src/index.js'

test('session tool binding is idempotent and validates before generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-tools-'))
  let setup, tool, calls = 0, registrations = 0
  const ctx = { on: (_name, handler) => { setup = handler }, effect: fn => fn() }
  const agentCtx = { tools: { register: value => { tool = value; registrations++; return () => {} } }, effect: fn => fn() }
  const host = { userCode: 'test', resolveSessionRoot: () => root,
    resolveMediaModel: async () => ({ id: 'm1', provider: 'OPENAI', model: 'image', timeoutMs: 1000 }) }
  const generate = async () => { calls++; return [{ mimeType: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64') }] }
  try {
    mountMediaPlugin(ctx, { kind: 'image', generate })
    const payload = { agentCtx, host, agent: { id: 'a1' }, command: { header: { userCode: 'test' } } }
    await setup(payload); await setup(payload)
    assert.equal(registrations, 1)
    assert.equal(tool.name, 'image_generate')
    assert.deepEqual(tool.parameters.required, ['prompt'])
    assert.equal(tool.parameters.additionalProperties, false)
    assert.ok(tool.description.length <= 250)
    for (const field of Object.values(tool.parameters.properties)) assert.ok((field.description?.length ?? 0) <= 150)
    await assert.rejects(tool.execute({ prompt: ' ', endpoint: 'https://attacker.example' }, {}), /INVALID_ARGUMENT/)
    assert.equal(calls, 0)
    const result = await tool.execute({ prompt: 'test' }, {})
    assert.equal(result.artifacts[0].path.startsWith(join(root, 'image') + '/'), true)
    assert.equal(calls, 1)
    await assert.rejects(setup({ ...payload, host: { ...host, userCode: 'other' } }), /IDENTITY/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
