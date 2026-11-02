import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveMediaModel } from '../src/index.js'

const raw = {
  instanceId: 'fixture', modelType: 'IMAGE_GENERATION', status: 1, isDefault: 1,
  modelCode: 'doubao-seedream-5-0-260128', url: 'https://vendor.test/images/generations',
  instanceParam: { providerName: 'VOLCENGINE', modelProtocol: 'VOLCENGINE_IMAGE',
    extendParam: JSON.stringify({ size: '4K', watermark: true, response_format: 'url', seed: 123 }),
    imageGenerationConfig: { size: '2K', watermark: false, responseFormat: 'b64_json' } },
}
const resolve = (model, type = 'IMAGE_GENERATION', options) => resolveMediaModel({
  hget: async key => JSON.stringify(key.endsWith('typelist') ? [model] : model),
}, type, options)

test('backend image settings override generic options for default and explicit models', async () => {
  for (const config of [undefined, { modelId: 'fixture' }]) {
    const model = await resolve(raw, 'IMAGE_GENERATION', config)
    assert.deepEqual(model.options, { size: '2K', watermark: false, response_format: 'b64_json', seed: 123 })
    assert.deepEqual(raw.instanceParam.imageGenerationConfig, { size: '2K', watermark: false, responseFormat: 'b64_json' })
  }
})
test('image defaults accept object/string extension data, options, and missing controls', async () => {
  for (const extension of [{ seed: 456 }, JSON.stringify({ seed: 456 })]) {
    const model = await resolve({ ...raw, instanceParam: { ...raw.instanceParam,
      extendParam: extension, imageGenerationConfig: undefined } })
    assert.deepEqual(model.options, { seed: 456 })
  }
  assert.deepEqual((await resolve({ ...raw, instanceParam: { ...raw.instanceParam,
    options: { quality: 'high' }, imageGenerationConfig: { watermark: false } } })).options,
  { quality: 'high', watermark: false })
  assert.deepEqual((await resolve({ ...raw, instanceParam: { ...raw.instanceParam,
    options: undefined, extendParam: undefined, imageGenerationConfig: undefined } })).options, {})
  const speech = await resolve({ ...raw, modelType: 'TTS' }, 'TTS')
  assert.deepEqual(speech.options, { size: '4K', watermark: true, response_format: 'url', seed: 123 })
})
