import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { createManagedClaims } from './byclaw-multi-host.mjs'

const exec = promisify(execFile)
test('shared storage excludes different generations and late release cannot delete a new owner', async t => {
  const dir = await mkdtemp('/tmp/dsh-claim-')
  const socket = join(dir, 'redis.sock')
  const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
  let spawnError
  server.on('error', error => { spawnError = error })
  t.after(async () => {
    if (server.pid && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited }
    await rm(dir, { recursive: true, force: true })
  })
  const command = async (...args) => (await exec('redis-cli', ['-s', socket, '--raw', ...args.map(String)])).stdout.trim()
  for (let i = 0; i < 50; i++) {
    if (spawnError) { if (spawnError.code === 'ENOENT') return t.skip('redis-server is not installed'); throw spawnError }
    try { if (await command('PING') === 'PONG') break } catch {}
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(await command('PING'), 'PONG')
  const redis = { get: async key => (await command('GET', key)) || null, eval: async (...args) => Number(await command('EVAL', ...args)) }
  const a = createManagedClaims(redis, 'host-a', { sharedStorage: true })
  const b = createManagedClaims(redis, 'host-b', { sharedStorage: true })
  const first = { mappingId: 'map-a', generation: 1, userCode: 'alice' }
  const next = { mappingId: 'map-b', generation: 2, userCode: 'alice' }
  await a.claim('ctx-a', first)
  await a.claim('ctx-a', first)
  await assert.rejects(b.claim('ctx-a', next), /another executor/)
  await b.claim('ctx-b', next)
  await a.release('ctx-a', first)
  await b.claim('ctx-a', next)
  await a.release('ctx-a', first)
  await assert.rejects(a.claim('ctx-a', first), /another executor/)
  await b.release('ctx-a', next)
})
