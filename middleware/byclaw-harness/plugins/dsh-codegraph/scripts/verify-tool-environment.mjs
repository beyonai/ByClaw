// Tool-environment route: with workspaceOnToolEnvironment the plugin starts the
// CodeGraph MCP server through ctx.subprocess (here the local provider stands
// in for the SSH one), reaches it over its private bridge socket, and registers
// the same model-facing tool; without the flag it registers only the policy.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
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
  subprocess.spawn = (spec) => {
    const handle = spawn(spec)
    const record = { ...spec, exited: false }
    void handle.done.finally(() => { record.exited = true })
    spawned.push(record)
    return handle
  }
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
  const settings = {
    workspaceOnToolEnvironment: true,
    command: process.execPath,
    args: [fakeCodeGraph, 'serve', '--mcp'],
    cwd: base,
    env: { CODEGRAPH_MCP_TOOLS: 'explore' },
    stateDir,
    idleMs: 300,
  }
  const remote = await boot(settings)
  await waitFor(() => remote.ctx.tools.get(TOOL) !== undefined, `${TOOL} to register`)
  // Every connection the client opens (protocol negotiation may open more
  // than one) starts its own server on the tool environment.
  assert.ok(remote.spawned.length >= 1)
  for (const spec of remote.spawned) {
    assert.deepEqual(spec.argv, [process.execPath, fakeCodeGraph, 'serve', '--mcp'])
    assert.equal(spec.cwd, base)
    assert.equal(spec.env.CODEGRAPH_MCP_TOOLS, 'explore')
  }
  // The handshake cache is written in the background; wait for the last write to land.
  await waitFor(() => readdirSync(stateDir).every(name => !name.endsWith('.tmp')), 'the handshake cache to be written')
  assert.deepEqual((await readdir(stateDir)).sort(), ['mcp-bridge.sock', 'mcp-cache.json'])

  const explore = async (ctx, callId) => {
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId,
      name: TOOL,
      arguments: { query: 'what calls apply?', projectPath: workspace },
    })
    assert.equal(result.isError, false)
    assert.equal(result.content.map(block => block.text).join(''), `fake codegraph_explore in ${base}`)
  }
  await explore(remote.ctx, 'codegraph-toolenv-1')
  // An idle server ends, so its stream no longer keeps the tool environment from pausing...
  await waitFor(() => remote.spawned.every(spec => spec.exited), 'the idle server to end')
  // ...and the next call starts a new one behind the same MCP session.
  const before = remote.spawned.length
  await explore(remote.ctx, 'codegraph-toolenv-2')
  assert.equal(remote.spawned.length, before + 1)
  await remote.ctx.fiber.dispose()
  assert.deepEqual(await readdir(stateDir), ['mcp-cache.json'])

  // A later context (the next boot of the user's context) knows the server's answers to the MCP
  // handshake: the tool registers without starting anything on the tool environment.
  const warm = await boot(settings)
  await waitFor(() => warm.ctx.tools.get(TOOL) !== undefined, `${TOOL} to register from the cache`)
  assert.equal(warm.spawned.length, 0)
  await explore(warm.ctx, 'codegraph-toolenv-3')
  assert.equal(warm.spawned.length, 1)
  await warm.ctx.fiber.dispose()

  // A server that introduces itself differently than the cache says (another CodeGraph)
  // refreshes the cache the first time a call starts one.
  const cachePath = join(stateDir, 'mcp-cache.json')
  const stale = JSON.parse(await readFile(cachePath, 'utf8'))
  stale.methods.initialize.result.serverInfo.version = '0.9.0'
  await writeFile(cachePath, JSON.stringify(stale))
  const again = await boot(settings)
  await waitFor(() => again.ctx.tools.get(TOOL) !== undefined, `${TOOL} to register`)
  await explore(again.ctx, 'codegraph-toolenv-4')
  await waitFor(() => JSON.parse(readFileSync(cachePath, 'utf8')).methods.initialize.result.serverInfo.version === '1.0.0', 'the cache to refresh')
  await again.ctx.fiber.dispose()

  // Another server command (a rebuilt image) does not use the old answers at all.
  const other = await boot({ ...settings, env: { CODEGRAPH_MCP_TOOLS: 'explore', OTHER: '1' } })
  await waitFor(() => other.ctx.tools.get(TOOL) !== undefined, `${TOOL} to register`)
  assert.ok(other.spawned.length >= 1, 'a different command asks its own server')
  await other.ctx.fiber.dispose()
} finally {
  await rm(base, { recursive: true, force: true })
}

console.info('ByClaw CodeGraph tool-environment verification passed')
