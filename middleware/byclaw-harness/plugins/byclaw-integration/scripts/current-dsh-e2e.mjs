/** Two official headless-profile launches exercise current DSH without Redis or API keys. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { writeAgentTemplate } from '../lib/agent-template.js'
import { registerAgentTemplateRuntime } from '../lib/template-runtime.js'
import { ByClawSkillRuntime } from '../lib/skill-runtime.js'
import { ByClawSessionWorkspaceRegistry } from '../lib/session-workspace.js'
import { ByClawDshSessionRuntime, ByClawAsyncTeamGate, TimedChunkBatcher, loadPersistedSessionById } from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'

export const name = 'byclaw-current-dsh-e2e'
export const inject = ['sessions', 'agents', 'agentLoop', 'subagents', 'sessionPersistence', 'llm', 'skills', 'tools', 'systemPrompt']
const parentId = SessionId('byclaw-e2e-parent')
const childId = SessionId('byclaw-e2e-child')
const templateId = 'byclaw-e2e-template'
const selection = { provider: 'byclaw-e2e-mock', model: 'byclaw-e2e-model' }
const userTexts = session => session.ownEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'user')
  .map(e => e.data.content.find(b => b.type === 'text')?.text)

/** Loaded by the shipped DSH CLI, never by a replacement application kernel. */
export function apply(ctx) {
  const requests = []
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  class ProbeAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      const ordinary = options.messages.filter(m => m.role === 'user' && m.source.kind === 'user').at(-1)
      const prompt = ordinary?.content.find(b => b.type === 'text')?.text ?? 'settlement'
      const system = options.system ?? options.messages
        .filter(message => message.role === 'system')
        .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
        .join('\n')
      requests.push({ prompt, system, provider: options.provider, model: options.model })
      const text = `answer:${prompt}`
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: 'probe-thinking' }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'probe-thinking' } }
      yield { type: 'block-start', index: 1, blockType: 'text' }
      yield { type: 'text-delta', index: 1, text: 'answer:' }
      if (prompt === 'first') { entered.resolve(); await release.promise }
      yield { type: 'text-delta', index: 1, text: prompt }
      yield { type: 'block-end', index: 1, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter([selection.provider], new ProbeAdapter())
  void runProbe(ctx, requests, entered, release).then(
    () => ctx.get('appExit')(0),
    async error => {
      release.resolve()
      console.error(error)
      await writeFile(join(process.env.BYCLAW_E2E_ROOT, `${process.env.BYCLAW_E2E_PHASE}.error.txt`), error.stack ?? String(error))
      ctx.get('appExit')(1)
    },
  )
}

async function runProbe(ctx, requests, entered, release) {
  await ctx.get('loader').await()
  const root = process.env.BYCLAW_E2E_ROOT
  const phase = process.env.BYCLAW_E2E_PHASE
  const workspace = join(root, 'workspace')
  const catalog = join(root, 'catalog')
  const skillDir = join(root, 'skill')
  assert.ok(ctx.subagents.list().includes('spawn'), 'the shipped spawn backend must be mounted')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: e2e-skill\ndescription: E2E template skill\n---\nE2E_SKILL_BODY\n')
  const template = {
    schemaVersion: 'dsh.agent-template/v1', id: templateId, kind: 'agent', name: 'E2E employee',
    description: 'current runtime regression', persona: 'E2E_TEMPLATE_PERSONA',
    skills: [{ code: 'e2e-skill', path: skillDir, ref: {
      id: 'fixture', code: 'e2e-skill', type: 'SKILL', versionUrl: '/version', downloadUrl: '/zip',
    } }],
    source: { system: 'byclaw', resourceId: 'e2e', resourceCode: 'E2E', workerAgentType: 'BYCLAW_DSH', directlyAuthorized: true },
  }
  await writeAgentTemplate(catalog, template)
  await mkdir(join(root, 'builtin'), { recursive: true })
  let skillLoads = 0
  const skillRuntime = await ByClawSkillRuntime.install(ctx, {
    builtinSkillDir: join(root, 'builtin'),
    resolveDeferredTemplate: async deferred => {
      skillLoads++
      return { ...deferred, skills: deferred.skills.map(({ ref: _ref, ...skill }) => skill) }
    },
  })
  ;(await skillRuntime.prepareGeneration([template], root, root))()
  assert.equal(skillLoads, 0, 'startup must not load associated Skill content')
  const registry = new ByClawSessionWorkspaceRegistry()
  const templates = registerAgentTemplateRuntime(ctx, { catalogDir: catalog, subagentProvider: 'spawn',
    resolveModel: async () => selection, workspaceRegistry: registry, skillRuntime })
  const priorParent = await loadPersistedSessionById(ctx.sessionPersistence, parentId)
  if (phase === 'create') assert.equal(priorParent, undefined)
  else assert.equal(priorParent.meta.id, parentId)
  const parentHandle = phase === 'create'
    ? await ctx.agents.create({ sessionId: parentId, meta: { cwd: workspace }, agentOptions: selection })
    : await ctx.agents.resume({ resumeSessionId: parentId, agentOptions: selection })
  const parent = parentHandle.agent
  registry.registerRoot(parent.session, parentId)
  const output = []
  const firstProjected = Promise.withResolvers()
  const live = []
  const disposeLive = ctx.root.on('agent/assistant-stream', ({ agent, frame }) => {
    if (agent.id === childId) live.push({ type: frame.type, ...frame.type === 'chunk' ? { chunk: frame.chunk } : {} })
  })
  const projection = new ByClawDshSessionRuntime(ctx, {
    sourceAgentType: 'BYCLAW_DSH', agentTemplateDir: catalog, workspaceRegistry: registry,
    emitter: { async emitChunk(...args) { output.push(args); if (args[2]?.content === 'answer:') firstProjected.resolve() } },
  })
  const turn = {
    context: { sessionId: parentId, traceId: `e2e-${phase}` }, rootSessionId: parentId,
    responseSessionId: childId, rootMessageId: 'e2e-command', rootLabel: 'E2E',
    teamGate: new ByClawAsyncTeamGate(), runtime: new ByClawSessionActivityTracker(parentId),
    forwarding: Promise.resolve(), answer: '', childTurns: new Map(), announcedChildren: new Set(),
    recoveryNotifiedAgents: new Set(), toolNames: new Map(), toolMutations: new Map(),
    answerChunks: new TimedChunkBatcher(), reasoningChunks: new TimedChunkBatcher(),
    chunkSequences: new Map(), reasoningChunkSequences: new Map(),
  }
  projection.active.set(parentId, turn)
  const signal = new AbortController().signal
  let child
  if (phase === 'create') {
    child = (await templates.instantiate(parent, templateId, 'first', signal, childId)).agent
    await entered.promise
    const skillCall = await ctx.tools.execute({ agent: child, signal,
      callId: ToolCallId('e2e-lazy-skill'), name: 'skill', arguments: { name: 'e2e-skill' } })
    assert.equal(skillCall.isError, false, `the shipped Skill tool must load the deferred Skill: ${JSON.stringify(skillCall)}`)
    assert.ok(JSON.stringify(skillCall).includes('E2E_SKILL_BODY'), 'the tool must return the associated Skill body')
    await firstProjected.promise
    await turn.forwarding
    assert.ok(live.some(f => f.type === 'chunk' && f.chunk.type === 'text-delta'), 'real agent loop must emit live frames before settlement')
    assert.equal(child.session.ownEvents().some(e => e.type === 'assistant/message'), false, 'first response remains unsettled')
    await templates.deliver(parent, templateId, 'second', childId, signal)
    await templates.deliver(parent, templateId, 'third', childId, signal)
    release.resolve()
  } else {
    assert.equal(ctx.agents.get(childId), undefined, 'second process must begin with a cold child')
    child = await templates.deliver(parent, templateId, 'resumed', childId, signal)
  }
  await child.whenIdle()
  await parent.whenIdle()
  await turn.forwarding
  await projection.flushTurnBuffers(turn, parent.session)
  assert.equal(child.session.header.version, SESSION_FORMAT_VERSION)
  assert.equal(child.session.header.parentSession, parent.id)
  assert.equal(child.session.header.cwd, workspace)
  assert.equal(registry.get(childId)?.cwd, workspace, 'template composition inherits authoritative workspace')
  const descriptor = foldSubagentDescriptor(child.session.ownEvents())
  assert.equal(descriptor.mode, 'continuable')
  assert.equal(descriptor.agentProvider, selection.provider)
  assert.equal(descriptor.agentModel, selection.model)
  const expected = phase === 'create' ? ['first', 'second', 'third'] : ['first', 'second', 'third', 'resumed']
  assert.deepEqual(userTexts(child.session), expected, 'real child inbox must preserve FIFO across cold resume')
  const answers = child.session.ownEvents().filter(e => e.type === 'assistant/message')
    .map(e => e.data.message.content.filter(b => b.type === 'text').map(b => b.text).join(''))
  assert.deepEqual(answers, expected.map(text => `answer:${text}`))
  assert.equal(turn.answer, phase === 'create' ? 'answer:firstanswer:secondanswer:third' : 'answer:resumed',
    'ByClaw live and durable event forwarding must not duplicate output')
  assert.ok(requests.filter(r => expected.includes(r.prompt)).every(r => r.system.includes('E2E_TEMPLATE_PERSONA') && r.system.includes(workspace)),
    'template persona and workspace must exist from the first provider request')
  const skills = await ctx.skills.list({ scope: child })
  assert.ok(skills.some(s => s.name === 'e2e-skill'), 'real template composition must install scoped Skill')
  assert.ok(skillLoads > 0, 'real catalog lookup must activate deferred Skills')
  assert.ok(live.some(f => f.type === 'end'), 'real lifecycle must settle its assistant stream')
  // The spawn backend may retain a child in its own session-store scope.
  // Flush visible live entries; the exact persisted-event assertions below
  // also verify the child loop's durability checkpoint when no entry is exposed.
  const liveChild = child.ctx.sessions.get(child.id)
  if (liveChild !== undefined) await child.ctx.sessions.flush(liveChild)
  await parent.ctx.sessions.flush(parent.session)
  const persisted = await loadPersistedSessionById(ctx.sessionPersistence, child.id)
  assert.equal(persisted.meta.version, SESSION_FORMAT_VERSION)
  assert.equal(persisted.inheritedEventCount, child.session.inheritedEventCount)
  assert.deepEqual(persisted.events.slice(persisted.inheritedEventCount), child.session.ownEvents())
  assert.equal(persisted.events.filter(e => e.type === 'assistant/message').length, expected.length)
  await writeFile(join(root, `${phase}.json`), JSON.stringify({
    phase, cwd: workspace, parent: parent.id, child: child.id,
    inputOrder: userTexts(child.session), answers, byclawAnswer: turn.answer,
    liveFrameCount: live.length, projectionCount: output.length,
    templateSkill: skills.find(s => s.name === 'e2e-skill').name,
    persistedEvents: persisted.events.length, headerVersion: persisted.meta.version,
    requests: requests.map(({ prompt }) => prompt),
  }, null, 2))
  disposeLive()
  turn.teamGate.dispose()
  projection.active.clear()
  await projection.close()
  await parentHandle.dispose()
  console.log(`BYCLAW_CURRENT_DSH_E2E_${phase.toUpperCase()}_PASS`)
}

async function runMain() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const dshRoot = resolve(process.env.DSH_ROOT ?? resolve(repoRoot, '../deepseek-harness'))
  const root = await mkdtemp(join(tmpdir(), 'byclaw-current-dsh-e2e-'))
  const home = join(root, 'home')
  const profile = join(home, 'profiles', 'headless')
  const modules = join(profile, 'node_modules')
  await mkdir(modules, { recursive: true })
  await mkdir(join(root, 'workspace'), { recursive: true })
  // Isolated package resolution uses this exact checkout; no install or registry fallback.
  async function linkPackage(path) {
    let manifest
    try { manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) } catch { return }
    if (!manifest.name) return
    const target = join(modules, manifest.name)
    await mkdir(dirname(target), { recursive: true })
    try { await symlink(path, target, 'dir') } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  for (const entry of await readdir(join(dshRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const child of await readdir(join(dshRoot, 'packages', entry.name), { withFileTypes: true })) {
      if (child.isDirectory()) await linkPackage(join(dshRoot, 'packages', entry.name, child.name))
    }
  }
  for (const folder of ['vendor', 'apps']) {
    for (const entry of await readdir(join(dshRoot, folder), { withFileTypes: true })) {
      if (entry.isDirectory()) await linkPackage(join(dshRoot, folder, entry.name))
    }
  }
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'byclaw-current-dsh-e2e', private: true,
    dependencies: Object.fromEntries(bundles.map((name, i) => [name, `link:${join(dshRoot, 'packages/bundle', i ? 'headless' : 'base')}`])),
    dsh: { profile: { bundles } },
  }, null, 2))
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  const patch = join(root, 'probe.patch.yml')
  await writeFile(patch, `- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- id: session-title-llm\n  disabled: true\n- id: session-persistence-jsonl\n  config:\n    root: ${JSON.stringify(join(home, 'sessions'))}\n    compression: none\n- id: agent-default-model\n  config:\n    provider: byclaw-e2e-mock\n    model: byclaw-e2e-model\n- insert:\n    - id: byclaw-current-dsh-e2e\n      name: ${JSON.stringify(fileURLToPath(import.meta.url))}\n`)
  for (const phase of ['create', 'resume']) {
    const output = []
    const child = spawn(process.execPath, [...(process.env.BYCLAW_E2E_SOURCE_CLI === '1' ? ['--import', 'tsx/esm', join(dshRoot, 'apps/cli/src/bin.ts')] : [join(dshRoot, 'apps/cli/lib/bin.js')]),
      '--profile', 'headless', '--patch', patch], {
      cwd: dshRoot, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', TSX_TSCONFIG_PATH: join(dshRoot, 'tsconfig.json'), BYCLAW_E2E_ROOT: root, BYCLAW_E2E_PHASE: phase },
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    })
    const stop = signal => {
      try {
        if (process.platform === 'win32') child.kill(signal)
        else process.kill(-child.pid, signal)
      } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    let forceTimer
    const timer = setTimeout(() => { stop('SIGTERM'); forceTimer = setTimeout(() => stop('SIGKILL'), 5000) }, 60000)
    child.stdout.on('data', data => output.push(data.toString()))
    child.stderr.on('data', data => output.push(data.toString()))
    let code
    try {
      code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
    } finally {
      clearTimeout(timer)
      clearTimeout(forceTimer)
      if (child.pid !== undefined) stop('SIGKILL') // Reap this probe's remaining subprocesses.
    }
    await writeFile(join(root, `${phase}.log`), output.join(''))
    if (code !== 0) throw new Error(`DSH ${phase} failed (${code}); artifacts: ${root}\n${output.join('').slice(-16000)}`)
    assert.ok(output.join('').includes(`BYCLAW_CURRENT_DSH_E2E_${phase.toUpperCase()}_PASS`))
  }
  console.log(`Official DSH profile create + cold-resume E2E passed. Artifacts: ${root}`)
  for (const phase of ['create', 'resume']) console.log(await readFile(join(root, `${phase}.json`), 'utf8'))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMain()
}
