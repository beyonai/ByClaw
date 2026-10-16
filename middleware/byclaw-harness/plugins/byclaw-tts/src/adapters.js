import { binarySpeech } from './binary-providers.js';
import { qwenSpeech } from './qwen.js';
import { minimaxSpeech } from './minimax.js';
import { volcengineSpeech } from './volcengine.js';
import { speechError } from './common.js';

export const providerRegistry = Object.freeze({
  OPENAI: binarySpeech, OPENROUTER: binarySpeech, TOGETHER: binarySpeech, ZAI: binarySpeech,
  QWEN: qwenSpeech, MINIMAX: minimaxSpeech, VOLCENGINE: volcengineSpeech,
});
export const unsupportedProviders = Object.freeze(['ANTHROPIC', 'DEEPSEEK', 'APK']);
const aliases = { CHATGPT: 'OPENAI', DOUBAO: 'VOLCENGINE', ARK: 'VOLCENGINE', ZHIPU: 'ZAI' };
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
