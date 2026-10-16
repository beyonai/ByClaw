import type { MediaModel, RequestContext } from '@byclaw/media-runtime'
export interface AsrResult { text: string; provider: string; model: string }
export interface AsrService { transcribe(model: MediaModel, bytes: Uint8Array, context?: RequestContext): Promise<AsrResult> }
export const MAX_ASR_BYTES: number
export function validateMp3(bytes: Uint8Array): Buffer
export function transcribeAudio(model: MediaModel, bytes: Uint8Array, context?: RequestContext): Promise<AsrResult>
export const name: string
export function apply(ctx: any): void
