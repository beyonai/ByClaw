#!/usr/bin/env node
// Exercise the lazy image path after installing the same profile hook as the host.
// All attachments and filesystem fixtures belong to a disposable temporary home.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [workspace, managedProfile] = process.argv.slice(2)
if (!workspace || !managedProfile) {
  console.error('usage: verify-read-image-runtime.mjs WORKSPACE MANAGED_PROFILE')
  process.exit(2)
}
// Match the failing resolver's logical symlink paths without applying this flag
// to Cordis and accidentally creating duplicate service/package identities.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGN4oGAARwzIHACBGgmBuK5wlQAAAABJRU5ErkJggg==', 'base64')
const native = spawnSync(process.execPath, ['--preserve-symlinks', '-e', `
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const sharp = createRequire(process.argv[1])('sharp');
(async () => {
  const source = readFileSync(0);
  const decoded = await sharp(source).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([decoded.info.width, decoded.info.height, decoded.info.channels], [4, 2, 3]);
  assert.deepEqual([...decoded.data], Array.from({ length: 8 }, () => [224, 32, 48]).flat());
  const png = await sharp(source).resize(2, 1).png().toBuffer();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [2, 1, 3]);
  assert.deepEqual([...data], [224, 32, 48, 224, 32, 48]);
  console.log('PRESERVED_SYMLINK_SHARP_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
`, join(resolve(workspace), 'packages/attachment/attachment-local/package.json')], {
  input: png, encoding: 'utf8', timeout: 30000,
})
assert.equal(native.status, 0, `Sharp native closure failed with preserved symlinks:\n${native.stderr || native.stdout || native.error}`)
assert.match(native.stdout, /PRESERVED_SYMLINK_SHARP_OK/)
process.stdout.write(native.stdout)
const anchor = join(resolve(workspace), 'apps/cli/package.json')
const hostRequire = createRequire(anchor)
const { loadHostRuntime } = await import(pathToFileURL(join(resolve(workspace), 'scripts/byclaw-multi-host.mjs')).href)
const { appBoot } = await loadHostRuntime(anchor)
const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
const home = await mkdtemp(join(tmpdir(), 'byclaw-read-image-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const ctx = new Context()
try {
  // Match bootUserContext: the user profile is a manifest beside a symlinked
  // managed node_modules tree. Resolving the managed directory directly misses
  // the user-profile interception path and can conceal pnpm realpath failures.
  const userProfile = join(home, 'profile')
  await mkdir(userProfile)
  await writeFile(join(userProfile, 'package.json'), await readFile(join(resolve(managedProfile), 'package.json')))
  await symlink(join(resolve(managedProfile), 'node_modules'), join(userProfile, 'node_modules'), 'dir')
  const profileRequire = createRequire(join(userProfile, 'package.json'))
  const profile = appBoot.loadProfileDirectory('dsh', userProfile, anchor)
  const resolution = await appBoot.createRuntimeResolution({ installAnchor: anchor, profile })
  await ctx.plugin(appBoot.PluginPackages, { resolution })
  // Bare ESM imports must originate in the user profile, like Loader imports;
  // pre-resolving them with createRequire would canonicalize paths too early.
  const importer = join(userProfile, 'read-image-importer.mjs')
  await writeFile(importer, 'export const load = name => import(name)\n')
  const { load } = await import(pathToFileURL(importer).href)
  // Import and first use both occur under interception; never warm Sharp first.
  await ctx.plugin((await load('@deepseek-ai/dsh-attachment-local')).default, { dshHome: home })
  await ctx.plugin((await load('@deepseek-ai/dsh-fs-local')).default, { cwd: home })
  const tools = new Map()
  // Capture the real tool-fs definition, with no model/network service involved.
  ctx.provide('tools', { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } })
  ctx.provide('systemPrompt', {})
  ctx.provide('workingDirectory', { ensure: async () => home })
  ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['image'] }) })
  await ctx.plugin(await load('@deepseek-ai/dsh-tool-fs'), { read: false, write: false, edit: false })
  const tool = tools.get('read_image')
  assert.ok(tool, 'real tool-fs read_image must register with the attachment backend')
  // Independently encoded 4x2 RGB PNG: every pixel is [224, 32, 48].
  const file = join(home, 'fixture.png')
  await writeFile(file, png)
  const result = await tool.execute({ file_path: file }, {
    signal: AbortSignal.timeout(30000), callId: 'read-image-runtime',
    agent: { options: { provider: 'fixture', model: 'fixture-image' }, session: { requestHeader: () => undefined } },
  })
  assert.equal(result.path, file)
  assert.deepEqual([result.image.mediaType, result.image.width, result.image.height], ['image/png', 4, 2])
  const stored = await ctx.attachments.readImage(result.image)
  assert.deepEqual(Buffer.from(stored.data), png)
  const variant = await ctx.attachments.readImageRequest(result.image, { width: 2, height: 1, maxBytes: 100000 })
  assert.deepEqual([variant.width, variant.height], [2, 1])
  assert.notDeepEqual(Buffer.from(variant.data), png, 'request image must actually transform the raster')
  // First native admission and re-encoding above used attachment-local's lazy
  // loader. Only now use its exact Sharp instance to inspect transformed pixels.
  const attachmentRequire = createRequire(profileRequire.resolve('@deepseek-ai/dsh-attachment-local'))
  const sharp = attachmentRequire('sharp')
  const { data, info } = await sharp(variant.data).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([info.width, info.height, info.channels], [2, 1, 3])
  for (let offset = 0; offset < data.length; offset += 3) {
    for (const [channel, expected] of [224, 32, 48].entries()) assert.ok(Math.abs(data[offset + channel] - expected) <= 8, 'resized pixel must retain the fixture color')
  }
  assert.deepEqual(await readFile(file), png, 'source fixture remains unchanged')
  console.log('READ_IMAGE_RUNTIME_OK: production profile interception, lazy Sharp decode, read_image, durable image read, native resize/encode and pixel verification')
} finally {
  try { await ctx.fiber.dispose() } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
}
