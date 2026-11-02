#!/usr/bin/env node
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

for (const executable of ['node', 'ssh', 'ssh-keygen', 'git', 'rsync', 'unzip', 'codegraph']) {
  assert.equal(spawnSync('sh', ['-c', 'command -v "$1"', 'sh', executable]).status, 0, `missing ${executable}`)
}
for (const executable of ['gcc', 'g++', 'make', 'java', 'javac', 'mvn', 'ffmpeg', 'ffprobe', 'libreoffice', 'chromium', 'Xvfb', 'x11vnc', 'websockify']) {
  assert.notEqual(spawnSync('sh', ['-c', 'command -v "$1"', 'sh', executable]).status, 0, `heavy tool remains: ${executable}`)
}
for (const path of ['/ms-playwright', '/opt/byclaw/novnc', '/usr/lib/jvm']) {
  await assert.rejects(access(path), `heavy runtime remains: ${path}`)
}
const require = createRequire('/opt/byclaw/dsh-managed/profiles/web/package.json')
const integration = createRequire(require.resolve('@byclaw/dsh-integration/package.json'))
const browser = createRequire(require.resolve('@byclaw/dsh-browser-use/package.json'))
const manifest = JSON.parse(await readFile(browser.resolve('@byclaw/dsh-browser-use/package.json'), 'utf8'))
assert.equal(manifest.name, '@byclaw/dsh-browser-use')
await access(new URL('./tool-environment-bridge.js', pathToFileURL(browser.resolve('@byclaw/dsh-browser-use'))))
assert.equal(typeof (await import(pathToFileURL(integration.resolve('@byclaw/by-framework')).href)).WorkerRunner, 'function')
// The remote helper and native PTY must retain their version-matched runtime closure.
const toolEnv = createRequire(require.resolve('@byclaw/dsh-tool-env/package.json'))
await access(toolEnv.resolve('@deepseek-ai/dsh-ssh/helper'))
assert.equal(typeof require('node-pty').spawn, 'function')
console.log('Lean runtime dependencies present; browser/Java/FFmpeg/Office runtimes absent')
