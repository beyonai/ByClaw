#!/usr/bin/env node
// Exercise the Docker package route with real pnpm resolution and no Redis/model calls.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleRoot = fileURLToPath(new URL('../', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'byclaw-framework-package-'))
function run(command, args, cwd = root, success = true) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 })
  if (success) assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  else assert.notEqual(result.status, 0)
  return result
}
async function json(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}
const node = (script, args = [], cwd = root, success = true) =>
  run(process.execPath, [join(root, 'scripts', script), ...args], cwd, success)
try {
  run(process.execPath, [join(moduleRoot, 'scripts/docker-framework-layout-verify.mjs')])
  await cp(join(moduleRoot, 'vendor/by-framework'), join(root, 'vendor/by-framework'), { recursive: true })
  await mkdir(join(root, 'scripts'))
  for (const name of ['prepare-by-framework.mjs', 'verify-by-framework-runtime.mjs',
    'docker-workspace-prepare.mjs', 'docker-plugin-layout.mjs']) {
    await cp(join(moduleRoot, 'scripts', name), join(root, 'scripts', name))
  }
  await json(join(root, 'package.json'), { name: 'package-route-test', private: true,
    dependencies: { 'js-yaml': '4.2.0' } })
  const install = cwd => run('pnpm', ['install', '--ignore-scripts',
    '--config.manage-package-manager-versions=false'], cwd)
  install(root)
  await mkdir(join(root, 'plugins'))
  node('prepare-by-framework.mjs')
  assert.match(node('prepare-by-framework.mjs', [], root, false).stderr, /EEXIST/)

  const metadataPath = join(root, 'vendor/by-framework/artifact.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  await json(metadataPath, { ...metadata, sha256: '0'.repeat(64) })
  assert.match(node('prepare-by-framework.mjs', ['vendor/by-framework', 'plugins/corrupt'], root, false).stderr,
    /checksum mismatch/)
  await json(metadataPath, { ...metadata, version: '1.6.0' })
  assert.match(node('prepare-by-framework.mjs', ['vendor/by-framework', 'plugins/wrong'], root, false).stderr,
    /1\.7\.0-byclaw\.1/)
  await json(metadataPath, metadata)

  // Old and qualified dependency overrides must not win over the staged package.
  await json(join(root, 'vendor/cordis/package.json'), { name: '@deepseek-ai/cordis', version: '4.0.2' })
  await json(join(root, 'plugins/integration/package.json'), { name: 'fixture-integration', version: '1.0.0',
    dependencies: { '@byclaw/by-framework': '1.6.0' } })
  await writeFile(join(root, 'pnpm-workspace.yaml'), `packages:\n  - vendor/*\noverrides:\n  '@byclaw/by-framework@1.6.0': '1.6.0'\n  'fixture-integration>@byclaw/by-framework': '1.6.0'\n`)
  node('docker-workspace-prepare.mjs')
  const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(workspace, /'@byclaw\/by-framework': link:plugins\/by-framework/)
  assert.doesNotMatch(workspace, /by-framework@1\.6\.0|fixture-integration>@byclaw/)
  node('docker-workspace-prepare.mjs')
  assert.equal(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'), workspace)
  install(root)
  node('verify-by-framework-runtime.mjs', ['plugins/integration/package.json'])
  for (const probe of ['worker-concurrency-verify.mjs', 'worker-health-verify.mjs']) {
    run(process.execPath, [join(moduleRoot, 'plugins/byclaw-integration/scripts', probe),
      join(root, 'plugins/by-framework/dist/index.js')])
  }
  assert.match(node('docker-plugin-layout.mjs', ['packages']).stdout, /plugins\/by-framework\/package.json/)
  assert.doesNotMatch(node('docker-plugin-layout.mjs', ['bundles']).stdout, /by-framework/)

  // Match Docker's pack -> extract -> profile file override, not a source symlink.
  const packs = join(root, 'packs')
  await mkdir(packs)
  run('pnpm', ['--filter', '@byclaw/by-framework', 'pack', '--pack-destination', packs])
  const finalPackage = join(root, 'managed/plugins/byclaw--by-framework')
  await mkdir(finalPackage, { recursive: true })
  run('tar', ['-xzf', join(packs, metadata.filename), '-C', finalPackage, '--strip-components=1'])
  const consumer = join(root, 'managed/plugins/integration')
  await json(join(consumer, 'package.json'), JSON.parse(await readFile(join(root, 'plugins/integration/package.json'), 'utf8')))
  const profile = join(root, 'managed/profiles/web')
  await json(join(profile, 'package.json'), { name: 'fixture-profile', private: true,
    dependencies: { 'fixture-integration': `file:${consumer}` } })
  await writeFile(join(profile, 'pnpm-workspace.yaml'), `packages: []\noverrides:\n  '@byclaw/by-framework': 'file:${finalPackage}'\n`)
  install(profile)
  const resolved = run(process.execPath, ['-p', "require.resolve('fixture-integration/package.json')"], profile).stdout.trim()
  node('verify-by-framework-runtime.mjs', [resolved], profile)
  for (const filename of ['Dockerfile', 'Dockerfile.extensions']) {
    const dockerfile = await readFile(join(moduleRoot, filename), 'utf8')
    assert.match(dockerfile, /COPY middleware\/byclaw-harness\/vendor\/by-framework\//)
    assert.match(dockerfile, /node scripts\/prepare-by-framework\.mjs/)
    assert.match(dockerfile, /verify-by-framework-runtime\.mjs plugins\/byclaw-integration\/package\.json/)
    assert.match(dockerfile, /verify-by-framework-runtime\.mjs "\$\(node -p "require\.resolve\('@byclaw\/dsh-integration\/package\.json'\)/)
  }
  console.log('Framework archive integrity, workspace install, packed profile resolution and runtime probes passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
