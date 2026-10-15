import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const dockerfiles = await Promise.all(['Dockerfile', 'Dockerfile.extensions'].map(name =>
  readFile(new URL(`../${name}`, import.meta.url), 'utf8')))
const healCommand = /node --import tsx\/esm --input-type=module -e "([^"]*healProfilesModuleFallback[^\"]*)"/
const importCommand = /node --input-type=module -e "([^"]*Profile resolved an unpatched DSH agent loop[^\"]*)"/

test('both image builds heal installation peers after plugin install and before the runtime guard', () => {
  assert.equal(dockerfiles[0].match(healCommand)?.[1], dockerfiles[1].match(healCommand)?.[1])
  assert.equal(dockerfiles[0].match(importCommand)?.[1], dockerfiles[1].match(importCommand)?.[1])
  for (const source of dockerfiles) {
    const install = source.indexOf('pnpm dsh plugin --profile web add')
    const heal = source.search(healCommand)
    const guard = source.search(importCommand)
    assert.ok(install >= 0 && heal > install && guard > heal)
    assert.match(source.slice(install, heal), /DSH_HOME="\$\{BYCLAW_DSH_MANAGED_HOME\}"/)
    assert.match(source.match(healCommand)[1], /installAnchor:'\/workspace\/apps\/cli\/package.json'/)
  }
})

// Run inside the pinned DSH builder workspace with:
// DSH_ROOT=/workspace node --import tsx/esm --test scripts/dsh-profile-runtime.test.mjs
// The test uses DSH's real fallback implementation and isolated business packages.
test('official fallback makes the packed loop importable and retains the capability guard', {
  skip: !process.env.DSH_ROOT && 'DSH_ROOT is required for the upstream API integration check',
}, async t => {
  const workspace = resolve(process.env.DSH_ROOT)
  const manifest = JSON.parse(await readFile(join(workspace, 'packages/boot/app-boot/package.json'), 'utf8'))
  assert.equal(manifest.version, '0.1.5-rc.2', 'test the base image release')
  const { healProfilesModuleFallback } = await import(pathToFileURL(join(workspace, 'packages/boot/app-boot/src/profile.ts')))
  const root = await mkdtemp(join(tmpdir(), 'byclaw-profile-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'managed')
  const profile = join(home, 'profiles/web')
  const installation = join(root, 'installation')
  async function file(path, contents) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  await file(join(installation, 'package.json'), JSON.stringify({
    name: 'fixture-dsh', dependencies: { '@deepseek-ai/cordis': '4.0.1' },
  }))
  await file(join(installation, 'node_modules/@deepseek-ai/cordis/package.json'), JSON.stringify({
    name: '@deepseek-ai/cordis', version: '4.0.1', type: 'module', exports: './index.js',
  }))
  await file(join(installation, 'node_modules/@deepseek-ai/cordis/index.js'), 'export class Service {}\n')
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
    await healProfilesModuleFallback({ home, installAnchor: join(installation, 'package.json') })
    const after = probe()
    assert.equal(after.status, 0, after.stderr)
  }
  const runtime = await import(pathToFileURL(loop))
  const host = await import(pathToFileURL(join(installation, 'node_modules/@deepseek-ai/cordis/index.js')))
  assert.equal(runtime.Service, host.Service, 'profile and host must share the same Cordis instance')
  await file(loop, loopSource.replace('Reassembly=true', 'Reassembly=false'))
  const unpatched = probe()
  assert.notEqual(unpatched.status, 0)
  assert.match(unpatched.stderr, /Profile resolved an unpatched DSH agent loop/)
})
