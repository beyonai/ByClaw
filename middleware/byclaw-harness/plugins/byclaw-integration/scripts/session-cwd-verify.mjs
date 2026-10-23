/** Conversation cwd, immutable DSH restore and legacy workspace compatibility regressions. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveTeamStateRoot } from '@byclaw/dsh-agent-teams'
import { byClawSessionCwd, isLegacyProjectWorkspaceTransition } from '../lib/session-cwd.js'
import { installByClawSessionCwdCompatibility } from '../lib/session-cwd-compat.js'
import { ByClawSessionMetadataStore } from '../lib/session-metadata.js'
import { ByClawSessionWorkspaceRegistry, byClawBoundRootSessionId } from '../lib/session-workspace.js'

const byRoot = await mkdtemp(join(tmpdir(), 'byclaw-session-cwd-'))
const table = {
  records: new Map(),
  get(id) { return this.records.get(id) },
  async put(id, value) { this.records.set(id, structuredClone(value)) },
}
const metadata = new ByClawSessionMetadataStore(table)
const records = new Map()
const closed = []
const flushed = []
const writers = new Set()
function stored(id, cwd, parentSession, events = []) {
  const initial = Session.create(SessionId(id))
  const header = Object.freeze({ ...initial.header, cwd, ...(parentSession ? { parentSession: SessionId(parentSession) } : {}) })
  records.set(id, { header, events: [...events], inheritedEventCount: 0 })
  return header
}
const backend = {
  async open(id, access) {
    const record = records.get(id)
    if (!record) throw Object.assign(new Error('missing'), { name: 'SessionPersistenceNotFoundError' })
    if (access === 'write') {
      if (writers.has(id)) throw new Error('already owned')
      writers.add(id)
    }
    let done = false
    return {
      id, header: record.header, access, inheritedEventCount: record.inheritedEventCount,
      async read(offset = 0, length) {
        assert.equal(done, false)
        return { events: structuredClone(record.events.slice(offset, length === undefined ? undefined : offset + length)), eventState: 'detached' }
      },
      async append(events) { assert.equal(access, 'write'); record.events.push(...events) },
      async flush() { flushed.push(id) },
      async close() { if (!done) { done = true; closed.push(id); if (access === 'write') writers.delete(id) } },
      async [Symbol.asyncDispose]() { await this.close() },
    }
  },
  async stat(id) { const record = records.get(id); return record && { header: record.header, revision: 'unchanged' } },
  async list() { return [...records.values()].map(record => ({ header: record.header, revision: 'unchanged' })) },
}
const originalOpen = backend.open
let uninstall = () => {}
try {
  const oldCwd = join(byRoot, 'projects', 'project-1')
  const cwd = byClawSessionCwd('conversation', byRoot)
  const seed = Session.create(SessionId('conversation'))
  seed.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'keep my history' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const rootHeader = stored('conversation', oldCwd, undefined, seed.snapshotEvents())
  const rootRequest = { createdAt: rootHeader.createdAt, cwd: oldCwd, externalSessionId: 'conversation', binding: { kind: 'main' } }
  await metadata.ensureRoot('conversation', rootRequest)
  stored('child', oldCwd, 'conversation')
  const employeeBinding = { kind: 'template', templateId: 'byclaw-employee-other' }
  const employeeId = byClawBoundRootSessionId('conversation', employeeBinding)
  const employeeHeader = stored(employeeId, oldCwd)
  await metadata.ensureRoot(employeeId, { ...rootRequest, createdAt: employeeHeader.createdAt, binding: employeeBinding })
  stored('unowned', oldCwd)
  stored('custom', '/srv/custom')
  stored('legacy', oldCwd, undefined, [
    { type: 'byclaw/session-workspace', data: { externalSessionId: 'legacy', cwd: oldCwd } },
  ])

  uninstall = installByClawSessionCwdCompatibility(backend, metadata, byRoot)
  assert.equal((await backend.stat('conversation')).header.cwd, cwd)
  assert.equal((await backend.list()).find(item => item.header.id === employeeId).header.cwd, cwd)
  const readOnly = await backend.open('conversation', 'read')
  assert.equal(readOnly.access, 'read')
  assert.equal(readOnly.header.cwd, cwd)
  await readOnly.close()

  const handle = await backend.open('conversation', 'write')
  const result = await handle.read()
  const resumed = Session.fromRestore(handle.id, result.events, structuredClone(handle.header), handle.inheritedEventCount, result.eventState)
  assert.equal(resumed.header.cwd, cwd, 'the actual immutable Session must be restored with the new execution cwd')
  assert.equal(resumed.id, 'conversation')
  assert.equal(resumed.header.createdAt, rootHeader.createdAt)
  const restored = resumed.snapshotEvents()
  assert.deepEqual(restored.slice(0, seed.snapshotEvents().length), seed.snapshotEvents(), 'all historical events are preserved exactly')
  assert.deepEqual(restored.slice(seed.snapshotEvents().length).map(event => event.type), ['session/end-seed'],
    'rc.2 appends only its restore boundary, without inventing business history')
  assert.equal(records.get('conversation').header, rootHeader, 'the physical legacy header is not rewritten')
  await assert.rejects(backend.open('conversation', 'write'), /already owned/)
  await writeFile(join(resumed.header.cwd, 'output.txt'), 'process file')
  assert.equal(await readFile(join(cwd, 'output.txt'), 'utf8'), 'process file')
  assert.equal(resolveTeamStateRoot(cwd, '.agent-teams'), resolveTeamStateRoot(oldCwd, '.agent-teams'),
    'existing task state must remain reachable independently of the new execution cwd')
  const nextEvent = resumed.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'continue the same conversation' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  assert.equal(nextEvent.type, 'user/message')
  await handle.append(resumed.snapshotEvents().slice(result.events.length))
  assert.deepEqual(records.get('conversation').events, resumed.snapshotEvents(), 'new events append to the original log')
  await handle.flush()
  await handle.close()
  assert.ok(flushed.includes('conversation'))
  assert.equal(writers.size, 0)

  const upgraded = await metadata.ensureRoot('conversation', { ...rootRequest, cwd }, { byRoot })
  assert.deepEqual(upgraded.identity, { createdAt: rootHeader.createdAt, cwd })
  assert.deepEqual(await metadata.ensureRoot('conversation', { ...rootRequest, cwd }, { byRoot }), upgraded)
  await assert.rejects(metadata.ensureRoot('conversation', rootRequest, { byRoot }), /cannot change cwd/)
  await assert.rejects(metadata.ensureRoot(employeeId, { ...rootRequest, createdAt: employeeHeader.createdAt,
    binding: employeeBinding, cwd: byClawSessionCwd('another', byRoot) }, { byRoot }), /cannot change cwd/)

  // A second restore after metadata upgrade still translates the original physical header.
  const reopened = await backend.open('conversation', 'write')
  assert.equal(reopened.header.cwd, cwd)
  await reopened[Symbol.asyncDispose]()
  for (const id of ['child', employeeId]) {
    const child = await backend.open(id, 'write')
    assert.equal(child.header.cwd, cwd, 'descendants and additional employee roots use the external conversation id')
    await child.close()
  }
  for (const [id, expected] of [['unowned', oldCwd], ['custom', '/srv/custom'], ['legacy', byClawSessionCwd('legacy', byRoot)]]) {
    const other = await backend.open(id, 'read')
    assert.equal(other.header.cwd, expected)
    await other.close()
  }
  const registry = new ByClawSessionWorkspaceRegistry()
  assert.equal(registry.registerRoot({ id: 'legacy', header: { cwd: byClawSessionCwd('legacy', byRoot) },
    snapshotEvents: () => records.get('legacy').events }, 'legacy', { sessionRoot: byClawSessionCwd('legacy', byRoot) }).cwd,
  byClawSessionCwd('legacy', byRoot))
  assert.throws(() => new ByClawSessionWorkspaceRegistry().registerRoot({ id: 'legacy', header: { cwd: byClawSessionCwd('another', byRoot) },
    snapshotEvents: () => records.get('legacy').events }, 'legacy', { sessionRoot: byClawSessionCwd('another', byRoot) }), /conflicts/)

  const staleHeader = stored('stale', oldCwd)
  await metadata.ensureRoot('stale', { ...rootRequest, externalSessionId: 'stale', createdAt: staleHeader.createdAt + 1 })
  await assert.rejects(backend.open('stale', 'write'), /lifecycle mismatch/)
  assert.equal(writers.size, 0, 'a rejected compatibility restore releases writer ownership')
  stored('cycle-a', oldCwd, 'cycle-b')
  stored('cycle-b', oldCwd, 'cycle-a')
  await assert.rejects(backend.open('cycle-a', 'read'), /Cyclic/)
  assert.ok(closed.includes('cycle-a'))

  for (const invalid of ['../other', '/absolute', '.', '..', 'a/b']) assert.throws(() => byClawSessionCwd(invalid, byRoot))
  assert.equal(isLegacyProjectWorkspaceTransition(oldCwd, cwd, 'conversation', byRoot), true)
  assert.equal(isLegacyProjectWorkspaceTransition('/by/projects/project-1', cwd, 'conversation', byRoot), true)
  assert.equal(isLegacyProjectWorkspaceTransition(oldCwd, cwd, 'another', byRoot), false)
  assert.equal(isLegacyProjectWorkspaceTransition('/srv/custom', cwd, 'conversation', byRoot), false)
  assert.equal(isLegacyProjectWorkspaceTransition(join(oldCwd, 'subdir'), cwd, 'conversation', byRoot), false)
  uninstall()
  assert.equal(backend.open, originalOpen)
  assert.notEqual(resolveTeamStateRoot(cwd, '.agent-teams'), resolveTeamStateRoot(oldCwd, '.agent-teams'))
  // Worker restart reinstalls the translation from durable identities; no in-memory migration flag is needed.
  uninstall = installByClawSessionCwdCompatibility(backend, new ByClawSessionMetadataStore(table), byRoot)
  const afterRestart = await backend.open('conversation', 'write')
  assert.equal(afterRestart.header.cwd, cwd)
  assert.deepEqual((await afterRestart.read()).events, resumed.snapshotEvents())
  await afterRestart.close()
  uninstall()
  // With the workspace on a tool environment the projected cwd is created there, not on this host.
  const remoteDirectories = []
  uninstall = installByClawSessionCwdCompatibility(
    backend, new ByClawSessionMetadataStore(table), byRoot, undefined, async path => { remoteDirectories.push(path) },
  )
  await rm(cwd, { recursive: true, force: true })
  const remote = await backend.open('conversation', 'write')
  assert.equal(remote.header.cwd, cwd)
  assert.deepEqual(remoteDirectories, [cwd])
  await assert.rejects(readFile(join(cwd, 'missing'), 'utf8'), { code: 'ENOENT' })
  await remote.close()
} finally {
  uninstall()
  await rm(byRoot, { recursive: true, force: true })
}
console.info('ByClaw session cwd verification passed')
