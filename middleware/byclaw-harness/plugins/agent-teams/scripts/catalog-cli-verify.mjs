import { registerTeamStateWorkspaceAlias, resolveTeamStateRoot } from '../lib/runtime-state.js'
/** Global expert-template catalog and model-free CLI verification. */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  listRuntimeInstances,
  listTeamTemplates,
  registerRuntimeInstance,
  unregisterRuntimeInstance,
  writeTeamTemplate,
} from '../lib/catalog.js'
import { createTeamDir, readTeam } from '../lib/state.js'
import { cancelCaptainTeam } from '../lib/lifecycle.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-catalog-'))
const catalogDir = join(root, 'global')
const workspace = join(root, 'workspace')
const unrelated = join(root, 'other-cwd')
const stateRoot = resolveTeamStateRoot(workspace, '.agent-teams')
await mkdir(unrelated, { recursive: true })

function cli(...args) {
  return spawnSync(process.execPath, [join(process.cwd(), 'lib/cli.js'), ...args, '--catalog-dir', catalogDir], {
    cwd: unrelated,
    encoding: 'utf8',
  })
}

console.log('dsh-agent-teams global catalog and CLI verification')
try {
  await writeTeamTemplate(catalogDir, {
    id: 'software-delivery',
    name: 'Software delivery experts',
    description: 'Reusable expert roster',
    members: [
      { name: 'engineer', role: 'implementation' },
      { name: 'qa', role: 'verification' },
    ],
  })
  const templates = await listTeamTemplates(catalogDir)
  if (templates.length !== 1 || templates[0]?.members.length !== 2 || 'tasks' in templates[0]) {
    throw new Error('global template did not preserve roster-only isolation')
  }

  const team = {
    id: 'runtime-team',
    name: 'Runtime team',
    captainSessionId: 'captain-session',
    createdAt: Date.now(),
    controlledWorkflow: true,
    lifecycle: 'draft',
    members: [{
      id: 'member-session',
      name: 'engineer',
      role: 'implementation',
      provider: 'fake',
      model: 'fake-model',
      status: 'idle',
      joinedAt: Date.now(),
    }],
    tasks: [],
    taskSeq: 0,
  }
  await createTeamDir(stateRoot, team)
  await registerRuntimeInstance(catalogDir, stateRoot, workspace, team)
  const instances = await listRuntimeInstances(catalogDir)
  if (instances.length !== 1 || instances[0]?.status !== 'active'
    || instances[0]?.workspace !== workspace || instances[0]?.taskCount !== 0
    || instances[0]?.members[0]?.name !== 'engineer') {
    throw new Error('runtime pointer did not resolve isolated workspace state')
  }

  const templateJson = cli('templates', 'list', '--json')
  if (templateJson.status !== 0 || JSON.parse(templateJson.stdout)[0]?.id !== 'software-delivery') {
    throw new Error(`template JSON CLI failed: ${templateJson.stderr}`)
  }
  const templateHuman = cli('templates', 'show', 'software-delivery')
  if (templateHuman.status !== 0 || !/engineer.*implementation/s.test(templateHuman.stdout)) {
    throw new Error(`template human CLI failed: ${templateHuman.stderr}`)
  }
  const instanceJson = cli('instances', 'list', '--json')
  if (instanceJson.status !== 0 || JSON.parse(instanceJson.stdout)[0]?.captainSessionId !== 'captain-session'
    || JSON.parse(instanceJson.stdout)[0]?.members[0]?.role !== 'implementation') {
    throw new Error(`instance JSON CLI failed: ${instanceJson.stderr}`)
  }
  const instanceHuman = cli('instances', 'show', 'runtime-team')
  if (instanceHuman.status !== 0 || !/engineer.*implementation.*fake\/fake-model/s.test(instanceHuman.stdout)) {
    throw new Error(`instance human CLI omitted team composition: ${instanceHuman.stderr}`)
  }

  await rm(join(stateRoot, team.id), { recursive: true, force: true })
  const stale = await listRuntimeInstances(catalogDir)
  if (stale[0]?.status !== 'stale') throw new Error('missing runtime state was not reported as stale')

  const legacyWorkspace = join(root, 'legacy-workspace')
  const legacyRoot = join(legacyWorkspace, '.agent-teams')
  const legacyTeam = { ...team, id: 'legacy-team', captainSessionId: 'legacy-captain', members: [] }
  await createTeamDir(legacyRoot, legacyTeam)
  await writeFile(join(catalogDir, 'instances', 'legacy-pointer.json'), JSON.stringify({ version: 1, id: 'legacy-pointer', teamId: legacyTeam.id, teamName: legacyTeam.name, workspace: legacyWorkspace, stateRoot: legacyRoot, captainSessionId: legacyTeam.captainSessionId, createdAt: legacyTeam.createdAt }))
  const migratedRoot = resolveTeamStateRoot(legacyWorkspace, '.agent-teams')
  const conversationWorkspace = join(root, '.sessions', 'conversation')
  const releaseAlias = registerTeamStateWorkspaceAlias(conversationWorkspace, legacyWorkspace)
  const releaseSecondAlias = registerTeamStateWorkspaceAlias(conversationWorkspace, legacyWorkspace)
  try {
    assert.equal(resolveTeamStateRoot(conversationWorkspace, '.agent-teams'), migratedRoot)
    assert.equal((await readTeam(resolveTeamStateRoot(conversationWorkspace, '.agent-teams'), legacyTeam.id)).id, legacyTeam.id)
    assert.throws(() => registerTeamStateWorkspaceAlias(conversationWorkspace, workspace), /Conflicting/)
    assert.notEqual(resolveTeamStateRoot(join(root, '.sessions', 'new-conversation'), '.agent-teams'), migratedRoot)
    releaseAlias()
    releaseAlias()
    assert.equal(resolveTeamStateRoot(conversationWorkspace, '.agent-teams'), migratedRoot, 'remaining owner retains the alias')
  } finally {
    releaseAlias()
    releaseSecondAlias()
  }
  assert.notEqual(resolveTeamStateRoot(conversationWorkspace, '.agent-teams'), migratedRoot)
  const cold = cli('instances', 'show', 'legacy-pointer', '--json')
  if (cold.status !== 0 || JSON.parse(cold.stdout).status !== 'active' || JSON.parse(cold.stdout).stateRoot !== migratedRoot) throw new Error('cold CLI must resolve pre-migration runtime pointer')
  const reRegistered = await registerRuntimeInstance(catalogDir, migratedRoot, legacyWorkspace, legacyTeam)
  if (reRegistered.id !== 'legacy-pointer' || (await listRuntimeInstances(catalogDir)).filter(pointer => pointer.teamId === legacyTeam.id).length !== 1) throw new Error('re-register must retain the existing instance id without duplicates')
  await cancelCaptainTeam({}, { id: legacyTeam.captainSessionId, session: { header: { cwd: legacyWorkspace } } }, '.agent-teams')
  if ((await readTeam(migratedRoot, legacyTeam.id)).stoppedAt === undefined) throw new Error('cancel must target the migrated team')
  await unregisterRuntimeInstance(catalogDir, migratedRoot, legacyTeam.id, legacyTeam.captainSessionId)
  if ((await listRuntimeInstances(catalogDir)).some(pointer => pointer.teamId === legacyTeam.id)) throw new Error('unregister must remove the migrated incarnation pointer')
  console.log('  PASS  legacy migration preserves cold CLI pointer, cancellation and instance identity')
  console.log('  PASS  expert roster is globally reusable without task-state sharing')
  console.log('  PASS  runtime catalog stores workspace-scoped pointers')
  console.log('  PASS  CLI queries templates and instances from another cwd')
  console.log('  PASS  missing runtime state is reported stale')
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('\nall global catalog and CLI checks passed')
