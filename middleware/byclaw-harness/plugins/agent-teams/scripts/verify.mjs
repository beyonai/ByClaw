#!/usr/bin/env node
import { resolveTeamStateRoot } from '../lib/runtime-state.js'
/**
 * Offline smoke verification for dsh-agent-teams.
 *
 * Runs the pure team-logic rules, the on-disk persistence flow, and the
 * browser workbench fold (events -> workbench projection) against throwaway
 * temp state. Requires a prior `pnpm build` (lib/ present). Does not touch
 * any running DSH instance or profile.
 *
 * Usage: node scripts/verify.mjs
 */

import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import {
  CAPTAIN_KEY,
  appendMailbox,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  readMailbox,
  readTeam,
  recordSettlementDispatch,
  settlementDispatchKey,
  removeTeamDir,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
} from '../lib/state.js'
import {
  activityPanelExpandedForSession,
  compactDagLayout,
  COMPACT_DAG_NODE_HEIGHT,
  COMPACT_DAG_NODE_WIDTH,
  dependencyFocusTaskId,
  relatedTaskIds,
  taskStages,
  usesParallelTaskGrid,
} from '../lib/client/activity-model.js'
import { parseAgentTeamsCreateArgs } from '../lib/client/agent-teams-card-definition.js'
import {
  CaptainWakeCoalescer,
  partitionSettlementMessages,
  isReusableTeamRuntime,
  steerCaptainReport,
} from '../lib/tools.js'
import {
  deliverToMember,
  installMemberSelectionRuntime,
  resolveMemberLlmSelection,
  spawnMember,
} from '../lib/members.js'
import {
  listRuntimeInstances,
  registerRuntimeInstance,
  unregisterRuntimeInstance,
} from '../lib/catalog.js'
const claudeBridge = await import('../lib/claude-bridge.js')
const agentTeamsPlugin = await import('../lib/index.js')
const agentTeamsTools = await import('../lib/tools.js')
let agentTeamsClient = {}
try {
  agentTeamsClient = await import('../lib/client/registration.js')
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND')) throw error
}

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('dsh-agent-teams offline verification')

const settlementTeam = {
  id: 'settlement-team',
  name: 'Settlement Team',
  captainSessionId: 'captain-session',
  createdAt: 1,
  members: [{ id: 'member-session', name: 'member', joinedAt: 1, status: 'idle' }],
  tasks: [],
  taskSeq: 0,
}
const settlementTask = {
  id: 't1', subject: 'done', status: 'completed', assignee: 'member', dependencies: [],
  attempt: 2, attemptId: 'attempt-2', createdAt: 1, updatedAt: 2,
}
const settlementKey = settlementDispatchKey(settlementTeam.members[0], settlementTask)
check('settlement key is attempt-scoped', settlementKey === 'member-session:t1:attempt-2:completed')
recordSettlementDispatch(settlementTeam, settlementKey, 100)
recordSettlementDispatch(settlementTeam, settlementKey, 101)
check('settlement dispatch ledger is durable and idempotent',
  settlementTeam.settlementDispatches.length === 1 && settlementTeam.settlementDispatches[0].dispatchedAt === 100)
const settlementMessages = partitionSettlementMessages(settlementTeam, [
  { id: 'duplicate', from: 'member', to: 'captain', content: 'done', ts: 1, settlementKey },
  { id: 'ordinary', from: 'member', to: 'captain', content: 'new detail', ts: 2 },
])
check('already-dispatched settlement is filtered without hiding ordinary mailbox work',
  settlementMessages.duplicates.map(message => message.id).join(',') === 'duplicate'
    && settlementMessages.deliverable.map(message => message.id).join(',') === 'ordinary')

const usagePolicy = agentTeamsPlugin.agentTeamsUsageSectionText?.('agent_teams_submit_task, agent_teams_get_submitted_task') ?? ''
check(
  'submitted-task policy is event-driven rather than polling',
  usagePolicy.includes('ends the current turn')
    && usagePolicy.includes('wakes this requester')
    && !usagePolicy.includes('Poll only that submitted task'),
)

const dispatchFailure = Object.assign(
  new Error('NOT_RESUMABLE: auth_token=super-secret member cannot be cold-resumed'),
  { code: 'NOT_RESUMABLE' },
)
const rejectedDelivery = await deliverToMember({
  subagents: { async [deliverSubagentPrompt]() { throw dispatchFailure } },
  logger: { warn() {} },
}, { id: 'captain' }, 'child-1', 'work', new AbortController().signal)
check(
  'member delivery returns a structured, sanitized dispatch failure',
  rejectedDelivery.ok === false
    && rejectedDelivery.failure.phase === 'dispatch'
    && rejectedDelivery.failure.code === 'NOT_RESUMABLE'
    && rejectedDelivery.failure.message.includes('member cannot be cold-resumed')
    && !rejectedDelivery.failure.message.includes('super-secret'),
  JSON.stringify(rejectedDelivery),
)

// The bundle patch's `name` is the specifier Node resolves when a profile
// loads this plugin, so it must equal the workspace package name. A mismatch
// only surfaces after the profile resolves the bundle row, never in local
// link-installed development.
console.log('1/7 packaging contract')
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patchText = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const patchName = patchText
  .split('\n')
  .filter(line => !/^\s*#/.test(line))
  .find(line => /^\s*name:\s*\S/.test(line))
  ?.match(/^\s*name:\s*(.+?)\s*$/)?.[1]
  ?.replace(/^(['"])(.*)\1$/, '$2')
check(
  'cordis.patch.yml name matches the workspace package name',
  patchName === pkg.name,
  `patch has ${JSON.stringify(patchName)}, package.json has ${JSON.stringify(pkg.name)}`,
)
check(
  'files[] ships the bundle patch and lib',
  ['lib', 'cordis.patch.yml'].every(entry => pkg.files?.includes(entry)),
  `files = ${JSON.stringify(pkg.files)}`,
)
check(
  'workspace package is private and has no publishConfig',
  pkg.private === true && pkg.publishConfig === undefined,
  `private = ${JSON.stringify(pkg.private)}, publishConfig = ${JSON.stringify(pkg.publishConfig)}`,
)
const requiredPeers = Object.keys(pkg.peerDependencies ?? {})
  .filter(name => pkg.peerDependenciesMeta?.[name]?.optional !== true)
check(
  'shared runtime peers are optional for standalone profile installs',
  requiredPeers.length === 0,
  `required peers trigger pnpm warnings: ${JSON.stringify(requiredPeers)}`,
)
// The browser half registers itself with __ModuleLoader__ under an id the host
// resolves by package name. A stale id here fails only in the browser — the
// host half loads fine, so every server-side check still passes.
const clientBundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const registeredId = clientBundle.match(/__ModuleLoader__\.load\(\{\s*id:\s*"([^"]*)"/)?.[1]
check(
  'client bundle registers under the package name',
  registeredId === pkg.name,
  `bundle registers ${JSON.stringify(registeredId)}, package.json has ${JSON.stringify(pkg.name)}`,
)
const activityPanelCss = await readFile(new URL('../src/client/ActivityPanel.module.css', import.meta.url), 'utf8')
const activityPanelSource = await readFile(new URL('../src/client/ActivityPanel.tsx', import.meta.url), 'utf8')
const pluginSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
const requiredHarnessTokenBridges = [
  '--dsw-alias-line-normal: var(--dsw-static-neutral-bluish-150',
  '--dsw-alias-bg-module: var(--dsw-alias-bg-layer-1',
  '--dsw-alias-state-success: var(--dsw-alias-state-success-primary',
  '--dsw-alias-state-warning: var(--dsw-alias-state-warn-primary',
  '--dsw-alias-state-danger: var(--dsw-alias-state-error-primary',
]
check(
  'activity panel bridges the reference palette to current Harness tokens',
  requiredHarnessTokenBridges.every(token => activityPanelCss.includes(token)),
  'missing token bridges make panel fills and DAG borders transparent',
)
const requiredPanelSizing = [
  '--agent-teams-panel-min-height: 560px',
  'min-height: min(',
  'max-height: calc(100dvh - var(--agent-teams-panel-top) - var(--agent-teams-panel-bottom-gap))',
]
check(
  'activity panel grows between a stable minimum and balanced viewport maximum',
  requiredPanelSizing.every(rule => activityPanelCss.includes(rule))
    && !activityPanelCss.includes('height: min(560px'),
  'a fixed panel height leaves excessive space below tall viewports',
)
check(
  'running DAG tasks reuse the animated work glyph without losing focus context',
  activityPanelSource.includes("task.state === 'running'")
    && activityPanelSource.includes('className={css.dagRunningState}')
    && activityPanelSource.includes('<WorkGlyph active />')
    && activityPanelCss.includes(".dagNode[data-state='running'][data-dimmed='true']")
    && activityPanelCss.includes('.dagRunningState {'),
  'running work should stay visible in both normal and dependency-focus states',
)
check(
  'activity tasks page five at a time',
  activityPanelSource.includes('const TASK_PAGE_SIZE = 5')
    && activityPanelSource.includes('tasks.slice(pageStart, pageStart + TASK_PAGE_SIZE)'),
  'the unified panel must not grow one unbounded task surface',
)
check(
  'captain keeps one runtime team across conversation rounds',
  pluginSource.includes('Keep the runtime team for later requests in the same conversation')
    && pluginSource.includes('delete it only when the user explicitly asks to end or abandon the team'),
  'the default captain policy must preserve the unified team activity history',
)

console.log('2/7 pure rules')
check("sanitizeKey('My Team!') -> 'my-team'", sanitizeKey('My Team!') === 'my-team')
check(
  'same captain and template reuse one team runtime',
  isReusableTeamRuntime({ captainSessionId: 'root-1', templateId: 'expert-team' }, 'root-1', 'expert-team'),
)
check(
  'different template does not reuse the existing runtime',
  !isReusableTeamRuntime({ captainSessionId: 'root-1', templateId: 'expert-team' }, 'root-1', 'other-team'),
)
// #15: an ASCII-only whitelist folded every non-Latin name onto one constant,
// so distinct members shared a mailbox file and the second one was rejected as
// a duplicate. Keys must stay distinct for distinct names, in any script.
check("CJK names survive folding", sanitizeKey('研究员') === '研究员')
check(
  'distinct non-Latin names stay distinct',
  sanitizeKey('研究员') !== sanitizeKey('工程师')
    && sanitizeKey('データ分析') !== sanitizeKey('Данные'),
)
check(
  'names with no letters or digits get distinct keys, not a shared constant',
  sanitizeKey('!!!') !== sanitizeKey('🐳') && sanitizeKey('🐳') !== '',
)
check('folding is deterministic', sanitizeKey('🐳') === sanitizeKey('🐳'))
check(
  'long names stay inside the filesystem name limit',
  Buffer.byteLength(`${sanitizeKey('研'.repeat(300))}.jsonl`) < 255,
)
check(
  'long names sharing a prefix stay distinct',
  sanitizeKey(`${'研'.repeat(60)}a`) !== sanitizeKey(`${'研'.repeat(60)}b`),
)
check(
  'keys stay a single safe path segment',
  !/[\\/:*?"<>|]/.test(sanitizeKey('a/b\\c:d*e?f"g<h>i|j')) && !sanitizeKey('../../etc').includes('.'),
)
check('pending -> claimed allowed', transitionError('pending', 'claimed') === undefined)
check('pending -> in_progress denied', transitionError('pending', 'in_progress') !== undefined)
check('in_progress -> completed allowed', transitionError('in_progress', 'completed') === undefined)
check('completed -> in_progress denied', transitionError('completed', 'in_progress') !== undefined)
check('same status is a no-op', transitionError('failed', 'failed') === undefined)

const claudeStateRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-claude-state-'))
try {
  const inbox = join(claudeStateRoot, 'team', 'inbox')
  const statePath = claudeBridge.claudeMemberStatePath?.(claudeStateRoot, 'team', 'x/../../../../package')
  const pathFromInbox = statePath === undefined ? undefined : relative(inbox, statePath)
  claudeBridge.writeClaudeMemberState?.(claudeStateRoot, 'team', 'x/../../../../package', { turn: 1 })
  const persisted = statePath === undefined ? undefined : JSON.parse(await readFile(statePath, 'utf8'))
  check(
    'Claude member state stays inside the inbox for a traversal-shaped member name',
    statePath !== undefined
      && pathFromInbox !== undefined
      && pathFromInbox !== ''
      && !pathFromInbox.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      && pathFromInbox !== '..'
      && !isAbsolute(pathFromInbox)
      && persisted?.turn === 1,
    `state path = ${JSON.stringify(statePath)}`,
  )
} finally {
  await rm(claudeStateRoot, { recursive: true, force: true })
}

const claudeEnv = claudeBridge.claudeProcessEnvironment?.({
  PATH: '/test/bin',
  HOME: '/test/home',
  LANG: 'C.UTF-8',
  ANTHROPIC_API_KEY: 'test-authentication-input',
  UNRELATED_SECRET_MARKER: 'must-not-reach-claude',
})
check(
  'Claude subprocess environment keeps required runtime and authentication inputs only',
  claudeEnv?.PATH === '/test/bin'
    && claudeEnv.HOME === '/test/home'
    && claudeEnv.LANG === 'C.UTF-8'
    && claudeEnv.ANTHROPIC_API_KEY === 'test-authentication-input'
    && claudeEnv.UNRELATED_SECRET_MARKER === undefined,
  `environment = ${JSON.stringify(claudeEnv)}`,
)

function disposableRegistry() {
  const tools = new Map()
  const promptSections = new Map()
  const conversations = new Map()
  const disposers = []
  const context = {
    effect(setup) {
      const dispose = setup()
      disposers.push(dispose)
      return dispose
    },
    tools: {
      register(tool) {
        if (tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`)
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
    systemPrompt: {
      section(section) {
        if (promptSections.has(section.name)) throw new Error(`duplicate prompt section ${section.name}`)
        promptSections.set(section.name, section)
        return () => promptSections.delete(section.name)
      },
    },
    uiConversation: {
      events: {
        register(definition) {
          if (conversations.has(definition.kind)) throw new Error(`duplicate conversation ${definition.kind}`)
          conversations.set(definition.kind, definition)
          return () => conversations.delete(definition.kind)
        },
      },
    },
  }
  return {
    context,
    mounted: () => tools.size === 1 && promptSections.size === 1 && conversations.size === 1,
    dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
  }
}

const registrations = disposableRegistry()
agentTeamsTools.registerAgentTeamsTool?.(registrations.context, { name: 'agent_teams_disposal_probe' })
agentTeamsPlugin.registerAgentTeamsUsageSection?.(registrations.context, 'agent_teams_disposal_probe', 117)
agentTeamsClient.registerAgentTeamsConversationDefinition?.(registrations.context)
check('AgentTeams registrations mount through lifecycle effects', registrations.mounted())
registrations.dispose()
check('AgentTeams registrations dispose completely', !registrations.mounted())
agentTeamsTools.registerAgentTeamsTool?.(registrations.context, { name: 'agent_teams_disposal_probe' })
agentTeamsPlugin.registerAgentTeamsUsageSection?.(registrations.context, 'agent_teams_disposal_probe', 117)
agentTeamsClient.registerAgentTeamsConversationDefinition?.(registrations.context)
check('AgentTeams registrations remount without duplicates after disposal', registrations.mounted())
registrations.dispose()

console.log('3/7 dependency gating')
const tasks = [
  { id: 't1', status: 'completed' },
  { id: 't2', status: 'pending' },
  { id: 't3', status: 'failed' },
]
check('all-done deps satisfied', unsatisfiedDependencies(tasks, ['t1']).length === 0)
check('pending dep blocks', unsatisfiedDependencies(tasks, ['t2']).length === 1)
check('failed dep blocks too', unsatisfiedDependencies(tasks, ['t3']).length === 1)

console.log('4/7 on-disk team flow (temp dir)')
const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-verify-'))
try {
  const team = {
    name: 'Verify Team',
    id: sanitizeKey('Verify Team'),
    description: 'smoke',
    captainSessionId: 'sess-captain',
    createdAt: Date.now(),
    members: [
      { id: 'sess-member', name: 'alice', joinedAt: Date.now(), status: 'idle' },
      { id: 'sess-removed', name: 'former', joinedAt: Date.now(), status: 'removed' },
    ],
    tasks: [],
    taskSeq: 0,
  }
  await createTeamDir(stateRoot, team)

  const reread = await readTeam(stateRoot, team.id)
  check('team.json round-trips', reread?.id === team.id && reread.captainSessionId === 'sess-captain')

  const catalogDir = join(stateRoot, 'catalog')
  const runtimePointer = await registerRuntimeInstance(catalogDir, stateRoot, '/tmp/workspace', team)
  check(
    'runtime instance registration creates one pointer',
    (await listRuntimeInstances(catalogDir)).some(instance => instance.id === runtimePointer.id),
  )
  await writeFile(
    join(stateRoot, team.id, 'team.json'),
    `${JSON.stringify({ ...team, captainSessionId: 'replacement-captain' }, null, 2)}\n`,
    'utf8',
  )
  check(
    'a reused team id does not make an old captain pointer active',
    (await listRuntimeInstances(catalogDir)).find(instance => instance.id === runtimePointer.id)?.status === 'stale',
  )
  await writeFile(join(stateRoot, team.id, 'team.json'), `${JSON.stringify(team, null, 2)}\n`, 'utf8')
  await unregisterRuntimeInstance(catalogDir, stateRoot, team.id, team.captainSessionId)
  check(
    'runtime instance unregistration removes the exact captain pointer',
    !(await listRuntimeInstances(catalogDir)).some(instance => instance.id === runtimePointer.id),
  )

  await writeFile(join(stateRoot, team.id, 'team.json'), `\uFEFF${JSON.stringify(team, null, 2)}`, 'utf8')
  check('team.json accepts a UTF-8 BOM', (await readTeam(stateRoot, team.id))?.id === team.id)

  const found = await findTeamByCaptain(stateRoot, 'sess-captain')
  check('findTeamByCaptain finds the team', found?.id === team.id)
  check('findTeamByCaptain ignores other captains', await findTeamByCaptain(stateRoot, 'sess-other') === undefined)
  check('findTeamByParticipant finds the captain', (await findTeamByParticipant(stateRoot, 'sess-captain'))?.id === team.id)
  check('findTeamByParticipant finds an active member', (await findTeamByParticipant(stateRoot, 'sess-member'))?.id === team.id)
  check('findTeamByParticipant rejects a removed member', await findTeamByParticipant(stateRoot, 'sess-removed') === undefined)

  const escapedContent = String.raw`save to notes\foo.md`
  const message = createMessage('alice', CAPTAIN_KEY, escapedContent)
  await withTeamLock(team.id, async () => {
    await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message)
  })
  const second = createMessage('bob', CAPTAIN_KEY, 'valid after BOM')
  const mailboxFile = join(stateRoot, team.id, 'inbox', `${CAPTAIN_KEY}.jsonl`)
  await writeFile(
    mailboxFile,
    `\uFEFF${JSON.stringify(second)}\n${String.raw`{"broken":"notes\q.md"}`}\n{}\n`,
    { encoding: 'utf8', flag: 'a' },
  )
  const malformedLines = []
  const inbox = await readMailbox(
    stateRoot,
    team.id,
    CAPTAIN_KEY,
    (lineNumber) => malformedLines.push(lineNumber),
  )
  check('mailbox append/read preserves backslashes', inbox[0]?.content === escapedContent)
  check('mailbox accepts BOM-prefixed JSONL records', inbox[1]?.content === second.content)
  check('mailbox skips malformed JSON and malformed shapes', inbox.length === 2 && malformedLines.join(',') === '3,4')
  check('missing mailbox reads empty', (await readMailbox(stateRoot, team.id, 'nobody')).length === 0)

  const duplicateCaptain = { ...team, id: 'duplicate-captain', members: [] }
  await createTeamDir(stateRoot, duplicateCaptain)
  let duplicateCaptainRejected = false
  try {
    await findTeamByCaptain(stateRoot, 'sess-captain')
  } catch {
    duplicateCaptainRejected = true
  }
  check('multiple teams for one captain fail as ambiguous', duplicateCaptainRejected)
  await removeTeamDir(stateRoot, duplicateCaptain.id)

  const duplicateMember = { ...team, id: 'duplicate-member', captainSessionId: 'sess-other-captain' }
  await createTeamDir(stateRoot, duplicateMember)
  let duplicateMemberRejected = false
  try {
    await findTeamByParticipant(stateRoot, 'sess-member')
  } catch {
    duplicateMemberRejected = true
  }
  check('multiple teams for one member fail as ambiguous', duplicateMemberRejected)
  await removeTeamDir(stateRoot, duplicateMember.id)

  const invalidId = 'invalid-shape'
  await mkdir(join(stateRoot, invalidId), { recursive: true })
  await writeFile(join(stateRoot, invalidId, 'team.json'), '{}', 'utf8')
  let invalidShapeRejected = false
  try {
    await readTeam(stateRoot, invalidId)
  } catch {
    invalidShapeRejected = true
  }
  check('invalid team.json shape is rejected at the durable boundary', invalidShapeRejected)
  await removeTeamDir(stateRoot, invalidId)

  await removeTeamDir(stateRoot, team.id)
  check('removeTeamDir removes the team', await readTeam(stateRoot, team.id) === undefined)

  // Archive keeps the team data for post-delete review.
  const archiveTeam = { ...team, id: sanitizeKey('Archive Team') }
  await createTeamDir(stateRoot, archiveTeam)
  const { archiveTeamDir, readArchivedTeam, listArchivedTeamIds } = await import('../lib/state.js')
  await archiveTeamDir(stateRoot, archiveTeam.id)
  check('archive moves the team out of live scan', await readTeam(stateRoot, archiveTeam.id) === undefined)
  check('archive keeps team.json readable', (await readArchivedTeam(stateRoot, archiveTeam.id))?.id === archiveTeam.id)
  check('archive lists the team id', (await listArchivedTeamIds(stateRoot)).includes(archiveTeam.id))
  check('archive dir skips live readTeam', await readTeam(stateRoot, 'archive') === undefined)
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

console.log('5/7 host visual-state functions (activity panel)')
const { taskVisualState, taskDepthsById } = await import('../lib/state.js')
const vtasks = [
  { id: 't1', subject: 'a', status: 'completed', assignee: 'alice', dependencies: [], createdAt: 0, updatedAt: 0 },
  { id: 't2', subject: 'b', status: 'pending', assignee: 'bob', dependencies: ['t1'], createdAt: 0, updatedAt: 0 },
  { id: 't3', subject: 'c', status: 'in_progress', assignee: 'bob', dependencies: ['t2'], createdAt: 0, updatedAt: 0 },
  { id: 't4', subject: 'd', status: 'pending', assignee: 'alice', dependencies: ['t9'], createdAt: 0, updatedAt: 0 },
]
check('completed -> completed visual state', taskVisualState('completed', [], vtasks) === 'completed')
check('in_progress -> running visual state', taskVisualState('in_progress', [], vtasks) === 'running')
check('pending with completed dep -> open', taskVisualState('pending', ['t1'], vtasks) === 'open')
check('pending with open dep -> blocked', taskVisualState('pending', ['t2'], vtasks) === 'blocked')
check('missing dependency is ignored (not blocked)', taskVisualState('pending', ['t9'], vtasks) === 'open')
const depths = taskDepthsById(vtasks)
check('t1 depth 0', depths.get('t1') === 0)
check('t2 depth 1 (longest path)', depths.get('t2') === 1)
check('t3 depth 2', depths.get('t3') === 2)
check('missing dep contributes no depth', depths.get('t4') === 0)

console.log('6/7 client relationship projections')
const projectionTasks = [
  { id: 't4', dependencies: ['t2'], depth: 2 },
  { id: 't1', dependencies: [], depth: 0 },
  { id: 't3', dependencies: ['t1'], depth: 1 },
  { id: 't2', dependencies: ['t1'], depth: 1 },
  { id: 't5', dependencies: [], depth: Number.NaN },
]
const stages = taskStages(projectionTasks)
check('task stages sort by depth', stages.map(stage => stage.depth).join(',') === '0,1,2')
check('task stages sort ids naturally', stages[1]?.tasks.map(task => task.id).join(',') === 't2,t3')
check('non-finite depth falls back to stage 0', stages[0]?.tasks.some(task => task.id === 't5') === true)
const chain = relatedTaskIds('t2', projectionTasks)
check('relationship chain includes upstream dependency', chain.has('t1'))
check('relationship chain includes focused task', chain.has('t2'))
check('relationship chain includes downstream dependent', chain.has('t4'))
check('relationship chain excludes sibling branch', !chain.has('t3'))
check(
  'pinned dependency chain wins over keyboard and hover previews',
  dependencyFocusTaskId('pinned', 'keyboard', 'hover') === 'pinned',
)
check(
  'keyboard dependency chain wins over delayed hover preview',
  dependencyFocusTaskId(null, 'keyboard', 'hover') === 'keyboard',
)
check(
  'hover dependency chain is used without a pinned or keyboard task',
  dependencyFocusTaskId(null, null, 'hover') === 'hover',
)
const cyclic = [
  { id: 'a', dependencies: ['b'], depth: 0 },
  { id: 'b', dependencies: ['a'], depth: 1 },
]
check('relationship traversal is cycle-safe', relatedTaskIds('a', cyclic).size === 2)
check('edge-free tasks switch to the fill-width parallel grid', usesParallelTaskGrid([
  { id: 't1', dependencies: [], depth: 0 },
  { id: 't2', dependencies: [], depth: 0 },
  { id: 't3', dependencies: ['missing'], depth: 0 },
]))
check('a real dependency keeps the layered DAG layout', !usesParallelTaskGrid([
  { id: 't1', dependencies: [], depth: 0 },
  { id: 't2', dependencies: ['t1'], depth: 1 },
]))
const dag = compactDagLayout(projectionTasks.filter(task => Number.isFinite(task.depth)))
check('compact DAG lays dependency depths out left-to-right',
  dag.nodes.find(node => node.task.id === 't1')?.x === 0
    && dag.nodes.find(node => node.task.id === 't2')?.x === 118
    && dag.nodes.find(node => node.task.id === 't4')?.x === 236)
check('compact DAG keeps stable rows and reference node geometry',
  dag.nodes.find(node => node.task.id === 't3')?.y === 38
    && dag.width === 328
    && dag.height === 68
    && COMPACT_DAG_NODE_WIDTH === 92
    && COMPACT_DAG_NODE_HEIGHT === 30)
check('compact DAG emits one curved SVG edge per valid dependency',
  dag.edges.length === 3
    && dag.edges.some(edge => edge.from === 't1' && edge.to === 't2' && edge.path.startsWith('M92 15C')))
check(
  'expanded activity panel belongs only to its current session',
  activityPanelExpandedForSession(true, 'session-a', 'session-a')
    && !activityPanelExpandedForSession(true, 'session-a', 'session-b')
    && !activityPanelExpandedForSession(true, 'session-a', undefined),
)
check(
  'agent team cards derive a stable id from the standard create tool call',
  JSON.stringify(parseAgentTeamsCreateArgs('{"name":" Repo Review 2W! "}'))
    === JSON.stringify({ teamId: 'repo-review-2w', name: 'Repo Review 2W!' }),
)
check('malformed create tool arguments do not create a card', parseAgentTeamsCreateArgs('{bad') === undefined)

const captainDeliveries = []
const captainSteered = steerCaptainReport(
  { steer: message => captainDeliveries.push(message) },
  'alice',
  'finished t1',
)
check(
  'member report delivery calls the live captain steer API',
  captainSteered
    && captainDeliveries.length === 1
    && captainDeliveries[0]?.content[0]?.type === 'text'
    && captainDeliveries[0]?.content[0]?.text === 'AgentTeams message from member alice:\n\nfinished t1',
)
check(
  'failed live captain delivery falls back to the durable mailbox',
  steerCaptainReport({ steer: () => { throw new Error('offline') } }, 'alice', 'finished t1') === false,
)
const captainWakes = new CaptainWakeCoalescer()
check('first member event claims one captain wake', captainWakes.claim('captain-session'))
check('concurrent member events are coalesced behind that wake', !captainWakes.claim('captain-session'))
captainWakes.release('captain-session')
check('a later event can wake the captain after its previous turn settles', captainWakes.claim('captain-session'))

console.log('7/7 member model selection and continuation restore')
const captain = {
  id: 'captain-session',
  options: { provider: 'birth-provider', model: 'birth-model' },
  session: {
    requestHeader: () => ({
      config: {
        provider: 'captain-provider',
        model: 'captain-model',
        reasoningEffort: 'max',
      },
    }),
  },
}
const resolvedCalls = []
const selectionContext = {
  llm: {
    resolveCallConfig: async (config) => {
      resolvedCalls.push(config)
      return config
    },
  },
}
const inheritedSelection = await resolveMemberLlmSelection(selectionContext, captain, {})
check(
  'ordinary member snapshots the captain current route and effort',
  inheritedSelection.provider === 'captain-provider'
    && inheritedSelection.model === 'captain-model'
    && inheritedSelection.reasoningEffort === 'max',
)
const overriddenSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  provider: 'other-provider',
  model: 'other-model',
})
check(
  'explicit cross-provider route does not carry the captain model effort',
  overriddenSelection.provider === 'other-provider'
    && overriddenSelection.model === 'other-model'
    && overriddenSelection.reasoningEffort === undefined
    && resolvedCalls.at(-1)?.reasoningEffort === undefined,
)
const defaultedSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  defaultModel: 'configured-member-model',
})
check(
  'plugin memberModel changes the route without carrying the captain model effort',
  defaultedSelection.provider === 'captain-provider'
    && defaultedSelection.model === 'configured-member-model'
    && defaultedSelection.reasoningEffort === undefined,
)
let providerWithoutModelRejected = false
try {
  await resolveMemberLlmSelection(selectionContext, captain, { provider: 'other-provider' })
} catch {
  providerWithoutModelRejected = true
}
check('explicit provider without model is rejected', providerWithoutModelRejected)

let startSpec
let pendingSelection
const initialConversationSelection = { provider: 'conversation-provider', model: 'conversation-model' }
const spawnMemberRecord = {
  id: '',
  name: 'backend',
  role: 'engineer',
  provider: overriddenSelection.provider,
  model: overriddenSelection.model,
  reasoningEffort: overriddenSelection.reasoningEffort,
  joinedAt: Date.now(),
  status: 'idle',
}
const spawnTeam = {
  name: 'Spawn Verify',
  id: 'spawn-verify',
  captainSessionId: captain.id,
  createdAt: Date.now(),
  members: [],
  tasks: [],
  taskSeq: 0,
}
await spawnMember(
  {
    subagents: {
      getProvider: () => ({
        prepareContinuable: () => undefined,
        capabilities: { persona: true, toolFilter: true },
      }),
      list: () => ['spawn'],
      startContinuable: async (spec) => {
        startSpec = spec
        return { childId: 'spawned-member', messageId: 'welcome-message' }
      },
    },
  },
  { provider: 'spawn', maxDepth: 1 },
  {
    withPending: async (_parentId, _label, selection, _member, operation) => {
      pendingSelection = selection
      return operation()
    },
    withNextRequest: async (_parentId, _label, _childId, _selection, _member, operation) => operation(),
  },
  overriddenSelection,
  initialConversationSelection,
  captain,
  spawnTeam,
  spawnMemberRecord,
  '.agent-teams',
  new AbortController().signal,
)
check(
  '#20: spawn receives the resolved per-member provider, model and reasoning effort',
  startSpec?.request?.agentOptions?.provider === 'other-provider'
    && startSpec?.request?.agentOptions?.model === 'other-model'
    && startSpec?.request?.agentOptions?.reasoningEffort === undefined
    && pendingSelection?.provider === 'conversation-provider'
    && pendingSelection?.model === 'conversation-model'
    && pendingSelection?.reasoningEffort === undefined
    && spawnMemberRecord.id === 'spawned-member',
)
check(
  'generic adjacent-agent messaging stays available for child delegation',
  startSpec?.request?.toolFilter?.deny?.includes('send_message') !== true,
)

function descriptorEvent(label, agentProvider = 'descriptor-provider', agentModel = 'descriptor-model') {
  return {
    type: 'subagent/descriptor',
    data: {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label,
      agentProvider,
      agentModel,
    },
  }
}

function fakeChildContext({ label, parentSessionId, cwd, agentProvider, agentModel }) {
  const listeners = new Map()
  const skills = new Map()
  const tools = new Map()
  const promptVariables = new Map()
  return {
    listeners,
    skills,
    tools,
    promptVariables,
    context: {
      effect(setup) { const dispose = setup(); this.disposers.push(dispose); return dispose },
      disposers: [],
      agent: {
        session: {
          header: { parentSession: parentSessionId, cwd },
          ownEvents() { return [descriptorEvent(label, agentProvider, agentModel)] },
        },
      },
      on(name, listener) {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
      get(name) {
        if (name !== 'skills') return undefined
        return {
          register(skill) {
            if (skills.has(skill.name)) throw new Error(`duplicate scoped skill ${skill.name}`)
            skills.set(skill.name, skill)
            return () => skills.delete(skill.name)
          },
        }
      },
      tools: {
        register(tool) {
          if (tools.has(tool.name)) throw new Error(`duplicate scoped tool ${tool.name}`)
          tools.set(tool.name, tool)
          return () => tools.delete(tool.name)
        },
      },
      systemPrompt: {
        section() { return () => undefined },
        variable(name, provider) {
          promptVariables.set(name, provider)
          return () => promptVariables.delete(name)
        },
      },
    },
  }
}

async function routedConfig(child) {
  const assemble = child.listeners.get('system-prompt/assemble')
  const request = child.listeners.get('agent/request')
  await assemble({}, {}, async () => ({ variables: {} }))
  return request({}, async () => ({
    provider: 'unselected-provider',
    model: 'unselected-model',
    reasoningEffort: 'low',
  }))
}

const childSelectionContext = {
  effect(setup) { return setup() },
  agents: {
    async create({ childCtx, setup }) { const commit = await setup(childCtx); commit?.commit() },
    async resume({ childCtx, setup }) { const commit = await setup(childCtx); commit?.commit() },
  },
}
const selectionRuntime = installMemberSelectionRuntime(childSelectionContext, '.agent-teams')
async function setupMemberSelection(childCtx, resume = false) {
  await childSelectionContext.agents[resume ? 'resume' : 'create']({ childCtx })
  return () => { for (const dispose of childCtx.disposers.reverse()) dispose() }
}
const freshChild = fakeChildContext({
  label: 'agent-teams:fresh-team:backend',
  parentSessionId: 'captain-session',
  cwd: process.cwd(),
})
const standardSkillTool = {
  name: 'skill',
  async execute(args) {
    const skill = freshChild.skills.get(args.name)
    if (skill === undefined) throw new Error(`unknown scoped skill ${args.name}`)
    return skill
  },
}
freshChild.tools.set('skill', standardSkillTool)
const agentSkillRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-agent-skill-'))
const architectSkillDir = join(agentSkillRoot, 'architecture-rules')
await mkdir(architectSkillDir, { recursive: true })
await writeFile(join(architectSkillDir, 'SKILL.md'), '---\nname: architecture-rules\ndescription: Agent-only architecture rules\n---\nKeep module boundaries explicit.\n')
let disposeFresh
await selectionRuntime.withPending(
  'captain-session',
  'agent-teams:fresh-team:backend',
  overriddenSelection,
  {
    id: '',
    name: 'backend',
    status: 'idle',
    joinedAt: Date.now(),
    source: {
      kind: 'byclaw-digital-employee',
      employeeId: 'employee-architect',
      employeeCode: 'EMP_ARCH',
      workerAgentType: 'BYCLAW_CODE',
      skills: [{ code: 'architecture-rules', path: architectSkillDir }],
    },
  },
  async () => {
    disposeFresh = await setupMemberSelection(freshChild.context)
  },
)
check(
  'ByClaw Skill is registered only in the selected member scope',
  freshChild.skills.has('architecture-rules'),
)
check(
  'ByClaw frontend file-preview placeholder survives strict DSH prompt assembly',
  freshChild.promptVariables.get('file_preview_prefix')?.() === '{{file_preview_prefix}}',
)
check(
  'ByClaw member keeps the standard scoped Skill loader visible',
  freshChild.tools.get('skill') === standardSkillTool,
)
const loadedAgentSkill = await standardSkillTool.execute(
  { name: 'architecture-rules' },
  { signal: new AbortController().signal },
)
check(
  'standard Skill loader returns the synchronized member Skill body',
  loadedAgentSkill.content.includes('Keep module boundaries explicit.'),
)
const freshRoute = await routedConfig(freshChild)
check(
  'fresh child request keeps the cross-route baseline effort clear',
  freshRoute.provider === 'other-provider'
    && freshRoute.model === 'other-model'
    && freshRoute.reasoningEffort === undefined,
)
disposeFresh()
check('member-scope disposal removes its ByClaw Skill', !freshChild.skills.has('architecture-rules'))
check('member-scope disposal retains the standard Skill loader', freshChild.tools.get('skill') === standardSkillTool)
await rm(agentSkillRoot, { recursive: true, force: true })

const restoreWorkspace = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-selection-'))
try {
  const restoreStateRoot = resolveTeamStateRoot(restoreWorkspace, '.agent-teams')
  await createTeamDir(restoreStateRoot, {
    name: 'Restore Team',
    id: 'restore-team',
    captainSessionId: 'captain-session',
    createdAt: Date.now(),
    members: [{
      id: 'cold-member',
      name: 'reviewer',
      provider: 'cold-provider',
      model: 'cold-model',
      reasoningEffort: 'high',
      joinedAt: Date.now(),
      status: 'idle',
    }],
    tasks: [],
    taskSeq: 0,
  })
  const coldChild = fakeChildContext({
    label: 'agent-teams:restore-team:reviewer',
    parentSessionId: 'captain-session',
    cwd: restoreWorkspace,
    agentProvider: 'cold-provider',
    agentModel: 'cold-model',
  })
  const disposeCold = await setupMemberSelection(coldChild.context, true)
  const coldRoute = await routedConfig(coldChild)
  check(
    'cold-resumed child restores provider, model, and reasoning from team.json',
    coldRoute.provider === 'cold-provider'
      && coldRoute.model === 'cold-model'
      && coldRoute.reasoningEffort === 'high',
  )
  disposeCold()
} finally {
  await rm(restoreWorkspace, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')
