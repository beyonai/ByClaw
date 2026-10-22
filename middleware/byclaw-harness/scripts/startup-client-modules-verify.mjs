#!/usr/bin/env node
/** Exercise the compiled registry: unchanged bytes, HMR maps and bounded generations. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const oracle = process.argv.includes('--oracle')
const snapshots = []
const workspace = resolve(process.env.DSH_ROOT ?? '/workspace')
const { Context } = await import(pathToFileURL(join(workspace, 'vendor/cordis/lib/index.js')))
const { ClientModuleRegistry } = await import(pathToFileURL(join(workspace, 'packages/client/modules/lib/index.js')))
const root = mkdtempSync(join(tmpdir(), 'byclaw-client-modules-'))
const names = ['@fixture/large']
const source = `/* ${'中文😀\r\n'.repeat(20000)} */\nmodule.exports = {}\n//# sourceURL=fixture/large.js\n`
function pkg(name, body) {
  const dir = join(root, 'node_modules', name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports: { './client': './lib/client.js', './package.json': './package.json' }, dsh: { client: { platform: 'web' } } }))
  const file = join(dir, 'lib/client.js'); writeFileSync(file, body); return file
}
const context = new Context()
context.baseUrl = pathToFileURL(root).href + '/'
context.provide('loader', { *entries() { for (const name of names) yield { options: { name }, fiber: {}, disabled: false, parent: { tree: { ctx: context } } } } })
context.provide('webServer', { port: 0, register: () => () => {}, tapIndex: () => () => {} })
const original = Buffer.prototype.toString
let conversions = 0
Buffer.prototype.toString = function (...args) { if (this.length === Buffer.byteLength(source)) conversions++; return original.apply(this, args) }
const get = (service, url, method = 'GET') => service.fetchBundle(new Request(`http://fixture${url}`, { method }))
async function snapshot(service, url) {
  const body = await get(service, url).text()
  const map = await get(service, mapUrl(url)).text()
  snapshots.push({ url, script: createHash('sha256').update(body).digest('hex'), map: createHash('sha256').update(map).digest('hex') })
}
const mapUrl = url => url.replace(/\/client\.js(?=,|&rev=)/g, '/client.js.map')
try {
  const file = pkg(names[0], source)
  const registry = new ClientModuleRegistry(context)
  if (!oracle) assert.equal(conversions, 1, 'each unchanged bundle should be decoded once across batch and single responses')
  const first = registry.graph().batches[0].url
  if (oracle) await snapshot(registry, first)
  const firstBody = await get(registry, first).text()
  const firstMap = await get(registry, mapUrl(first)).json()
  assert.equal(firstMap.sections[0].map.sources[0], '/fixture/large.js')
  assert.ok(!firstBody.includes('sourceURL=fixture/large.js'))
  const decoded = conversions
  pkg('@fixture/second', 'module.exports = 2\n')
  names.push('@fixture/second')
  context.emit('internal/plugin', { entry: { options: { name: names[1] } } })
  await new Promise(resolve => setImmediate(resolve))
  if (!oracle) assert.equal(conversions, decoded, 'unrelated plugin arrival must not decode unchanged bundles again')
  const second = registry.graph().batches[0].url
  if (oracle) await snapshot(registry, second)
  assert.notEqual(second, first)
  assert.equal(await get(registry, first).text(), firstBody, 'previous graph still serves identical bytes')
  const secondMap = await get(registry, mapUrl(second)).json()
  assert.deepEqual(secondMap.sections[0], firstMap.sections[0])
  assert.equal(secondMap.sections[1].offset.line, 20003)
  writeFileSync(file, 'module.exports = 3\n')
  writeFileSync(`${file}.map`, JSON.stringify({ version: 3, sources: ['changed.ts'], names: [], mappings: 'AAAA', sourcesContent: ['new source'] }))
  registry.rebuilt(names[0])
  const third = registry.graph().batches[0].url
  if (oracle) await snapshot(registry, third)
  assert.notEqual(third, second)
  assert.match(await get(registry, third).text(), /module.exports = 3/)
  assert.equal((await get(registry, mapUrl(third)).json()).sections[0].map.sourcesContent[0], 'new source')
  assert.equal(get(registry, first).status, 404, 'only one previous batch generation is retained')
  assert.equal(get(registry, second).status, 200)
  writeFileSync(`${file}.map`, JSON.stringify({ version: 3, sources: ['map-only.ts'], names: [], mappings: 'AAAA' }))
  registry.rebuilt(names[0])
  const fourth = registry.graph().batches[0].url
  if (oracle) await snapshot(registry, fourth)
  assert.notEqual(fourth, third, 'map-only changes invalidate cached artifacts')
  assert.match(JSON.stringify(await get(registry, mapUrl(fourth)).json()), /map-only.ts/)
  assert.equal(get(registry, fourth, 'HEAD').status, 200)
  assert.equal(await get(registry, fourth, 'HEAD').text(), '')
  assert.equal(get(registry, fourth, 'POST').status, 405)
  names.splice(1)
  context.emit('internal/plugin', { entry: { options: { name: '@fixture/second' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(registry.graph().entries.map(row => row.id), names)
  if (oracle) console.log(JSON.stringify(snapshots))
  console.log('compiled client registry: decode reuse, offsets, HMR/map-only invalidation, removal, prior generation and HTTP contracts passed')
} finally {
  Buffer.prototype.toString = original
  rmSync(root, { recursive: true, force: true })
}
