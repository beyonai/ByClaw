import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepare, prepareSource, getBefore, getAfter, marker } from './prepare-dsh-tool-lookup-021.mjs'

const RUN_CODE_NAME = 'run_code'
const viewSource = '  private view(scope?: ScopeKey): ToolView {\n  }'

// JS port of DSH 0.2.1-rc.2 ToolRegistry.view(), the reference the patched get() must agree with.
function view(scope) {
  const layers = this.layers.chainLayers(scope)
  const own = this.layers.peek(scope)
  const inherited = new Map(this.layers.global.tools.entries())
  for (const layer of layers) {
    if (layer === own) continue
    for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition)
  }
  const visible = new Map()
  for (const [name, definition] of inherited) if (layers.every(layer => layer.admits(name))) visible.set(name, definition)
  if (own !== undefined) for (const [name, definition] of own.tools.entries()) visible.set(name, definition)
  if (this.modeFor(scope) !== 'native') visible.set(RUN_CODE_NAME, this.requirePtcTransport())
  return { visible }
}

const patchedGet = new Function('RUN_CODE_NAME', `return function ${getAfter.trim()
  .replace('get(name: string, scope?: ScopeKey): ToolDefinition | undefined {', 'get(name, scope) {')}`)(RUN_CODE_NAME)

// Deterministic PRNG so a failure reproduces.
function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 }

function registry(random) {
  const names = ['bash', 'read', 'subagent', 'spawn', 'answer', RUN_CODE_NAME]
  const layer = () => ({
    tools: new Map(names.filter(n => n !== RUN_CODE_NAME && random() < 0.4).map(n => [n, { name: n, id: random() }])),
    deny: new Set(names.filter(() => random() < 0.2)),
    admits(name) { return !this.deny.has(name) },
  })
  // Scope chain root -> a -> a/b -> a/b/c; some scopes have no overlay.
  const chain = ['a', 'a/b', 'a/b/c']
  const scoped = new Map(chain.filter(() => random() < 0.7).map(k => [k, layer()]))
  const modes = new Map(chain.map(k => [k, random() < 0.3 ? 'ptc' : 'native']))
  const transport = { name: RUN_CODE_NAME, transport: true }
  return {
    layers: {
      global: layer(),
      peek: scope => scope === undefined ? undefined : scoped.get(scope),
      chainLayers: scope => scope === undefined ? [] : chain.slice(0, chain.indexOf(scope) + 1).map(k => scoped.get(k)).filter(Boolean),
    },
    modeFor: scope => scope === undefined ? 'native' : modes.get(scope),
    requirePtcTransport: () => transport,
    view, get: patchedGet, names, scopes: [undefined, ...chain],
  }
}

test('patched get() resolves exactly what view(scope).visible.get(name) resolves', () => {
  const random = rng(42)
  let checked = 0
  for (let round = 0; round < 3000; round++) {
    const r = registry(random)
    for (const scope of r.scopes) for (const name of [...r.names, 'missing']) {
      assert.equal(r.get(name, scope), r.view(scope).visible.get(name), `round ${round} scope ${scope} name ${name}`)
      checked++
    }
  }
  assert.ok(checked > 50000)
})

test('patch is exact, idempotent and refuses changed or mixed sources', () => {
  const source = `class ToolRegistry {\n${viewSource}\n${getBefore}\n}`
  const updated = prepareSource(source)
  assert.ok(updated.includes(marker) && !updated.includes(getBefore))
  assert.equal(prepareSource(updated), updated)
  assert.throws(() => prepareSource('upstream changed'), /Unsupported/)
  assert.throws(() => prepareSource(source + getBefore), /Unsupported/)
  assert.throws(() => prepareSource(updated + getBefore), /Unsupported/)
  assert.throws(() => prepareSource(getBefore), /Unsupported/)
})

test('prepare checks the package version before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-tool-lookup-'))
  try {
    const dir = join(root, 'packages/core/tools')
    await mkdir(join(dir, 'src'), { recursive: true })
    const source = `class ToolRegistry {\n${viewSource}\n${getBefore}\n}`
    await writeFile(join(dir, 'src/index.ts'), source)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.2.2' }))
    await assert.rejects(prepare(root), /Expected/)
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), source)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.2.1-rc.2' }))
    await prepare(root)
    assert.ok((await readFile(join(dir, 'src/index.ts'), 'utf8')).includes(marker))
  } finally { await rm(root, { recursive: true, force: true }) }
})
