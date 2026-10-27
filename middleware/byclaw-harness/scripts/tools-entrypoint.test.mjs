#!/usr/bin/env node
// The `tools` mode of docker-entrypoint.sh: what the tool sandbox (B) does before serving SSH.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const entrypoint = fileURLToPath(new URL('../docker-entrypoint.sh', import.meta.url))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tools-entry-'))
  const server = join(root, 'server')
  await writeFile(server, '#!/bin/sh\nprintf "%s\\n" "server $*" >>"$CAPTURE"\n')
  await chmod(server, 0o755)
  const env = {
    ...process.env, CAPTURE: join(root, 'calls'),
    BYCLAW_TOOL_ENV_SERVER: server,
    BYCLAW_TOOL_HOME: join(root, 'home'),
    BYCLAW_TOOL_HOME_SEED: join(root, 'seed'),
    // No browser supervisor here: these cases are about the home directory.
    BYCLAW_TOOL_BROWSER: '0',
  }
  return { root, env, run: () => spawnSync('bash', [entrypoint, 'tools'], { env, encoding: 'utf8' }) }
}

test('a persistent home starts from the image home and keeps what the user changed', async () => {
  const { root, env, run } = await fixture()
  try {
    const seed = env.BYCLAW_TOOL_HOME_SEED
    await mkdir(join(seed, '.lark-cli'), { recursive: true })
    await writeFile(join(seed, '.bashrc'), 'image bashrc\n')
    await writeFile(join(seed, '.lark-cli', 'config.json'), '{"image":true}\n')
    // First start on an empty volume: the image home appears.
    await mkdir(env.BYCLAW_TOOL_HOME)
    let result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.bashrc'), 'utf8'), 'image bashrc\n')
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.lark-cli', 'config.json'), 'utf8'), '{"image":true}\n')
    // The user changes and adds files; a newer image adds a default of its own.
    await writeFile(join(env.BYCLAW_TOOL_HOME, '.bashrc'), 'user bashrc\n')
    await mkdir(join(env.BYCLAW_TOOL_HOME, '.openclaw'))
    await writeFile(join(env.BYCLAW_TOOL_HOME, '.openclaw', 'credentials'), 'token\n')
    await writeFile(join(seed, '.profile'), 'new default\n')
    result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.bashrc'), 'utf8'), 'user bashrc\n')
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.openclaw', 'credentials'), 'utf8'), 'token\n')
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.profile'), 'utf8'), 'new default\n')
    assert.equal(await readFile(env.CAPTURE, 'utf8'), 'server \nserver \n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an image without a home seed just serves SSH', async () => {
  const { root, env, run } = await fixture()
  try {
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(env.CAPTURE, 'utf8'), 'server \n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
