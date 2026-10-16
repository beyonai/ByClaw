import type { MediaModel, MediaAsset, RequestContext } from '@byclaw/media-runtime'
export function generateSpeech(model: MediaModel, args: { text: string; voice?: string; format?: string; speed?: number }, context?: RequestContext): Promise<MediaAsset[]>
