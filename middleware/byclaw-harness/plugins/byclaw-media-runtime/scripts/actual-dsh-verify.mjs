/** Actual pinned DSH profile, scoped tool dispatch, unload, and cold session resume. No provider traffic. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const name = 'byclaw-media-actual-dsh-verify'
export const inject = ['agents', 'llm', 'sessions', 'sessionPersistence', 'tools']
const here = dirname(fileURLToPath(import.meta.url))
const plugins = resolve(here, '../..')
const sessionId = 'byclaw-media-lifecycle-probe'
const toolNames = ['image_generate', 'text_to_speech']
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')

function wavFixture() {
  const bytes = Buffer.alloc(48)
  bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(4, 40)
  return bytes
}

export function apply(ctx) {
  void runProbe(ctx).then(() => ctx.get('appExit')(0), error => {
    console.error(error)
    ctx.get('appExit')(1)
  })
}

async function runProbe(ctx) {
  await ctx.get('loader').await()
  const root = process.env.BYCLAW_MEDIA_VERIFY_ROOT
  const phase = process.env.BYCLAW_MEDIA_VERIFY_PHASE
  const dshRoot = process.env.DSH_ROOT
  const requireAgent = createRequire(join(dshRoot, 'packages/core/agent/package.json'))
  const { LlmAdapter } = await import(pathToFileURL(requireAgent.resolve('@deepseek-ai/dsh-llm')).href)
  const { ByClawSessionWorkspaceRegistry } = await import(pathToFileURL(join(dshRoot, 'plugins/byclaw-integration/lib/session-workspace.js')).href)
  class NoGenerationAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream() { throw new Error('This lifecycle probe must not invoke an LLM') }
  }
  ctx.llm.registerAdapter(['media-fixture'], new NoGenerationAdapter())
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://media-fixture.invalid', 'No real provider call is allowed')
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-secret')
    requests.push({ path: parsed.pathname, body: JSON.parse(init.body) })
    if (parsed.pathname === '/v1/images/generations') return Response.json({ data: [{ b64_json: png.toString('base64') }] })
    assert.equal(parsed.pathname, '/v1/audio/speech')
    return new Response(wavFixture(), { headers: { 'content-type': 'audio/wav' } })
  }
  const imagePlugin = await import(pathToFileURL(join(plugins, 'byclaw-image/src/index.js')).href)
  const speechPlugin = await import(pathToFileURL(join(plugins, 'byclaw-tts/src/index.js')).href)
  const fibers = []
  let handle
  try {
    fibers.push(await ctx.plugin(imagePlugin, { modelId: 'fixture-image' }))
    fibers.push(await ctx.plugin(speechPlugin, { modelId: 'fixture-tts' }))
    const workspace = join(root, 'workspace')
    const sessionRoot = join(root, 'session-root')
    assert.notEqual(workspace, sessionRoot)
    const options = { agentOptions: { provider: 'media-fixture', model: 'fixture' } }
    handle = phase === 'create'
      ? await ctx.agents.create({ ...options, sessionId, meta: { cwd: workspace } })
      : await ctx.agents.resume({ ...options, resumeSessionId: sessionId })
    const agent = handle.agent
    const registry = new ByClawSessionWorkspaceRegistry()
    registry.registerRoot(agent.session, sessionId, { sessionRoot, userCode: 'media-user' })
    const host = {
      userCode: 'media-user',
      resolveSessionRoot: id => registry.get(id)?.sessionRoot,
      resolveMediaModel: async (type, modelId) => {
        assert.equal(modelId, type === 'TTS' ? 'fixture-tts' : 'fixture-image')
        return { id: modelId, provider: 'OPENAI', protocol: type === 'TTS' ? 'OPENAI_TTS' : 'OPENAI_IMAGE',
          model: type === 'TTS' ? 'tts-1' : 'gpt-image-1', endpoint: 'https://media-fixture.invalid/v1',
          apiKey: 'fixture-secret', headers: {}, options: {}, timeoutMs: 5000 }
      },
    }
    const payload = { agent, agentCtx: agent.ctx, host, command: { header: { userCode: 'media-user', sessionId } } }
    assert.ok(toolNames.every(name => !ctx.tools.get(name)), 'No global media tools')
    assert.ok(toolNames.every(name => !ctx.tools.get(name, agent)), 'Agent starts without media binding')
    await ctx.serial('byclaw/session-setup', payload)
    await ctx.serial('byclaw/session-setup', payload)
    const schemas = ctx.tools.schemas(agent).filter(tool => toolNames.includes(tool.name))
    assert.equal(schemas.length, 2, 'Repeated setup must register one copy of each tool')
    for (const schema of schemas) {
      assert.equal(schema.parameters.additionalProperties, false)
      assert.deepEqual(schema.parameters.required, [schema.name === 'image_generate' ? 'prompt' : 'text'])
      assert.ok(schema.description.length <= 250)
      assert.doesNotMatch(JSON.stringify(schema), /fixture-secret|media-fixture\.invalid|apiKey|endpoint/)
    }
    await assert.rejects(ctx.serial('byclaw/session-setup', { ...payload, host: { ...host, userCode: 'other' } }), /MEDIA_SESSION_IDENTITY/)
    const signal = new AbortController().signal
    const dispatch = (name, args) => ctx.tools.execute({ name, arguments: args, agent, signal, callId: `${phase}-${name}-${requests.length}` })
    const invalid = await dispatch('image_generate', { prompt: 'test', endpoint: 'https://elsewhere.invalid' })
    assert.equal(invalid.isError, true)
    assert.equal(requests.length, 0, 'Invalid arguments must not reach the provider')
    const results = []
    for (const [name, args, kind, expected] of [
      ['image_generate', { prompt: 'a small blue dot' }, 'image', png],
      ['text_to_speech', { text: '验证音频。', format: 'wav' }, 'tts', wavFixture()],
    ]) {
      const outcome = await dispatch(name, args)
      assert.equal(outcome.isError, false, JSON.stringify(outcome))
      const result = JSON.parse(outcome.content.find(block => block.type === 'text').text)
      assert.equal(result.artifacts.length, 1)
      assert.equal(dirname(result.artifacts[0].path), join(sessionRoot, kind))
      assert.deepEqual(await readFile(result.artifacts[0].path), expected)
      assert.doesNotMatch(JSON.stringify(outcome), /fixture-secret|media-fixture\.invalid/)
      results.push({ name, path: result.artifacts[0].path, bytes: result.artifacts[0].bytes })
    }
    assert.equal(requests.length, 2)
    await ctx.sessions.flush(agent.session)
    await fibers[0].dispose()
    assert.equal(ctx.tools.get('image_generate', agent), undefined, 'Plugin unload removes scoped image tool')
    assert.ok(ctx.tools.get('text_to_speech', agent), 'Image unload preserves speech tool')
    fibers.push(await ctx.plugin(imagePlugin, { modelId: 'fixture-image' }))
    await ctx.serial('byclaw/session-setup', payload)
    assert.equal(ctx.tools.schemas(agent).filter(tool => tool.name === 'image_generate').length, 1)
    await handle.dispose(); handle = undefined
    assert.ok(toolNames.every(name => !ctx.tools.get(name, agent)), 'Agent disposal removes both media tools')
    if (phase === 'resume') {
      const prior = JSON.parse(await readFile(join(root, 'create.json'), 'utf8'))
      assert.equal(prior.sessionRoot, sessionRoot)
      for (const item of prior.results) assert.ok((await readFile(item.path)).length > 0, 'Cold resume retains prior artifacts')
    }
    await writeFile(join(root, `${phase}.json`), JSON.stringify({ phase, sessionId, workspace, sessionRoot, results, providerCalls: requests.length }, null, 2))
    console.log(`BYCLAW_MEDIA_ACTUAL_DSH_${phase.toUpperCase()}_PASS`)
  } finally {
    globalThis.fetch = originalFetch
    await handle?.dispose()
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
}

async function main() {
  if (!process.env.DSH_ROOT) throw new Error('Set DSH_ROOT to the built dsh-v0.1.5-rc.2 checkout')
  const dshRoot = resolve(process.env.DSH_ROOT)
  assert.equal(JSON.parse(await readFile(join(dshRoot, 'package.json'), 'utf8')).version, '0.1.5-rc.2')
  const root = await mkdtemp(join(tmpdir(), 'byclaw-media-actual-dsh-'))
  const home = join(root, 'home')
  const profile = join(home, 'profiles/headless')
  const modules = join(profile, 'node_modules')
  await Promise.all([modules, join(root, 'workspace'), join(root, 'session-root')].map(path => mkdir(path, { recursive: true })))
  async function linkPackage(path) {
    let manifest
    try { manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) } catch { return }
    if (!manifest.name) return
    const target = join(modules, manifest.name)
    await mkdir(dirname(target), { recursive: true })
    try { await symlink(path, target, 'dir') } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  for (const category of await readdir(join(dshRoot, 'packages'), { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    for (const child of await readdir(join(dshRoot, 'packages', category.name), { withFileTypes: true })) {
      if (child.isDirectory()) await linkPackage(join(dshRoot, 'packages', category.name, child.name))
    }
  }
  for (const folder of ['vendor', 'apps']) for (const entry of await readdir(join(dshRoot, folder), { withFileTypes: true })) {
    if (entry.isDirectory()) await linkPackage(join(dshRoot, folder, entry.name))
  }
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'byclaw-media-actual-dsh-verify', private: true,
    dependencies: Object.fromEntries(bundles.map((name, index) => [name, `link:${join(dshRoot, 'packages/bundle', index ? 'headless' : 'base')}`])),
    dsh: { profile: { bundles } } }, null, 2))
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  const patch = join(root, 'probe.patch.yml')
  await writeFile(patch, `- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- id: session-title-llm\n  disabled: true\n- id: session-persistence-jsonl\n  config:\n    root: ${JSON.stringify(join(home, 'sessions'))}\n    compression: none\n- id: agent-default-model\n  config:\n    provider: media-fixture\n    model: fixture\n- insert:\n    - id: byclaw-media-actual-dsh-verify\n      name: ${JSON.stringify(fileURLToPath(import.meta.url))}\n`)
  const requireDsh = createRequire(join(dshRoot, 'package.json'))
  for (const phase of ['create', 'resume']) {
    const output = []
    const child = spawn(process.execPath, ['--import', requireDsh.resolve('tsx/esm'), join(dshRoot, 'apps/cli/src/bin.ts'), '--profile', 'headless', '--patch', patch], {
      cwd: dshRoot, env: { ...process.env, DSH_ROOT: dshRoot, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
        TSX_TSCONFIG_PATH: join(dshRoot, 'tsconfig.json'), BYCLAW_MEDIA_VERIFY_ROOT: root, BYCLAW_MEDIA_VERIFY_PHASE: phase },
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    })
    const stop = signal => {
      try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal) }
      catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    let forceTimer
    const timer = setTimeout(() => { stop('SIGTERM'); forceTimer = setTimeout(() => stop('SIGKILL'), 5000) }, 60000)
    child.stdout.on('data', data => output.push(data.toString()))
    child.stderr.on('data', data => output.push(data.toString()))
    let code
    try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) }) }
    finally { clearTimeout(timer); clearTimeout(forceTimer); if (child.pid !== undefined) stop('SIGKILL') }
    await writeFile(join(root, `${phase}.log`), output.join(''))
    assert.equal(code, 0, `DSH ${phase} failed; evidence ${root}\n${output.join('').slice(-12000)}`)
    assert.ok(output.join('').includes(`BYCLAW_MEDIA_ACTUAL_DSH_${phase.toUpperCase()}_PASS`))
  }
  console.log(`Pinned official DSH lifecycle create + cold resume passed. Evidence: ${root}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
