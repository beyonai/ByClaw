import type { MediaModel, MediaAsset, MediaGenerationResult, SpeechOptions, RequestContext } from '@byclaw/media-runtime'
export function generateSpeech(model: MediaModel, args: { text: string; voice?: string; format?: string; speed?: number }, context?: RequestContext): Promise<MediaAsset[]>
export function generateSpeechResult(model: MediaModel, args: { text: string; voice?: string; format?: string; speed?: number }, context?: RequestContext): Promise<MediaGenerationResult>
export function getSpeechOptions(model: MediaModel): SpeechOptions
