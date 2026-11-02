import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const dockerfiles = await Promise.all(['Dockerfile', 'Dockerfile.extensions'].map(name =>
  readFile(new URL(`../${name}`, import.meta.url), 'utf8')))
const linkScript = fileURLToPath(new URL('./link-dsh-installation-peers.mjs', import.meta.url))
const linkCommand = /DSH_HOME="\$\{BYCLAW_DSH_MANAGED_HOME\}" node --import tsx\/esm \/tmp\/link-dsh-installation-peers\.mjs \/workspace web;/
const importCommand = /node --input-type=module -e "([^"]*Profile resolved an unpatched DSH agent loop[^\"]*)"/

test('both image builds link installation peers after plugin install and before the runtime guard', () => {
  assert.equal(dockerfiles[0].match(importCommand)?.[1], dockerfiles[1].match(importCommand)?.[1])
  for (const source of dockerfiles) {
    assert.doesNotMatch(source, /healProfilesModuleFallback/)
    assert.match(source, /COPY [^\n]*scripts\/link-dsh-installation-peers\.mjs \/tmp\/link-dsh-installation-peers\.mjs\n/)
    const install = source.indexOf('pnpm dsh plugin --profile web add')
    const link = source.search(linkCommand)
    const guard = source.search(importCommand)
    assert.ok(install >= 0 && link > install && guard > link)
  }
})

test('every business image verifies the actual shared launcher and packed employee scopes', async () => {
  for (const name of ['Dockerfile', 'Dockerfile.extensions', 'Dockerfile.slim']) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), 'utf8')
    const copy = source.indexOf('scripts/verify-shared-runtime.mjs /workspace/scripts/')
    const install = source.indexOf('pnpm dsh plugin --profile web add')
    const guard = source.indexOf('node scripts/verify-shared-runtime.mjs /workspace')
    assert.ok(copy >= 0 && copy < install && guard > install, name)
  }
})

test('slim final runtime receives and verifies the shared launcher across the stage boundary', async () => {
  const source = await readFile(new URL('../Dockerfile.slim', import.meta.url), 'utf8')
  const final = source.slice(source.lastIndexOf('\nFROM '))
  assert.match(final, /COPY --from=profile-builder[^\n]* \/workspace\/scripts\/byclaw-multi-host\.mjs \/workspace\/scripts\/byclaw-managed-host\.mjs \/workspace\/scripts\/verify-shared-runtime\.mjs \/workspace\/scripts\//)
  assert.match(final, /node \/workspace\/scripts\/verify-shared-runtime\.mjs \/workspace/)
})

// Run inside the pinned DSH builder workspace with:
// DSH_ROOT=/workspace node --test scripts/dsh-profile-runtime.test.mjs
// The test uses DSH's real runtime resolution and isolated business packages.
test('linked installation peers make the packed loop importable and retain the capability guard', {
  skip: !process.env.DSH_ROOT && 'DSH_ROOT is required for the upstream API integration check',
}, async t => {
  const dshRoot = resolve(process.env.DSH_ROOT)
  const manifest = JSON.parse(await readFile(join(dshRoot, 'packages/boot/app-boot/package.json'), 'utf8'))
  assert.equal(manifest.version, '0.2.1-rc.2', 'test the base image release')
  const root = await mkdtemp(join(tmpdir(), 'byclaw-profile-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'managed')
  const profile = join(home, 'profiles/web')
  // A stand-in DSH workspace: its own CLI anchor and installation, with DSH's real app-boot sources.
  const installation = join(root, 'installation')
  async function file(path, contents) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  await file(join(installation, 'packages/boot/app-boot/package.json'), JSON.stringify({ type: 'module' }))
  await file(join(installation, 'packages/boot/app-boot/src/profile.ts'),
    `export * from ${JSON.stringify(join(dshRoot, 'packages/boot/app-boot/src/profile.ts'))}\n`)
  await file(join(installation, 'apps/cli/package.json'), JSON.stringify({
    name: 'fixture-dsh', version: '0.2.1-rc.2', dependencies: { '@deepseek-ai/cordis': '4.0.5' },
  }))
  await file(join(installation, 'apps/cli/node_modules/@deepseek-ai/cordis/package.json'), JSON.stringify({
    name: '@deepseek-ai/cordis', version: '4.0.5', type: 'module', exports: './index.js',
  }))
  await file(join(installation, 'apps/cli/node_modules/@deepseek-ai/cordis/index.js'), 'export class Service {}\n')
  await file(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }))
  await file(join(profile, 'node_modules/@byclaw/byclaw-model-router/package.json'), JSON.stringify({
    name: '@byclaw/byclaw-model-router', type: 'module', exports: { './dsh': './dsh.js' },
  }))
  await file(join(profile, 'node_modules/@byclaw/byclaw-model-router/dsh.js'), 'export {}\n')
  await file(join(profile, 'node_modules/@deepseek-ai/dsh-agent-loop/package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-agent-loop', type: 'module', exports: './index.js',
  }))
  const loop = join(profile, 'node_modules/@deepseek-ai/dsh-agent-loop/index.js')
  const loopSource = "export {Service} from '@deepseek-ai/cordis'; export const byclawRequestReassembly=true\n"
  await file(loop, loopSource)
  const command = dockerfiles[0].match(importCommand)[1]
  const probe = () => spawnSync(process.execPath, ['--input-type=module', '-e', command], { cwd: profile, encoding: 'utf8' })
  const before = probe()
  assert.notEqual(before.status, 0)
  assert.match(before.stderr, /ERR_MODULE_NOT_FOUND.*|Cannot find package/)
  assert.match(before.stderr, /@deepseek-ai\/cordis/)
  for (let attempt = 0; attempt < 2; attempt++) {
    const linked = spawnSync(process.execPath, ['--import', 'tsx/esm', linkScript, installation, 'web'], {
      cwd: dshRoot, encoding: 'utf8', env: { ...process.env, DSH_HOME: home },
    })
    assert.equal(linked.status, 0, linked.stderr)
    assert.match(linked.stdout, /linked \d+ DSH installation packages/)
    assert.ok((await lstat(join(home, 'profiles/node_modules/@deepseek-ai/cordis'))).isSymbolicLink())
    const after = probe()
    assert.equal(after.status, 0, after.stderr)
  }
  const runtime = await import(pathToFileURL(loop))
  const host = await import(pathToFileURL(join(installation, 'apps/cli/node_modules/@deepseek-ai/cordis/index.js')))
  assert.equal(runtime.Service, host.Service, 'profile and host must share the same Cordis instance')
  await file(loop, loopSource.replace('Reassembly=true', 'Reassembly=false'))
  const unpatched = probe()
  assert.notEqual(unpatched.status, 0)
  assert.match(unpatched.stderr, /Profile resolved an unpatched DSH agent loop/)
})
