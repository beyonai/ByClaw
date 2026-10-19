import { binarySpeech, binarySpeechOptions } from './binary-providers.js';
import { qwenSpeech, qwenSpeechOptions } from './qwen.js';
import { minimaxSpeech, minimaxSpeechOptions } from './minimax.js';
import { volcengineSpeech, volcengineSpeechOptions } from './volcengine.js';
import { availableVoices, speechError } from './common.js';

export const providerRegistry = Object.freeze({
  OPENAI: binarySpeech, OPENROUTER: binarySpeech, TOGETHER: binarySpeech, ZAI: binarySpeech,
  QWEN: qwenSpeech, MINIMAX: minimaxSpeech, VOLCENGINE: volcengineSpeech,
});
export const unsupportedProviders = Object.freeze(['ANTHROPIC', 'DEEPSEEK', 'APK']);
const aliases = { CHATGPT: 'OPENAI', DOUBAO: 'VOLCENGINE', ARK: 'VOLCENGINE', ZHIPU: 'ZAI' };
const optionsRegistry = {
  OPENAI: binarySpeechOptions, OPENROUTER: binarySpeechOptions, TOGETHER: binarySpeechOptions, ZAI: binarySpeechOptions,
  QWEN: qwenSpeechOptions, MINIMAX: minimaxSpeechOptions, VOLCENGINE: volcengineSpeechOptions,
};
// The TTS form currently reuses the LLM protocol picker. Its legacy OpenAI
// label must not turn native Qwen/MiniMax/Volcengine requests into OpenAI bodies.
// Provider remains authoritative; this matrix accepts saved UI metadata only.
const frontendProtocols = Object.freeze({
  OPENAI: ['OPENAI'],
  OPENROUTER: ['OPENAI'],
  TOGETHER: ['OPENAI'],
  ZAI: ['OPENAI'],
  QWEN: ['OPENAI', 'QWEN'],
  MINIMAX: ['OPENAI'],
  VOLCENGINE: ['OPENAI'],
});

export function getSpeechOptions(model) {
  const key = String(model.provider || '').trim().toUpperCase();
  const provider = aliases[key] ?? key;
  if (!Object.hasOwn(providerRegistry, provider)) throw speechError('Unsupported speech provider capability');
  const options = model.options ?? {};
  const normalized = { ...model, provider, options };
  const contract = optionsRegistry[provider](normalized);
  const voices = availableVoices(options, contract.defaultVoice, contract.voices);
  const defaultVoice = options.voice ?? options.speaker ?? options.defaultVoice ?? contract.defaultVoice;
  const speed = contract.speed;
  return {
    provider, model: model.model,
    voice: { supported: true, ...(defaultVoice ? { default: defaultVoice } : {}), choices: voices.values, restricted: voices.configured,
      note: voices.configured ? '仅可选择配置允许的音色。' : '列表为已知候选，并非完整或已授权音色清单；可传供应商支持的其他音色 ID，最终由供应商验证。' },
    speed: { ...speed, default: speed.supported && Number.isFinite(options.speed) && options.speed >= speed.min && options.speed <= speed.max ? options.speed : 1 },
  };
}

/** Tool-facing result: recoverable control limitations are data, never connector errors. */
export async function generateSpeechResult(model, args, context = {}) {
  const warnings = [];
  const onWarning = warning => { warnings.push(warning); context.onWarning?.(warning); };
  try {
    const assets = await generateSpeech(model, args, { ...context, onWarning });
    return { assets, warnings };
  } catch (error) {
    if (context.signal?.aborted || error?.code !== 'TTS_VOICE_NOT_AVAILABLE' || !args?.voice) throw error;
    // No retry with a different voice: a failed stream may already be billable.
    return { assets: [], warnings: [{ code: error.code, parameter: 'voice', message: `${error.message}。本次未生成音频，请选择可用音色。` }] };
  }
}

export async function generateSpeech(model, args, context = {}) {
  const providerKey = String(model?.provider || '').trim().toUpperCase();
  const provider = aliases[providerKey] ?? providerKey;
  if (!Object.hasOwn(providerRegistry, provider)) throw speechError('Unsupported speech provider capability');
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some((key) => !['text', 'voice', 'format', 'speed'].includes(key))) throw speechError('Invalid speech arguments');
  const normalizedArgs = { ...args };
  if (normalizedArgs.voice === null || (typeof normalizedArgs.voice === 'string' && !normalizedArgs.voice.trim())) delete normalizedArgs.voice;
  if (typeof normalizedArgs.text !== 'string' || !normalizedArgs.text.trim() || normalizedArgs.text.length > 100000) throw speechError('Speech text must be nonempty and at most 100000 characters');
  if (typeof model.model !== 'string' || !model.model.trim()) throw speechError('Configure a speech model code');
  if (normalizedArgs.voice !== undefined && (typeof normalizedArgs.voice !== 'string' || normalizedArgs.voice.length > 256)) throw speechError('Invalid speech voice');
  if (normalizedArgs.speed !== undefined && (!Number.isFinite(normalizedArgs.speed) || normalizedArgs.speed <= 0)) throw speechError('Invalid speech speed');
  const protocol = String(model.protocol || '').trim().toUpperCase();
  const acceptedProtocols = [
    `${provider}_TTS`, `${provider}_SPEECH`, ...frontendProtocols[provider],
    ...(provider === 'QWEN' ? ['DASHSCOPE_TTS'] : []),
    ...(provider === 'VOLCENGINE' ? ['VOLCENGINE_TTS_V3'] : []),
  ];
  if (protocol && !acceptedProtocols.includes(protocol)) throw speechError('Speech provider / protocol mismatch');
  const signal = context.signal;
  signal?.throwIfAborted();
  try {
    return await providerRegistry[provider]({ ...model, provider, options: model.options ?? {} }, normalizedArgs, context);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Speech generation aborted', 'AbortError');
    if (typeof error?.code === 'string' && error.code.startsWith('TTS_')) throw error;
    // Provider bodies, transport errors and signed URLs may contain credentials.
    throw speechError('Speech provider request or response failed');
  }
}
