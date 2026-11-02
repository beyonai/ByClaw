import { transcribeAudio } from './adapters.js'
export { transcribeAudio, validateMp3, MAX_ASR_BYTES } from './adapters.js'
export const name = 'byclaw-asr'
// Infrastructure service only: transcription is deterministic preprocessing,
// never a tool the LLM must discover or choose to invoke.
export function apply(ctx) {
  ctx.provide('byclawAsr', { transcribe: transcribeAudio })
}
