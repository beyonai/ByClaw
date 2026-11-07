import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PID1 = fileURLToPath(new URL('./byclaw-pid1.py', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const run = (args) => {
  const child = spawn('python3', [PID1, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const done = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })))
  return { child, done }
}
// Direct children of `pid` in a given state ('Z' zombie, or any live state), read from /proc.
const childrenOf = (pid, zombie) => readdirSync('/proc').filter(n => /^\d+$/.test(n)).filter((n) => {
  try {
    const stat = readFileSync(`/proc/${n}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return Number(fields[1]) === pid && (fields[0] === 'Z') === zombie
  } catch { return false }
})

test('orphans of the command are adopted and reaped instead of left as zombies', async () => {
  // Each subshell exits at once, so its `sleep 0.6` is orphaned: the subreaper must adopt it, then reap it.
  const { child, done } = run(['sh', '-c', 'for i in 1 2 3 4 5; do (sleep 0.6 &); done; sleep 1.8'])
  await sleep(300)
  // the command itself (sh) plus the five adopted sleeps
  assert.ok(childrenOf(child.pid, false).length >= 6, 'orphans were not adopted by the wrapper')
  await sleep(1000)
  assert.deepEqual(childrenOf(child.pid, true), [])
  assert.equal(childrenOf(child.pid, false).length, 1)
  assert.equal((await done).code, 0)
})

test('the command exit status and fatal signal are passed through', async () => {
  assert.equal((await run(['sh', '-c', 'exit 7']).done).code, 7)
  assert.equal((await run(['sh', '-c', 'kill -KILL $$']).done).code, 128 + 9)
  assert.equal((await run(['/nonexistent-command']).done).code, 127)
})

test('SIGTERM is forwarded to the command', async () => {
  const { child, done } = run(['sh', '-c', 'trap "exit 42" TERM; while :; do sleep 0.05; done'])
  await sleep(300)
  child.kill('SIGTERM')
  assert.equal((await done).code, 42)
})
