import { mountMediaPlugin } from '@byclaw/media-runtime'
import { generateSpeech } from './adapters.js'

export const name = 'byclaw-tts'
export function apply(ctx, config = {}) {
  mountMediaPlugin(ctx, { kind: 'tts', generate: generateSpeech, modelId: config.modelId ?? process.env.BYCLAW_TTS_MODEL_ID, provider: config.provider, protocol: config.protocol })
}
