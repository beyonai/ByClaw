import { readJson } from '@byclaw/media-runtime';
import { audioAsset, formatFor, post, requireTextLimit, speechError, speedFor, voiceFor } from './common.js';

export async function minimaxSpeech(model, args, context) {
  if (!/^speech-/.test(model.model)) throw speechError('Unsupported MiniMax speech model');
  requireTextLimit(args.text, 9999);
  const options = model.options;
  const format = formatFor(args, options, ['mp3', 'wav', 'pcm'], 'mp3');
  const voiceSetting = { voice_id: voiceFor(args, options) };
  const speed = speedFor(args, options);
  if (speed !== undefined) voiceSetting.speed = speed;
  for (const key of ['vol', 'pitch', 'emotion']) if (options[key] !== undefined) voiceSetting[key] = options[key];
  const audioSetting = { format };
  for (const [from, to] of [['sampleRate', 'sample_rate'], ['bitrate', 'bitrate'], ['channel', 'channel']]) if (options[from] !== undefined) audioSetting[to] = options[from];
  const body = { model: model.model, text: args.text, stream: false, output_format: 'hex', voice_setting: voiceSetting, audio_setting: audioSetting };
  if (options.languageBoost) body.language_boost = options.languageBoost;
  const response = await readJson(await post(model, 'https://api.minimax.io/v1', '/t2a_v2', body, context));
  if (response.base_resp?.status_code !== 0 || response.data?.status !== 2) throw speechError('MiniMax speech generation failed or incomplete');
  const audio = response.data.audio;
  if (typeof audio !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(audio)) throw speechError('MiniMax returned malformed hex audio');
  return [audioAsset(Buffer.from(audio, 'hex'), format, { sampleRate: options.sampleRate ?? 32000, channels: options.channel ?? 1 })];
}
