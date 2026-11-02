/** ByClaw resolves AgentTeams state through the per-context runtime, as the agent-teams plugin does. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { resolveTeamStateRoot, TeamStateRuntime } from '@byclaw/dsh-agent-teams'
import { byClawSessionCwd } from '../lib/session-cwd.js'
import { installByClawSessionCwdCompatibility } from '../lib/session-cwd-compat.js'
import { ByClawSessionMetadataStore } from '../lib/session-metadata.js'
import { GroupStateBoundary } from '../lib/group-state-boundary.js'

const root = await mkdtemp(join(tmpdir(), 'byclaw-team-state-runtime-'))
console.log('byclaw-integration per-context AgentTeams state verification')
try {
  // 1. Legacy-cwd aliases land on the context's runtime, not the process-wide one.
  const byRoot = join(root, 'by')
  const table = { records: new Map(), get(id) { return this.records.get(id) }, async put(id, value) { this.records.set(id, structuredClone(value)) } }
  const metadata = new ByClawSessionMetadataStore(table)
  const oldCwd = join(byRoot, 'projects', 'project-1')
  const header = Object.freeze({ ...Session.create(SessionId('conversation')).header, cwd: oldCwd })
  await metadata.ensureRoot('conversation', { createdAt: header.createdAt, cwd: oldCwd, externalSessionId: 'conversation', binding: { kind: 'main' } })
  const backend = {
    async open(id, access) {
      return { id, header, access, inheritedEventCount: 0, async read() { return { events: [], eventState: 'detached' } },
        async append() {}, async flush() {}, async close() {}, async [Symbol.asyncDispose]() {} }
    },
    async stat() { return { header, revision: 'unchanged' } },
    async list() { return [{ header, revision: 'unchanged' }] },
  }
  const runtime = new TeamStateRuntime({ dshHome: join(root, 'alice-home') })
  const uninstall = installByClawSessionCwdCompatibility(backend, metadata, byRoot, () => runtime)
  const cwd = byClawSessionCwd('conversation', byRoot)
  try {
    const handle = await backend.open('conversation', 'write')
    assert.equal(handle.header.cwd, cwd)
    assert.equal(runtime.resolveTeamStateRoot(cwd, '.agent-teams'), runtime.resolveTeamStateRoot(oldCwd, '.agent-teams'))
    assert.notEqual(resolveTeamStateRoot(cwd, '.agent-teams'), resolveTeamStateRoot(oldCwd, '.agent-teams'), 'process-wide aliases stay untouched')
    await handle.close()
  } finally {
    uninstall()
  }
  console.log('  PASS  session cwd aliases register on the context runtime')

  // 2. The member boundary protects this context's team database and resolves tool-environment cwds without the host.
  const remote = new TeamStateRuntime({ dshHome: join(root, 'bob-home'), workspaceOnToolEnvironment: true })
  const boundary = new GroupStateBoundary({
    privateRoots: [join(root, 'catalog')], getScope: () => ({ role: 'member' }),
    dshHome: join(root, 'bob-home'), stateRuntime: () => remote,
  })
  const member = { id: 'member-1', session: { header: { cwd: '/by/s/conversation' } } }
  const asMember = operation => boundary.actors.run({ agent: member, scope: { role: 'member' } }, operation)
  asMember(() => boundary.assertPath('notes/../report.md'))
  assert.throws(() => asMember(() => boundary.assertPath(join(remote.runtimeRoot(), 'team', 'team.json'))), /PRIVATE_STATE_DENIED/)
  const fallback = new GroupStateBoundary({ privateRoots: [join(root, 'catalog')], getScope: () => ({ role: 'member' }) })
  assert.throws(() => fallback.actors.run({ agent: member, scope: { role: 'member' } },
    () => fallback.assertPath(join(new TeamStateRuntime().runtimeRoot(), 'x'))), /PRIVATE_STATE_DENIED/, 'default runtime root stays private')
  console.log('  PASS  member boundary uses the context runtime root and opaque tool-environment cwds')
} finally {
  await rm(root, { recursive: true, force: true })
}
console.log('\nall per-context AgentTeams state checks passed')
