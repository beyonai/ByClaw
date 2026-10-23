// Import everything B's SSH helper and PTC bootstrap may load, so the resolve hook sees the closure.
// Run from the harness image; fails when a root cannot be found.
import { createRequire, register } from 'node:module'
import { pathToFileURL } from 'node:url'
register(pathToFileURL(process.env.TRACE_HOOK))
const roots = [
  '/workspace/packages/ssh/ssh/lib/helper.js',
  '/workspace/packages/ptc-runtime/ptc-runtime-node/lib/process.js',
  '/workspace/packages/ptc-runtime/ptc-runtime-node/lib/persistent-process.js',
  '/workspace/packages/ptc-runtime/ptc-runtime-node/lib/index.js',
]
for (const root of roots) {
  try { await import(root) } catch (error) {
    // Static imports are resolved (and traced) before evaluation; only a missing module is a failure.
    if (error.code === 'ERR_MODULE_NOT_FOUND') { console.error('root not found', root, error.message); process.exitCode = 1 }
    else console.error('root evaluation stopped (expected outside a live helper):', root, error.message)
  }
}
// Packages the helper reaches through dynamic imports or data-driven loads: resolve them the way
// the helper's own package would, then import the resolved file so its subtree is traced too.
const parents = ['/workspace/packages/ssh/ssh/package.json', '/workspace/packages/ptc-runtime/ptc-runtime-node/package.json', '/workspace/package.json']
for (const name of ['@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-sandbox-local', '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-sandbox-policy', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-fs', '@deepseek-ai/cordis', 'zod']) {
  let resolved
  for (const parent of parents) {
    try { resolved = createRequire(parent).resolve(name); break } catch { /* next parent */ }
  }
  if (resolved === undefined) { console.error('not resolvable from the helper, skipped:', name); continue }
  try { await import(pathToFileURL(resolved).href) } catch (error) { console.error('evaluation stopped:', name, error.message) }
}
console.error('trace done')
