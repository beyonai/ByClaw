/** Shared-host opt-ins: user-tree I/O on the tool environment, configurable roots, worker history. */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AskAgentCommand, HistoryProvider, MessageHeader } from '@byclaw/by-framework'
import { createFakeToolEnvironment } from './tool-environment-fakes.mjs'
import { lazyToolEnvironmentFiles, mediaArtifactIo, toolEnvironmentFiles } from '../src/tool-environment-files.ts'
import { ByClawVoiceRuntime } from '../src/voice-runtime.ts'
import { createVoiceHttpHandler } from '../src/voice-http.ts'
import { saveMediaArtifact, saveWordTimingArtifact } from '../src/media-generation/artifacts.ts'
import { loadProjectedMediaModel, MEDIA_PROJECTION_ROOT, mediaProjectionRoot, resolveMediaProjectionPath } from '../src/media-generation/runtime-config.ts'
import { resolvePluginMediaModel } from '../src/media-generation/plugin-model.ts'
import { persistFileChangesSummary } from '../src/file-changes.ts'
import { memberSkillProjectionRoot, memberSkillRoot, resolveByClawDshHome } from '../src/group-skill-resources.ts'
import { GroupStateBoundary } from '../src/group-state-boundary.ts'
import { writeCachedByClawSkill } from '../src/skill-sync.ts'
import { agentSkillRootFor, AGENT_SKILLS_ROOT } from '../src/skill-runtime.ts'
import { applyByClawWorkerHistory, NO_WORKER_HISTORY } from '../src/worker-history.ts'
import { Config } from '../lib/index.js'

const b = await createFakeToolEnvironment()
let checks = 0
const check = (condition, message) => { assert.ok(condition, message); checks += 1 }
try {
  const files = toolEnvironmentFiles(b.ctx)
  const byRoot = join(b.virtual, 'by')

  // --- file primitives -------------------------------------------------------
  await files.ensureDirectory(join(byRoot, '.sessions', 's1'))
  check(((await stat(b.toHost(join(byRoot, '.sessions', 's1')))).mode & 0o777) === 0o700, 'ensureDirectory creates owner-only directories on B')
  check(b.calls.subprocess.some(argv => argv[0] === '/bin/sh' && argv.includes(join(byRoot, '.sessions', 's1'))), 'mkdir runs through ctx.subprocess')
  await assert.rejects(files.realpath(join(byRoot, 'missing')), { code: 'ENOENT' }); checks += 1
  await assert.rejects(files.listDir(join(byRoot, 'missing')), { code: 'ENOENT' }); checks += 1
  await files.writeText(join(byRoot, 'a', 'b', 'note.txt'), 'hello')
  check(await readFile(b.toHost(join(byRoot, 'a', 'b', 'note.txt')), 'utf8') === 'hello', 'writeText creates parents through ctx.fs')
  await assert.rejects(files.writeText(join(byRoot, 'a', 'b', 'note.txt'), 'again', { exclusive: true }), { code: 'EEXIST' }); checks += 1
  await assert.rejects(files.listDir(join(byRoot, 'a', 'b', 'note.txt')), { code: 'ENOTDIR' }); checks += 1
  const binary = Buffer.from([0, 255, 1, 254, 10, 13, 0, 128])
  await files.writeBytes(join(byRoot, 'bin', 'x.bin'), binary)
  check(Buffer.compare(await readFile(b.toHost(join(byRoot, 'bin', 'x.bin'))), binary) === 0, 'binary bytes survive stdin piping unchanged')
  await files.writeBytes(join(byRoot, 'bin', 'x.bin'), Buffer.from('replaced'))
  check(await readFile(b.toHost(join(byRoot, 'bin', 'x.bin')), 'utf8') === 'replaced', 'non-exclusive byte writes replace atomically')
  check((await readdir(b.toHost(join(byRoot, 'bin')))).length === 1, 'atomic replacement leaves no temporary file')
  await assert.rejects(files.writeBytes(join(byRoot, 'bin', 'x.bin'), binary, { exclusive: true }), /failed/); checks += 1
  check(Buffer.compare(await files.readBytes(join(byRoot, 'bin', 'x.bin'), 1024), Buffer.from('replaced')) === 0, 'readBytes goes through ctx.fs')
  await symlink(b.toHost(join(byRoot, 'bin')), b.toHost(join(byRoot, 'link')))
  check(await files.realpath(join(byRoot, 'link')) === join(byRoot, 'bin'), 'realpath resolves symlinks on B')
  check((await files.lstat(join(byRoot, 'link')))?.type === 'symlink', 'lstat does not follow a final symlink')
  await files.remove(join(byRoot, 'bin', 'x.bin'))
  check((await files.lstat(join(byRoot, 'bin', 'x.bin'))) === undefined, 'remove deletes on B; lstat reports absence')
  const io = mediaArtifactIo(files)
  check(typeof io.writeExclusive === 'function' && typeof io.realpath === 'function', 'media artifact io adapter')

  // --- voice runtime and ASR HTTP --------------------------------------------
  const audio = Buffer.from('ID3voice-fixture')
  const voice = { audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg' }
  const model = { provider: 'VOLCENGINE', protocol: 'VOLCENGINE_ASR', model: 'bigmodel', endpoint: 'https://example.invalid', timeoutMs: 2000, headers: {}, options: {}, apiKey: 'fixture' }
  const command = new AskAgentCommand(new MessageHeader('voice-1', '123', 'trace', { userCode: 'alice' }), '[语音消息]', false, { messageType: 'VOICE', voice })
  let transcribed = 0
  const runtime = new ByClawVoiceRuntime({ byRoot, userCode: 'alice', files, resolveModel: async () => model,
    transcribe: async (_, bytes) => { transcribed++; assert.deepEqual(bytes, audio); return { text: '打开报告', provider: 'VOLCENGINE', model: 'bigmodel' } },
    speak: async () => [{ bytes: Buffer.from('ID3speech'), mimeType: 'audio/mpeg' }],
  })
  const prepared = await runtime.prepare(command, '123', new AbortController().signal)
  check(prepared.transcript === '打开报告', 'voice prepare transcribes with the tool-environment tree')
  const asrDir = b.toHost(join(byRoot, '.sessions', '123', 'asr'))
  const asrFiles = await readdir(asrDir)
  check(asrFiles.filter(name => name.endsWith('.mp3')).length === 1 && asrFiles.filter(name => name.endsWith('.json')).length === 1, 'ASR audio and transcript cache land on B')
  check(b.calls.fs.some(([operation, path]) => operation === 'writeText' && path.endsWith('.json')), 'transcript cache is written through ctx.fs writeText')
  await runtime.prepare(command, '123', new AbortController().signal)
  check(transcribed === 1, 'redelivery reads the transcript cache from B')
  const answer = await runtime.finish('完整。\n<voice_summary>摘要。</voice_summary>', prepared, new AbortController().signal)
  check(/\[🔊 播放语音摘要\]\(\/by\/\.sessions\/123\/tts\/[0-9a-f-]+\.mp3\)$/u.test(answer), `TTS artifact link stays a /by path: ${answer}`)
  check((await readdir(b.toHost(join(byRoot, '.sessions', '123', 'tts')))).length === 1, 'TTS audio lands on B')
  await mkdir(b.toHost(join(byRoot, 'uploads')), { recursive: true })
  await writeFile(b.toHost(join(byRoot, 'uploads', 'v.mp3')), audio)
  const fileVoice = new AskAgentCommand(new MessageHeader('voice-2', '124', 'trace', { userCode: 'alice' }), '[语音消息]', false, { messageType: 'VOICE', voice: { filePath: '/by/uploads/v.mp3' } })
  check((await runtime.prepare(fileVoice, '124', new AbortController().signal)).transcript === '打开报告', 'uploaded /by audio is read from B through readBytes')
  check(b.calls.fs.some(([operation, path]) => operation === 'readBytes' && path.endsWith('v.mp3')), 'voice input uses ctx.fs readBytes')
  const hiddenVoice = new AskAgentCommand(new MessageHeader('voice-3', '125', 'trace', { userCode: 'alice' }), '[语音消息]', false, { messageType: 'VOICE', voice: { filePath: '/by/.connector-auth/v.mp3' } })
  await mkdir(b.toHost(join(byRoot, '.connector-auth')), { recursive: true })
  await writeFile(b.toHost(join(byRoot, '.connector-auth', 'v.mp3')), audio)
  await assert.rejects(runtime.prepare(hiddenVoice, '125', new AbortController().signal), /ASR_AUDIO_PATH_REJECTED/); checks += 1
  await mkdir(b.toHost(join(byRoot, '.sessions', 'blocked')), { recursive: true })
  await symlink(b.host, b.toHost(join(byRoot, '.sessions', 'blocked', 'asr')))
  await assert.rejects(runtime.prepare(command, 'blocked', new AbortController().signal), /ASR_SESSION_PATH_REJECTED/); checks += 1
  const cacheName = asrFiles.find(name => name.endsWith('.json'))
  await writeFile(b.toHost(join(byRoot, 'outside.json')), JSON.stringify({ text: 'outside' }))
  await rm(join(asrDir, cacheName))
  await symlink(b.toHost(join(byRoot, 'outside.json')), join(asrDir, cacheName))
  await assert.rejects(runtime.prepare(command, '123', new AbortController().signal), /ASR_CACHE_INVALID/); checks += 1

  const handler = createVoiceHttpHandler({ byRoot, files, authHeaders: async () => ({ 'Beyond-Token': 'token' }), resolveModel: async () => model,
    transcribe: async () => ({ text: 'manual', provider: 'VOLCENGINE', model: 'bigmodel' }) })
  const { createServer } = await import('node:http')
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'Beyond-Token': 'token' },
      body: JSON.stringify({ audioBase64: voice.audioBase64, mimeType: 'audio/mpeg', sessionId: 'http1' }) })
    check(response.status === 200, 'ASR HTTP accepts with the tool-environment tree')
    check((await readdir(b.toHost(join(byRoot, '.sessions', 'http1', 'asr')))).length === 1, 'ASR HTTP audio lands on B')
  } finally { await new Promise(resolve => server.close(resolve)) }

  // --- media artifacts and connector projections -----------------------------
  const workspace = join(byRoot, '.sessions', 'media')
  const image = await saveMediaArtifact(workspace, 'image', Buffer.from([137, 80, 78, 71, 0, 1, 2]), 'image/png', files)
  check(Buffer.compare(await readFile(b.toHost(image.path)), Buffer.from([137, 80, 78, 71, 0, 1, 2])) === 0, 'media artifact bytes land on B')
  const timing = await saveWordTimingArtifact(workspace, [{ word: 'hi', startTime: 0, endTime: 1 }], { text: 'hi' }, files)
  check(JSON.parse(await readFile(b.toHost(timing.path), 'utf8')).words.length === 1, 'word-timing artifact is written through ctx.fs')

  check(resolveMediaProjectionPath('IMAGE', {}) === `${MEDIA_PROJECTION_ROOT}/image.json`, 'default projection path is unchanged')
  const projectionRoot = mediaProjectionRoot(byRoot)
  check(projectionRoot === join(byRoot, '.connector-auth', '.model'), 'projection root derives from byRoot')
  check(resolveMediaProjectionPath('TTS', {}, projectionRoot) === join(projectionRoot, 'tts.json'), 'projection path under a configured root')
  check(resolveMediaProjectionPath('TTS', { BYCLAW_TTS_MODEL_CONFIG_PATH: join(projectionRoot, 'u', 'tts.json') }, projectionRoot) === join(projectionRoot, 'u', 'tts.json'), 'env override stays within the configured root')
  assert.throws(() => resolveMediaProjectionPath('TTS', { BYCLAW_TTS_MODEL_CONFIG_PATH: '/by/.connector-auth/.model/tts.json' }, projectionRoot), /MEDIA_PROJECTION_PATH_INVALID/); checks += 1
  await assert.rejects(loadProjectedMediaModel(join(projectionRoot, 'tts.json'), 'TTS', undefined, files), { code: 'ENOENT' }); checks += 1
  const projection = { schemaVersion: 1, revision: 'rev-1', connectorCode: 'speech-generation-model', modelName: 'Voice', modelCode: 'voice-1',
    modelType: 'TTS', modelProtocol: 'VOLCENGINE_TTS_V3', apiEndpoint: 'https://speech.example.com/api', apiToken: 'secret', headers: [],
    connectTimeoutSeconds: 5, readTimeoutSeconds: 60, maxRetryCount: 0, retryIntervalSeconds: 0, options: {} }
  await mkdir(b.toHost(projectionRoot), { recursive: true })
  await writeFile(b.toHost(join(projectionRoot, 'tts.json')), JSON.stringify(projection))
  check((await loadProjectedMediaModel(join(projectionRoot, 'tts.json'), 'TTS', 'rev-1', files)).revision === 'rev-1', 'projection is read from B')
  const redis = { hget: async () => { throw new Error('system default must not be consulted') } }
  check((await resolvePluginMediaModel(redis, 'TTS', { projectionRoot, files })).provider === 'VOLCENGINE', 'plugin model resolution reads the B projection')
  await symlink(b.toHost(join(projectionRoot, 'tts.json')), b.toHost(join(projectionRoot, 'image.json')))
  await assert.rejects(loadProjectedMediaModel(join(projectionRoot, 'image.json'), 'IMAGE', undefined, files), /symbolic link/); checks += 1
  const fallbackRedis = { hget: async () => JSON.stringify([{ instanceId: 'img', modelType: 'IMAGE_GENERATION', isDefault: 1, status: 1,
    modelCode: 'm', url: 'https://example.com', authToken: 'x', instanceParam: { providerName: 'OPENAI', modelProtocol: 'OPENAI_IMAGE' } }]) }
  check((await resolvePluginMediaModel(fallbackRedis, 'IMAGE_GENERATION', { projectionRoot: join(byRoot, 'none'), files })).source === 'system-default', 'absent B projection falls back to the system default')

  // --- file-change snapshots --------------------------------------------------
  const change = { path: 'report.md', changeType: 'modified', oldText: 'a', newText: 'b', binary: false, additions: 1, deletions: 1, sources: ['edit'] }
  const payload = await persistFileChangesSummary(join(byRoot, 'projects', 'p'), 'sess-1', [change], { userFsRoot: byRoot, files })
  check(payload?.files.length === 1, 'file-change summary is produced')
  check((await readdir(b.toHost(join(byRoot, '.file_changes', 'sess-1', 'files')))).length === 1, 'file-change snapshot lands on B under the configured userFsRoot')
  const localRoot = join(b.host, 'local-userfs')
  const previous = process.env.BYCLAW_USER_FS_ROOT
  process.env.BYCLAW_USER_FS_ROOT = join(b.host, 'env-userfs')
  try {
    await persistFileChangesSummary(join(localRoot, 'projects', 'p'), 'sess-2', [change], { userFsRoot: localRoot })
    check((await readdir(join(localRoot, '.file_changes', 'sess-2', 'files'))).length === 1, 'configured userFsRoot overrides BYCLAW_USER_FS_ROOT')
    await persistFileChangesSummary(join(localRoot, 'projects', 'p'), 'sess-3', [change])
    check((await readdir(join(b.host, 'env-userfs', '.file_changes', 'sess-3', 'files'))).length === 1, 'default still honors BYCLAW_USER_FS_ROOT')
  } finally {
    if (previous === undefined) delete process.env.BYCLAW_USER_FS_ROOT
    else process.env.BYCLAW_USER_FS_ROOT = previous
  }

  // --- DSH home threading -----------------------------------------------------
  const homeA = join(b.host, 'users', 'a', 'dsh-home')
  const homeB = join(b.host, 'users', 'b', 'dsh-home')
  check(resolveByClawDshHome(homeA) === homeA, 'explicit dshHome wins over DSH_HOME')
  check(memberSkillProjectionRoot(homeA) === join(b.host, 'users', 'a', '.byclaw-member-skills'), 'member Skill projection root follows dshHome')
  check(memberSkillRoot('agent', homeA) !== memberSkillRoot('agent', homeB), 'member Skill roots are per DSH home')
  check(memberSkillRoot('agent', homeA).startsWith(memberSkillProjectionRoot(homeA)), 'member Skill root is inside its projection root')
  const boundary = new GroupStateBoundary({ privateRoots: [], getScope: () => undefined, dshHome: homeA })
  const actor = { agent: { id: 'm1', session: { header: { cwd: '/' } } }, scope: { role: 'member' } }
  for (const name of ['sessions', 'storages', 'runtime']) {
    assert.throws(() => boundary.actors.run(actor, () => boundary.assertPath(join(homeA, name, 'x'))), /GROUP_MEMBER_PRIVATE_STATE_DENIED/); checks += 1
  }
  boundary.actors.run(actor, () => boundary.assertPath(join(homeB, 'sessions', 'x')))
  check(true, 'another user home is not this context\'s private root')

  // --- skill roots, swap suffix, history and config ---------------------------
  check(AGENT_SKILLS_ROOT === '/by/.openclaw' && agentSkillRootFor(byRoot) === join(byRoot, '.openclaw'), 'employee Skill root default and byRoot derivation')
  const cacheRoot = join(b.host, 'skill-cache')
  const codes = ['s1', 's2', 's3', 's4']
  for (const code of codes) {
    await mkdir(join(b.host, 'skill-src', code), { recursive: true })
    await writeFile(join(b.host, 'skill-src', code, 'SKILL.md'), `---\nname: ${code}\ndescription: d\n---\n`)
  }
  // Same process, same millisecond, one shared private generations directory.
  await Promise.all(codes.map(code => writeCachedByClawSkill({ sourceDir: join(b.host, 'skill-src', code), targetDir: join(cacheRoot, code),
    metadata: { code, version: '1', downloadUrl: 'https://x/a', versionUrl: 'https://x/v' } })))
  for (const code of codes) {
    check((await readFile(join(cacheRoot, code, 'SKILL.md'), 'utf8')).includes(`name: ${code}`), `concurrent Skill publication ${code} keeps its own swap directory`)
  }
  check((await readdir(join(cacheRoot, '.byclaw-private-generations'))).length === 0, 'no swap or backup directory is left behind')

  const recorded = []
  HistoryProvider.setStorage({ saveMessage: async (...args) => { recorded.push(args) }, getSessionHistory: async () => [{ role: 'user', content: 'kept' }] })
  applyByClawWorkerHistory('memory')
  check((await HistoryProvider.getSessionHistory('s')).length === 1, "workerHistory 'memory' leaves the storage untouched")
  applyByClawWorkerHistory(undefined)
  check((await HistoryProvider.getSessionHistory('s')).length === 1, 'omitted workerHistory leaves the storage untouched')
  applyByClawWorkerHistory('none')
  await HistoryProvider.saveMessage('s', 'user', 'secret')
  check(recorded.length === 0 && (await HistoryProvider.getSessionHistory('s')).length === 0, "workerHistory 'none' records and returns nothing")
  check((await NO_WORKER_HISTORY.getSessionHistory('s', 0)).length === 0, 'no-op storage ignores limits')

  const defaults = Config({})
  check(defaults.workerHistory === 'memory' && defaults.workspaceOnToolEnvironment === false, 'defaults: memory history, host workspace')
  check(defaults.byRoot === undefined && defaults.dshHome === undefined && defaults.agentSkillRoot === undefined && defaults.userFsRoot === undefined, 'defaults: no explicit roots')
  const shared = Config({ workspaceOnToolEnvironment: true, byRoot: '/by', dshHome: '/data/u/dsh-home', agentSkillRoot: '/by/.openclaw', userFsRoot: '/by', workerHistory: 'none' })
  check(shared.workerHistory === 'none' && shared.dshHome === '/data/u/dsh-home', 'shared-host values are accepted')
  assert.throws(() => Config({ workerHistory: 'redis' })); checks += 1

  // Lazy access: nothing a context does before its first tool call may start B.
  {
    const deferred = new Map()
    const environment = { connected: false, async whenConnected(key, operation) { if (this.connected) { await operation(); return } deferred.set(key, operation) } }
    const lazy = lazyToolEnvironmentFiles(environment, toolEnvironmentFiles(b.ctx))
    const lazyRoot = join(byRoot, 'lazy')
    const before = b.calls.subprocess.length
    await lazy.ensureDirectory(join(lazyRoot, 'dir'))
    await lazy.writeText(join(lazyRoot, 'note.txt'), 'first')
    await lazy.writeText(join(lazyRoot, 'note.txt'), 'second')
    check(b.calls.subprocess.length === before, 'while B is down, directory creation and writes do not reach B')
    check(deferred.size === 2, 'one deferred operation per path, the latest write winning')
    check(await lazy.readText(join(lazyRoot, 'note.txt')) === 'second', 'a pending write is readable from this host meanwhile')
    check((await lazy.lstat(join(lazyRoot, 'note.txt')))?.type === 'file', 'a pending write stats as a file')
    check((await lazy.listDir(join(lazyRoot, 'dir'))).length === 0, 'a pending directory lists as empty')
    await assert.rejects(lazy.readText(join(lazyRoot, 'unknown.txt')), { code: 'ENOENT' }); checks += 1
    await assert.rejects(lazy.listDir(join(byRoot, '.sessions')), { code: 'ENOENT' }); checks += 1
    environment.connected = true
    for (const operation of deferred.values()) await operation()
    check((await readFile(b.toHost(join(lazyRoot, 'note.txt')), 'utf8')) === 'second', 'deferred writes land on B once it connects, latest content only')
    check((await stat(b.toHost(join(lazyRoot, 'dir')))).isDirectory(), 'deferred directories are created on B once it connects')
    check((await lazy.listDir(join(byRoot, '.sessions'))).some(entry => entry.name === 's1'), 'with B connected reads go to B')
    environment.connected = false
    check((await lazy.listDir(join(byRoot, '.sessions'))).some(entry => entry.name === 's1'), 'after B pauses, the last listing read from B is still served')
  }
  check(b.calls.fs.every(([, path]) => typeof path !== 'string' || !path.startsWith(b.host)), 'the tool environment only ever saw its own paths')
  console.log(`tool-environment verification passed (${String(checks)} checks): user-tree I/O via ctx.fs/ctx.subprocess, configurable roots, dshHome, worker history`)
} finally { await b.dispose() }
