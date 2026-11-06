import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stripTypeScriptTypes } from 'node:module'
import { prepare, prepareSource, before, after, marker } from './prepare-dsh-ripgrep-path-021.mjs'

// The function as DSH 0.2.1 ships it (search-core.ts), with its module-level cache.
const original = `let rgPathPromise: Promise<string> | undefined
${before} process.versions.electron === undefined
      ? dependency
      : dependency.replace(/\\.asar(?=[\\\\/])/u, '.asar.unpacked')
  })
  return rgPathPromise
}
`

/** Compile the patched function with stand-ins for its module imports. */
function resolver(source, ripgrep) {
  const body = stripTypeScriptTypes(prepareSource(source).replace("await import('@vscode/ripgrep')", 'await loadRipgrep()'))
    .replace('export function', 'function')
  return new Function('parse', 'join', 'existsSync', 'loadRipgrep', `${body}; return resolveRgPath`)(
    () => ({ dir: '/node', name: 'node' }), (...parts) => parts.join('/'), () => false, ripgrep)
}

test('the configured rg wins, the packaged rg is next, and PATH catches an unreachable package', async () => {
  const packaged = async () => ({ rgPath: '/workspace/rg' })
  const unreachable = async () => { throw new Error('Could not find @vscode/ripgrep-linux-x64') }
  const saved = process.env.BYCLAW_RIPGREP_PATH
  try {
    delete process.env.BYCLAW_RIPGREP_PATH
    assert.equal(await resolver(original, packaged)(), '/workspace/rg')
    assert.equal(await resolver(original, unreachable)(), 'rg')
    process.env.BYCLAW_RIPGREP_PATH = ' rg '
    assert.equal(await resolver(original, packaged)(), 'rg')
    process.env.BYCLAW_RIPGREP_PATH = '/usr/bin/rg'
    assert.equal(await resolver(original, unreachable)(), '/usr/bin/rg')
  } finally {
    if (saved === undefined) delete process.env.BYCLAW_RIPGREP_PATH
    else process.env.BYCLAW_RIPGREP_PATH = saved
  }
})

test('patch is exact, idempotent and refuses changed or mixed sources', () => {
  const updated = prepareSource(original)
  assert.ok(updated.includes(marker) && updated.includes(after) && !updated.includes(before))
  assert.equal(prepareSource(updated), updated)
  assert.throws(() => prepareSource('upstream changed'), /Unsupported/)
  assert.throws(() => prepareSource(updated + before), /Unsupported/)
})

test('prepare checks the package version before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-ripgrep-path-'))
  try {
    const dir = join(root, 'packages/fs/tool-fs-search')
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src/search-core.ts'), original)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-fs-search', version: '0.2.2' }))
    await assert.rejects(prepare(root), /Expected/)
    assert.equal(await readFile(join(dir, 'src/search-core.ts'), 'utf8'), original)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-fs-search', version: '0.2.1-rc.2' }))
    await prepare(root)
    assert.ok((await readFile(join(dir, 'src/search-core.ts'), 'utf8')).includes(marker))
  } finally { await rm(root, { recursive: true, force: true }) }
})
