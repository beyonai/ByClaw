import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createTtsDebugHttpHandler } from '../src/tts-http.ts'
const model = { provider: 'VOLCENGINE', protocol: 'VOLCENGINE_TTS', model: 'seed-tts-2.0', endpoint: 'https://example.invalid', timeoutMs: 2000, apiKey: 'secret', headers: {}, options: {} }
let calls = 0
let assets = [{ bytes: Buffer.from('ID3fixture'), mimeType: 'audio/mpeg' }]
const handler = createTtsDebugHttpHandler({ authHeaders: async () => ({ 'Beyond-Token': 'current-token' }), resolveModel: async () => model,
  synthesize: async (chosen, args) => { calls++; assert.equal(chosen.model, model.model); assert.equal(args.format, 'mp3'); return assets },
})
const server = createServer(handler)
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const url = `http://127.0.0.1:${server.address().port}/api/byclaw/tts/debug`
  const request = (body, token = 'current-token') => fetch(url, { method: 'POST', headers: { 'Beyond-Token': token }, body: JSON.stringify(body) })
  assert.equal((await request({ debug: true, text: '朗读测试' }, 'wrong')).status, 401)
  assert.equal(calls, 0)
  assert.equal((await request({ text: '朗读测试', model })).status, 400)
  assert.equal(calls, 0)
  const response = await request({ debug: true, text: '朗读测试', model })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(Buffer.from(result.audioBase64, 'base64').toString(), 'ID3fixture')
  assert.equal(result.mimeType, 'audio/mpeg')
  assert.equal(result.provider, model.provider)
  assert.equal(result.model, model.model)
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal((await request({ debug: true, text: ' ' })).status, 400)
  assert.equal((await request({ debug: true, text: 'x'.repeat(20001) })).status, 400)
  assert.equal(calls, 1)
  const audio = assets[0]
  const timing = { bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, text: '朗读测试', words: [] })), mimeType: 'application/json', artifactType: 'word-timing' }
  assets = [timing, audio]
  const withTiming = await request({ debug: true, text: '朗读测试', model })
  assert.equal(withTiming.status, 200)
  assert.equal(Buffer.from((await withTiming.json()).audioBase64, 'base64').toString(), 'ID3fixture')
  assets = [timing]
  assert.equal((await request({ debug: true, text: '朗读测试', model })).status, 400)
  assets = [audio, { ...audio, mimeType: 'audio/wav' }, timing]
  assert.equal((await request({ debug: true, text: '朗读测试', model })).status, 400)
  console.log('TTS debug verification passed: auth, explicit debug gate, native speech, response and text bounds')
} finally { await new Promise(resolve => server.close(resolve)) }
