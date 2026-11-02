import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountMediaPlugin } from '@byclaw/media-runtime'
import { generateImage } from '../src/adapters.js'

const model = { id: 'fixture', source: 'system-default', provider: 'VOLCENGINE', protocol: 'VOLCENGINE_IMAGE',
  model: 'doubao-seedream-5-0-260128', endpoint: 'https://vendor.test/api/v3/images/generations',
  apiKey: 'fixture-secret', options: {}, timeoutMs: 5000 }
const args = { prompt: 'a mountain' }
const fetchError = async () => Response.json({ error: {
  code: 'InvalidParameter', message: 'invalid size; token fixture-secret', param: 'size',
} }, { status: 400, headers: { 'x-request-id': 'fixture-request' } })

test('registered tool retains safe details through connector error handling without changing metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-diagnostic-tool-'))
  let setup, tool
  const ctx = { on: (_event, callback) => { setup = callback }, effect: fn => fn() }
  const agentCtx = { tools: { register: value => { tool = value; return () => {} } }, effect: fn => fn() }
  mountMediaPlugin(ctx, { kind: 'image', generate: (selected, input, context) => generateImage(selected, input, { ...context, fetch: fetchError }) })
  try {
    await setup({ agentCtx, host: { userCode: 'fixture', resolveSessionRoot: () => root,
      resolveMediaModel: async () => model }, agent: { id: 'agent' }, command: { header: { userCode: 'fixture' } } })
    await assert.rejects(tool.execute(args), error => {
      assert.equal(error.code, 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED')
      assert.equal(error.reason, 'MEDIA_HTTP_400')
      assert.equal(error.retryable, false)
      assert.equal(error.source, 'system-default')
      assert.match(error.message, /code=InvalidParameter/)
      assert.match(error.message, /param=size; requestId=fixture-request/)
      assert.doesNotMatch(error.message, /fixture-secret/)
      return true
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})
