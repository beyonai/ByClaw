import test from 'node:test'
import assert from 'node:assert/strict'
import { generateImage } from '../src/adapters.js'

const model = { id: 'fixture', source: 'system-default', provider: 'VOLCENGINE', protocol: 'VOLCENGINE_IMAGE',
  model: 'doubao-seedream-5-0-260128', endpoint: 'https://vendor.test/api/v3/images/generations',
  apiKey: 'fixture-secret', options: {}, timeoutMs: 5000 }
const args = { prompt: 'a mountain' }
const fetchError = async () => Response.json({ error: {
  code: 'InvalidParameter', message: 'invalid size; token fixture-secret', param: 'size',
} }, { status: 400, headers: { 'x-request-id': 'fixture-request' } })

test('real image adapter retains only sanitized provider diagnostics', async () => {
  await assert.rejects(generateImage(model, args, { fetch: fetchError }), error => {
    assert.match(error.message, /MEDIA_HTTP_400: code=InvalidParameter/)
    assert.match(error.message, /message=invalid size/)
    assert.match(error.message, /param=size; requestId=fixture-request/)
    assert.doesNotMatch(error.message, /fixture-secret/)
    return true
  })
  await assert.rejects(generateImage(model, args, { fetch: async () => {
    throw new Error('MEDIA_HTTP_400: forged details fixture-secret')
  } }), error => !error.message.includes('fixture-secret') && !error.message.includes('forged'))
})
