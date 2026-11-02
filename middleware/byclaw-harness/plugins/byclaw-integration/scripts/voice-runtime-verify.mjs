import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { AskAgentCommand, MessageHeader } from '@byclaw/by-framework'
import { ByClawVoiceRuntime, VoiceSummaryStreamFilter, byClawVoicePayload, decodeVoiceBase64, withVoiceCancellation } from '../src/voice-runtime.ts'
import { ByClawDshSessionRuntime } from '../src/session-runtime.ts'
import { createVoiceHttpHandler } from '../src/voice-http.ts'
import { ByClawDshCommandHandler } from '../src/worker.ts'
import { resolvePluginMediaModel } from '../src/media-generation/plugin-model.ts'

const summaryOutput = '正常回答。\n<voice_summary>口语摘要。</voice_summary>结束。'
for (let split = 0; split <= summaryOutput.length; split++) {
  const filter = new VoiceSummaryStreamFilter()
  assert.equal(filter.write(summaryOutput.slice(0, split)) + filter.write(summaryOutput.slice(split)) + filter.finish(), '正常回答。\n结束。')
}
const characterFilter = new VoiceSummaryStreamFilter()
assert.equal([...summaryOutput].map(character => characterFilter.write(character)).join('') + characterFilter.finish(), '正常回答。\n结束。')
const literalFilter = new VoiceSummaryStreamFilter()
assert.equal(literalFilter.write('literal <voice') + literalFilter.finish(), 'literal <voice')
const root = await mkdtemp(join(tmpdir(), 'byclaw-voice-test-'))
const audio = Buffer.from('ID3voice-fixture')
const voice = { audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg' }
const model = { provider: 'VOLCENGINE', protocol: 'VOLCENGINE_ASR', model: 'bigmodel', endpoint: 'https://example.invalid', timeoutMs: 2000, headers: {}, options: {}, apiKey: 'fixture' }
const command = new AskAgentCommand(new MessageHeader('voice-1', '123', 'trace', { userCode: 'alice' }), '[语音消息]', false, { messageType: 'VOICE', voice })
assert.equal(byClawVoicePayload(command), voice)
assert.equal(byClawVoicePayload({ extraPayload: { payload: {}, ext_params: { messageType: 'VOICE', voice } } }), voice)
assert.throws(() => byClawVoicePayload({ extraPayload: { messageType: 'VOICE' } }), /ASR_AUDIO_REQUIRED/)
let called = 0
const runtime = new ByClawVoiceRuntime({ byRoot: root, userCode: 'alice', resolveModel: async () => model,
  transcribe: async (_, bytes) => { called++; assert.deepEqual(bytes, audio); return { text: '打开本周销售报告', provider: 'VOLCENGINE', model: 'bigmodel' } },
  speak: async (_, args) => { assert.equal(args.text, '报告已打开。'); return [{ bytes: Buffer.from('ID3speech'), mimeType: 'audio/mpeg' }] },
})
try {
  const prepared = await runtime.prepare(command, '123', new AbortController().signal)
  assert.equal(command.content, '[语音消息]', 'upstream command must not be mutated')
  assert.ok(prepared.command instanceof AskAgentCommand)
  assert.match(prepared.command.content, /打开本周销售报告/)
  assert.equal(prepared.command.extraPayload.userInput, '打开本周销售报告')
  assert.equal(prepared.command.extraPayload.voiceInteraction, true)
  assert.equal((await readdir(join(root, '.sessions/123/asr'))).filter(name => name.endsWith('.mp3')).length, 1)
  await runtime.prepare(command, '123', new AbortController().signal)
  assert.equal(called, 1, 'redelivery must reuse durable transcript')
  const result = await runtime.finish('完整报告。\n<voice_summary>报告已打开。</voice_summary>', prepared, new AbortController().signal)
  assert.match(result, /^完整报告。\n\n\[🔊 播放语音摘要\]\(\/by\/\.sessions\/123\/tts\//)
  assert.doesNotMatch(result, /voice_summary/)
  let admissions = 0
  command.content = ''
  await new ByClawDshCommandHandler({ ask: async () => { admissions++; return { answer: 'ok', finalAnswer: 'ok', dshSessionId: '123' } } }).process(command, { isCancelRequested: () => false })
  assert.equal(admissions, 1, 'audio-only messages reach ASR session preprocessing')
  await assert.rejects(runtime.prepare(command, '../escape', new AbortController().signal), /ASR_SESSION_INVALID/)
  await mkdir(join(root, '.sessions/blocked'), { recursive: true })
  await symlink(tmpdir(), join(root, '.sessions/blocked/asr'))
  await assert.rejects(runtime.prepare(command, 'blocked', new AbortController().signal), /ASR_SESSION_PATH_REJECTED/)
  await assert.rejects(runtime.prepare({ ...command, header: { ...command.header, userCode: 'bob' } }, '123', new AbortController().signal), /ASR_SESSION_IDENTITY/)
  assert.throws(() => decodeVoiceBase64('{}'), /ASR_AUDIO_INVALID/)
  const control = new AbortController(); control.abort()
  await assert.rejects(runtime.prepare(command, '123', control.signal), { name: 'AbortError' })
  let cancelRequested = false
  const cancelling = withVoiceCancellation({ isCancelRequested: () => cancelRequested }, signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
  const cancelTimer = setTimeout(() => { cancelRequested = true }, 10)
  const keepAlive = setTimeout(() => {}, 1000)
  await assert.rejects(cancelling, { name: 'AbortError' }); clearTimeout(cancelTimer); clearTimeout(keepAlive)

  const sessionRuntime = Object.assign(Object.create(ByClawDshSessionRuntime.prototype), {
    options: { byRoot: root, voiceRuntime: runtime }, voiceRequests: new Map(), voiceControllers: new Map(),
    messageAgents: new Map(), voiceSummaryStreams: new WeakMap(), askPrepared: async () => { admissions++; return { answer: '完整报告。', finalAnswer: '完整报告。<voice_summary>报告已打开。</voice_summary>', dshSessionId: '123' } },
  })
  admissions = 0
  const context = { isCancelRequested: () => false }
  const [first, second] = await Promise.all([sessionRuntime.ask(command, context), sessionRuntime.ask(command, context)])
  assert.deepEqual(first, second)
  assert.equal(admissions, 1, 'redelivery must not rerun Agent or TTS')
  const changedVoice = Object.assign(Object.create(Object.getPrototypeOf(command)), command, { extraPayload: { messageType: 'VOICE', voice: { ...voice, audioBase64: Buffer.from('ID3different').toString('base64') } } })
  await assert.rejects(sessionRuntime.ask(changedVoice, context), /ASR_IDEMPOTENCY_CONFLICT/)
  assert.equal(admissions, 1)
  const visibleChunks = []
  sessionRuntime.emitAnswerChunk = async (_turn, _session, _sequence, text) => { visibleChunks.push(text) }
  const outputTurn = { voiceInteraction: true, responseSessionId: '123', chunkSequences: new Map() }
  for (const character of summaryOutput) await sessionRuntime.emitBufferedChunk(outputTurn, { id: '123' }, '123:1:1', character)
  assert.equal(visibleChunks.join(''), '正常回答。\n结束。')
  const failedRuntime = Object.assign(Object.create(ByClawDshSessionRuntime.prototype), {
    options: { byRoot: root, voiceRuntime: { prepare: async () => { throw Error('ASR_PROVIDER_REJECTED') } }, emitter: { emitChunk: async (_id, _trace, chunk) => visibleChunks.push(chunk.content) } },
    voiceRequests: new Map(), voiceControllers: new Map(), messageAgents: new Map(),
  })
  await assert.rejects(failedRuntime.ask(command, { ...context, sessionId: '123', traceId: 'trace' }), /ASR_PROVIDER_REJECTED/)
  assert.match(visibleChunks.at(-1), /语音转文字失败/)
  failedRuntime.options.voiceRuntime.prepare = async () => { throw Error('ASR_SPEECH_NOT_DETECTED') }
  await assert.rejects(failedRuntime.ask(command, { ...context, sessionId: '123', traceId: 'trace' }), /ASR_SPEECH_NOT_DETECTED/)
  assert.equal(visibleChunks.at(-1), '未识别到语音，请靠近麦克风后重试')
  const cancellingRuntime = Object.assign(Object.create(ByClawDshSessionRuntime.prototype), {
    options: { byRoot: root, voiceRuntime: { prepare: async (_, __, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) } },
    voiceRequests: new Map(), voiceControllers: new Map(), messageAgents: new Map(),
  })
  const pendingAsk = cancellingRuntime.ask(command, context)
  await cancellingRuntime.cancel(command.header.messageId, 'cancel before Agent admission')
  await assert.rejects(pendingAsk, /cancelled/)

  const redis = { hget: async (key, type) => key.endsWith('typelist') ? JSON.stringify([{ instanceId: 'asr', modelType: type, isDefault: 1, status: 1 }]) : JSON.stringify({ ...model, instanceId: 'asr', modelType: 'ASR', modelCode: 'bigmodel', url: model.endpoint, authToken: 'fixture', status: 1, instanceParam: { providerName: 'VOLCENGINE', modelProtocol: 'VOLCENGINE_ASR' } }) }
  assert.equal((await resolvePluginMediaModel(redis, 'ASR')).provider, 'VOLCENGINE')
  let transcriptions = 0
  const handler = createVoiceHttpHandler({ byRoot: root, authHeaders: async () => ({ 'Beyond-Token': 'token' }), resolveModel: async () => model,
    transcribe: async () => { transcriptions++; return { text: 'manual transcript', provider: 'VOLCENGINE', model: 'bigmodel' } },
  })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/byclaw/asr/transcribe`
    const request = (body, token = 'token') => fetch(url, { method: 'POST', headers: { 'Beyond-Token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await request({ audioBase64: voice.audioBase64, mimeType: 'audio/mpeg' }, 'wrong')).status, 401)
    assert.equal(transcriptions, 0)
    const ok = await request({ audioBase64: voice.audioBase64, mimeType: 'audio/mpeg', sessionId: '123' })
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).text, 'manual transcript')
    assert.equal((await request({ audioBase64: voice.audioBase64, mimeType: 'audio/mpeg', model })).status, 400)
    assert.equal((await request({ audioBase64: '{}', mimeType: 'audio/mpeg' })).status, 400)
    const noSpeech = createVoiceHttpHandler({ byRoot: root, authHeaders: async () => ({ 'Beyond-Token': 'token' }), resolveModel: async () => model, transcribe: async () => { throw Error('ASR_SPEECH_NOT_DETECTED') } })
    const noSpeechServer = createServer(noSpeech)
    await new Promise(resolve => noSpeechServer.listen(0, '127.0.0.1', resolve))
    try {
      const failure = await fetch(`http://127.0.0.1:${noSpeechServer.address().port}/api/byclaw/asr/transcribe`, { method: 'POST', headers: { 'Beyond-Token': 'token' }, body: JSON.stringify({ audioBase64: voice.audioBase64, mimeType: 'audio/mpeg' }) })
      assert.equal(failure.status, 422)
      assert.deepEqual(await failure.json(), { code: 'ASR_SPEECH_NOT_DETECTED', message: '未识别到语音，请靠近麦克风后重试' })
    } finally { await new Promise(resolve => noSpeechServer.close(resolve)) }
  } finally { await new Promise(resolve => server.close(resolve)) }
  const cacheFile = (await readdir(join(root, '.sessions/123/asr'))).find(name => name.endsWith('.json'))
  await writeFile(join(root, 'outside.json'), JSON.stringify({ text: 'outside file' }))
  await rm(join(root, '.sessions/123/asr', cacheFile))
  await symlink(join(root, 'outside.json'), join(root, '.sessions/123/asr', cacheFile))
  await assert.rejects(runtime.prepare(command, '123', new AbortController().signal), /ASR_CACHE_INVALID/)
  console.log('voice-runtime verification passed: audio-only admission, scoped persistence, caching, summary, auth and cancellation')
} finally { await rm(root, { recursive: true, force: true }) }
