import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSpeech, providerRegistry } from '../src/adapters.js';

const wav = Buffer.alloc(48);
wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
const mp3 = Buffer.alloc(417); mp3.set([0xff, 0xfb, 0x90, 0x00]);
const model = (provider, extra = {}) => ({ provider, model: 'tts-model', apiKey: 'test-key', options: { voice: 'test-voice' }, ...extra });
const binary = (bytes = wav) => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function capture(response) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url: String(url), ...init, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined }); return response(); } };
}
function volcResponse(frames, sse = false) {
  const text = frames.map((frame) => `${sse ? 'data: ' : ''}${JSON.stringify(frame)}\n${sse ? '\n' : ''}`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } }), { headers: { 'content-type': sse ? 'text/event-stream' : 'application/json' } });
}
const volc = (extra = {}) => model('VOLCENGINE', { model: 'doubao-seed-tts-2.0', options: { speaker: 'zh_female_vv_uranus_bigtts' }, ...extra });
const done = { code: 20000000, message: 'ok', data: null };
const chunk = { code: 0, message: '', data: mp3.toString('base64') };

test('registry accounts for every frontend speech provider without generic fallback', () => {
  for (const name of ['OPENAI', 'QWEN', 'OPENROUTER', 'TOGETHER', 'ZAI', 'MINIMAX', 'VOLCENGINE']) assert.equal(typeof providerRegistry[name], 'function');
});
for (const provider of ['ANTHROPIC', 'DEEPSEEK', 'APK', 'UNKNOWN']) test(`${provider} rejects speech before HTTP`, async () => {
  let calls = 0;
  await assert.rejects(generateSpeech(model(provider), { text: 'Hello' }, { fetch: async () => { calls++; } }), /unsupported.*speech|speech.*unsupported/i);
  assert.equal(calls, 0);
});
for (const [provider, name, url, format, voice] of [
  ['OPENAI', 'gpt-4o-mini-tts', 'https://api.openai.com/v1/audio/speech', 'wav', 'alloy'],
  ['OPENROUTER', 'openai/gpt-4o-mini-tts', 'https://openrouter.ai/api/v1/audio/speech', 'mp3', 'alloy'],
  ['TOGETHER', 'hexgrad/Kokoro-82M', 'https://api.together.ai/v1/audio/speech', 'wav', 'af_heart'],
  ['ZAI', 'glm-tts', 'https://open.bigmodel.cn/api/paas/v4/audio/speech', 'wav', 'tongtong'],
]) test(`${provider} sends documented audio/speech body and decodes binary`, async () => {
  const transport = capture(() => binary(format === 'mp3' ? mp3 : wav));
  const result = await generateSpeech(model(provider, { model: name, protocol: 'OpenAI' }), { text: 'Hello', voice, format }, transport);
  assert.equal(transport.calls[0].url, url);
  assert.equal(transport.calls[0].headers.get('authorization'), 'Bearer test-key');
  assert.deepEqual(transport.calls[0].body, { model: name, input: 'Hello', voice, response_format: format, ...(provider === 'TOGETHER' || provider === 'ZAI' ? { stream: false } : {}) });
  assert.deepEqual(result[0].bytes, format === 'mp3' ? mp3 : wav);
  assert.equal(result[0].mimeType, format === 'mp3' ? 'audio/mpeg' : 'audio/wav');
});
test('configured full endpoint is not appended twice', async () => {
  const t = capture(binary);
  await generateSpeech(model('OPENAI', { endpoint: 'https://gateway.example/v1/audio/speech' }), { text: 'Hi', format: 'wav' }, t);
  assert.equal(t.calls[0].url, 'https://gateway.example/v1/audio/speech');
});
test('Qwen uses native multimodal speech contract and strips credentials on download', async () => {
  const calls = [];
  const result = await generateSpeech(model('QWEN', { model: 'qwen3-tts-flash', protocol: 'Qwen', options: { voice: 'Cherry', languageType: 'Chinese' } }), { text: '你好' }, {
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return calls.length === 1 ? json({ output: { finish_reason: 'stop', audio: { data: '', url: 'https://media.example/speech.wav' } } }) : binary(); },
  });
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'qwen3-tts-flash', input: { text: '你好', voice: 'Cherry', language_type: 'Chinese' } });
  assert.equal(new Headers(calls[1].init.headers).get('authorization'), null);
  assert.equal(result[0].mimeType, 'audio/wav');
});
test('MiniMax uses native hex payload and requires completed status', async () => {
  const t = capture(() => json({ base_resp: { status_code: 0 }, data: { status: 2, audio: mp3.toString('hex') } }));
  const result = await generateSpeech(model('MINIMAX', { model: 'speech-2.8-hd', protocol: 'OpenAI' }), { text: 'Hi', speed: 1.2 }, t);
  assert.equal(t.calls[0].url, 'https://api.minimax.io/v1/t2a_v2');
  assert.deepEqual(t.calls[0].body, { model: 'speech-2.8-hd', text: 'Hi', stream: false, output_format: 'hex', voice_setting: { voice_id: 'test-voice', speed: 1.2 }, audio_setting: { format: 'mp3' } });
  assert.deepEqual(result[0].bytes, mp3);
});
for (const sse of [false, true]) test(`Volcengine ${sse ? 'SSE' : 'chunked JSON'} handles fragmented frames and exact Seed resource`, async () => {
  const t = capture(() => volcResponse([chunk, done], sse));
  const result = await generateSpeech(volc({ protocol: 'OpenAI' }), { text: '你好', speed: 1.2 }, t);
  assert.equal(t.calls[0].url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
  assert.equal(t.calls[0].headers.get('x-api-resource-id'), 'seed-tts-2.0');
  assert.equal(t.calls[0].headers.get('x-api-key'), 'test-key');
  assert.equal(t.calls[0].headers.get('authorization'), null);
  assert.match(t.calls[0].headers.get('x-api-request-id'), /^[a-f0-9-]{36}$/);
  assert.deepEqual(t.calls[0].body.req_params, { text: '你好', speaker: 'zh_female_vv_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: 20 } });
  assert.deepEqual(result[0].bytes, mp3);
});
test('Volcengine accepts legacy configured auth headers and clone version', async () => {
  const t = capture(() => volcResponse([chunk, done]));
  await generateSpeech(volc({ apiKey: '', headers: { 'X-Api-App-Id': '123', 'X-Api-Access-Key': 'legacy-key' }, options: { speaker: 'S_clone', resourceId: 'seed-icl-2.0', modelVersion: 'seed-tts-2.0-standard' } }), { text: 'Hi' }, t);
  assert.equal(t.calls[0].headers.get('x-api-app-id'), '123');
  assert.equal(t.calls[0].headers.get('x-api-access-key'), 'legacy-key');
  assert.equal(t.calls[0].headers.get('x-api-key'), null);
  assert.equal(t.calls[0].body.req_params.model, 'seed-tts-2.0-standard');
});
for (const frames of [[chunk], [chunk, { code: 55000000, message: 'test-key secret' }], [done], [{ code: 0, data: '!!!' }, done], [done, chunk]]) test('Volcengine rejects incomplete, failed, empty, malformed, or post-terminal audio', async () => {
  await assert.rejects(generateSpeech(volc(), { text: 'Hi' }, capture(() => volcResponse(frames))), /truncated|failed|empty|base64|terminal/i);
});
test('Volcengine missing voice rejects before HTTP', async () => {
  const t = capture(() => volcResponse([chunk, done]));
  await assert.rejects(generateSpeech(volc({ options: {} }), { text: 'Hi' }, t), /voice|speaker/);
  assert.equal(t.calls.length, 0);
});
for (const [provider, args, override] of [
  ['OPENAI', { text: '' }, {}], ['OPENAI', { text: 'Hi', apiKey: 'injected' }, {}],
  ['OPENAI', { text: 'Hi', speed: 0 }, {}], ['OPENROUTER', { text: 'Hi', format: 'wav' }, {}],
  ['TOGETHER', { text: 'Hi', speed: 1.2 }, {}], ['ZAI', { text: 'Hi', format: 'mp3' }, { model: 'glm-tts' }],
  ['QWEN', { text: 'Hi', speed: 1.2 }, { model: 'qwen3-tts-flash' }],
  ['QWEN', { text: 'Hi' }, { model: 'qwen3-tts-flash-realtime' }],
  ['OPENAI', { text: 'Hi' }, { protocol: 'VOLCENGINE_TTS' }],
]) test(`${provider} invalid parameters/protocol fail before HTTP`, async () => {
  const t = capture(binary);
  await assert.rejects(generateSpeech(model(provider, override), args, t));
  assert.equal(t.calls.length, 0);
});
test('malformed and truncated binary audio cannot become artifacts', async () => {
  for (const bytes of [Buffer.from('not audio'), wav.subarray(0, 44)]) await assert.rejects(generateSpeech(model('OPENAI'), { text: 'Hi', format: 'wav' }, capture(() => binary(bytes))), /audio|truncated/i);
});
test('provider error body and transport errors do not leak credentials', async () => {
  for (const fetch of [async () => new Response('test-key secret', { status: 401 }), async () => { throw new Error('test-key secret'); }]) {
    await assert.rejects(generateSpeech(model('OPENAI'), { text: 'Hi' }, { fetch }), (error) => !error.message.includes('test-key'));
  }
});
test('already aborted generation never sends HTTP', async () => {
  const controller = new AbortController(); controller.abort();
  const t = capture(binary);
  await assert.rejects(generateSpeech(model('OPENAI'), { text: 'Hi' }, { ...t, signal: controller.signal }), /abort/i);
  assert.equal(t.calls.length, 0);
});
test('aborting a stalled Volcengine body cancels reading promptly', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(chunk) + '\n')); }, cancel() { cancelled = true; } });
  const pending = generateSpeech(volc(), { text: 'Hi' }, { signal: controller.signal, fetch: async () => new Response(body) });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /abort/i);
  assert.equal(cancelled, true);
});

test('Qwen known signed HTTP OSS result is fetched over HTTPS without auth', async () => {
  const urls = [];
  await generateSpeech(model('QWEN', { model: 'qwen3-tts-flash' }), { text: 'Hi' }, {
    fetch: async (url) => { urls.push(String(url)); return urls.length === 1 ? json({ output: { finish_reason: 'stop', audio: { url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=test' } } }) : binary(); },
  });
  assert.equal(urls[1], 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=test');
});
test('Qwen failures and nonterminal responses never download audio', async () => {
  for (const payload of [{ code: 'InvalidApiKey', message: 'test-key' }, { output: { finish_reason: null, audio: { url: 'https://media.example/a.wav' } } }]) {
    const t = capture(() => json(payload));
    await assert.rejects(generateSpeech(model('QWEN', { model: 'qwen3-tts-flash' }), { text: 'Hi' }, t), /failed|incomplete/);
    assert.equal(t.calls.length, 1);
  }
});
test('MiniMax failure, incomplete status and invalid hex are rejected', async () => {
  for (const payload of [
    { base_resp: { status_code: 1004, status_msg: 'test-key' }, data: null },
    { base_resp: { status_code: 0 }, data: { status: 1, audio: mp3.toString('hex') } },
    { base_resp: { status_code: 0 }, data: { status: 2, audio: '123z' } },
  ]) await assert.rejects(generateSpeech(model('MINIMAX', { model: 'speech-2.8-hd' }), { text: 'Hi' }, capture(() => json(payload))), /failed|incomplete|malformed/);
});
test('Volcengine protocol errors never leak provider message and invalid configuration is local', async () => {
  await assert.rejects(generateSpeech(volc(), { text: 'Hi' }, capture(() => volcResponse([{ code: 55000000, message: 'test-key' }]))), (e) => !e.message.includes('test-key'));
  for (const options of [
    { speaker: 'voice', resourceId: 'seed-tts-1.0' },
    { speaker: 'voice', sampleRate: 12345 },
    { speaker: 'voice', accessKey: 'secret' },
  ]) {
    const t = capture(binary);
    await assert.rejects(generateSpeech(volc({ options }), { text: 'Hi' }, t));
    assert.equal(t.calls.length, 0);
  }
});
test('Volcengine rejects truncated JSON even after a complete audio frame', async () => {
  await assert.rejects(generateSpeech(volc(), { text: 'Hi' }, capture(() => new Response(JSON.stringify(chunk) + '{"code":2000'))), /truncated/i);
});
test('Volcengine configured SSE URL and legacy options preserve authentication mode', async () => {
  const t = capture(() => volcResponse([chunk, done], true));
  await generateSpeech(volc({ endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', options: { speaker: 'zh_female_vv_uranus_bigtts', appId: '123' } }), { text: 'Hi' }, t);
  assert.equal(t.calls[0].url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');
  assert.equal(t.calls[0].headers.get('x-api-app-id'), '123');
  assert.equal(t.calls[0].headers.get('x-api-access-key'), 'test-key');
  assert.equal(t.calls[0].headers.get('x-api-key'), null);
});
test('Volcengine response length cap stops before parsing or accumulating the body', async () => {
  await assert.rejects(generateSpeech(volc(), { text: 'Hi' }, capture(() => new Response('{}', { headers: { 'content-length': '104857601' } }))), /oversized/i);
});

test('timeout signal interrupts a stalled Volcengine stream', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(generateSpeech(volc(), { text: 'Hi' }, { signal: AbortSignal.timeout(10), fetch: async () => new Response(new ReadableStream()) }), /abort/i);
  } finally { clearTimeout(keepAlive); }
});
test('MP3 frame truncation and forged WAV length are rejected', async () => {
  const forged = Buffer.from(wav); forged.writeUInt32LE(100, 40);
  for (const [bytes, format] of [[mp3.subarray(0, 100), 'mp3'], [forged, 'wav']]) await assert.rejects(generateSpeech(model('OPENAI'), { text: 'Hi', format }, capture(() => binary(bytes))), /truncated|malformed/i);
});
test('provider aliases preserve Volcengine and OpenAI protocols', async () => {
  for (const alias of ['DOUBAO', 'ARK']) {
    const t = capture(() => volcResponse([chunk, done]));
    await generateSpeech({ ...volc(), provider: alias }, { text: 'Hi' }, t);
    assert.equal(t.calls[0].headers.get('x-api-resource-id'), 'seed-tts-2.0');
  }
  const t = capture(binary);
  await generateSpeech(model('CHATGPT'), { text: 'Hi', format: 'wav' }, t);
  assert.equal(t.calls[0].url, 'https://api.openai.com/v1/audio/speech');
});
test('JSON error content cannot be accepted as raw PCM audio', async () => {
  await assert.rejects(generateSpeech(model('OPENAI'), { text: 'Hi', format: 'pcm' }, capture(() => json({ error: 'failed' }))), /non-audio/i);
});

test('rejects truncated AAC/Opus containers and unavailable FLAC validation', async () => {
  const aac = Buffer.from([255, 241, 80, 128, 1, 63, 252, 0]); // declares nine bytes, contains eight
  const opus = Buffer.alloc(50); opus.write('OggS'); opus.write('OpusHead', 28);
  const flac = Buffer.alloc(50); flac.write('fLaC');
  for (const [bytes, format] of [[aac, 'aac'], [opus, 'opus'], [flac, 'flac']]) {
    await assert.rejects(generateSpeech(model('OPENAI'), { text: 'Hi', format }, capture(() => binary(bytes))), /truncated|malformed|unsupported/i);
  }
});
test('complete ADTS frame retains AAC media type', async () => {
  const aac = Buffer.from([255, 241, 80, 128, 1, 63, 252, 0, 0]);
  const result = await generateSpeech(model('OPENAI'), { text: 'Hi', format: 'aac' }, capture(() => binary(aac)));
  assert.equal(result[0].mimeType, 'audio/aac');
});
test('PCM output is wrapped as playable WAV with provider sample metadata', async () => {
  const result = await generateSpeech(model('OPENAI'), { text: 'Hi', format: 'pcm' }, capture(() => binary(Buffer.alloc(16))));
  const b = Buffer.from(result[0].bytes);
  assert.equal(result[0].mimeType, 'audio/wav');
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.readUInt32LE(24), 24000);
  assert.equal(b.readUInt16LE(22), 1);
  assert.equal(b.readUInt16LE(34), 16);
  assert.equal(b.readUInt32LE(40), 16);
});
test('MiniMax PCM wrapping uses selected sample rate and channels', async () => {
  const t = capture(() => json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '0000000000000000' } }));
  const result = await generateSpeech(model('MINIMAX', { model: 'speech-2.8-hd', options: { voice: 'voice', sampleRate: 16000, channel: 2 } }), { text: 'Hi', format: 'pcm' }, t);
  assert.equal(result[0].mimeType, 'audio/wav');
  assert.equal(result[0].bytes.readUInt32LE(24), 16000);
  assert.equal(result[0].bytes.readUInt16LE(22), 2);
});
test('OpenRouter forwards documented delivery instructions at top level', async () => {
  const t = capture(() => binary(mp3));
  await generateSpeech(model('OPENROUTER', { model: 'openai/gpt-4o-mini-tts', options: { voice: 'alloy', instructions: 'Speak warmly' } }), { text: 'Hi' }, t);
  assert.equal(t.calls[0].body.instructions, 'Speak warmly');
});
test('formats without complete container verification fail before HTTP', async () => {
  for (const [provider, format] of [['OPENAI', 'flac'], ['OPENAI', 'opus'], ['MINIMAX', 'flac'], ['VOLCENGINE', 'ogg_opus']]) {
    const t = capture(binary);
    await assert.rejects(generateSpeech(provider === 'VOLCENGINE' ? volc() : model(provider, { model: provider === 'MINIMAX' ? 'speech-2.8-hd' : 'gpt-4o-mini-tts' }), { text: 'Hi', format }, t), /unsupported/i);
    assert.equal(t.calls.length, 0);
  }
});
test('OpenRouter PCM without documented sample metadata rejects before HTTP', async () => {
  const t = capture(binary);
  await assert.rejects(generateSpeech(model('OPENROUTER', { model: 'unknown/speech' }), { text: 'Hi', format: 'pcm' }, t), /PCM|sample/i);
  assert.equal(t.calls.length, 0);
});
test('frontend OpenAI protocol name retains OpenAI and native Volcengine routes', async () => {
  const t = capture(binary);
  await generateSpeech(model('OpenAI', { protocol: 'OpenAI' }), { text: 'Hi', format: 'wav' }, t);
  assert.equal(t.calls[0].url, 'https://api.openai.com/v1/audio/speech');
  const other = capture(() => volcResponse([chunk, done]));
  await generateSpeech(volc({ protocol: 'OpenAI' }), { text: 'Hi' }, other);
  assert.equal(other.calls[0].body.req_params.speaker, 'zh_female_vv_uranus_bigtts');
  assert.equal(other.calls[0].headers.get('authorization'), null);
});

test('legacy frontend OpenAI label still uses Qwen native TTS protocol', async () => {
  const calls = [];
  await generateSpeech(model('Qwen', { protocol: 'OpenAI', model: 'qwen3-tts-flash' }), { text: 'Hi' }, {
    fetch: async (url, init) => { calls.push({ url: String(url), body: init.body && JSON.parse(init.body) }); return calls.length === 1 ? json({ output: { finish_reason: 'stop', audio: { url: 'https://media.example/audio.wav' } } }) : binary(); },
  });
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(calls[0].body.input.text, 'Hi');
});

test('frontend LLM-only protocols and cross-provider Qwen labels never issue speech requests', async () => {
  for (const provider of ['OPENAI', 'OPENROUTER', 'TOGETHER', 'ZAI', 'QWEN', 'MINIMAX', 'VOLCENGINE']) {
    for (const protocol of ['Anthropic', 'OpenAI Responses', ...(provider === 'QWEN' ? [] : ['Qwen'])]) {
      const t = capture(binary);
      await assert.rejects(generateSpeech(model(provider, { protocol }), { text: 'Hi' }, t), /mismatch/);
      assert.equal(t.calls.length, 0);
    }
  }
});
