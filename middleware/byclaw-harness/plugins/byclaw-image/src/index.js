import { mountMediaPlugin } from '@byclaw/media-runtime'
import { generateImage } from './adapters.js'

export const name = 'byclaw-image'
export function apply(ctx, config = {}) {
  mountMediaPlugin(ctx, { kind: 'image', generate: generateImage, modelId: config.modelId ?? process.env.BYCLAW_IMAGE_MODEL_ID, provider: config.provider, protocol: config.protocol })
}
