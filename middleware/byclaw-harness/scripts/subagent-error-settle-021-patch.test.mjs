import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stripTypeScriptTypes } from 'node:module'
import { prepare, prepareSource, before, after, marker } from './prepare-dsh-subagent-error-settle-021.mjs'

// The function as DSH 0.2.1 ships it (packages/subagent/subagent/src/activation.ts).
const original = `/**
 * Retain local failures whose turn ending could not be committed.
 * @param activation - exact local Agent and epoch receiving the scoped observers.
 * @param wake - notify its settlement watcher when failure changes readiness.
 */
export function observeLocalFailure(activation: LocalActivation, wake: () => void): void {
  const child = activation.handle.agent
  child.ctx.on('agent/error', ({ agent }) => {
    if (agent !== child) return
    activation.failureAt = child.session.seq
    wake()
  })
${before}
}
`

/** Compile the function and attach it to a stand-in child; returns the activation and an event feed. */
function observe(source) {
  const observeLocalFailure = new Function(`${stripTypeScriptTypes(source).replace('export function', 'function')}; return observeLocalFailure`)()
  const handlers = new Map()
  const session = { seq: 0 }
  const child = { session, ctx: { on: (name, handler) => handlers.set(name, handler) } }
  const activation = { handle: { agent: child }, failureAt: undefined, wakes: 0 }
  observeLocalFailure(activation, () => { activation.wakes++ })
  const turnEnd = (seq, kind) => { session.seq = seq + 1; handlers.get('session/event')(session, { type: 'turn/end', seq, data: { reason: { kind } } }) }
  const failLive = seq => { session.seq = seq; handlers.get('agent/error')({ agent: child }) }
  return { activation, turnEnd, failLive }
}

test('a committed error ending keeps the child failed, so queued input no longer holds its settlement', () => {
  const before = observe(original)
  before.turnEnd(124, 'error')
  assert.equal(before.activation.failureAt, undefined) // DSH 0.2.1: the parent then waits on the child's inbox
  const { activation, turnEnd, failLive } = observe(prepareSource(original))
  turnEnd(124, 'error')
  assert.equal(activation.failureAt, 125) // the log offset after the ending, as a live failure records it
  assert.equal(activation.wakes, 1)
  // A later turn that ends otherwise (the child was given more work) clears it, as before.
  turnEnd(130, 'completed')
  assert.equal(activation.failureAt, undefined)
  // A live failure without a committed ending is still kept until one is committed.
  failLive(140)
  assert.equal(activation.failureAt, 140)
  turnEnd(141, 'completed')
  assert.equal(activation.failureAt, undefined)
})

test('patch is exact, idempotent and refuses changed or mixed sources', () => {
  const updated = prepareSource(original)
  assert.ok(updated.includes(marker) && updated.includes(after) && !updated.includes(before))
  assert.equal(prepareSource(updated), updated)
  assert.throws(() => prepareSource('upstream changed'), /Unsupported/)
  assert.throws(() => prepareSource(updated + before), /Unsupported/)
})

test('prepare checks the package version before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-subagent-error-'))
  try {
    const dir = join(root, 'packages/subagent/subagent')
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src/activation.ts'), original)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-subagent', version: '0.2.2' }))
    await assert.rejects(prepare(root), /Expected/)
    assert.equal(await readFile(join(dir, 'src/activation.ts'), 'utf8'), original)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-subagent', version: '0.2.1-rc.2' }))
    await prepare(root)
    assert.ok((await readFile(join(dir, 'src/activation.ts'), 'utf8')).includes(marker))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
