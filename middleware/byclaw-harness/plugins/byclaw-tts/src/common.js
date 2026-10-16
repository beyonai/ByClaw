import { endpoint, request, readBytes } from '@byclaw/media-runtime';

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MIME = Object.freeze({ mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac' });

export function speechError(message, code = 'TTS_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function availableVoices(options, fallback) {
  const configured = options.voices !== undefined;
  if (configured && (!Array.isArray(options.voices) || options.voices.length === 0 || options.voices.length > 100)) {
    throw speechError('Configure voices as a nonempty array with at most 100 entries');
  }
  const values = [];
  for (const item of options.voices ?? []) {
    const id = typeof item === 'string' ? item.trim() : typeof item?.id === 'string' ? item.id.trim() : '';
    const name = typeof item === 'object' && item !== null && typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || id.length > 256 || name.length > 100) throw speechError('Configure valid speech voice choices');
    values.push({ id, ...(name ? { name } : {}) });
  }
  for (const value of [options.voice, options.speaker, options.defaultVoice, fallback]) {
    if (typeof value === 'string' && value.trim() && value.trim().length <= 256) values.push({ id: value.trim() });
  }
  return { configured, values: values.filter((item, index) => values.findIndex(other => other.id === item.id) === index) };
}

export function voiceNotAvailable(requested, choices) {
  const shown = choices.slice(0, 20).map(item => item.name ? `${item.id}（${item.name}）` : item.id);
  const available = shown.length ? shown.join('、') : '请前往供应商控制台音色库查看当前账号已授权的音色 ID';
  const more = choices.length > shown.length ? `，另有 ${choices.length - shown.length} 个` : '';
  return speechError(`VOICE_NOT_AVAILABLE: 音色“${requested}”不存在、未授权或与当前模型不匹配。可选音色：${available}${more}`, 'TTS_VOICE_NOT_AVAILABLE');
}

export function formatFor(args, options, supported, fallback) {
  const format = args.format ?? options.format ?? fallback;
  if (!supported.includes(format)) throw speechError('Unsupported speech output format for this provider');
  return format;
}

export function voiceFor(args, options, fallback) {
  const voice = args.voice ?? options.voice ?? options.speaker ?? fallback;
  if (typeof voice !== 'string' || !voice.trim() || voice.length > 256) throw speechError('Configure a valid speech voice / speaker in the selected model');
  const choices = availableVoices(options, fallback);
  if (args.voice !== undefined && choices.configured && !choices.values.some(item => item.id === voice.trim())) {
    throw voiceNotAvailable(voice.trim(), choices.values);
  }
  return voice.trim();
}

export function speedFor(args, options, min = 0.5, max = 2) {
  const speed = args.speed ?? options.speed;
  if (speed !== undefined && (!Number.isFinite(speed) || speed < min || speed > max)) throw speechError('Unsupported speech speed for this provider');
  return speed;
}

export function requireTextLimit(text, limit) {
  if ([...text].length > limit) throw speechError(`Speech text exceeds provider limit of ${limit} characters`);
}

export async function post(model, base, suffix, body, context, authHeaders, requestOptions) {
  const headers = new Headers(model.headers);
  headers.set('content-type', 'application/json');
  if (authHeaders) {
    headers.delete('authorization');
    for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value);
  } else {
    if (!model.apiKey) throw speechError('Configure the speech provider API key');
    headers.set('authorization', `Bearer ${model.apiKey}`);
  }
  return request(endpoint(model.endpoint || base, suffix), { method: 'POST', headers, body: JSON.stringify(body) }, context, requestOptions);
}

// Check the container as well as MIME so an upstream JSON error cannot be persisted as audio.
export function audioAsset(bytes, format, pcm = {}) {
  bytes = Buffer.from(bytes);
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw speechError('Empty or oversized speech audio');
  let valid = false;
  if (format === 'wav') {
    valid = bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE' && bytes.readUInt32LE(4) + 8 === bytes.length;
    let hasData = false;
    let hasFormat = false;
    for (let offset = 12; valid && offset < bytes.length;) {
      if (offset + 8 > bytes.length) { valid = false; break; }
      const id = bytes.toString('ascii', offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      if (offset + 8 + length > bytes.length) { valid = false; break; }
      if (id === 'fmt ' && length >= 16) hasFormat = true;
      if (id === 'data' && length > 0) hasData = true;
      offset += 8 + length + (length % 2);
    }
    valid = valid && hasFormat && hasData;
  } else if (format === 'mp3') {
    let offset = 0;
    if (bytes.toString('ascii', 0, 3) === 'ID3' && bytes.length >= 10) {
      if ([...bytes.subarray(6, 10)].some((b) => b > 127)) throw speechError('Malformed speech audio');
      offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]) + ((bytes[5] & 16) ? 10 : 0);
    }
    let frames = 0;
    while (offset + 4 <= bytes.length) {
      if (bytes.length - offset === 128 && bytes.toString('ascii', offset, offset + 3) === 'TAG') { offset += 128; break; }
      const a = bytes[offset + 1], b = bytes[offset + 2];
      if (bytes[offset] !== 255 || (a & 224) !== 224 || (a & 6) !== 2 || (a & 24) === 8) break;
      const version = (a >> 3) & 3;
      const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[b >> 4];
      const sampleRate = [44100, 48000, 32000][(b >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
      if (!bitrate || !sampleRate) break;
      const length = Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + ((b >> 1) & 1);
      if (offset + length > bytes.length) break;
      frames++; offset += length;
    }
    valid = frames > 0 && offset === bytes.length;
  } else if (format === 'pcm') {
    const sampleRate = pcm.sampleRate ?? 24000;
    const channels = pcm.channels ?? 1;
    if (![8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(sampleRate) || ![1, 2].includes(channels) || bytes.length % (2 * channels) !== 0 || bytes.length + 44 > MAX_AUDIO_BYTES) throw speechError('Invalid PCM speech audio or sample metadata');
    const header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(36 + bytes.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28);
    header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
    return { bytes: Buffer.concat([header, bytes]), mimeType: 'audio/wav' };
  } else if (format === 'aac') {
    let offset = 0, frames = 0;
    while (offset + 7 <= bytes.length) {
      if (bytes[offset] !== 255 || (bytes[offset + 1] & 246) !== 240 || ((bytes[offset + 2] >> 2) & 15) >= 13) break;
      const headerLength = (bytes[offset + 1] & 1) ? 7 : 9;
      const frameLength = ((bytes[offset + 3] & 3) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
      if (frameLength <= headerLength || offset + frameLength > bytes.length) break;
      offset += frameLength; frames++;
    }
    valid = frames > 0 && offset === bytes.length;
  }
  if (!valid) throw speechError('Malformed or truncated speech audio');
  return { bytes, mimeType: MIME[format] };
}

export async function binaryAsset(response, format) {
  const contentType = response.headers.get('content-type') || '';
  if (/json|text\//i.test(contentType)) throw speechError('Speech provider returned non-audio content');
  return audioAsset(await readBytes(response, MAX_AUDIO_BYTES), format);
}
