import test from 'node:test'
import assert from 'node:assert/strict'
import { request, providerErrorMessage } from '../src/index.js'

const failure = async (body, status = 400, headers = {}, init = {}) => {
  try {
    await request('https://vendor.test/images/generations', init, {
      fetch: async () => new Response(body, { status, headers }),
    }, { errorDetails: true })
    assert.fail('request should fail')
  } catch (error) { return error }
}
test('structured diagnostics retain status, numeric codes, fields and request IDs while redacting headers and URLs', async () => {
  const error = await failure(JSON.stringify({ error: { code: 40001, param: 'size',
    message: 'invalid size\nfixture-secret custom-secret Bearer other-secret https://vendor.test/path?key=secret' } }),
  400, { 'x-tt-logid': 'fixture-id' }, { headers: { Authorization: 'Bearer fixture-secret', 'X-Token': 'custom-secret' } })
  assert.match(error.message, /MEDIA_HTTP_400: code=40001; message=invalid size/)
  assert.match(error.message, /param=size; requestId=fixture-id/)
  assert.doesNotMatch(error.message, /fixture-secret|custom-secret|other-secret|https:|key=secret|\n/)
  const saved = providerErrorMessage(error)
  error.message = 'mutated secret'
  assert.equal(providerErrorMessage(error), saved)
  assert.equal(providerErrorMessage(new Error(saved)), undefined)
})
test('non-JSON, oversized, broken and stalled errors fall back without losing HTTP status', async () => {
  for (const body of ['<html>private details</html>', 'x'.repeat(17000), null]) {
    const error = await failure(body, 503, { 'x-request-id': 'fallback' })
    assert.equal(error.message, 'MEDIA_HTTP_503: requestId=fallback')
  }
  const broken = new ReadableStream({ start(controller) { controller.error(new Error('secret')) } })
  assert.equal((await failure(broken)).message, 'MEDIA_HTTP_400')
  let cancelled = false
  const stalled = new ReadableStream({ cancel() { cancelled = true } })
  assert.equal((await failure(stalled)).message, 'MEDIA_HTTP_400')
  assert.equal(cancelled, true)
})
test('diagnostic fields are bounded and unselected response fields are not exposed', async () => {
  const error = await failure(JSON.stringify({ message: 'x'.repeat(2000), request_id: 'body-id', debug: 'secret' }))
  assert.match(error.message, /requestId=body-id/)
  assert.equal(error.message.split('message=')[1].split('; requestId=')[0].length, 512)
  assert.doesNotMatch(error.message, /debug|secret/)
})
test('ordinary HTTP callers retain code-only behavior and acceptErrorResponse takes precedence', async () => {
  await assert.rejects(request('https://vendor.test', {}, {
    fetch: async () => Response.json({ error: { message: 'secret' } }, { status: 401 }),
  }), { message: 'MEDIA_HTTP_401' })
  const response = await request('https://vendor.test', {}, {
    fetch: async () => Response.json({ error: 'raw' }, { status: 400 }),
  }, { acceptErrorResponse: true, errorDetails: true })
  assert.equal(response.status, 400)
})
