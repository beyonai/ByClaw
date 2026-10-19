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
    assert.match(tool.description, /配置连接器.*不要再次调用/u)
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
    assert.match(tool.description, /配置连接器.*不要再次调用/u)
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
      && error.message.includes('配置并启用个人连接器')
      && error.message.includes('不要再次调用当前工具'))
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
      && error.message.includes('检查并重新保存')
      && error.message.includes('不要再次调用当前工具'))
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
      && error.message.includes('配置并启用个人连接器')
      && error.message.includes('不要再次调用当前工具'))
  } finally { await rm(mounted.root, { recursive: true, force: true }) }
})

test('speech query uses live model binding without generation and survives repeated setup', async () => {
  let setup, generationCalls = 0;
  const registered = new Map();
  const ctx = { on: (_name, handler) => { setup = handler }, effect: fn => fn() };
  const agentCtx = { tools: { register: tool => { assert.ok(!registered.has(tool.name)); registered.set(tool.name, tool); return () => registered.delete(tool.name) } }, effect: fn => fn() };
  const host = { userCode: 'test', resolveSessionRoot: () => { throw new Error('query must not require files') },
    resolveMediaModel: async () => ({ provider: 'VOLCENGINE', model: 'seed-tts-2.0' }) };
  mountMediaPlugin(ctx, { kind: 'tts', generate: async () => { generationCalls++; }, describe: model => ({ provider: model.provider, model: model.model, voice: { supported: true, choices: [], restricted: false, note: 'test' }, speed: { supported: true, min: 0.5, max: 2, default: 1 } }) });
  const payload = { agentCtx, host, agent: { id: 'a1' }, command: { header: { userCode: 'test' } } };
  await setup(payload); await setup(payload);
  assert.equal(registered.size, 2);
  const query = registered.get('text_to_speech_options');
  assert.ok(query.description.length <= 250);
  assert.equal(query.parameters.additionalProperties, false);
  assert.equal((await query.execute({})).speed.max, 2);
  await setup({ ...payload, host: { ...host, resolveMediaModel: async () => ({ provider: 'OPENAI', model: 'tts-1' }) } });
  assert.equal((await query.execute({})).provider, 'OPENAI');
  await assert.rejects(query.execute({ apiKey: 'untrusted' }), /MEDIA_INVALID_ARGUMENT/);
  assert.equal(generationCalls, 0);
});

test('speech limitations render as normal tool feedback with no fabricated audio', async () => {
  const mounted = await mountedTool('tts', {
    resolveMediaModel: async () => ({ provider: 'VOLCENGINE', model: 'seed-tts-2.0', timeoutMs: 1000 }),
    generate: async () => ({ assets: [], warnings: [{ code: 'TTS_VOICE_NOT_AVAILABLE', parameter: 'voice', message: '音色不支持，请选择 v1。' }] }),
  });
  try {
    const result = await mounted.tool.execute({ text: '你好', voice: 'bad' });
    assert.equal(result.status, 'unsupported');
    assert.deepEqual(result.artifacts, []);
    assert.equal(result.warnings[0].code, 'TTS_VOICE_NOT_AVAILABLE');
    assert.doesNotMatch(JSON.stringify(mounted.tool.output.render({}, result)), /MEDIA_CONNECTOR_CONFIGURATION_REQUIRED/);
  } finally { await rm(mounted.root, { recursive: true, force: true }); }
});

test('positive speeds reach the adapter while malformed and nonpositive speeds remain invalid', async () => {
  const speeds = [];
  const mounted = await mountedTool('tts', {
    resolveMediaModel: async () => ({ provider: 'OPENAI', model: 'tts-1', timeoutMs: 1000 }),
    generate: async (_model, args) => { speeds.push(args.speed); return { assets: [], warnings: [{ code: 'TTS_SPEED_UNSUPPORTED', parameter: 'speed', message: 'unsupported speed' }] }; },
  });
  try {
    for (const speed of [0.1, 5]) await mounted.tool.execute({ text: 'Hi', speed });
    assert.deepEqual(speeds, [0.1, 5]);
    for (const speed of [0, -1, NaN, Infinity, '1.2']) await assert.rejects(mounted.tool.execute({ text: 'Hi', speed }), /MEDIA_INVALID_ARGUMENT: speed/);
  } finally { await rm(mounted.root, { recursive: true, force: true }); }
});

test('image tool resolves ordinary session-file references and returns durable lineage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-image-edit-'))
  let setup, tool, calls = 0
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')
  const ctx = { on: (_name, handler) => { setup = handler }, effect: fn => fn() }
  const agentCtx = { tools: { register: value => { tool = value; return () => {} } }, effect: fn => fn() }
  const host = { userCode: 'test', resolveSessionRoot: () => root,
    resolveMediaModel: async () => ({ provider: 'VOLCENGINE', model: 'seedream-5-0', timeoutMs: 1000 }) }
  try {
    mountMediaPlugin(ctx, { kind: 'image', generate: async (_model, args, context) => {
      if (args.referenceImage) assert.deepEqual(context.referenceImage.bytes, png)
      calls++; return [{ bytes: png, mimeType: 'image/png' }]
    } })
    const payload = { agentCtx, host, agent: { id: '100' }, command: { header: { userCode: 'test', sessionId: '100' } } }
    await setup(payload)
    const original = (await tool.execute({ prompt: 'whale' })).imageArtifacts[0]
    await setup({ ...payload, command: { ...payload.command, extraPayload: { resource_list: [{ resourceType: 'COMMON_FILE', resourceId: original.path, resourceName: original.id }] } } })
    await assert.rejects(tool.execute({ prompt: 'blue', referenceImage: original.path.replace('/100/', '/101/') }), /IMAGE_REFERENCE_INVALID/)
    await assert.rejects(tool.execute({ prompt: 'blue', referenceImage: '/by/.sessions/100/image/../first.png' }), /IMAGE_REFERENCE_INVALID/)
    assert.equal(calls, 1)
    const result = await tool.execute({ prompt: 'blue', referenceImage: original.path })
    assert.equal(result.imageArtifacts[0].parentId, original.id)
    assert.ok(result.imageArtifacts[0].path.startsWith('/by/.sessions/100/image/'))
    assert.equal(result.artifacts[0].path, result.imageArtifacts[0].path)
    const rendered = JSON.parse(tool.output.render({}, result)[0].text)
    assert.deepEqual(rendered.imageArtifacts, result.imageArtifacts)
    assert.equal(tool.output.schema.properties.imageArtifacts.type, 'array')
  } finally { await rm(root, { recursive: true, force: true }) }
})
