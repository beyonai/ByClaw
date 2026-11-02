#!/usr/bin/env node
// Verify packed plugins through the same profile resolver used by the DSH launcher.
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [workspace, home] = process.argv.slice(2)
if (!workspace || !home) throw new Error('usage: verify-dsh-profile-runtime.mjs WORKSPACE DSH_HOME')
const installAnchor = join(resolve(workspace), 'apps/cli/package.json')
const { loadProfile, createRuntimeResolution } = await import(pathToFileURL(join(workspace, 'packages/boot/app-boot/src/profile.ts')))
const { installRuntimeInterception } = await import(pathToFileURL(join(workspace, 'packages/boot/app-boot/src/profile-resolution/resolver.ts')))
const profile = loadProfile('dsh', 'web', installAnchor, home)
if (profile.skippedBundles.length) throw new Error(JSON.stringify(profile.skippedBundles))
const interception = installRuntimeInterception(await createRuntimeResolution({ installAnchor, profile, home }))
try {
  const require = createRequire(join(profile.dir, 'package.json'))
  const pluginRequire = createRequire(require.resolve('@byclaw/byclaw-model-router/dsh'))
  const runtime = await import(pathToFileURL(pluginRequire.resolve('@deepseek-ai/dsh-agent-loop')))
  if (runtime.byclawRequestReassembly !== true) throw new Error('Profile resolved an unpatched DSH agent loop')
  if (typeof require('node-pty').spawn !== 'function') throw new Error('Profile node-pty is unavailable')
  console.log('DSH profile resolver, model-routing patch and node-pty verified')
} finally {
  interception.dispose()
}
