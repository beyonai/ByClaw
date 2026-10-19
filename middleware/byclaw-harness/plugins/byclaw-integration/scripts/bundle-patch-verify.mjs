import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const patch = readFileSync(join(packageRoot, 'cordis.patch.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

assert.match(patch, /id:\s*logger-console/u, 'bundle must mount a console exporter so ctx.logger reaches container stdout')
assert.match(patch, /@deepseek-ai\/cordis-plugin-logger-console/u, 'bundle console exporter package is missing')
assert.match(
  patch,
  /levels:\s*\n\s+default:\s*-1\s*\n\s+byclaw-dsh:\s*2/u,
  'console exporter must emit only ByClaw ERROR/INFO/WARN records',
)
assert.equal(
  typeof manifest.dependencies?.['@deepseek-ai/cordis-plugin-logger-console'],
  'string',
  'console exporter must be a runtime dependency because the bundle patch mounts it',
)
assert.match(
  patch,
  /projectionConcurrency:\s*8/u,
  'bundle projection concurrency must default to 8',
)
assert.match(
  patch,
  /id:\s*tool-web[\s\S]*?config:[\s\S]*?search:\s*false/u,
  'bundle must disable the default DSH web_search tool',
)

// The bundle patch is baked into the image profile by `dsh plugin add`, so any
// machine-absolute path here becomes an unwritable mkdir target in the container.
for (const [label, pattern] of [
  ['macOS home', /^\s*\w+:\s*'?\/Users\//gmu],
  ['Linux home', /^\s*\w+:\s*'?\/home\//gmu],
  ['Windows drive', /^\s*\w+:\s*'?[A-Za-z]:\\/gmu],
]) {
  const offenders = patch.match(pattern) ?? []
  assert.deepEqual(offenders, [], `${label} path committed in cordis.patch.yml: ${offenders.join(', ')}`)
}

// Path settings must stay unset so DSH_HOME and the process cwd decide them per host.
for (const field of ['catalogDir', 'agentTemplateDir', 'skillCacheDir', 'workspace', 'fileStorageLocalPath']) {
  assert.doesNotMatch(
    patch,
    new RegExp(`^\\s*${field}:`, 'mu'),
    `cordis.patch.yml must leave ${field} to its host default`,
  )
}

const staticBaseUrlKey = /(?:^|[\s{,])(?:baseUrl|"baseUrl"|'baseUrl')\s*:/mu
function assertNoStaticBaseUrl(source, label) {
  assert.doesNotMatch(
    source,
    staticBaseUrlKey,
    `${label} must leave baseUrl to environment or Redis service discovery`,
  )
}
for (const [label, source] of [
  ['plain key', 'config:\n  baseUrl: http://backend'],
  ['spaced key', 'config:\n  baseUrl : http://backend'],
  ['double-quoted key', 'config:\n  "baseUrl": http://backend'],
  ['single-quoted key', "config:\n  'baseUrl': http://backend"],
  ['flow-map key', 'config: { baseUrl: http://backend }'],
]) {
  assert.throws(
    () => assertNoStaticBaseUrl(source, label),
    `${label} must be rejected by the static baseUrl guard`,
  )
}
assertNoStaticBaseUrl(patch, 'cordis.patch.yml')

console.log('bundle-patch-verify ok')
