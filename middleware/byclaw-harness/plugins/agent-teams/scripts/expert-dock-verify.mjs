/** Pure parent/child expert-strip projection verification. */

import { expertState, teamForParent } from '../lib/client/expert-team-model.js'

const teams = [{
  teamId: 'delivery',
  captainSessionId: 'parent-1',
  members: [
    { id: 'child-dev', name: 'engineer', role: 'implementation', activity: 'working', status: 'working' },
    { id: 'child-qa', name: 'qa', role: 'verification', activity: 'idle', status: 'idle' },
  ],
  tasks: [
    { id: 't1', assignee: 'engineer', status: 'in_progress', state: 'running', dependencies: [] },
    { id: 't2', assignee: 'qa', status: 'failed', state: 'open', dependencies: ['t1'] },
  ],
}]

console.log('dsh-agent-teams parent/child expert dock verification')
const selected = teamForParent(teams, 'parent-1')
if (selected?.teamId !== 'delivery' || teamForParent(teams, 'child-dev') !== undefined) {
  throw new Error('expert dock did not stay scoped to the captain parent session')
}
if (expertState(selected.members[0], selected.tasks) !== 'working') {
  throw new Error('working child state was not projected')
}
if (expertState(selected.members[1], selected.tasks) !== 'failed') {
  throw new Error('failed owned task did not dominate idle child state')
}
console.log('  PASS  dock is visible only in the captain parent session')
console.log('  PASS  expert chips derive working and failure states from live children and owned tasks')
console.log('\nall parent/child expert dock checks passed')
