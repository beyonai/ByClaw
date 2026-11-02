import { resolveTeamStateRoot } from '../lib/runtime-state.js'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectArchivedTeamsActivity, collectTeamsActivity } from '../lib/snapshot.js'

const workspace = await mkdtemp(join(tmpdir(), 'agent-teams-snapshot-scope-'))
const stateRoot = resolveTeamStateRoot(workspace, '.agent-teams')
const roots = [{ workspace, stateRoot }]
const activityReads = []
const warnings = []
const ctx = {
  subagents: { async listChildren(id) { activityReads.push(id); return [] } },
  agents: { get() { return undefined } },
  logger: { warn(message) { warnings.push(message) } },
}

try {
  for (const archived of [false, true]) {
    for (const captain of ['root', 'nested', 'unrelated-a', 'unrelated-b']) {
      const id = `${archived ? 'archive' : 'live'}-${captain}`
      const dir = join(stateRoot, ...(archived ? ['archive'] : []), id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'team.json'), JSON.stringify({
        id, name: id, captainSessionId: captain, createdAt: 1,
        members: [], tasks: [], taskSeq: 0,
      }))
    }
  }
  const scope = new Set(['root', 'nested'])
  const live = await collectTeamsActivity(ctx, roots, scope)
  assert.deepEqual(live.map(team => team.captainSessionId).sort(), ['nested', 'root'])
  assert.deepEqual(activityReads.sort(), ['nested', 'root'], 'unrelated teams must not load live session activity')
  assert.deepEqual((await collectArchivedTeamsActivity(ctx, roots, scope)).map(team => team.captainSessionId).sort(), ['nested', 'root'])

  activityReads.length = 0
  assert.deepEqual(await collectTeamsActivity(ctx, roots, new Set(['solo'])), [])
  assert.deepEqual(activityReads, [], 'a solo conversation must not enumerate another captain\'s children')
  assert.deepEqual(await collectArchivedTeamsActivity(ctx, roots, new Set()), [])
  assert.equal((await collectTeamsActivity(ctx, roots)).length, 4, 'unscoped activity panels retain every team')
  assert.equal((await collectArchivedTeamsActivity(ctx, roots)).length, 4)

  // An unrelated unreadable mailbox must not be opened by a scoped refresh.
  for (const prefix of ['live', 'archive']) {
    await mkdir(join(stateRoot, ...(prefix === 'archive' ? ['archive'] : []), `${prefix}-unrelated-a`, 'inbox', 'captain.jsonl'), { recursive: true })
  }
  warnings.length = 0
  assert.equal((await collectTeamsActivity(ctx, roots, scope)).length, 2)
  assert.equal((await collectArchivedTeamsActivity(ctx, roots, scope)).length, 2)
  assert.deepEqual(warnings, [])
  console.log('AgentTeams scoped snapshot verification passed')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
