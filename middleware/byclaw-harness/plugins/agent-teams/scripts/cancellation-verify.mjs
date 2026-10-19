import { resolveTeamStateRoot } from '../lib/runtime-state.js'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cancelCaptainTeam, resumeCaptainTeam, isTeamCaptainStopped } from '../lib/lifecycle.js'
import { createTeamDir, readTeam } from '../lib/state.js'
import { steerCaptainReport } from '../lib/tools.js'
const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-cancel-'))
const root = resolveTeamStateRoot(workspace, '.agent-teams')
const captain = { id: 'captain', session: { header: { cwd: workspace } }, steer() { throw new Error('must not wake') } }
const ctx = { logger: { debug() {}, warn() {} } }
const task = (id, status) => ({ id, status, subject: id, assignee: 'member', dependencies: [], createdAt: 1, updatedAt: 1, attemptId: 'old-attempt', output: status === 'completed' ? 'keep result' : undefined })
try {
  await createTeamDir(root, { id: 'own', name: 'own', captainSessionId: captain.id, createdAt: 1, taskSeq: 3,
    members: [{ id: 'child', name: 'member', joinedAt: 1, status: 'working' }], tasks: [task('t1', 'in_progress'), task('t2', 'pending'), task('t3', 'completed')] })
  await createTeamDir(root, { id: 'other', name: 'other', captainSessionId: 'other-captain', createdAt: 1, taskSeq: 1,
    members: [], tasks: [task('t1', 'in_progress')] })
  const stopping = cancelCaptainTeam(ctx, captain, '.agent-teams')
  assert.equal(isTeamCaptainStopped(captain), true, 'close wake admission synchronously')
  assert.equal(steerCaptainReport(captain, 'member', 'late response'), false)
  await stopping
  const stopped = await readTeam(root, 'own')
  assert.deepEqual(stopped.tasks.map(t => t.status), ['cancelled', 'cancelled', 'completed'])
  assert.equal(stopped.tasks[0].attemptId, undefined)
  assert.equal(stopped.tasks[0].assignee, 'member')
  assert.equal(stopped.tasks[2].output, 'keep result')
  assert.equal(stopped.members[0].status, 'idle')
  assert.ok(stopped.stoppedAt)
  assert.equal((await readTeam(root, 'other')).tasks[0].status, 'in_progress')
  await resumeCaptainTeam(captain, '.agent-teams')
  assert.equal(isTeamCaptainStopped(captain), false)
  assert.equal((await readTeam(root, 'own')).stoppedAt, undefined)
  assert.equal((await readTeam(root, 'own')).tasks[0].status, 'cancelled')
  const solo = { id: 'solo', session: captain.session }
  await cancelCaptainTeam(ctx, solo, '.agent-teams')
  assert.equal((await readTeam(root, 'other')).tasks[0].status, 'in_progress')
  console.log('Team / single-agent cancellation boundary verification passed')
} finally { await rm(workspace, { recursive: true, force: true }) }
