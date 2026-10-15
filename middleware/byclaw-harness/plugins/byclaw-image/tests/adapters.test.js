import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { generateImage, imageProviders } from '../src/adapters.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='
const image = { b64_json: png }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const model = (provider, extra = {}) => ({ provider, protocol: `${provider}_IMAGE`, model: 'image-model', endpoint: 'https://vendor.test/v1', apiKey: 'test-secret', ...extra })
const prompt = { prompt: 'a red kite' }
const fixtures = [
  ['OPENAI', {}, { size: '1024x1024', count: 2 }, '/v1/images/generations', { model: 'image-model', prompt: 'a red kite', n: 2, size: '1024x1024' }, { data: [image] }],
  ['DEEPINFRA', { endpoint: 'https://vendor.test/v1/openai' }, { size: '1024x1024' }, '/v1/openai/images/generations', { model: 'image-model', prompt: 'a red kite', n: 1, size: '1024x1024', response_format: 'b64_json' }, { data: [image] }],
  ['LITELLM', {}, {}, '/v1/images/generations', { model: 'image-model', prompt: 'a red kite', n: 1 }, { data: [image] }],
  ['MICROSOFT_FOUNDRY', { endpoint: 'https://vendor.test', options: { deployment: 'image-deployment', apiVersion: '2025-04-01-preview' } }, {}, '/openai/deployments/image-deployment/images/generations?api-version=2025-04-01-preview', { prompt: 'a red kite', n: 1 }, { data: [image] }],
  ['OPENROUTER', {}, { aspectRatio: '16:9', size: '2K' }, '/v1/images', { model: 'image-model', prompt: 'a red kite', n: 1, aspect_ratio: '16:9', size: '2K' }, { data: [{ ...image, media_type: 'image/png' }] }],
  ['XAI', {}, { size: '2K', aspectRatio: '16:9' }, '/v1/images/generations', { model: 'image-model', prompt: 'a red kite', n: 1, response_format: 'b64_json', resolution: '2k', aspect_ratio: '16:9' }, { data: [image] }],
  ['VOLCENGINE', { endpoint: 'https://vendor.test/api/v3/images/generations', model: 'doubao-seedream-5-0-flash-260915' }, { size: '2K' }, '/api/v3/images/generations', { model: 'doubao-seedream-5-0-flash-260915', prompt: 'a red kite', response_format: 'b64_json', size: '2K', stream: false }, { data: [image] }],
  ['MINIMAX', { endpoint: 'https://vendor.test/v1/image_generation' }, { aspectRatio: '16:9' }, '/v1/image_generation', { model: 'image-model', prompt: 'a red kite', n: 1, response_format: 'base64', aspect_ratio: '16:9' }, { base_resp: { status_code: 0 }, data: { image_base64: [png] } }],
  ['FAL', { endpoint: 'https://vendor.test', model: 'fal-ai/flux/dev' }, { size: '1280x720', count: 2 }, '/fal-ai/flux/dev', { prompt: 'a red kite', num_images: 2, image_size: { width: 1280, height: 720 } }, { images: [{ url: `data:image/png;base64,${png}`, content_type: 'image/png' }] }],
  ['GOOGLE', { model: 'gemini-image' }, { size: '2K', aspectRatio: '16:9' }, '/v1/models/gemini-image:generateContent', { contents: [{ role: 'user', parts: [{ text: 'a red kite' }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '2K', aspectRatio: '16:9' } } }, { candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: 'image/png' } }] }, finishReason: 'STOP' }] }],
]

for (const [provider, config, args, path, body, response] of fixtures) {
  test(`${provider} emits documented endpoint, authentication and fields and decodes bytes`, async () => {
    let calls = 0
    const result = await generateImage(model(provider, config), { ...prompt, ...args }, { fetch: async (url, init) => {
      calls++
      assert.equal(String(url), `https://vendor.test${path}`)
      assert.equal(init.method, 'POST')
      assert.deepEqual(JSON.parse(init.body), body)
      const headers = new Headers(init.headers)
      const authKey = provider === 'GOOGLE' ? 'x-goog-api-key' : provider === 'MICROSOFT_FOUNDRY' ? 'api-key' : 'authorization'
      const auth = provider === 'GOOGLE' || provider === 'MICROSOFT_FOUNDRY' ? 'test-secret' : provider === 'FAL' ? 'Key test-secret' : 'Bearer test-secret'
      assert.equal(headers.get(authKey), auth)
      return json(response)
    } })
    assert.equal(calls, 1)
    assert.equal(result[0].mimeType, 'image/png')
    assert.deepEqual(Buffer.from(result[0].bytes), Buffer.from(png, 'base64'))
  })
}

test('Vydra submits one job, polls its id, and downloads without credentials', async () => {
  let calls = 0
  const result = await generateImage(model('VYDRA', { options: { pollIntervalMs: 1 } }), { ...prompt, aspectRatio: '16:9' }, { fetch: async (url, init) => {
    calls++
    if (calls === 1) {
      assert.equal(String(url), 'https://vendor.test/v1/jobs')
      assert.deepEqual(JSON.parse(init.body), { workflow: 'generate_image', input: { model: 'image-model', prompt: 'a red kite', aspect_ratio: '16:9' } })
      return json({ id: 'job-1', status: 'running', _links: { self: 'https://evil.test/steal' } })
    }
    if (calls === 2) {
      assert.equal(String(url), 'https://vendor.test/v1/jobs/job-1')
      return json({ id: 'job-1', status: 'completed', output: { imageUrl: 'https://cdn.test/image.png' } })
    }
    assert.equal(String(url), 'https://cdn.test/image.png')
    assert.equal(new Headers(init.headers).get('authorization'), null)
    return new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/png' } })
  } })
  assert.equal(calls, 3)
  assert.equal(result[0].bytes.length, Buffer.from(png, 'base64').length)
})

const comfy = { protocol: 'COMFY_IMAGE', options: { workflow: { '6': { class_type: 'CLIPTextEncode', inputs: { text: 'original' } }, '9': { class_type: 'SaveImage', inputs: {} } }, promptNode: '6', outputNodes: ['9'], pollIntervalMs: 1 } }
test('ComfyUI updates only configured prompt, waits for successful history and retrieves selected outputs', async () => {
  let calls = 0
  const config = model('COMFYUI', comfy)
  const result = await generateImage(config, prompt, { fetch: async (url, init) => {
    calls++
    if (calls === 1) {
      assert.equal(String(url), 'https://vendor.test/v1/prompt')
      assert.equal(JSON.parse(init.body).prompt['6'].inputs.text, 'a red kite')
      return json({ prompt_id: 'prompt-1', number: 1, node_errors: {} })
    }
    if (calls === 2) return json({})
    if (calls === 3) {
      assert.equal(String(url), 'https://vendor.test/v1/history/prompt-1')
      return json({ 'prompt-1': { status: { completed: true, status_str: 'success' }, outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] }, '10': { images: [{ filename: 'ignore.png' }] } } } })
    }
    assert.equal(String(url), 'https://vendor.test/v1/view?filename=out.png&subfolder=&type=output')
    return new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/png' } })
  } })
  assert.equal(calls, 4)
  assert.equal(result.length, 1)
  assert.equal(config.options.workflow['6'].inputs.text, 'original')
})

test('registry covers frontend providers without counting aliases as new providers', async () => {
  const source = await readFile(new URL('../../../../../byclaw-fe/src/pages/manager/pages/ModelMgr/components/imageGenerationProviders.ts', import.meta.url), 'utf8')
  const names = [...source.matchAll(/providerName: '([^']+)'/g)].map((match) => match[1])
  assert.equal(names.length, 12)
  for (const name of names) assert.ok(imageProviders[name], name)
})

for (const [alias, provider] of [['CHATGPT', 'OPENAI'], ['GEMINI', 'GOOGLE'], ['COMFY', 'COMFYUI'], ['DOUBAO', 'VOLCENGINE'], ['ARK', 'VOLCENGINE']]) {
  test(`${alias} resolves to ${provider}`, async () => {
    const fixture = fixtures.find((entry) => entry[0] === provider)
    const extra = fixture?.[1] ?? comfy
    let calls = 0
    await assert.rejects(generateImage(model(alias, { ...extra, protocol: provider === 'COMFYUI' ? 'COMFY_IMAGE' : `${provider}_IMAGE` }), prompt, { fetch: async () => { calls++; return json({ error: 'rejected' }, 400) } }))
    assert.equal(calls, 1)
  })
}

test('Qwen saved OpenAI image protocol remains an explicit compatibility route', async () => {
  const result = await generateImage(model('Qwen', { protocol: 'OPENAI_IMAGE', endpoint: 'https://vendor.test/compatible-mode/v1' }), prompt, { fetch: async (url, init) => {
    assert.equal(String(url), 'https://vendor.test/compatible-mode/v1/images/generations')
    assert.equal(JSON.parse(init.body).model, 'image-model')
    return json({ data: [image] })
  } })
  assert.equal(result.length, 1)
})

test('Qwen native multimodal image API maps input and parses image outputs', async () => {
  const result = await generateImage(model('QWEN', { protocol: 'QWEN_IMAGE', endpoint: 'https://vendor.test/api/v1' }), { ...prompt, size: '1024x1024' }, { fetch: async (url, init) => {
    assert.equal(String(url), 'https://vendor.test/api/v1/services/aigc/multimodal-generation/generation')
    assert.deepEqual(JSON.parse(init.body), { model: 'image-model', input: { messages: [{ role: 'user', content: [{ text: 'a red kite' }] }] }, parameters: { n: 1, size: '1024*1024' } })
    return json({ output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${png}` }] } }] } })
  } })
  assert.equal(result.length, 1)
})

for (const [provider, config] of [...fixtures, ['VYDRA', {}], ['COMFYUI', comfy], ['QWEN', {}]]) {
  test(`${provider} rejects upstream errors without leaking the body or retrying generation`, async () => {
    let calls = 0
    await assert.rejects(generateImage(model(provider, config), prompt, { fetch: async () => { calls++; return json({ error: 'test-secret' }, 401) } }), (error) => !error.message.includes('test-secret'))
    assert.equal(calls, 1)
  })
}

test('unknown or conflicting provider/protocol and unsupported arguments reject before network', async () => {
  for (const [config, args] of [
    [model('UNKNOWN'), prompt], [model('OPENAI', { protocol: 'FAL_IMAGE' }), prompt],
    [model('OPENAI'), { prompt: ' ' }], [model('OPENAI'), { ...prompt, count: 0 }],
    [model('GOOGLE'), { ...prompt, count: 2 }], [model('VYDRA'), { ...prompt, count: 2 }],
    [model('COMFYUI', { protocol: 'COMFY_IMAGE' }), prompt], [model('OPENAI'), { ...prompt, endpoint: 'https://evil.test' }],
    [model('VOLCENGINE'), { ...prompt, count: 2 }], [model('OPENAI'), { ...prompt, aspectRatio: '16:9' }],
  ]) await assert.rejects(generateImage(config, args, { fetch: () => { assert.fail('unexpected request') } }))
})

for (const response of [{ data: [] }, { data: [{ b64_json: '!!!!' }] }, { data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }, { error: { message: 'test-secret' } }]) {
  test(`rejects malformed or empty image payload ${JSON.stringify(response).slice(0, 45)}`, async () => {
    await assert.rejects(generateImage(model('OPENAI'), prompt, { fetch: async () => json(response) }))
  })
}

for (const provider of ['VYDRA', 'COMFYUI']) {
  test(`${provider} stops polling on terminal failure`, async () => {
    let calls = 0
    await assert.rejects(generateImage(model(provider, provider === 'COMFYUI' ? comfy : { options: { pollIntervalMs: 1 } }), prompt, { fetch: async () => {
      calls++
      if (provider === 'VYDRA') return json(calls === 1 ? { id: 'j', status: 'running' } : { id: 'j', status: 'failed', error: 'test-secret' })
      return json(calls === 1 ? { prompt_id: 'p' } : { p: { status: { status_str: 'error', completed: false }, outputs: {} } })
    } }), /failed/i)
    assert.equal(calls, 2)
  })

  test(`${provider} propagates abort while polling without resubmission`, async () => {
    const controller = new AbortController()
    let calls = 0
    await assert.rejects(generateImage(model(provider, provider === 'COMFYUI' ? comfy : { options: { pollIntervalMs: 1 } }), prompt, { signal: controller.signal, fetch: async () => {
      calls++
      controller.abort()
      return json(provider === 'VYDRA' ? { id: 'j', status: 'running' } : { prompt_id: 'p' })
    } }), /abort/i)
    assert.equal(calls, 1)
  })
}

test('pre-aborted requests never reach a provider', async () => {
  await assert.rejects(generateImage(model('OPENAI'), prompt, { signal: AbortSignal.abort(), fetch: () => assert.fail('unexpected request') }), /abort/i)
})

test('Vydra accepts completion from the last permitted poll', async () => {
  let calls = 0
  const assets = await generateImage(model('VYDRA', { options: { pollIntervalMs: 1, maxPollAttempts: 1 } }), prompt, { fetch: async () => {
    calls++
    return json(calls === 1 ? { id: 'j', status: 'running' } : { id: 'j', status: 'completed', output: { imageUrl: `data:image/png;base64,${png}` } })
  } })
  assert.equal(assets.length, 1)
  assert.equal(calls, 2)
})

test('Vydra polling is bounded even without an external signal', async () => {
  let calls = 0
  await assert.rejects(generateImage(model('VYDRA', { options: { pollIntervalMs: 1, maxPollAttempts: 2 } }), prompt, { fetch: async () => { calls++; return json({ id: 'j', status: 'running' }) } }), /POLL_LIMIT/)
  assert.equal(calls, 3)
})

test('provider timeout aborts an in-flight request', async () => {
  await assert.rejects(generateImage(model('OPENAI', { timeoutMs: 5 }), prompt, { fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('did not abort')), 100)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  }) }), /timeout/i)
})

test('complete image containers are required, not just image signatures', async () => {
  for (const bytes of [Buffer.from(png, 'base64').subarray(0, 30), Buffer.from([255, 216, 255, 1, 2]), Buffer.from('RIFFxxxxWEBP')]) {
    await assert.rejects(generateImage(model('OPENAI'), prompt, { fetch: async () => json({ data: [{ b64_json: bytes.toString('base64') }] }) }), /INVALID_MEDIA/)
  }
})

test('invalid size and zero aspect ratio fail before billing', async () => {
  for (const [provider, args] of [['OPENAI', { size: 'invalid' }], ['OPENAI', { size: '0x0' }], ['GOOGLE', { aspectRatio: '0:1' }]]) {
    await assert.rejects(generateImage(model(provider), { ...prompt, ...args }, { fetch: () => assert.fail('unexpected request') }), /INVALID_(SIZE|ASPECT_RATIO)/)
  }
})

test('Azure complete deployment URL preserves its query and uses configured Entra auth', async () => {
  await generateImage(model('MICROSOFT_FOUNDRY', { endpoint: 'https://vendor.test/openai/deployments/image/images/generations?api-version=2025-04-01-preview', options: { authType: 'bearer' } }), prompt, { fetch: async (url, init) => {
    assert.equal(String(url), 'https://vendor.test/openai/deployments/image/images/generations?api-version=2025-04-01-preview')
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-secret')
    assert.equal(JSON.parse(init.body).model, undefined)
    return json({ data: [image] })
  } })
})

test('MiniMax nonzero base_resp and Google safety termination are not successful output', async () => {
  await assert.rejects(generateImage(model('MINIMAX'), prompt, { fetch: async () => json({ base_resp: { status_code: 1008, status_msg: 'test-secret' }, data: { image_base64: [png] } }) }), /PROVIDER_FAILED/)
  await assert.rejects(generateImage(model('GOOGLE'), prompt, { fetch: async () => json({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ inlineData: { data: png, mimeType: 'image/png' } }] } }] }) }), /INCOMPLETE/)
})

test('JPEG and WebP signatures with no image frame are rejected', async () => {
  const webp = Buffer.alloc(24)
  webp.write('RIFF')
  webp.writeUInt32LE(16, 4)
  webp.write('WEBP', 8)
  for (const bytes of [Buffer.from([255, 216, 255, 1, 2, 255, 217]), webp]) {
    await assert.rejects(generateImage(model('OPENAI'), prompt, { fetch: async () => json({ data: [{ b64_json: bytes.toString('base64') }] }) }), /INVALID_MEDIA/)
  }
})

for (const [file, mime] of [['red.jpg', 'image/jpeg'], ['red.webp', 'image/webp']]) {
  test(`preserves complete ${mime} bytes and identifies format independently of a default MIME`, async () => {
    const bytes = await readFile(new URL(`fixtures/${file}`, import.meta.url))
    const assets = await generateImage(model('OPENAI'), prompt, { fetch: async () => json({ data: [{ b64_json: bytes.toString('base64') }] }) })
    assert.equal(assets[0].mimeType, mime)
    assert.deepEqual(Buffer.from(assets[0].bytes), bytes)
  })
}

for (const [provider, config, expected] of [
  ['OPENAI', { size: '1536x1024', count: 2 }, { size: '1536x1024', n: 2 }],
  ['DEEPINFRA', { size: '1024x1024', count: 2 }, { size: '1024x1024', n: 2 }],
  ['LITELLM', { size: '1024x1024', count: 2 }, { size: '1024x1024', n: 2 }],
  ['OPENROUTER', { size: '2K', aspectRatio: '16:9', count: 2 }, { size: '2K', aspect_ratio: '16:9', n: 2 }],
  ['XAI', { size: '2K', aspectRatio: '16:9', count: 2 }, { resolution: '2k', aspect_ratio: '16:9', n: 2 }],
  ['VOLCENGINE', { size: '4K', count: 1 }, { size: '4K' }],
]) {
  test(`${provider} applies configured dimensions and count when omitted`, async () => {
    await generateImage(model(provider, { options: config }), prompt, { fetch: async (_url, init) => {
      const body = JSON.parse(init.body)
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value)
      return json({ data: [image] })
    } })
  })
}

test('configured defaults map through native Google, MiniMax, fal, Qwen and Vydra protocols', async () => {
  for (const [provider, options, args, expected, result] of [
    ['GOOGLE', { size: '2K', aspectRatio: '16:9' }, {}, { generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '2K', aspectRatio: '16:9' } } }, { candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: 'image/png' } }] } }] }],
    ['MINIMAX', { size: '1024x768', count: 2 }, {}, { width: 1024, height: 768, n: 2 }, { base_resp: { status_code: 0 }, data: { image_base64: [png] } }],
    ['FAL', { size: '1024x768', count: 2 }, {}, { image_size: { width: 1024, height: 768 }, num_images: 2 }, { images: [{ url: `data:image/png;base64,${png}` }] }],
    ['QWEN', { size: '1024x768', count: 2 }, {}, { parameters: { size: '1024*768', n: 2 } }, { output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${png}` }] } }] } }],
    ['VYDRA', { size: '2K', aspectRatio: '16:9' }, {}, { input: { model: 'image-model', prompt: 'a red kite', resolution: '2K', aspect_ratio: '16:9' } }, { id: 'j', status: 'completed', output: { imageUrl: `data:image/png;base64,${png}` } }],
  ]) {
    await generateImage(model(provider, { options, ...(provider === 'FAL' ? { model: 'fal-ai/flux/dev' } : {}) }), { ...prompt, ...args }, { fetch: async (_url, init) => {
      const body = JSON.parse(init.body)
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value)
      return json(result)
    } })
  }
})

test('explicit args override configured defaults without options overriding prompt, model or credentials', async () => {
  await generateImage(model('OPENAI', { options: { size: '1024x1024', count: 2, prompt: 'malicious prompt', model: 'other-model', endpoint: 'https://evil.test', apiKey: 'other-secret' } }), { ...prompt, size: '1536x1024', count: 1 }, { fetch: async (url, init) => {
    assert.equal(String(url), 'https://vendor.test/v1/images/generations')
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-secret')
    assert.deepEqual(JSON.parse(init.body), { model: 'image-model', prompt: 'a red kite', n: 1, size: '1536x1024' })
    return json({ data: [image] })
  } })
})

test('Seedream 5 Flash uses documented 2K default without configured options', async () => {
  await generateImage(model('VOLCENGINE', { model: 'doubao-seedream-5-0-flash-260915' }), prompt, { fetch: async (_url, init) => {
    assert.equal(JSON.parse(init.body).size, '2K')
    return json({ data: [image] })
  } })
})

test('unsupported or malformed configured defaults reject before generation', async () => {
  for (const [provider, options] of [['GOOGLE', { count: 2 }], ['OPENAI', { size: 'invalid' }], ['MINIMAX', { count: 0 }], ['COMFYUI', { ...comfy.options, size: '1024x1024' }]]) {
    let calls = 0
    await assert.rejects(generateImage(model(provider, { options, ...(provider === 'COMFYUI' ? { protocol: 'COMFY_IMAGE' } : {}) }), prompt, { fetch: async () => { calls++; return json({ data: [image] }) } }))
    assert.equal(calls, 0)
  }
})

test('public boundary removes URL parse input and abort reasons from errors', async () => {
  for (const config of [model('OPENAI', { endpoint: 'not-a-url-test-secret' }), model('OPENAI', { headers: { 'bad\nheader': 'test-secret' } })]) {
    await assert.rejects(generateImage(config, prompt), (error) => {
      assert.equal(error.message.includes('test-secret'), false)
      assert.equal(JSON.stringify(error).includes('test-secret'), false)
      assert.equal(error.cause, undefined)
      return true
    })
  }
  await assert.rejects(generateImage(model('OPENAI'), prompt, { signal: AbortSignal.abort(new Error('test-secret')) }), (error) => error.name === 'AbortError' && !error.message.includes('test-secret'))
})

test('frontend Qwen protocol selects native multimodal image route', async () => {
  await generateImage(model('Qwen', { protocol: 'Qwen', endpoint: 'https://vendor.test/api/v1' }), prompt, { fetch: async (url, init) => {
    assert.equal(String(url), 'https://vendor.test/api/v1/services/aigc/multimodal-generation/generation')
    assert.deepEqual(JSON.parse(init.body).input.messages, [{ role: 'user', content: [{ text: 'a red kite' }] }])
    return json({ output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${png}` }] } }] } })
  } })
})
