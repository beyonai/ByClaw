import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadProjectedMediaModel,
  mediaConfigurationRequiredResult,
  MediaSystemDefaultUnavailableError,
  parseMediaModelConfig,
  resolveMediaModelFromProjection,
  resolveMediaProjectionPath,
  withMediaRetry,
} from '../src/media-generation/runtime-config.ts'
import { generateVolcengineTtsV3 } from '../src/media-generation/providers/volcengine-tts-v3.ts'
import { loadSystemDefaultMediaModel } from '../src/media-generation/system-model.ts'
import { generateOpenAiImage } from '../src/media-generation/providers/openai-image.ts'

const pluginEntry = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
assert.match(pluginEntry, /resolvePluginMediaModel/u)
assert.doesNotMatch(pluginEntry, /registerMediaGenerationTools\(ctx/u)

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.match(packageJson.scripts.verify, /media-generation-verify\.mjs/u)

const validTts = {
  schemaVersion: 1,
  revision: 'rev-1',
  connectorCode: 'speech-generation-model',
  modelName: 'My TTS',
  modelCode: 'seed-tts-2.0',
  modelType: 'TTS',
  modelProtocol: 'VOLCENGINE_TTS_V3',
  apiEndpoint: 'https://example.invalid/api/v3/tts/unidirectional',
  apiToken: 'test-secret',
  headers: [],
  connectTimeoutSeconds: 10,
  readTimeoutSeconds: 60,
  maxRetryCount: 2,
  retryIntervalSeconds: 1,
  options: {},
}

assert.equal(resolveMediaProjectionPath('TTS', {}), '/by/.connector-auth/.model/tts.json')
assert.equal(resolveMediaProjectionPath('IMAGE', {
  BYCLAW_IMAGE_MODEL_CONFIG_PATH: '/by/.connector-auth/.model/custom/image.json',
}), '/by/.connector-auth/.model/custom/image.json')
assert.throws(() => resolveMediaProjectionPath('TTS', {
  BYCLAW_TTS_MODEL_CONFIG_PATH: '/tmp/tts.json',
}), /MEDIA_PROJECTION_PATH_INVALID/)
assert.throws(() => resolveMediaProjectionPath('TTS', {
  BYCLAW_TTS_MODEL_CONFIG_PATH: '/by/.connector-auth/.model/image.json',
}), /MEDIA_PROJECTION_PATH_INVALID/)

assert.equal(parseMediaModelConfig(JSON.stringify(validTts), 'TTS').modelCode, 'seed-tts-2.0')
assert.throws(
  () => parseMediaModelConfig(JSON.stringify({ ...validTts, modelType: 'IMAGE' }), 'TTS'),
  /CONNECTOR_MODEL_TYPE_MISMATCH/,
)
assert.throws(
  () => parseMediaModelConfig(JSON.stringify({ ...validTts, apiEndpoint: 'http:\/\/169.254.169.254' }), 'TTS'),
  /MEDIA_ENDPOINT_REJECTED/,
)

const root = await mkdtemp(join(tmpdir(), 'byclaw-media-'))
const modelDir = join(root, '.connector-auth', '.model')
await mkdir(modelDir, { recursive: true })
const ttsPath = join(modelDir, 'tts.json')
await writeFile(ttsPath, JSON.stringify(validTts), { mode: 0o600 })
assert.equal((await loadProjectedMediaModel(ttsPath, 'TTS', 'rev-1')).revision, 'rev-1')
await assert.rejects(() => loadProjectedMediaModel(ttsPath, 'TTS', 'rev-old'), /CONNECTOR_CONFIG_REVISION_MISMATCH/)

const outside = join(root, 'outside.json')
await writeFile(outside, JSON.stringify(validTts))
const link = join(modelDir, 'link.json')
await symlink(outside, link)
await assert.rejects(() => loadProjectedMediaModel(link, 'TTS', 'rev-1'), /symbolic link/)

const system = { ...validTts, revision: 'system-1', source: 'system-default', apiToken: 'system-secret' }
const fromSystem = await resolveMediaModelFromProjection({
  capability: 'TTS',
  projectionPath: join(modelDir, 'missing-tts.json'),
  loadSystemDefault: async () => system,
})
assert.equal(fromSystem.source, 'system-default')

await assert.rejects(
  () => resolveMediaModelFromProjection({
    capability: 'IMAGE',
    projectionPath: join(modelDir, 'missing-image.json'),
    loadSystemDefault: async () => { throw new Error('MEDIA_DEFAULT_MODEL_NOT_FOUND') },
  }),
  error => error instanceof MediaSystemDefaultUnavailableError && error.capability === 'IMAGE',
)
const configurationRequired = mediaConfigurationRequiredResult('IMAGE', new Error('MEDIA_DEFAULT_MODEL_NOT_FOUND'))
assert.equal(configurationRequired.status, 'configuration_required')
assert.equal(configurationRequired.connectorCode, 'image-generation-model')
assert.match(configurationRequired.message, /文生图模型连接器/u)
const speechConfigurationRequired = mediaConfigurationRequiredResult('TTS', new Error('MEDIA_PROVIDER_ERROR'))
assert.equal(speechConfigurationRequired.connectorCode, 'speech-generation-model')
assert.match(speechConfigurationRequired.message, /语音模型连接器/u)

const fromUser = await resolveMediaModelFromProjection({
  capability: 'TTS',
  projectionPath: ttsPath,
  loadSystemDefault: async () => system,
})
assert.equal(fromUser.source, 'user-connector')
assert.equal(fromUser.apiToken, 'test-secret')

const invalidPath = join(modelDir, 'invalid-tts.json')
await writeFile(invalidPath, '{broken-json')
await assert.rejects(() => resolveMediaModelFromProjection({
  capability: 'TTS', projectionPath: invalidPath, loadSystemDefault: async () => system,
}), /CONNECTOR_CONFIG_INVALID/)

let observedRequest
const audio = await generateVolcengineTtsV3({
  model: { ...parseMediaModelConfig(JSON.stringify(validTts), 'TTS'), options: { resourceId: 'seed-tts-2.0' } },
  request: { text: '你好', voice: 'zh_female_shuangkuaisisi_moon_bigtts', speed: 1, format: 'mp3' },
  signal: new AbortController().signal,
  fetchImpl: async (input, init) => {
    observedRequest = { input: String(input), init }
    return new Response(
      `${JSON.stringify({ code: 0, data: Buffer.from('audio-a').toString('base64') })}\n`
      + JSON.stringify({ code: 20000000, data: Buffer.from('audio-b').toString('base64') }),
      { status: 200, headers: { 'x-tt-logid': 'log-1' } },
    )
  },
})
assert.equal(audio.bytes.toString(), 'audio-aaudio-b')
assert.equal(audio.mimeType, 'audio/mpeg')
assert.equal(observedRequest.input, validTts.apiEndpoint)
assert.equal(observedRequest.init.headers['X-Api-Key'], 'test-secret')
assert.equal(observedRequest.init.headers['X-Api-Resource-Id'], 'seed-tts-2.0')

const redisValues = new Map([
  [`byai:aimodel:typelist\0TTS`, JSON.stringify([{ instanceId: '42', modelType: 'TTS', status: 1, isDefault: 1 }])],
  [['byai:aimodel:config', '42'].join('\0'), JSON.stringify({
    instanceId: '42',
    modelCode: 'seed-tts-2.0',
    modelName: 'System TTS',
    modelType: 'TTS',
    status: 1,
    url: validTts.apiEndpoint,
    authToken: 'system-secret',
    instanceParam: {
      modelProtocol: 'VOLCENGINE_TTS_V3',
      connectTimeoutSeconds: 10,
      readTimeoutSeconds: 60,
      maxRetryCount: 1,
      retryIntervalSeconds: 2,
      headers: [],
      options: { resourceId: 'seed-tts-2.0' },
    },
  })],
])
const systemModel = await loadSystemDefaultMediaModel({
  hget: async (key, field) => redisValues.get(`${key}\0${field}`) ?? null,
}, 'TTS')
assert.equal(systemModel.source, 'system-default')
assert.equal(systemModel.modelCode, 'seed-tts-2.0')
assert.equal(systemModel.apiToken, 'system-secret')

const imageRedisValues = new Map([
  [`byai:aimodel:typelist\0IMAGE_GENERATION`, JSON.stringify([
    { instanceId: '84', modelType: 'IMAGE_GENERATION', status: 1, isDefault: 1 },
  ])],
  [['byai:aimodel:config', '84'].join('\0'), JSON.stringify({
    instanceId: '84', modelCode: 'image-model', modelName: 'System Image',
    modelType: 'IMAGE_GENERATION', modelProtocol: 'OPENAI_IMAGE', status: 1,
    url: 'https://example.invalid/v1/images/generations', authToken: 'system-image-secret',
    instanceParam: {
      headers: [{ key: 'X-App', value: 'byclaw' }, { key: '', value: '' }],
      connectTimeoutSec: 32,
      readTimeoutSec: 75,
      maxRetries: 2,
      retryIntervalSec: 3,
      extendParam: JSON.stringify({ responseFormat: 'b64_json' }),
    },
  })],
])
const systemImageModel = await loadSystemDefaultMediaModel({
  hget: async (key, field) => imageRedisValues.get(`${key}\0${field}`) ?? null,
}, 'IMAGE')
assert.equal(systemImageModel.modelProtocol, 'OPENAI_IMAGE')
assert.deepEqual(systemImageModel.headers, [{ name: 'X-App', value: 'byclaw', sensitive: false }])
assert.equal(systemImageModel.connectTimeoutSeconds, 32)
assert.equal(systemImageModel.readTimeoutSeconds, 75)
assert.equal(systemImageModel.maxRetryCount, 2)
assert.equal(systemImageModel.retryIntervalSeconds, 3)
assert.deepEqual(systemImageModel.options, { responseFormat: 'b64_json' })

const imageModel = parseMediaModelConfig(JSON.stringify({
  ...validTts,
  revision: 'image-1',
  connectorCode: 'image-generation-model',
  modelName: 'Image',
  modelCode: 'image-model',
  modelType: 'IMAGE',
  modelProtocol: 'OPENAI_IMAGE',
}), 'IMAGE')
const generatedImages = await generateOpenAiImage({
  model: imageModel,
  request: { prompt: 'a blue whale', width: 1024, height: 1024, count: 1 },
  signal: new AbortController().signal,
  fetchImpl: async () => Response.json({ data: [{ b64_json: Buffer.from('png-data').toString('base64') }] }),
})
assert.equal(generatedImages.length, 1)
assert.equal(generatedImages[0].bytes.toString(), 'png-data')

let attempts = 0
assert.equal(await withMediaRetry({ ...imageModel, maxRetryCount: 2, retryIntervalSeconds: 0 }, async () => {
  attempts += 1
  if (attempts < 3) throw new Error('MEDIA_RATE_LIMITED: retry me')
  return 'ok'
}), 'ok')
assert.equal(attempts, 3)

await assert.rejects(
  () => withMediaRetry(imageModel, async () => { throw new Error('MEDIA_REQUEST_INVALID: do not retry') }),
  /MEDIA_REQUEST_INVALID/,
)

console.log('media-generation verification passed')
