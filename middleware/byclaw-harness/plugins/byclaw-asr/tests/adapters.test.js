import test from 'node:test'
import assert from 'node:assert/strict'
import { transcribeAudio } from '../src/adapters.js'
const model = { provider: 'VOLCENGINE', protocol: 'VOLCENGINE_ASR', model: 'bigmodel', endpoint: 'https://openspeech.bytedance.com', apiKey: 'test-key', headers: {}, options: {} }
const audio = Buffer.from('ID3test-audio')
test('flash ASR sends native base64, resource and auth and reads result.text', async () => {
  const result = await transcribeAudio(model, audio, { fetch: async (url, init) => {
    assert.equal(url, 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash')
    assert.equal(init.headers.get('x-api-key'), 'test-key')
    assert.equal(init.headers.get('x-api-resource-id'), 'volc.bigasr.auc_turbo')
    assert.equal(init.headers.get('x-api-sequence'), '-1')
    assert.match(init.headers.get('x-api-request-id'), /^[0-9a-f-]{36}$/)
    const body = JSON.parse(init.body)
    assert.equal(body.audio.data, audio.toString('base64'))
    assert.equal(body.request.model_name, 'bigmodel')
    return Response.json({ result: { text: '这是语音' } }, { headers: { 'X-Api-Status-Code': '20000000' } })
  } })
  assert.equal(result.text, '这是语音')
})
test('legacy auth uses App-Key and removes new auth', async () => {
  await transcribeAudio({ ...model, options: { appKey: 'app', accessKey: 'access' } }, audio, { fetch: async (_, init) => {
    assert.equal(init.headers.get('x-api-app-key'), 'app')
    assert.equal(init.headers.get('x-api-access-key'), 'access')
    assert.equal(init.headers.get('x-api-key'), null)
    return Response.json({ result: { text: 'ok' } }, { headers: { 'x-api-status-code': '20000000' } })
  } })
})
test('HTTP 200 is insufficient; empty transcript and unsupported bytes fail', async () => {
  await assert.rejects(transcribeAudio(model, audio, { fetch: async () => Response.json({ result: { text: 'bad' } }) }), /ASR_PROVIDER_REJECTED/)
  await assert.rejects(transcribeAudio(model, audio, { fetch: async () => Response.json({ result: { text: '' } }, { headers: { 'x-api-status-code': '20000000' } }) }), /ASR_TRANSCRIPT_EMPTY/)
  await assert.rejects(transcribeAudio(model, Buffer.from('{}')), /ASR_MP3_REQUIRED/)
  await assert.rejects(transcribeAudio({ ...model, provider: 'OPENAI' }, audio), /ASR_PROVIDER_UNSUPPORTED/)
})
test('abort and provider errors do not expose credential-bearing messages', async () => {
  const control = new AbortController(); control.abort()
  await assert.rejects(transcribeAudio(model, audio, { signal: control.signal }), { name: 'AbortError' })
  await assert.rejects(transcribeAudio(model, audio, { fetch: async () => { throw Error('signed-secret') } }), /^Error: ASR_PROVIDER_FAILED$/)
})
for (const code of ['20000003', '45000002']) {
  test(`no-speech vendor status ${code} is actionable without exposing provider text`, async () => {
    await assert.rejects(transcribeAudio(model, audio, { fetch: async () => Response.json({ message: 'provider-secret-not-for-user' }, { headers: { 'x-api-status-code': code } }) }), /^Error: ASR_SPEECH_NOT_DETECTED$/)
  })
}
test('HTTP 4xx no-speech statuses retain their actionable classification', async () => {
  for (const code of ['20000003', '45000002']) {
    await assert.rejects(transcribeAudio(model, audio, { fetch: async () => Response.json({ message: 'secret' }, { status: 400, headers: { 'x-api-status-code': code } }) }), /^Error: ASR_SPEECH_NOT_DETECTED$/)
  }
})
test('other vendor status remains a redacted provider rejection', async () => {
  await assert.rejects(transcribeAudio(model, audio, { fetch: async () => Response.json({ message: 'token-secret' }, { headers: { 'x-api-status-code': '45000001' } }) }), /^Error: ASR_PROVIDER_REJECTED$/)
})
