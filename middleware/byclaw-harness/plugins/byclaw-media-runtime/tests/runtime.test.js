import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, readBytes, assetFromBase64, persistAssets, resolveMediaModel } from '../src/index.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')

test('artifacts use session_root/image or session_root/tts with unique names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-media-'))
  try {
    const first = await persistAssets(root, 'image', [{ bytes: png, mimeType: 'image/png' }])
    const second = await persistAssets(root, 'image', [{ bytes: png, mimeType: 'image/png' }])
    assert.equal(first[0].path.startsWith(join(root, 'image') + '/'), true)
    assert.notEqual(first[0].path, second[0].path)
    assert.deepEqual(await readFile(first[0].path), png)
    const audio = Buffer.from('RIFF0000WAVEfmt ')
    const speech = await persistAssets(root, 'tts', [{ bytes: audio, mimeType: 'audio/wav' }])
    assert.equal(speech[0].path.startsWith(join(root, 'tts') + '/'), true)
    const timing = Buffer.from(JSON.stringify({ schemaVersion: 1, unit: 'second', granularity: 'provider-word', text: '你好', words: [] }))
    const timedSpeech = await persistAssets(root, 'tts', [
      { bytes: audio, mimeType: 'audio/wav' },
      { bytes: timing, mimeType: 'application/json', artifactType: 'word-timing' },
    ])
    assert.equal(timedSpeech[1].path.endsWith('.json'), true)
    assert.equal(timedSpeech[1].mimeType, 'application/json')
    assert.deepEqual(JSON.parse(await readFile(timedSpeech[1].path, 'utf8')), JSON.parse(timing.toString('utf8')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('artifact directory cannot escape through a symlink and missing root fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-media-'))
  try {
    const outside = join(root, 'outside'); const session = join(root, 'session')
    await mkdir(outside); await mkdir(session); await symlink(outside, join(session, 'image'))
    await assert.rejects(persistAssets(session, 'image', [{ bytes: png, mimeType: 'image/png' }]), /directory/i)
    await assert.rejects(persistAssets('', 'image', []), /session_root/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('bounded response reads and strict base64 reject corrupt provider payloads', async () => {
  await assert.rejects(readBytes(new Response('12345'), 4), /limit/)
  assert.throws(() => assetFromBase64('not-base64!', 'image/png'), /base64/)
  assert.deepEqual(assetFromBase64(png.toString('base64'), 'image/png').bytes, png)
})

test('transport prevents redirect credential forwarding and redacts error bodies', async () => {
  let redirect
  await assert.rejects(request('https://provider.example/v1', { headers: { authorization: 'secret' } }, {
    fetch: async (_url, init) => { redirect = init.redirect; return new Response('secret upstream data', { status: 401 }) },
  }), error => error.message === 'MEDIA_HTTP_401')
  assert.equal(redirect, 'error')
})

test('model resolver uses enabled exact type defaults and decrypted credentials', async () => {
  const record = { instanceId: 'image1', modelType: 'IMAGE_GENERATION', status: 1, isDefault: 1,
    modelCode: 'seedream', url: 'https://provider.example/v3/images/generations', authToken: 'encrypted',
    instanceParam: { providerName: 'VOLCENGINE', modelProtocol: 'VOLCENGINE_IMAGE', readTimeoutSec: 90,
      extendParam: '{"watermark":false}' } }
  const redis = { hget: async (key) => JSON.stringify(key.endsWith('typelist') ? [record] : record) }
  const result = await resolveMediaModel(redis, 'IMAGE_GENERATION', { decrypt: () => 'decrypted' })
  assert.equal(result.apiKey, 'decrypted'); assert.equal(result.provider, 'VOLCENGINE')
  assert.equal(result.options.watermark, false); assert.equal(result.timeoutMs, 90000)
  record.status = 0
  await assert.rejects(resolveMediaModel(redis, 'IMAGE_GENERATION'), /UNAVAILABLE/)
  await assert.rejects(resolveMediaModel(redis, 'TTS'), /NOT_CONFIGURED/)
})

test('request signal cancels a stalled response body', async () => {
  const controller = new AbortController()
  const response = await request('https://example.test/media', {}, { signal: controller.signal,
    fetch: async () => new Response(new ReadableStream({ pull() {} })) })
  const pending = readBytes(response)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
