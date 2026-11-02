/** Deterministic ASR admission and post-answer speech for authenticated voice turns. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { readFile, realpath, mkdir, writeFile, rename, stat, open } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { persistAssets, type MediaModel } from '@byclaw/media-runtime'
import { transcribeAudio, validateMp3, MAX_ASR_BYTES, type AsrResult } from '@byclaw/byclaw-asr'
import { generateSpeech } from '@byclaw/byclaw-tts/adapters'
import type { AgentContext, AskAgentCommand } from '@byclaw/by-framework'
import { resolveByClawInboundPath } from './inbound-context.ts'
import { mediaArtifactIo, type ToolEnvironmentFiles } from './tool-environment-files.ts'

export const ASR_NO_SPEECH_MESSAGE = '未识别到语音，请靠近麦克风后重试'

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
export function byClawVoicePayload(command: Pick<AskAgentCommand, 'extraPayload'>): Record<string, unknown> | undefined {
  const extra = command.extraPayload
  const sources = [extra, record(extra['payload']), record(extra['ext_params']), record(extra['extParams'])]
  if (!sources.some(source => String(source?.['messageType'] ?? '').toUpperCase() === 'VOICE')) return
  const voice = sources.map(source => record(source?.['voice'])).find(value => value !== undefined)
  if (!voice) throw new Error('ASR_AUDIO_REQUIRED')
  return voice
}
export function voiceRequestFingerprint(voice: Record<string, unknown>): string {
  return createHash('sha256').update(String(voice['audioBase64'] ?? voice['filePath'] ?? voice['fileUrl'] ?? ''))
    .update('\0').update(String(voice['fileId'] ?? '')).digest('hex')
}
export function voiceSessionRoot(byRoot: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(sessionId)) throw new Error('ASR_SESSION_INVALID')
  return join(byRoot, '.sessions', sessionId)
}
export function decodeVoiceBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_ASR_BYTES / 3) * 4 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new Error('ASR_AUDIO_INVALID')
  return validateMp3(Buffer.from(value, 'base64'))
}
async function inputAudio(voice: Record<string, unknown>, byRoot: string, files?: ToolEnvironmentFiles): Promise<Buffer> {
  if (voice['audioBase64'] !== undefined) return decodeVoiceBase64(voice['audioBase64'])
  const source = voice['filePath'] ?? voice['fileUrl']
  if (typeof source !== 'string' || !source.startsWith('/by/')) throw new Error('ASR_LOCAL_AUDIO_REQUIRED')
  const canonical = (path: string) => files === undefined ? realpath(path) : files.realpath(path)
  const root = await canonical(byRoot)
  const path = await canonical(resolveByClawInboundPath(source, byRoot))
  const suffix = relative(root, path)
  if (!suffix || suffix === '..' || suffix.startsWith('..' + sep) || isAbsolute(suffix)
    || suffix.split(sep).some(part => part.startsWith('.') && part !== '.sessions' && part !== '.shared')) throw new Error('ASR_AUDIO_PATH_REJECTED')
  if (files !== undefined) {
    // The canonical path has no symlink left, so its lstat is the file itself.
    const info = await files.lstat(path)
    if (info?.type !== 'file' || (info.size ?? 0) > MAX_ASR_BYTES) throw new Error('ASR_AUDIO_SIZE_INVALID')
    return validateMp3(await files.readBytes(path, MAX_ASR_BYTES))
  }
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_ASR_BYTES) throw new Error('ASR_AUDIO_SIZE_INVALID')
  return validateMp3(await readFile(path))
}

/** Read the ASR transcript cache without following a symlinked cache file (`O_NOFOLLOW`). */
async function readAsrCache(cached: string, files?: ToolEnvironmentFiles): Promise<AsrResult | undefined> {
  if (files !== undefined) {
    const info = await files.lstat(cached).catch(() => { throw new Error('ASR_CACHE_INVALID') })
    if (info === undefined) return undefined
    if (info.type !== 'file' || (info.size ?? 0) > 2 * 1024 * 1024) throw new Error('ASR_CACHE_INVALID')
    let value: AsrResult
    try { value = JSON.parse(await files.readText(cached)) as AsrResult } catch { throw new Error('ASR_CACHE_INVALID') }
    if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('ASR_CACHE_INVALID')
    return value
  }
  try {
    const file = await open(cached, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('ASR_CACHE_INVALID')
      const value = JSON.parse(await file.readFile('utf8')) as AsrResult
      if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('ASR_CACHE_INVALID')
      return value
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('ASR_CACHE_INVALID')
    return undefined
  }
}
export interface VoiceRuntimeOptions {
  byRoot: string
  userCode: string
  resolveModel(type: 'ASR' | 'TTS'): Promise<MediaModel>
  transcribe?: typeof transcribeAudio
  speak?: typeof generateSpeech
  /**
   * The user tree lives in a separate tool environment: read and write it there
   * instead of on this host (`workspaceOnToolEnvironment`).
   */
  files?: ToolEnvironmentFiles
}
export interface PreparedVoice { command: AskAgentCommand; root: string; transcript: string }
export class ByClawVoiceRuntime {
  constructor(private readonly options: VoiceRuntimeOptions) {}
  async prepare(command: AskAgentCommand, sessionId: string, signal: AbortSignal): Promise<PreparedVoice | undefined> {
    const voice = byClawVoicePayload(command)
    if (!voice) return
    if (command.header.userCode !== this.options.userCode) throw new Error('ASR_SESSION_IDENTITY')
    const files = this.options.files
    const root = voiceSessionRoot(this.options.byRoot, sessionId)
    const ensureDirectory = (path: string) => files === undefined ? mkdir(path, { recursive: true, mode: 0o700 }) : files.ensureDirectory(path)
    const canonical = (path: string) => files === undefined ? realpath(path) : files.realpath(path)
    await ensureDirectory(root)
    const canonicalRoot = await canonical(root)
    const canonicalByRoot = await canonical(this.options.byRoot)
    if (canonicalRoot !== join(canonicalByRoot, '.sessions', sessionId)) throw new Error('ASR_SESSION_PATH_REJECTED')
    await ensureDirectory(join(root, 'asr'))
    if (await canonical(join(root, 'asr')) !== join(canonicalRoot, 'asr')) throw new Error('ASR_SESSION_PATH_REJECTED')
    const bytes = await inputAudio(voice, this.options.byRoot, files)
    signal.throwIfAborted()
    const digest = createHash('sha256').update(command.header.messageId).update('\0').update(bytes).digest('hex')
    const cached = join(root, 'asr', `${digest}.json`)
    let result = await readAsrCache(cached, files)
    let artifact: { path: string; mimeType: string; bytes: number } | undefined
    if (!result) {
      ;[artifact] = await persistAssets(root, 'asr', [{ bytes, mimeType: 'audio/mpeg' }], ...(files === undefined ? [] : [mediaArtifactIo(files)]))
      const model = await this.options.resolveModel('ASR')
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(model.timeoutMs)])
      result = await (this.options.transcribe ?? transcribeAudio)(model, bytes, { signal: requestSignal })
      requestSignal.throwIfAborted()
      if (files === undefined) {
        const temporary = `${cached}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify({ ...result, artifact }), { flag: 'wx', mode: 0o600 })
        await rename(temporary, cached)
      } else {
        // The tool environment's text write is atomic and replaces the whole file.
        await files.writeText(cached, JSON.stringify({ ...result, artifact }))
      }
    }
    signal.throwIfAborted()
    const text = `${result.text}\n\n[语音交互：请正常回答，并在末尾用 <voice_summary>简短口语摘要</voice_summary> 提供适合朗读的摘要。]`
    // Preserve framework command identity/prototype without mutating upstream payload.
    const prepared = Object.assign(Object.create(Object.getPrototypeOf(command)) as AskAgentCommand, command, {
      content: text, extraPayload: { ...command.extraPayload, voiceInteraction: true, userInput: result.text,
        voiceTranscript: result.text, ...(artifact ? { voiceArtifact: artifact } : {}) },
    })
    return { command: prepared, root, transcript: result.text }
  }
  async finish(answer: string, prepared: PreparedVoice, signal: AbortSignal): Promise<string> {
    const summary = /<voice_summary>([\s\S]*?)<\/voice_summary>/u.exec(answer)?.[1]?.trim()
    const normal = answer.replace(/\s*<voice_summary>[\s\S]*?(?:<\/voice_summary>|$)/gu, '').trim()
    const spoken = (summary || normal.replace(/```[\s\S]*?```/gu, '').replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/[#*_>`]/gu, '')).slice(0, 600).trim()
    if (!spoken) return normal
    try {
      const model = await this.options.resolveModel('TTS')
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(model.timeoutMs)])
      const assets = await (this.options.speak ?? generateSpeech)(model, { text: spoken, format: 'mp3' }, { signal: requestSignal })
      requestSignal.throwIfAborted()
      const files = this.options.files
      const [artifact] = await persistAssets(prepared.root, 'tts', assets, ...(files === undefined ? [] : [mediaArtifactIo(files)]))
      signal.throwIfAborted()
      if (!artifact) return normal
      const virtual = '/by/' + relative(this.options.byRoot, artifact.path).split(sep).join('/')
      return `${normal}\n\n[🔊 播放语音摘要](${virtual})`
    } catch {
      signal.throwIfAborted()
      return `${normal}\n\n语音摘要暂时不可用，请查看上方文字回复。`
    }
  }
}
/** Covers cancellation before an Agent exists and after its normal answer settles. */
export async function withVoiceCancellation<T>(context: AgentContext, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController()
  const check = () => { if (context.isCancelRequested?.()) control.abort() }
  check()
  const timer = setInterval(check, 50)
  timer.unref()
  try { return await operation(control.signal) } finally { clearInterval(timer) }
}

/** Hide the speech-only summary even when its delimiters span network chunks. */
export class VoiceSummaryStreamFilter {
  private pending = ''
  private inside = false
  write(text: string): string {
    this.pending += text
    let output = ''
    for (;;) {
      const marker = this.inside ? '</voice_summary>' : '<voice_summary>'
      const index = this.pending.indexOf(marker)
      if (index >= 0) {
        if (!this.inside) output += this.pending.slice(0, index)
        this.pending = this.pending.slice(index + marker.length)
        this.inside = !this.inside
        continue
      }
      let suffix = Math.min(marker.length - 1, this.pending.length)
      while (suffix > 0 && !marker.startsWith(this.pending.slice(-suffix))) suffix--
      if (!this.inside) output += this.pending.slice(0, this.pending.length - suffix)
      this.pending = suffix ? this.pending.slice(-suffix) : ''
      return output
    }
  }
  finish(): string {
    const output = this.inside ? '' : this.pending
    this.pending = ''
    this.inside = false
    return output
  }
}
