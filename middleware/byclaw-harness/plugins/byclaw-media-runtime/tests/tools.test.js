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

test('speech tool treats null and blank voices as unspecified', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-tools-tts-'))
  let setup, tool
  const calls = []
  const ctx = { on: (_name, handler) => { setup = handler }, effect: fn => fn() }
  const agentCtx = { tools: { register: value => { tool = value; return () => {} } }, effect: fn => fn() }
  const host = { userCode: 'test', resolveSessionRoot: () => root,
    resolveMediaModel: async () => ({ id: 'm1', provider: 'OPENAI', model: 'tts', timeoutMs: 1000 }) }
  const generate = async (_model, args) => {
    calls.push(args)
    return [{ mimeType: 'audio/mpeg', bytes: Buffer.from([0xff, 0xfb, 0x90, 0x00]) }]
  }
  try {
    mountMediaPlugin(ctx, { kind: 'tts', generate })
    await setup({ agentCtx, host, agent: { id: 'a1' }, command: { header: { userCode: 'test' } } })
    for (const voice of [null, '', '   ']) await tool.execute({ text: 'hello', voice })
    assert.deepEqual(calls, [{ text: 'hello' }, { text: 'hello' }, { text: 'hello' }])
    await assert.rejects(tool.execute({ text: 'hello', voice: 42 }), /MEDIA_INVALID_ARGUMENT: voice/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function mountedTool(kind, { resolveMediaModel, generate }) {
  const root = await mkdtemp(join(tmpdir(), `media-tools-${kind}-`))
  let setup, tool
  const ctx = { on: (_name, handler) => { setup = handler }, effect: fn => fn() }
  const agentCtx = { tools: { register: value => { tool = value; return () => {} } }, effect: fn => fn() }
  const host = { userCode: 'test', resolveSessionRoot: () => root, resolveMediaModel }
  mountMediaPlugin(ctx, { kind, generate })
  await setup({ agentCtx, host, agent: { id: 'a1' }, command: { header: { userCode: 'test' } } })
  return { root, tool }
}

for (const [kind, modelError, connectorCode, connectorName, args] of [
  ['tts', 'MEDIA_MODEL_NOT_CONFIGURED: TTS', 'speech-generation-model', '语音模型', { text: '你好' }],
  ['image', 'MEDIA_MODEL_INCOMPLETE', 'image-generation-model', '文生图模型', { prompt: '一只猫' }],
]) test(`${kind} asks the user to configure a connector when the system model cannot be resolved`, async () => {
  const mounted = await mountedTool(kind, {
    resolveMediaModel: async () => { throw new Error(modelError) },
    generate: async () => { throw new Error('must not generate') },
  })
  try {
    await assert.rejects(mounted.tool.execute(args), error => error.code === 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED'
      && error.connectorCode === connectorCode
      && error.source === 'system-default'
      && error.configurationRequired === true
      && error.message.includes(connectorName)
      && error.message.includes('配置并启用个人连接器'))
  } finally { await rm(mounted.root, { recursive: true, force: true }) }
})

for (const [kind, generationError, connectorCode, connectorName, args] of [
  ['tts', Object.assign(new Error('VOICE_NOT_AVAILABLE'), { code: 'TTS_VOICE_NOT_AVAILABLE' }), 'speech-generation-model', '语音模型', { text: '你好' }],
  ['image', new Error('IMAGE_MODEL_CONFIG_REQUIRED'), 'image-generation-model', '文生图模型', { prompt: '一只猫' }],
]) test(`${kind} asks the user to repair an active connector when its configuration fails`, async () => {
  const mounted = await mountedTool(kind, {
    resolveMediaModel: async () => ({ id: 'connector:1', source: 'user-connector', connectorCode, provider: 'TEST', model: 'test', timeoutMs: 1000 }),
    generate: async () => { throw generationError },
  })
  try {
    await assert.rejects(mounted.tool.execute(args), error => error.code === 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED'
      && error.connectorCode === connectorCode
      && error.source === 'user-connector'
      && error.message.includes(connectorName)
      && error.message.includes('检查并重新保存'))
  } finally { await rm(mounted.root, { recursive: true, force: true }) }
})

test('input errors do not incorrectly ask the user to change a connector', async () => {
  const mounted = await mountedTool('image', {
    resolveMediaModel: async () => ({ id: 'system:1', source: 'system-default', provider: 'TEST', model: 'test', timeoutMs: 1000 }),
    generate: async () => { throw new Error('IMAGE_INVALID_SIZE') },
  })
  try {
    await assert.rejects(mounted.tool.execute({ prompt: '一只猫' }), error => error.message === 'IMAGE_INVALID_SIZE'
      && error.code !== 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED')
  } finally { await rm(mounted.root, { recursive: true, force: true }) }
})

test('a resolved but unusable system model asks the user to configure a personal connector', async () => {
  const mounted = await mountedTool('tts', {
    resolveMediaModel: async () => ({ id: 'system:1', source: 'system-default', provider: 'VOLCENGINE', model: 'test', timeoutMs: 1000 }),
    generate: async () => { throw Object.assign(new Error('Volcengine speech generation failed'), { code: 'TTS_ERROR' }) },
  })
  try {
    await assert.rejects(mounted.tool.execute({ text: '你好' }), error => error.code === 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED'
      && error.source === 'system-default'
      && error.connectorCode === 'speech-generation-model'
      && error.reason === 'TTS_ERROR'
      && error.message.includes('配置并启用个人连接器'))
  } finally { await rm(mounted.root, { recursive: true, force: true }) }
})
