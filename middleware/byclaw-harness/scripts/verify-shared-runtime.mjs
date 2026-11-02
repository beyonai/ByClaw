#!/usr/bin/env node
// Exercise the image's compiled host against its actual installed employee plugin.
// No model calls, business credentials, employee hydration or tool environments.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadHostRuntime, preloadHostRuntime } from './byclaw-multi-host.mjs'

const [workspace, managedProfile] = process.argv.slice(2)
if (!workspace || !managedProfile) throw new Error('usage: verify-shared-runtime.mjs WORKSPACE MANAGED_PROFILE')
const started = performance.now()
const anchor = join(resolve(workspace), 'apps/cli/package.json')
const hostRequire = createRequire(anchor)
const profileRequire = createRequire(join(resolve(managedProfile), 'package.json'))
const preloaded = await preloadHostRuntime({ installAnchor: anchor, managedProfile: resolve(managedProfile) })
assert.deepEqual(preloaded.failed, [], 'all image-owned shared modules must be importable')
const { appBoot } = await loadHostRuntime(anchor)
const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')))
const load = name => import(pathToFileURL(profileRequire.resolve(name)))
const { createScope } = await load('@deepseek-ai/dsh-scope')
const selectorUrl = pathToFileURL(profileRequire.resolve('@byclaw/dsh-employee-selector'))
const selector = await import(selectorUrl)
const composition = await import(new URL('./composition.js', selectorUrl))
const profile = appBoot.loadProfileDirectory('dsh', resolve(managedProfile), anchor)
const resolution = await appBoot.createRuntimeResolution({ installAnchor: anchor, profile })
const home = await mkdtemp(join(tmpdir(), 'byclaw-shared-runtime-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const roots = []
try {
  let prepared = 0
  for (const owner of ['alice', 'bob']) {
    const ctx = new Context()
    roots.push(ctx)
    ctx.baseUrl = pathToFileURL(`${dirname(profileRequire.resolve('@byclaw/dsh-employee-selector'))}/`).href
    await ctx.plugin(appBoot.PluginPackages, { resolution })
    await ctx.plugin((await load('@deepseek-ai/cordis-plugin-loader')).default)
    ctx.loader.builtins.group = (await load('@deepseek-ai/cordis-plugin-group')).default
    await ctx.plugin((await load('@deepseek-ai/dsh-session-projection')).default)
    await ctx.plugin((await load('@deepseek-ai/dsh-agent-preset-registry')).default, { default: 'standard' })
    ctx.provide('byclawEmployeeRoots', {
      list: () => Array.from({ length: 56 }, (_, i) => ({
        template_id: `byclaw-employee-${i + 1}`, name: `${owner}-${i + 1}`, description: 'fixture',
      })),
      prepare: () => { prepared++; throw new Error('Employee resources must remain lazy') },
    })
    await ctx.agentPresets.register({ id: 'standard', plugins: [] })
    await ctx.plugin(selector)
    const roster = await ctx.agentPresets.list()
    assert.equal(roster.length, 57)
    assert.ok(roster.every(row => !row.broken), JSON.stringify(roster.filter(row => row.broken)))
    assert.equal(roster.find(row => row.id === 'byclaw-employee-1').name, `${owner}-1`)
  }
  const [alice, bob] = roots
  const capability = await composition.createEmployeeCapabilities(alice, [])
  const one = createScope(alice, {}), other = createScope(bob, {})
  try {
    await one.ctx.plugin({ inject: ['agentPresets'], apply: ctx => composition.composeEmployeeCapabilities(ctx, capability.id) })
    assert.equal(alice.agentPresets.composedPreset(one.ctx), capability.id)
    assert.throws(() => composition.composeEmployeeCapabilities(other.ctx, capability.id), /unavailable in this user context/)
    await capability.dispose()
    assert.throws(() => composition.composeEmployeeCapabilities(one.ctx, capability.id), /unavailable in this user context/)
    assert.equal(prepared, 0)
  } finally {
    await one.dispose()
    await other.dispose()
    await capability.dispose()
  }
  console.log(JSON.stringify({ sharedRuntime: 'passed', users: 2, employeesPerUser: 56,
    employeeResourcesLoaded: prepared, preloadedModules: preloaded.loaded, elapsedMs: Math.round(performance.now() - started) }))
} finally {
  for (const ctx of roots.reverse()) await ctx.fiber.dispose()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(home, { recursive: true, force: true })
}
