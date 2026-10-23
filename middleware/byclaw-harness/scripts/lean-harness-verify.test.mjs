#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const moduleRoot = fileURLToPath(new URL('../', import.meta.url))
const base = await readFile(join(moduleRoot, 'Dockerfile.base_slim'), 'utf8')
const lean = await readFile(join(moduleRoot, 'Dockerfile.slim'), 'utf8')
const tools = await readFile(join(moduleRoot, 'Dockerfile.tool_slim'), 'utf8')
assert.match(lean, /^ARG BASE_IMAGE=192\.168\.0\.81:8080\/byclaw\/dsh-base:0\.2\.1-rc\.2_slim$/m)
assert.match(base, /FROM runtime-os AS dsh-base-slim/)
assert.doesNotMatch(base.split('FROM runtime-os AS dsh-builder')[0], /build-essential|ffmpeg|libreoffice|openjdk|chromium|xvfb/)
assert.match(base, /COPY --from=dsh-builder --chown=byclaw:byclaw \/workspace\//)
assert.match(lean, /FROM \$\{BASE_IMAGE\} AS runtime/)
assert.doesNotMatch(lean.split('FROM \${BASE_IMAGE} AS runtime')[1], /apt-get install|npm install --global|pip install/)
assert.match(lean, /USER byclaw/)
assert.match(lean, /verify-lean-harness\.mjs/)
assert.match(lean, /--dump-config/)
assert.match(tools, /FROM \$\{HARNESS_IMAGE\} AS tools/)
assert.match(tools, /playwright install --with-deps chromium/)
assert.match(tools, /EXPOSE 22 8081 8082/)
assert.match(tools, /tool-slim-entrypoint/)
assert.match(tools, /BYCLAW_BROWSER_ON_TOOL_ENV=0/)
// Old full-image builds retain their original entrypoints and local browsers.
for (const name of ['Dockerfile', 'Dockerfile.extensions', 'Dockerfile.base', 'Dockerfile.tools']) {
  const original = await readFile(join(moduleRoot, name), 'utf8')
  assert.doesNotMatch(original, /lean-entrypoint|tool-slim-entrypoint|Dockerfile\.base_slim/)
}

const root = await mkdtemp(join(tmpdir(), 'lean-startup-'))
try {
  const capture = join(root, 'calls')
  const original = join(root, 'original')
  await writeFile(original, '#!/bin/sh\nprintf "%s %s %s %s\\n" "${BYCLAW_DSH_PREPARE_ONLY:-0}" "${BYCLAW_DSH_PREPARED:-0}" "$BYCLAW_BROWSER_ON_TOOL_ENV" "$*" >>"$CAPTURE"\n')
  await chmod(original, 0o755)
  const entry = join(moduleRoot, 'scripts/lean-harness-entrypoint.sh')
  const env = { ...process.env, CAPTURE: capture, BYCLAW_LEAN_ORIGINAL_ENTRYPOINT: original }
  delete env.BYCLAW_DSH_TOOL_ENV
  assert.equal(spawnSync('bash', [entry], { env }).status, 2, 'no local-tool fallback in lean mode')
  env.BYCLAW_DSH_TOOL_ENV = 'static'
  assert.equal(spawnSync('bash', [entry, 'tools'], { env }).status, 2)
  if (process.getuid?.() !== 0) {
    assert.equal(spawnSync('bash', [entry, 'web', '--port', '4080'], { env }).status, 0)
    assert.equal(await readFile(capture, 'utf8'), '1 0 1 web --port 4080\n0 1 1 web --port 4080\n')
    await writeFile(capture, '')
    assert.equal(spawnSync('bash', [entry, 'multi-host'], { env }).status, 0)
    assert.equal(await readFile(capture, 'utf8'), '0 0 1 multi-host\n')
  }
  for (const name of ['lean-harness-entrypoint.sh', 'tool-slim-entrypoint.sh']) {
    assert.equal(spawnSync('bash', ['-n', join(moduleRoot, 'scripts', name)]).status, 0)
  }
  // The supervisor's anonymous secret FD must not reach SSH session configuration.
  const sshd = join(root, 'sshd')
  await writeFile(sshd, '#!/usr/bin/env python3\nimport os\nassert "BYCLAW_BROWSER_SECRET_FD" not in os.environ\nassert "BYCLAW_BROWSER_SECRET" not in os.environ\ntry:\n os.fstat(3)\nexcept OSError:\n pass\nelse:\n raise AssertionError("secret FD leaked")\n')
  await chmod(sshd, 0o755)
  const detached = spawnSync('bash', [join(moduleRoot, 'scripts/tool-slim-entrypoint.sh'), '--sshd'], {
    env: { ...process.env, BYCLAW_TOOL_SLIM_SSHD: sshd, BYCLAW_BROWSER_SECRET_FD: '3', BYCLAW_BROWSER_SECRET: 'test-only' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  })
  assert.equal(detached.status, 0, detached.stderr?.toString())
  console.log('Slim image layout, startup routing and secret FD checks passed')
} finally { await rm(root, { recursive: true, force: true }) }
