import { downloadAsset, readJson } from '@byclaw/media-runtime';
import { audioAsset, formatFor, post, requireTextLimit, speechError, voiceFor } from './common.js';

export async function qwenSpeech(model, args, context) {
  if (!/^qwen(?:3)?-tts-(?:flash|instruct-flash|latest|20\d{2}-\d{2}-\d{2}|vc-|vd-)/.test(model.model) || model.model.includes('realtime')) throw speechError('Unsupported Qwen HTTP speech model; configure a Qwen-TTS HTTP model');
  requireTextLimit(args.text, 600);
  const options = model.options;
  formatFor(args, options, ['wav'], 'wav');
  if (args.speed !== undefined || options.speed !== undefined) throw speechError('Qwen HTTP speech speed parameter is unsupported');
  const input = { text: args.text, voice: voiceFor(args, options, 'Cherry'), language_type: options.languageType ?? 'Auto' };
  if (options.instructions) input.instructions = options.instructions;
  const response = await readJson(await post(model, 'https://dashscope.aliyuncs.com/api/v1', '/services/aigc/multimodal-generation/generation', { model: model.model, input }, context));
  if (response.code || response.status_code && response.status_code !== 200 || response.output?.finish_reason !== 'stop') throw speechError('Qwen speech generation failed or incomplete');
  if (typeof response.output?.audio?.url !== 'string') throw speechError('Qwen speech response is missing completed audio URL');
  const url = new URL(response.output.audio.url);
  // DashScope's documented result URL may use HTTP; OSS supports the same
  // signed path/query over HTTPS. Never downgrade or forward the generation key.
  if (url.protocol === 'http:' && /^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)) url.protocol = 'https:';
  const asset = await downloadAsset(url.toString(), context);
  return [audioAsset(asset.bytes, 'wav')];
}
