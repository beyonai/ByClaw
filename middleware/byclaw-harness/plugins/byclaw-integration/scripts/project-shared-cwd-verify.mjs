/** Path policy checks run directly from source, without a DSH daemon or mounted /by volume. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  byClawProjectCwd,
  byClawProjectSessionAlias,
  byClawSessionCwd,
  ensureByClawProjectSessionAlias,
  isLegacyProjectWorkspaceTransition,
  isProjectSharedCwd,
} from '../src/session-cwd.ts'

assert.equal(byClawProjectCwd(-1), '/by/.shared/project_-1')
assert.equal(byClawProjectCwd('42'), '/by/.shared/project_42')
assert.equal(byClawProjectCwd('42', '/tmp/local/by'), '/tmp/local/by/.shared/project_42')
assert.equal(byClawProjectSessionAlias('42', '100'), '/by/.shared/project_42/sessions/session_100')
assert.equal(byClawProjectSessionAlias('-1', 'abc-123', '/tmp/local/by'), '/tmp/local/by/.shared/project_-1/sessions/session_abc-123')
assert.equal(byClawProjectSessionAlias(undefined, '100'), undefined)
assert.throws(() => byClawProjectSessionAlias('42', '../escape'))
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

const byRoot = await mkdtemp(join(tmpdir(), 'byclaw-project-session-alias-'))
try {
  const canonical = byClawSessionCwd('100', byRoot)
  const alias = byClawProjectSessionAlias('42', '100', byRoot)
  assert.ok(alias)
  await ensureByClawProjectSessionAlias(canonical, alias)
  assert.equal(resolve(join(alias, '..'), await readlink(alias)), canonical)
  await writeFile(join(alias, 'from-project.txt'), 'project')
  assert.equal(await readFile(join(canonical, 'from-project.txt'), 'utf8'), 'project')
  await writeFile(join(canonical, 'from-session.txt'), 'session')
  assert.equal(await readFile(join(alias, 'from-session.txt'), 'utf8'), 'session')
  await ensureByClawProjectSessionAlias(canonical, alias)

  const concurrentAlias = byClawProjectSessionAlias('42', 'concurrent', byRoot)
  assert.ok(concurrentAlias)
  await Promise.all([
    ensureByClawProjectSessionAlias(canonical, concurrentAlias),
    ensureByClawProjectSessionAlias(canonical, concurrentAlias),
  ])

  const wrongTarget = byClawSessionCwd('other', byRoot)
  const wrongAlias = byClawProjectSessionAlias('42', 'other-link', byRoot)
  assert.ok(wrongAlias)
  await symlink(wrongTarget, wrongAlias, 'dir')
  await assert.rejects(ensureByClawProjectSessionAlias(canonical, wrongAlias), /unexpected target/)
} finally {
  await rm(byRoot, { recursive: true, force: true })
}
console.log('DSH project shared cwd path policy verification passed')
