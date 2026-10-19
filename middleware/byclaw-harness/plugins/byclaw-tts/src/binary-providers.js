import { binaryAsset, formatFor, post, requireTextLimit, speechError, speedFor, voiceFor } from './common.js';

const contracts = {
  OPENAI: { base: 'https://api.openai.com/v1', formats: ['mp3', 'wav', 'pcm', 'aac'], format: 'mp3', voice: 'alloy', maxText: 4096, minSpeed: 0.25, maxSpeed: 4 },
  OPENROUTER: { base: 'https://openrouter.ai/api/v1', formats: ['mp3', 'pcm'], format: 'mp3', maxText: 10000 },
  TOGETHER: { base: 'https://api.together.ai/v1', formats: ['mp3', 'wav'], format: 'wav', maxText: 10000 },
  ZAI: { base: 'https://open.bigmodel.cn/api/paas/v4', formats: ['wav', 'pcm'], format: 'wav', voice: 'tongtong', maxText: 1024 },
};

export async function binarySpeech(model, args, context) {
  const contract = contracts[model.provider];
  const options = model.options;
  if (model.provider === 'ZAI' && model.model !== 'glm-tts') throw speechError('Unsupported ZAI speech model; configure glm-tts');
  requireTextLimit(args.text, contract.maxText);
  const format = formatFor(args, options, contract.formats, contract.format);
  if (model.provider === 'OPENROUTER' && format === 'pcm' && !/^(?:openai\/(?:tts-1(?:-hd)?|gpt-4o-mini-tts)(?:$|-)|microsoft\/mai-voice-)/.test(model.model)) throw speechError('OpenRouter PCM sample metadata is unknown for this model; use mp3');
  const voice = voiceFor(args, options, contract.voice);
  const range = binarySpeechOptions(model).speed;
  const speed = speedFor(args, options, range.supported ? range.min : null, range.max, context);
  const body = { model: model.model, input: args.text, voice, response_format: format };
  if (speed !== undefined) body.speed = speed;
  if (model.provider === 'TOGETHER' || model.provider === 'ZAI') body.stream = false;
  if (model.provider === 'TOGETHER') {
    for (const [from, to] of [['language', 'language'], ['sampleRate', 'sample_rate'], ['bitRate', 'bit_rate']]) if (options[from] !== undefined) body[to] = options[from];
  }
  if (model.provider === 'OPENAI' && options.instructions) body.instructions = options.instructions;
  if (model.provider === 'OPENROUTER') {
    if (options.instructions) body.instructions = options.instructions;
    if (options.routing) body.provider = options.routing;
  }
  if (model.provider === 'ZAI' && options.volume !== undefined) body.volume = options.volume;
  return [await binaryAsset(await post(model, contract.base, '/audio/speech', body, context), format)];
}

export function binarySpeechOptions(model) {
  const contract = contracts[model.provider];
  const supported = model.provider !== 'TOGETHER' && (model.provider !== 'OPENROUTER' || /^openai\/(?:tts-1(?:-hd)?|gpt-4o-mini-tts)(?:$|-)/.test(model.model));
  return { defaultVoice: contract.voice, speed: supported
    ? { supported: true, min: model.provider === 'OPENROUTER' ? 0.25 : contract.minSpeed ?? 0.5, max: model.provider === 'OPENROUTER' ? 4 : contract.maxSpeed ?? 2 }
    : { supported: false } };
}
