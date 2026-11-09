import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ENTRYPOINT = fileURLToPath(new URL('../docker-entrypoint.sh', import.meta.url))
const source = await readFile(ENTRYPOINT, 'utf8')
// Exercise the exact function the entrypoint defines, with fixture cgroup and meminfo files.
const fn = source.match(/^multi_host_heap_mb\(\) \{\n[\s\S]+?\n\}$/m)?.[0]
const GiB = 1024 ** 3

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'multi-host-heap-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function heap(t, { v2, v1, memKb }) {
  assert.ok(fn, 'entrypoint must define multi_host_heap_mb')
  const dir = await fixture(t)
  const paths = [join(dir, 'memory.max'), join(dir, 'memory.limit_in_bytes'), join(dir, 'meminfo')]
  if (v2 !== undefined) await writeFile(paths[0], `${v2}\n`)
  if (v1 !== undefined) await writeFile(paths[1], `${v1}\n`)
  if (memKb !== undefined) await writeFile(paths[2], `MemTotal:       ${memKb} kB\nMemFree:        1 kB\n`)
  const r = spawnSync('bash', ['-c', `set -Eeuo pipefail\n${fn}\nmulti_host_heap_mb "$@"`, 'heap', ...paths], { encoding: 'utf8' })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr }
}

const kb = bytes => Math.round(bytes / 1024)
const mib34 = bytes => String(Math.floor(Math.floor(kb(bytes) * 1024 / 1048576) * 3 / 4))

test('a cgroup v2 limit sets the heap to three quarters of it', async (t) => {
  assert.deepEqual(await heap(t, { v2: 4 * GiB, memKb: kb(16 * GiB) }), { status: 0, out: '3072', err: '' })
  assert.equal((await heap(t, { v2: 1536 * 1048576, memKb: kb(16 * GiB) })).out, '1152')
})

test('without a v2 limit the cgroup v1 limit is used', async (t) => {
  assert.equal((await heap(t, { v1: 2 * GiB, memKb: kb(16 * GiB) })).out, '1536')
})

test('"max" or the v1 unlimited value fall back to physical memory', async (t) => {
  assert.equal((await heap(t, { v2: 'max', v1: 2 * GiB, memKb: kb(8 * GiB) })).out, '6144', 'v2 "max" means no limit; v1 is not consulted')
  assert.equal((await heap(t, { v1: '9223372036854771712', memKb: kb(14.8 * GiB) })).out, mib34(14.8 * GiB))
  assert.equal((await heap(t, { memKb: 23456789 })).out, mib34(23456789 * 1024))
  assert.equal((await heap(t, { v1: '9223372036854771712' })).status, 1, 'v1 unlimited without meminfo must not become a huge heap')
})

test('a limit above physical memory is capped by it', async (t) => {
  assert.equal((await heap(t, { v2: 64 * GiB, memKb: kb(8 * GiB) })).out, '6144')
})

test('nothing readable or a nonsense limit gives no value (Node keeps its default)', async (t) => {
  assert.deepEqual(await heap(t, {}), { status: 1, out: '', err: '' })
  assert.equal((await heap(t, { v2: 'garbage' })).status, 1)
  assert.equal((await heap(t, { v2: 1000 })).status, 1)
})

async function entrypointOptions(t, env) {
  const dir = await fixture(t)
  // A fake `node` that reports its own options and the NODE_OPTIONS its children would inherit.
  await writeFile(join(dir, 'node'), '#!/bin/sh\nfor a in "$@"; do case "$a" in --*) printf "%s " "$a";; esac; done\nprintf "|%s" "$NODE_OPTIONS"\n')
  await chmod(join(dir, 'node'), 0o755)
  const r = spawnSync('bash', [ENTRYPOINT, 'multi-host'], { encoding: 'utf8', env: { PATH: `${dir}:${process.env.PATH}`, ...env } })
  assert.equal(r.status, 0, r.stderr)
  const [flags, inherited] = r.stdout.split('|')
  return { flags: flags.trim(), inherited }
}

test('the multi-host entrypoint passes the detected heap and keeps an explicit one', { skip: process.getuid?.() === 0 && 'root takes the privilege-dropping path' }, async (t) => {
  const detected = spawnSync('bash', ['-c', `set -Eeuo pipefail\n${fn}\nmulti_host_heap_mb /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes /proc/meminfo`], { encoding: 'utf8' }).stdout.trim()
  const { flags: options, inherited } = await entrypointOptions(t, {})
  assert.match(options, /--experimental-async-context-frame/)
  assert.match(options, /--max-semi-space-size=64/)
  if (detected) assert.match(options, new RegExp(`--max-old-space-size=${detected}( |$)`))
  else assert.doesNotMatch(options, /--max-old-space-size/)
  assert.doesNotMatch(options, /--max-old-space-size=8192/)
  // The host's children do not inherit its flags.
  assert.equal(inherited, '')
  const explicit = await entrypointOptions(t, { NODE_OPTIONS: '--max-old-space-size=1234' })
  assert.doesNotMatch(explicit.flags, /--max-old-space-size/)
  assert.match(explicit.flags, /--max-semi-space-size=64/)
  assert.equal(explicit.inherited, '--max-old-space-size=1234')
})
