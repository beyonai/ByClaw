import assert from 'node:assert/strict'
import { TeamStateRuntime } from '../src/runtime-state.ts'

const runtime = new TeamStateRuntime({ dshHome: '/tmp/byclaw-state-test', workspaceOnToolEnvironment: true })
const project = '/by/.shared/project_-1'
const first = '/by/.sessions/first'
const second = '/by/.sessions/second'
const namespace = '.agent-teams'
const original = runtime.resolveTeamStateRoot(project, namespace)
const expectedFirst = runtime.resolveTeamStateRoot(first, namespace)
const expectedSecond = runtime.resolveTeamStateRoot(second, namespace)
assert.notEqual(expectedFirst, expectedSecond)
await Promise.all([first, second].map((session, index) => runtime.runWithWorkspaceAlias(project, session, async () => {
  await new Promise(resolve => setTimeout(resolve, index ? 1 : 10))
  assert.equal(runtime.resolveTeamStateRoot(project, namespace), index ? expectedSecond : expectedFirst)
})))
assert.equal(runtime.resolveTeamStateRoot(project, namespace), original, 'scopes do not leak')
const release = runtime.registerWorkspaceAlias(first, '/by/projects/old-project')
runtime.runWithWorkspaceAlias(first, first, () => {
  assert.equal(runtime.resolveTeamStateRoot(first, namespace), runtime.resolveTeamStateRoot('/by/projects/old-project', namespace))
})
runtime.runWithWorkspaceAlias(project, first, () => {
  assert.equal(runtime.resolveTeamStateRoot(project, namespace), runtime.resolveTeamStateRoot('/by/projects/old-project', namespace))
})
release()
assert.throws(() => runtime.runWithWorkspaceAlias(project, first, () => { throw new Error('task failed') }), /task failed/)
assert.equal(runtime.resolveTeamStateRoot(project, namespace), original)
console.log('Concurrent project cwd session-state isolation and legacy state aliases: passed')
