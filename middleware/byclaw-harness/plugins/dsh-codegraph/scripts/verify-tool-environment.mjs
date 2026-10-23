// Tool-environment route: with workspaceOnToolEnvironment the plugin starts the
// CodeGraph MCP server through ctx.subprocess (here the local provider stands
// in for the SSH one), reaches it over its private bridge socket, and registers
// the same model-facing tool; without the flag it registers only the policy.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import * as CodeGraph from '../lib/index.js'

const fakeCodeGraph = fileURLToPath(new URL('./fixtures/fake-codegraph.mjs', import.meta.url))
const TOOL = 'mcp__codegraph__codegraph_explore'

async function boot(config) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(LocalSubprocess).await()
  const spawned = []
  const subprocess = ctx.get('subprocess')
  const spawn = subprocess.spawn.bind(subprocess)
  subprocess.spawn = (spec) => { spawned.push(spec); return spawn(spec) }
  const fiber = ctx.plugin(CodeGraph, config)
  await fiber.await()
  return { ctx, fiber, spawned }
}

async function waitFor(predicate, what) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const base = await mkdtemp(join(tmpdir(), 'dsh-codegraph-toolenv-'))
try {
  // Default: the policy only; no server, no socket.
  const plain = await boot({})
  assert.equal(plain.ctx.tools.get(TOOL), undefined)
  assert.equal(plain.spawned.length, 0)
  assert.equal(CodeGraph.Config({}).workspaceOnToolEnvironment, false)
  await plain.ctx.fiber.dispose()

  // A tool environment without a private state directory fails loud.
  const missing = new Context()
  await missing.plugin(SystemPrompt)
  await assert.rejects(missing.plugin(CodeGraph, { workspaceOnToolEnvironment: true }).await(), /stateDir is required/u)
  await missing.fiber.dispose()

  const stateDir = join(base, 'state')
  const workspace = join(base, 'by')
  const remote = await boot({
    workspaceOnToolEnvironment: true,
    command: process.execPath,
    args: [fakeCodeGraph, 'serve', '--mcp'],
    cwd: base,
    env: { CODEGRAPH_MCP_TOOLS: 'explore' },
    stateDir,
  })
  await waitFor(() => remote.ctx.tools.get(TOOL) !== undefined, `${TOOL} to register`)
  // Every connection the client opens (protocol negotiation may open more
  // than one) starts its own server on the tool environment.
  assert.ok(remote.spawned.length >= 1)
  for (const spec of remote.spawned) {
    assert.deepEqual(spec.argv, [process.execPath, fakeCodeGraph, 'serve', '--mcp'])
    assert.equal(spec.cwd, base)
    assert.equal(spec.env.CODEGRAPH_MCP_TOOLS, 'explore')
  }
  assert.deepEqual(await readdir(stateDir), ['mcp-bridge.sock'])

  const result = await remote.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: 'codegraph-toolenv-1',
    name: TOOL,
    arguments: { query: 'what calls apply?', projectPath: workspace },
  })
  assert.equal(result.isError, false)
  assert.equal(result.content.map(block => block.text).join(''), `fake codegraph_explore in ${base}`)

  await remote.ctx.fiber.dispose()
  assert.deepEqual(await readdir(stateDir), [])
} finally {
  await rm(base, { recursive: true, force: true })
}

console.info('ByClaw CodeGraph tool-environment verification passed')
