import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { prepareRuntime, prepareRuntimeSources, supportedDshVersion } from './prepare-dsh-model-routing-runtime.mjs'

// A compact executable fixture retains the release's admission/retry structure
// and patch anchors. It never imports or writes a real DSH installation.
const originalLoop = `
// The real module imports renderContextSections, joinContextSections and assembleContextFor.
class FixtureAgent {
  private async step(decision: FixtureDecision): Promise<unknown> {
    const { signal } = this
    const turn = 1
    const step = 2
    const { assembly } = decision
    const renderedPrompt = renderPrompt(assembly)
    let firstAttempt = true
    while (true) {
      const { config, preparedCall } = await this.prepareRequest(turn, step, signal)
      const currentContext = this.loopCtx.systemPrompt.refreshContext(assembly, assembleContextFor(this, signal))
      const sections = renderContextSections(currentContext)
      const context = this.runtimeContext.project(joinContextSections(sections), sections)
      signal.throwIfAborted()
      const startsRequestSeries = firstAttempt && decision.startsRequestSeries === true
      const commits = this.systemPrompt.project(renderedPrompt, { startsSeries: startsRequestSeries })
      for (const { message, intent } of commits) {
        this.session.append('system/message', { turn, step, message }, intent)
      }
      if (firstAttempt) {
        for (const message of decision.messages) {
          this.session.append('user/message', message, { surfaceOp: 'append' })
        }
      }
      if (context !== undefined) {
        this.session.append('user/message', context, { surfaceOp: 'append' })
      }
      firstAttempt = false
      const request = this.buildRequest(config, preparedCall, assembly.tools, { turn, step }, startsRequestSeries, signal)
      const live = new AssistantStreamAttempt(
        this.nextFinish(),
        (frame) => { this.dispatch.emit('agent/assistant-stream', { frame }) },
      )
      {
        const finish = live.finish
        if (finish.kind === 'error') {
          const action = await this.dispatch.waterfall('agent/request-error', { failure: finish.failure })
          signal.throwIfAborted()
          if (action?.kind !== 'retry') {
            throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
          }
          continue
        }
      }
      return request
    }
  }
}
`
const originalTypes = `export type RequestErrorAction = { kind: 'retry' } | undefined\n`
const originalEntry = `import { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from './constants.ts'
import type {} from './runtime-context.ts'

export class AgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections']
}
`
const sources = () => ({ loop: originalLoop, types: originalTypes, entry: originalEntry })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-runtime-compat-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const packageName of ['agent', 'agent-loop']) {
    const directory = join(root, 'packages/core', packageName)
    await mkdir(join(directory, 'src'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: `@deepseek-ai/dsh-${packageName}`, version: supportedDshVersion,
    }))
  }
  const paths = {
    loop: join(root, 'packages/core/agent-loop/src/agent.ts'),
    types: join(root, 'packages/core/agent/src/runtime-types.ts'),
    entry: join(root, 'packages/core/agent-loop/src/index.ts'),
  }
  for (const [key, path] of Object.entries(paths)) await writeFile(path, sources()[key])
  return { root, paths, read: async () => Object.fromEntries(await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
  )) }
}

test('explicit workspace is mandatory; check is read-only and apply is idempotent', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareRuntime(), /explicit --workspace/)
  const command = spawnSync(process.execPath, [fileURLToPath(new URL('./prepare-dsh-model-routing-runtime.mjs', import.meta.url))], { cwd: f.root, encoding: 'utf8' })
  assert.equal(command.status, 1)
  assert.match(command.stderr, /--workspace PATH/)
  assert.deepEqual(await f.read(), sources())
  assert.equal((await prepareRuntime(f.root, { check: true })).ready, false)
  assert.deepEqual(await f.read(), sources())
  const first = await prepareRuntime(f.root)
  assert.equal(first.changed, 3)
  assert.equal(first.manifests.length, 2)
  const prepared = await f.read()
  assert.match(prepared.entry, /export const byclawRequestReassembly = true/)
  assert.match(prepared.entry, /readonly byclawRequestReassembly: true = true/)
  assert.match(prepared.types, /reassemble\?: true/)
  assert.equal((await prepareRuntime(f.root)).changed, 0)
  assert.equal((await prepareRuntime(f.root, { check: true })).ready, true)
  assert.deepEqual(await f.read(), prepared)
})

test('unsupported package versions and source drift fail before any source is written', async t => {
  const f = await fixture(t)
  const manifest = join(f.root, 'packages/core/agent-loop/package.json')
  await writeFile(manifest, JSON.stringify({ name: '@deepseek-ai/dsh-agent-loop', version: '0.1.1-rc.2' }))
  await assert.rejects(prepareRuntime(f.root), /expected .*0\.2\.1-rc\.2/)
  assert.deepEqual(await f.read(), sources())
  await writeFile(manifest, JSON.stringify({ name: '@deepseek-ai/dsh-agent-loop', version: supportedDshVersion }))
  await writeFile(f.paths.loop, originalLoop.replace('const renderedPrompt = renderPrompt(assembly)', 'const renderedPrompt = differentRender(assembly)'))
  const drifted = await f.read()
  await assert.rejects(prepareRuntime(f.root), /unsupported source shape/)
  assert.deepEqual(await f.read(), drifted)
})

test('duplicate anchors, mixed file shapes and capability without implementation are rejected', () => {
  assert.throws(() => prepareRuntimeSources({ ...sources(), loop: originalLoop + originalLoop }), /unsupported source shape/)
  const prepared = prepareRuntimeSources(sources())
  assert.throws(() => prepareRuntimeSources({
    ...sources(), loop: prepared.loop.source.replace('let renderedPrompt = renderPrompt(assembly)', 'const renderedPrompt = renderPrompt(assembly)'),
  }), /unsupported source shape/)
  assert.throws(() => prepareRuntimeSources({ ...sources(), entry: prepared.entry.source }), /declares reassembly support/)
})

test('workspace symlinks cannot redirect changes to another checkout', async t => {
  const f = await fixture(t)
  const other = await fixture(t)
  await rm(f.paths.loop)
  await symlink(other.paths.loop, f.paths.loop)
  await assert.rejects(prepareRuntime(f.root), /outside the explicit workspace/)
  assert.deepEqual(await other.read(), sources())
  assert.equal(await readFile(f.paths.entry, 'utf8'), originalEntry)
})

test('reassembly retries preserve admitted input and tool results while refreshing prompt, tools and context', async () => {
  const patched = prepareRuntimeSources(sources()).loop.source
    .replace('private async step(decision: FixtureDecision): Promise<unknown>', 'async step(decision)')
  const FixtureAgent = new Function('renderPrompt', 'renderContextSections', 'joinContextSections', 'assembleContextFor', 'AssistantStreamAttempt', 'LlmError', `${patched}; return FixtureAgent`)(
    assembly => `Use ${assembly.id}`,
    assembly => [{ text: `context ${assembly.id}` }],
    sections => sections.map(section => section.text).join('\n'),
    (agent, signal) => ({ agent, signal }),
    class { constructor(finish) { this.finish = finish } },
    Error,
  )
  const initial = { id: 'a', tools: ['tool-a'] }
  const replacements = [{ id: 'b', tools: ['tool-b'] }, { id: 'c', tools: ['tool-c'] }]
  const events = [{ type: 'tool/result', data: { callId: 'completed-once', result: 'retained' } }]
  const calls = []
  const projectionInputs = []
  const agent = new FixtureAgent()
  agent.activeAssembly = initial
  agent.signal = new AbortController().signal
  agent.session = { append: (type, data) => events.push({ type, data }) }
  agent.systemPrompt = { project: (prompt, facts) => {
    projectionInputs.push(facts)
    return [{ message: prompt, intent: {} }]
  } }
  agent.runtimeContext = { project: text => ({ role: 'user', context: text }) }
  agent.loopCtx = { systemPrompt: { refreshContext: assembly => assembly, assemble: async ({ signal }) => {
    signal.throwIfAborted()
    agent.activeAssembly = replacements.shift()
    assert.ok(agent.activeAssembly, 'recovery must stay bounded by available fixtures')
    return agent.activeAssembly
  } } }
  agent.prepareRequest = async () => ({ config: { model: agent.activeAssembly.id } })
  agent.buildRequest = (config, _prepared, tools) => {
    const request = { ...config, tools, events: structuredClone(events) }
    calls.push(request)
    return request
  }
  agent.nextFinish = () => calls.length < 3 ? { kind: 'error', failure: { code: 'SERVER', message: 'unavailable' } } : { kind: 'stop' }
  agent.dispatch = { emit() {}, waterfall: async () => ({ kind: 'retry', reassemble: true }) }
  const input = { role: 'user', content: 'do the task' }
  const result = await agent.step({ assembly: initial, messages: [input] })
  assert.equal(result.model, 'c')
  assert.deepEqual(calls.map(call => [call.model, call.tools]), [['a', ['tool-a']], ['b', ['tool-b']], ['c', ['tool-c']]])
  assert.deepEqual(calls.map(call => call.events.findLast(event => event.type === 'system/message').data.message), ['Use a', 'Use b', 'Use c'])
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.content === 'do the task').length, 1)
  assert.equal(events.filter(event => event.type === 'tool/result').length, 1)
  // The release admits refreshed runtime context on every attempt; reassembly makes it follow the new assembly.
  assert.deepEqual(events.filter(event => event.data.context).map(event => event.data.context), ['context a', 'context b', 'context c'])
  assert.deepEqual(projectionInputs.map(input => input.startsSeries), [false, true, true])
})
