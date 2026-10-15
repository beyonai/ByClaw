/** Plugin model precedence: explicit deployment ID, validated connector projection, Redis default. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePluginMediaModel } from '../src/media-generation/plugin-model.ts'

const root = await mkdtemp(join(tmpdir(), 'byclaw-media-plugin-model-'))
const projectionPath = join(root, 'model.json')
const calls = []
const systemRecord = {
  instanceId: 'system-image', modelType: 'IMAGE_GENERATION', status: 1, isDefault: 1,
  modelCode: 'system-model', url: 'https://system.invalid/v1', authToken: 'encrypted-token',
  instanceParam: { providerName: 'OPENAI', modelProtocol: 'OPENAI_IMAGE', headers: [{ key: 'X-Key', value: 'encrypted-header' }] },
}
const redis = { hget: async (key, field) => {
  calls.push([key, field])
  return JSON.stringify(key.endsWith('typelist') ? [systemRecord] : systemRecord)
} }
const connector = {
  schemaVersion: 1, revision: 'rev-1', connectorCode: 'image-generation-model',
  modelName: 'Connector Image', modelCode: 'connector-image', modelType: 'IMAGE',
  modelProtocol: 'OPENAI_IMAGE', apiEndpoint: 'https://connector.invalid/v1', apiToken: 'plaintext-token',
  headers: [{ name: 'X-App', value: 'plaintext-header', sensitive: true }],
  connectTimeoutSeconds: 10, readTimeoutSeconds: 75, maxRetryCount: 3, retryIntervalSeconds: 2,
  options: { size: '1024x1024', watermark: false },
}
const save = value => writeFile(projectionPath, typeof value === 'string' ? value : JSON.stringify(value))
try {
  await save('{damaged')
  const explicit = await resolvePluginMediaModel(redis, 'IMAGE_GENERATION', {
    modelId: 'exact-model', projectionPath, decrypt: value => `decrypted:${value}`,
  })
  assert.equal(explicit.model, 'system-model')
  assert.equal(explicit.apiKey, 'decrypted:encrypted-token')
  assert.equal(explicit.headers['X-Key'], 'decrypted:encrypted-header')
  assert.deepEqual(calls.splice(0), [['byai:aimodel:config', 'exact-model']], 'Explicit ID must skip projection/default lookup')

  const fallback = await resolvePluginMediaModel(redis, 'IMAGE_GENERATION', {
    projectionPath: join(root, 'absent.json'), decrypt: value => `decrypted:${value}`,
  })
  assert.equal(fallback.model, 'system-model')
  assert.deepEqual(calls.splice(0), [['byai:aimodel:typelist', 'IMAGE_GENERATION']])

  await save(connector)
  const projected = await resolvePluginMediaModel(redis, 'IMAGE_GENERATION', {
    projectionPath, decrypt: () => { throw new Error('Projection credentials are already plaintext') },
  })
  assert.equal(projected.provider, 'OPENAI')
  assert.equal(projected.protocol, 'OPENAI_IMAGE')
  assert.equal(projected.model, connector.modelCode)
  assert.equal(projected.endpoint, connector.apiEndpoint)
  assert.equal(projected.apiKey, connector.apiToken)
  assert.deepEqual(projected.headers, { 'X-App': 'plaintext-header' })
  assert.deepEqual(projected.options, connector.options)
  assert.equal(projected.timeoutMs, 75000)
  assert.deepEqual(calls, [], 'A connector projection must take precedence over Redis defaults')
  assert.equal('maxRetryCount' in projected, false, 'Projection retries must not enable paid generation replay')

  await save({ ...connector, headers: [{ name: 'aUtHoRiZaTiOn', value: 'Bearer explicit-key' }] })
  const customImageAuth = await resolvePluginMediaModel(redis, 'IMAGE_GENERATION', { projectionPath })
  assert.equal(customImageAuth.apiKey, '', 'Explicit image Authorization must not be overwritten by apiToken')
  assert.equal(new Headers(customImageAuth.headers).get('authorization'), 'Bearer explicit-key')
  const legacySpeech = { ...connector, modelType: 'TTS', modelProtocol: 'VOLCENGINE_TTS_V3',
    headers: [{ name: 'x-API-key', value: 'explicit-speech-key' }], options: { defaultVoice: 'configured-voice' } }
  await save(legacySpeech)
  const compatibleSpeech = await resolvePluginMediaModel(redis, 'TTS', { projectionPath })
  assert.equal(compatibleSpeech.apiKey, 'explicit-speech-key')
  assert.equal(compatibleSpeech.options.voice, 'configured-voice')
  await save({ ...legacySpeech, readTimeoutSeconds: 3600,
    headers: [...legacySpeech.headers, { name: 'x-API-resource-ID', value: 'seed-icl-2.0' }],
    options: { ...legacySpeech.options, resourceId: 'seed-tts-2.0' },
  })
  const overriddenSpeech = await resolvePluginMediaModel(redis, 'TTS', { projectionPath })
  assert.equal(overriddenSpeech.options.resourceId, 'seed-icl-2.0', 'Explicit resource header retains its legacy precedence')
  assert.equal(overriddenSpeech.timeoutMs, 1800000, 'Projection timeout is capped at the shared 30-minute generation budget')
  for (const name of ['voice', 'speaker']) {
    await save({ ...legacySpeech, options: { ...legacySpeech.options, [name]: 'new-voice' } })
    const result = await resolvePluginMediaModel(redis, 'TTS', { projectionPath })
    assert.equal(result.options[name], 'new-voice')
    if (name === 'speaker') assert.equal(result.options.voice, undefined, 'Explicit speaker takes precedence over defaultVoice')
  }

  const imageProtocols = {
    COMFY_IMAGE: 'COMFYUI', DEEPINFRA_IMAGE: 'DEEPINFRA', FAL_IMAGE: 'FAL', GOOGLE_IMAGE: 'GOOGLE',
    LITELLM_IMAGE: 'LITELLM', MICROSOFT_FOUNDRY_IMAGE: 'MICROSOFT_FOUNDRY', MINIMAX_IMAGE: 'MINIMAX',
    OPENAI_IMAGE: 'OPENAI', OPENROUTER_IMAGE: 'OPENROUTER', VYDRA_IMAGE: 'VYDRA', XAI_IMAGE: 'XAI',
    VOLCENGINE_IMAGE: 'VOLCENGINE', QWEN_IMAGE: 'QWEN',
  }
  for (const [protocol, provider] of Object.entries(imageProtocols)) {
    await save({ ...connector, modelProtocol: protocol })
    const result = await resolvePluginMediaModel(redis, 'IMAGE_GENERATION', { projectionPath })
    assert.equal(result.provider, provider, protocol)
    assert.equal(result.protocol, protocol)
  }
  for (const provider of ['OPENAI', 'OPENROUTER', 'TOGETHER', 'ZAI', 'QWEN', 'MINIMAX', 'VOLCENGINE']) {
    for (const suffix of ['TTS', 'SPEECH']) {
      const protocol = `${provider}_${suffix}`
      await save({ ...connector, modelType: 'TTS', modelProtocol: protocol })
      const result = await resolvePluginMediaModel(redis, 'TTS', { projectionPath })
      assert.equal(result.provider, provider, protocol)
      assert.equal(result.protocol, protocol)
    }
  }
  for (const [protocol, provider] of [['VOLCENGINE_TTS_V3', 'VOLCENGINE'], ['DASHSCOPE_TTS', 'QWEN']]) {
    await save({ ...connector, modelType: 'TTS', modelProtocol: protocol })
    assert.equal((await resolvePluginMediaModel(redis, 'TTS', { projectionPath })).provider, provider)
  }
  for (const [value, type, expected] of [
    ['{broken-json', 'IMAGE_GENERATION', /CONNECTOR_CONFIG_INVALID/],
    [{ ...connector, modelType: 'TTS' }, 'IMAGE_GENERATION', /CONNECTOR_MODEL_TYPE_MISMATCH/],
    [{ ...connector, modelProtocol: 'VOLCENGINE_TTS_V3' }, 'IMAGE_GENERATION', /MEDIA_ADAPTER_NOT_FOUND/],
    [{ ...connector, modelType: 'TTS', modelProtocol: 'OPENAI_IMAGE' }, 'TTS', /MEDIA_ADAPTER_NOT_FOUND/],
    [{ ...connector, modelProtocol: 'UNKNOWN_IMAGE' }, 'IMAGE_GENERATION', /MEDIA_ADAPTER_NOT_FOUND/],
    [{ ...connector, modelType: 'TTS', modelProtocol: 'ANTHROPIC_TTS' }, 'TTS', /MEDIA_ADAPTER_NOT_FOUND/],
    [{ ...connector, apiEndpoint: 'http://127.0.0.1/private' }, 'IMAGE_GENERATION', /MEDIA_ENDPOINT_REJECTED/],
  ]) {
    await save(value)
    await assert.rejects(resolvePluginMediaModel(redis, type, { projectionPath }), expected)
  }
  await mkdir(join(root, 'directory'))
  await assert.rejects(resolvePluginMediaModel(redis, 'IMAGE_GENERATION', { projectionPath: join(root, 'directory') }), /not a regular file/)
  await symlink(projectionPath, join(root, 'symlink.json'))
  await assert.rejects(resolvePluginMediaModel(redis, 'IMAGE_GENERATION', { projectionPath: join(root, 'symlink.json') }), /symbolic link/)
  await assert.rejects(resolvePluginMediaModel(redis, 'IMAGE', { projectionPath }), /MEDIA_MODEL_INVALID_TYPE/)
  assert.deepEqual(calls, [], 'No invalid projection or capability may silently use Redis')
  console.log('Media plugin projection precedence, validation and all native protocol mappings passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
