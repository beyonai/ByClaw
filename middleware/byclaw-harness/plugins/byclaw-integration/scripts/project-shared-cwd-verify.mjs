/** Path policy checks run directly from source, without a DSH daemon or mounted /by volume. */
import assert from 'node:assert/strict'
import { byClawProjectCwd, byClawSessionCwd, isLegacyProjectWorkspaceTransition, isProjectSharedCwd } from '../src/session-cwd.ts'

assert.equal(byClawProjectCwd(-1), '/by/.shared/project_-1')
assert.equal(byClawProjectCwd('42'), '/by/.shared/project_42')
assert.equal(byClawProjectCwd('42', '/tmp/local/by'), '/tmp/local/by/.shared/project_42')
for (const value of [undefined, '', '../escape', '42/child', 'NaN', '42.5']) {
  assert.equal(byClawProjectCwd(value), undefined)
}
const project = byClawProjectCwd('42')
assert.equal(isProjectSharedCwd(project), true)
assert.equal(isProjectSharedCwd(`${project}/child`), false)
assert.equal(isLegacyProjectWorkspaceTransition(byClawSessionCwd('session'), project, 'session'), true)
assert.equal(isLegacyProjectWorkspaceTransition('/by/projects/42', project, 'session'), true)
for (const previous of ['/by/.sessions/other', '/srv/private', '/by/.shared/project_13', `${project}/child`]) {
  assert.equal(isLegacyProjectWorkspaceTransition(previous, project, 'session'), false)
}
assert.equal(isLegacyProjectWorkspaceTransition(project, '/by/.sessions/session', 'session'), false)
console.log('DSH project shared cwd path policy verification passed')
