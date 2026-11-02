/** Run in a built DSH workspace; rejects eager compiler/schema aggregate loads. */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
const loaded = []
let checkingTransport = true
const hooks = registerHooks({
  load(url, context, next) {
    loaded.push(url)
    if (checkingTransport && /\/undici\//.test(url)) throw new Error(`Eager model transport: ${url}`)
    if (/\/typebox\/|\/typescript\/lib\/typescript\.js$/.test(url)) {
      throw new Error(`Unexpected startup dependency: ${url}`)
    }
    return next(url, context)
  },
})
try {
  await import('../lib/model-fetch.js')
  checkingTransport = false
  await import('../lib/model-runtime.js')
  const spec = await import('../../dsh-devflow-plugins/packages/devflow-spec-filesystem/lib/index.js')
  hooks.deregister()
  // The synchronous API must still parse on demand and preserve hashes.
  assert.equal(spec.findSymbolText('export function answer() { return 42 }', 'answer'), 'export function answer() { return 42 }')
  assert.equal(spec.hashSymbol('function answer(){return 42;}', 'answer'), spec.hashSymbol('function answer() { /* comment */ return 42 }', 'answer'))
  assert.equal(spec.findSymbolText('const other = 1', 'missing'), undefined)
  console.log(`Startup imports verified: ${loaded.length} loads; TypeScript remains available on first use`)
} finally { hooks.deregister() }
