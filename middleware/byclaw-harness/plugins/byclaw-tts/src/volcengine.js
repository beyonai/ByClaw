import { randomUUID } from 'node:crypto';
import { audioAsset, availableVoices, formatFor, MAX_AUDIO_BYTES, post, speechError, speedFor, voiceFor, voiceNotAvailable } from './common.js';

// Selected standard 2.0 voices, not an authorization list. Verified 2026-10-16:
// https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh
const seed2Voices = [
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0' },
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何 2.0' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟 2.0' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天 2.0' },
];

export function volcengineSpeechOptions(model) {
  const resource = model.options.resourceId ?? new Headers(model.headers).get('x-api-resource-id') ?? model.model.replace(/^doubao-/, '');
  return { voices: resource === 'seed-tts-2.0' ? seed2Voices : [], speed: { supported: true, min: 0.5, max: 2 } };
}

function decodeAudio(value) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw speechError('Malformed Volcengine base64 audio');
  return Buffer.from(value, 'base64');
}

// HTTP chunks are transport fragments, not JSON frame boundaries. A string-aware
// object scanner accepts newline-delimited and directly concatenated JSON objects.
function wordTimingAsset(text, words) {
  return {
    artifactType: 'word-timing',
    mimeType: 'application/json',
    bytes: Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      unit: 'second',
      granularity: 'provider-word',
      text,
      words,
    }, null, 2)}\n`),
  };
}

function appendWordTimings(event, words) {
  if (event.sentence === undefined) return;
  if (!event.sentence || typeof event.sentence !== 'object' || !Array.isArray(event.sentence.words)) throw speechError('Malformed Volcengine word timings');
  for (const value of event.sentence.words) {
    if (!value || typeof value !== 'object' || typeof value.word !== 'string' || !value.word
      || !Number.isFinite(value.startTime) || value.startTime < 0
      || !Number.isFinite(value.endTime) || value.endTime < value.startTime
      || (value.confidence !== undefined && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1))) {
      throw speechError('Malformed Volcengine word timings');
    }
    if (words.length >= 100000) throw speechError('Oversized Volcengine word timings');
    words.push({
      word: value.word,
      startTime: value.startTime,
      endTime: value.endTime,
      ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
    });
  }
}

function voiceFailure(event) {
  const message = typeof event.message === 'string' ? event.message : '';
  return event.code === 45001115 || event.code === 45002000
    || (event.code === 55000000 && /resource\s*id\s+is\s+mismatched\s+with\s+speaker/i.test(message))
    || ([45000000, 45000001].includes(event.code) && /speaker|resource\s*id.*mismatch/i.test(message));
}

async function readVolcStream(response, context, format, sampleRate, text, speaker, voiceChoices) {
  if (!response.body) throw speechError('Empty Volcengine speech stream');
  if (Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES * 2) {
    await response.body.cancel();
    throw speechError('Oversized speech stream');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  const sse = /text\/event-stream/i.test(response.headers.get('content-type') || '');
  let buffer = '', frame = '', depth = 0, inString = false, escaped = false;
  let total = 0, wireBytes = 0, terminal = false;
  const words = [];
  const consume = (raw) => {
    let event;
    try { event = JSON.parse(raw); } catch { throw speechError('Malformed Volcengine speech frame'); }
    if (terminal) throw speechError('Unexpected speech frame after terminal status');
    if (event.code === 20000000) {
      if (event.data) throw speechError('Unexpected audio in terminal speech frame');
      terminal = true;
    } else if (voiceFailure(event)) {
      throw voiceNotAvailable(speaker, voiceChoices);
    } else if (event.code !== 0) {
      throw speechError('Volcengine speech generation failed');
    } else {
      appendWordTimings(event, words);
      if (event.data) {
        const bytes = decodeAudio(event.data);
        total += bytes.length;
        if (total > MAX_AUDIO_BYTES) throw speechError('Oversized speech audio');
        chunks.push(bytes);
      }
    }
  };
  const parseText = (text) => {
    if (sse) {
      buffer += text;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
        if (line.startsWith('data:')) frame += `${line.slice(5).trimStart()}\n`;
        else if (line === '' && frame) { consume(frame.trimEnd()); frame = ''; }
        else if (line && !/^(?:event:|id:|retry:|:)/.test(line)) throw speechError('Malformed Volcengine SSE frame');
      }
      if (buffer.length + frame.length > 8 * 1024 * 1024) throw speechError('Oversized speech frame');
      return;
    }
    for (const char of text) {
      if (!depth && /\s/.test(char)) continue;
      if (!depth && char !== '{') throw speechError('Malformed Volcengine speech frame');
      frame += char;
      if (frame.length > 8 * 1024 * 1024) throw speechError('Oversized speech frame');
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
      if (!depth) { consume(frame); frame = ''; }
    }
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  context.signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      context.signal?.throwIfAborted();
      const { value, done } = await reader.read();
      context.signal?.throwIfAborted();
      if (done) break;
      wireBytes += value.byteLength;
      if (wireBytes > MAX_AUDIO_BYTES * 2) throw speechError('Oversized speech stream');
      parseText(decoder.decode(value, { stream: true }));
    }
    parseText(decoder.decode());
    if (frame || buffer.trim() || !terminal) throw speechError('Truncated Volcengine speech stream: terminal success missing');
    return [
      audioAsset(Buffer.concat(chunks, total), format, { sampleRate }),
      wordTimingAsset(text, words),
    ];
  } finally {
    context.signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function volcengineSpeech(model, args, context) {
  const options = model.options;
  const headers = new Headers(model.headers);
  const catalog = volcengineSpeechOptions(model).voices;
  const speaker = voiceFor(args, options, undefined, catalog);
  const format = formatFor(args, options, ['mp3', 'wav', 'pcm'], 'mp3');
  const speed = speedFor(args, options, 0.5, 2, context);
  const resourceId = options.resourceId ?? headers.get('x-api-resource-id') ?? ({
    'doubao-seed-tts-2.0': 'seed-tts-2.0', 'seed-tts-2.0': 'seed-tts-2.0',
    'seed-icl-2.0': 'seed-icl-2.0', 'seed-tts-1.0': 'seed-tts-1.0',
  })[model.model];
  if (!resourceId || !['seed-tts-2.0', 'seed-icl-2.0', 'seed-tts-1.0', 'seed-tts-1.0-concurr', 'seed-icl-1.0', 'seed-icl-1.0-concurr'].includes(resourceId)) throw speechError('Configure a supported Volcengine speech resourceId');
  if (model.model === 'doubao-seed-tts-2.0' && !['seed-tts-2.0', 'seed-icl-2.0'].includes(resourceId)) throw speechError('Seed TTS 2.0 requires a matching resourceId and voice');
  const appId = options.appId ?? headers.get('x-api-app-id');
  const accessKey = options.accessKey ?? headers.get('x-api-access-key') ?? (appId ? model.apiKey : undefined);
  const auth = { 'X-Api-Resource-Id': resourceId, 'X-Api-Request-Id': randomUUID() };
  if (appId || accessKey) {
    if (!appId || !accessKey) throw speechError('Legacy Volcengine speech authentication requires appId and accessKey');
    auth['X-Api-App-Id'] = appId; auth['X-Api-Access-Key'] = accessKey;
    headers.delete('x-api-key');
  } else {
    const apiKey = model.apiKey || headers.get('x-api-key');
    if (!apiKey) throw speechError('Configure a Volcengine speech API key');
    auth['X-Api-Key'] = apiKey;
  }
  const sampleRate = options.sampleRate ?? 24000;
  if (![8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(sampleRate)) throw speechError('Unsupported Volcengine speech sample rate');
  const req = { text: args.text, speaker, audio_params: { format, sample_rate: sampleRate, enable_subtitle: true } };
  if (speed !== undefined) req.audio_params.speech_rate = Math.round((speed - 1) * 100);
  if (options.modelVersion) req.model = options.modelVersion;
  if (options.additions) req.additions = typeof options.additions === 'string' ? options.additions : JSON.stringify(options.additions);
  const suffix = model.endpoint && new URL(model.endpoint).pathname.replace(/\/$/, '').endsWith('/api/v3/tts/unidirectional/sse') ? '/api/v3/tts/unidirectional/sse' : '/api/v3/tts/unidirectional';
  const response = await post({ ...model, headers }, 'https://openspeech.bytedance.com', suffix, { req_params: req }, context, auth, { acceptErrorResponse: true });
  return readVolcStream(response, context, format, sampleRate, args.text, speaker, availableVoices(options, undefined, catalog).values);
}
