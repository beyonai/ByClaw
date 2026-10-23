import { sessionLog, liveStreamFrames } from './session-runtime-fixtures.mjs'
/** Native ByClaw FE projection checks without Redis or a running DSH instance. */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventType } from '@byclaw/by-framework'
import {
  childRunId,
  childOutputProjection,
  detailProjection,
  editDiffProjection,
  reasoningProjection,
  sessionStatusProjection,
  taskPlanProjection,
  teamTaskPlanTodos,
  teamSnapshotProjection,
  toolCallProjection,
} from '../lib/byclaw-presentation.js'
import {
  ByClawFileChangeAccumulator,
  normalizeWorkspaceEditDiffFiles,
  persistFileChangesSummary,
} from '../lib/file-changes.js'
import {
  ByClawDshSessionRuntime,
  resolveChildEventTurn,
  TimedChunkBatcher,
} from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'

const childContext = {
  sessionId: 'child-session',
  parentSessionId: 'root-session',
  rootSessionId: 'root-session',
  externalParentSessionId: 'byclaw-session',
  scope: 'child',
  depth: 1,
  sequence: '17:think',
  eventKind: 'think',
  status: 'running',
  childName: '架构专家',
  childTask: '分析系统结构',
  childTurn: 1,
  parentMessageId: 'dsh:child-session',
}

assert.equal(childRunId('child-session', 1), 'child-session:1')
const firstTerminal = {
  type: 'turn/end',
  seq: 10,
  data: { turn: 1, reason: { kind: 'completed' } },
}
const firstTurnEvents = [
  { type: 'turn/start', seq: 1, data: { turn: 1 } },
  { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [] } },
  { type: 'assistant/message', seq: 3, data: { turn: 1, step: 1 } },
  firstTerminal,
]
let currentChildTurn
const firstTurnHistory = []
const firstTurnResolutions = firstTurnEvents.map((event) => {
  firstTurnHistory.push(event)
  const resolved = resolveChildEventTurn(event, currentChildTurn, firstTurnHistory)
  currentChildTurn = resolved.currentTurn
  return resolved
})
assert.deepEqual(firstTurnResolutions, [
  { eventTurn: 1, currentTurn: 1 },
  { eventTurn: 1, currentTurn: 1 },
  { eventTurn: 1, currentTurn: 1 },
  { eventTurn: 1, currentTurn: 1 },
], 'every event in one DSH turn must use the same child run identity')
const secondTurnStart = {
  type: 'turn/start',
  seq: 11,
  data: { turn: 2 },
}
const secondUserMessage = {
  type: 'user/message',
  seq: 12,
  data: { source: { kind: 'user' }, content: [] },
}
assert.deepEqual(resolveChildEventTurn(secondTurnStart, 1, [...firstTurnEvents, secondTurnStart]), {
  eventTurn: 2,
  currentTurn: 2,
})
assert.deepEqual(resolveChildEventTurn(secondUserMessage, 2, [...firstTurnEvents, secondTurnStart, secondUserMessage]), {
  eventTurn: 2,
  currentTurn: 2,
})
assert.deepEqual(resolveChildEventTurn(firstTerminal, 2, [...firstTurnEvents, secondTurnStart, secondUserMessage]), {
  eventTurn: 1,
  currentTurn: 2,
}, 'a late terminal keeps its old run id without moving the current child run backwards')
const explicitTurnHistory = new Proxy([], {
  get(target, property, receiver) {
    if (property === 'reduce') throw new Error('explicit child turns must not rescan session history')
    return Reflect.get(target, property, receiver)
  },
})
assert.deepEqual(resolveChildEventTurn(firstTerminal, 2, explicitTurnHistory), {
  eventTurn: 1,
  currentTurn: 2,
}, 'explicit child events resolve in constant time')

const reasoning = reasoningProjection('正在分析系统结构', childContext)
assert.equal(reasoning.content, '正在分析系统结构')
assert.equal(reasoning.options.eventType, 'reasoningLogDelta')
assert.equal(reasoning.options.contentType, '1001')
assert.equal(reasoning.options.messageId, 'dsh:child-session:event:17:think')
assert.equal(reasoning.options.parentMessageId, 'dsh:child-session')
assert.deepEqual(reasoning.options.metadata, {
  event_source: 'dsh',
  event_kind: 'think',
  session_scope: 'child',
  external_session_id: 'child-session',
  external_parent_session_id: 'root-session',
  external_root_session_id: 'root-session',
  host_session_id: 'byclaw-session',
  delegation_depth: 1,
  event_sequence: '17:think',
  session_status: 'running',
  child_name: '架构专家',
  child_task: '分析系统结构',
  child_run_id: 'child-session:1',
  child_turn: 1,
})

const childOutput = childOutputProjection('我是架构专家。', {
  ...childContext,
  sequence: '18:output',
  eventKind: 'session.output',
  streamBlockId: 'answer:1:2',
})
assert.equal(childOutput.options.eventType, 'answerDelta')
assert.equal(childOutput.options.contentType, '1002')
assert.equal(childOutput.options.parentMessageId, 'dsh:child-session')
assert.equal(childOutput.options.metadata.session_scope, 'child')
const continuedChildOutput = childOutputProjection('继续介绍。', {
  ...childContext,
  sequence: '19:output',
  eventKind: 'session.output',
  streamBlockId: 'answer:1:2',
})
const nextChildOutput = childOutputProjection('下一阶段。', {
  ...childContext,
  sequence: '20:output',
  eventKind: 'session.output',
  streamBlockId: 'answer:1:3',
})
assert.equal(continuedChildOutput.options.messageId, childOutput.options.messageId,
  'chunks from one assistant block must merge into one Markdown message')
assert.notEqual(nextChildOutput.options.messageId, childOutput.options.messageId,
  'different assistant blocks must keep their chronological boundary')

const childPlan = taskPlanProjection([
  { content: '分析需求', status: 'completed' },
  { content: '实现功能', status: 'in_progress' },
], {
  ...childContext,
  sequence: '21:plan',
  eventKind: 'plan',
})
assert.equal(childPlan.options.contentType, '2008')
assert.equal(childPlan.options.messageId, 'dsh:child-session:plan')
assert.equal(childPlan.options.parentMessageId, 'dsh:child-session')
assert.equal(childPlan.options.metadata.session_scope, 'child')
assert.equal(JSON.parse(childPlan.content).steps[0].sub_steps[1].tool_metadata.status, 'in_progress')

assert.deepEqual(teamTaskPlanTodos([
  { id: 't1', subject: '等待依赖', status: 'pending', state: 'blocked' },
  { id: 't2', subject: '正在实现', status: 'in_progress', state: 'running' },
  { id: 't3', subject: '已经完成', status: 'completed', state: 'completed' },
]), [
  { taskId: 't1', content: '等待依赖', status: 'pending' },
  { taskId: 't2', content: '正在实现', status: 'in_progress' },
  { taskId: 't3', content: '已经完成', status: 'completed' },
], 'Agent Teams visual states must map to ByClaw task-plan statuses')

const contextDetail = detailProjection({
  title: '上下文注入 · skill-catalog',
}, {
  ...childContext,
  sequence: '18:context',
  eventKind: 'context',
})
assert.equal(contextDetail.options.eventType, 'reasoningLogDelta')
assert.equal(contextDetail.options.contentType, '3015')
assert.equal(contextDetail.options.objectType, 'tool_call')
assert.equal(contextDetail.options.status, '_DONE_')
assert.deepEqual(JSON.parse(contextDetail.content), {
  title: '上下文注入 · skill-catalog',
  status: '_DONE_',
  source: 'runtime',
  eventKind: 'context',
})

const toolStart = toolCallProjection({
  phase: 'start',
  toolCallId: 'call-1',
  toolName: 'read_file',
  input: '{"path":"README.md"}',
  description: '读取项目说明',
}, {
  ...childContext,
  sequence: 19,
  eventKind: 'tool.call',
})
assert.equal(toolStart.options.eventType, 'reasoningLogDelta')
assert.equal(toolStart.options.contentType, '3015')
assert.equal(toolStart.options.objectType, 'tool_call')
assert.equal(toolStart.options.messageId, 'call-1')
assert.equal(toolStart.options.parentMessageId, 'dsh:child-session')
assert.equal(toolStart.options.status, '_START_')
assert.deepEqual(JSON.parse(toolStart.content), {
  title: 'read_file',
  input: '{"path":"README.md"}',
  status: '_START_',
  description: '读取项目说明',
})

const toolDone = toolCallProjection({
  phase: 'success',
  toolCallId: 'call-1',
  toolName: 'read_file',
  output: 'file body',
}, {
  ...childContext,
  sequence: 20,
  eventKind: 'tool.result',
})
assert.equal(toolDone.options.messageId, toolStart.options.messageId)
assert.equal(toolDone.options.status, '_DONE_')
assert.deepEqual(JSON.parse(toolDone.content), {
  title: 'read_file',
  output: 'file body',
  status: '_DONE_',
})

const toolError = toolCallProjection({
  phase: 'error',
  toolCallId: 'call-2',
  toolName: 'bash',
  output: 'permission denied',
}, {
  ...childContext,
  sequence: 21,
  eventKind: 'tool.result',
})
assert.equal(toolError.options.status, '_ERROR_')
assert.equal(JSON.parse(toolError.content).status, '_ERROR_')

const editDiff = editDiffProjection({
  type: 'edit_diff', schemaVersion: 1, eventId: 'root-message:edit:call-1', phase: 'applied',
  operation: 'edit', sessionId: 'root-session',
  files: [{ path: 'src/a.ts', changeType: 'modified', oldText: 'a\n', newText: 'b\n', additions: 1, deletions: 1, binary: false }],
}, { ...childContext, sequence: 21, eventKind: 'tool.result' })
assert.equal(editDiff.options.contentType, '3017')
assert.equal(editDiff.options.messageId, 'root-message:edit:call-1')
assert.equal(editDiff.options.eventType, 'reasoningLogDelta')
assert.equal(editDiff.options.status, '_DONE_')
assert.equal(editDiff.options.objectType, 'tool_call')
assert.equal(JSON.parse(editDiff.content).type, 'edit_diff')

const workspace = join(tmpdir(), 'byclaw-workspace')
const scopedFiles = normalizeWorkspaceEditDiffFiles(workspace, [
  { path: join(workspace, 'e2e', 'demo.md'), changeType: 'modified', oldText: 'a\n', newText: 'b\n', additions: 1, deletions: 1, binary: false },
  { path: 'e2e/demo.md', changeType: 'modified', oldText: 'b\n', newText: 'c\n', additions: 1, deletions: 1, binary: false },
  { path: join(tmpdir(), 'acp-runs', 'internal.json'), changeType: 'added', oldText: null, newText: '{}', additions: 1, deletions: 0, binary: false },
])
assert.deepEqual(scopedFiles.map(file => file.path), ['e2e/demo.md', 'e2e/demo.md'])

const changes = new ByClawFileChangeAccumulator()
changes.add(JSON.parse(editDiff.content).files, 'edit')
changes.add([{ path: 'src/a.ts', changeType: 'modified', oldText: 'b\n', newText: 'c\n', additions: 1, deletions: 1, binary: false }], 'edit')
assert.deepEqual(changes.files(), [{
  path: 'src/a.ts', changeType: 'modified', oldText: 'a\n', newText: 'c\n', additions: 1, deletions: 1,
  binary: false, sources: ['edit'],
}])
const netZero = new ByClawFileChangeAccumulator()
netZero.add([{ path: 'src/a.ts', changeType: 'modified', oldText: 'a\n', newText: 'b\n', additions: 1, deletions: 1, binary: false }], 'edit')
netZero.add([{ path: 'src/a.ts', changeType: 'modified', oldText: 'b\n', newText: 'a\n', additions: 1, deletions: 1, binary: false }], 'edit')
assert.deepEqual(netZero.files(), [])
const fileRoot = await mkdtemp(join(tmpdir(), 'byclaw-file-changes-'))
try {
  const summary = await persistFileChangesSummary(join(fileRoot, '.sessions', 'host-session'), 'host-session', changes.files())
  assert.equal(summary.files.length, 1)
  const stored = JSON.parse(await readFile(join(fileRoot, '.file_changes', 'host-session', 'files', `${summary.files[0].uuid}.json`), 'utf8'))
  assert.equal(stored.originalContent, 'a\n')
  assert.equal(stored.modifiedContent, 'c\n')
} finally {
  await rm(fileRoot, { recursive: true, force: true })
}

const childStarted = sessionStatusProjection({
  title: '架构专家 · 正在处理任务',
  status: 'running',
}, {
  ...childContext,
  sequence: '22:status',
  eventKind: 'session.status',
})
assert.equal(childStarted.content, '架构专家 · 正在处理任务')
assert.equal(childStarted.options.contentType, '3009')
assert.equal(childStarted.options.objectType, 'tool_call')
assert.equal(childStarted.options.messageId, 'dsh:child-session')
assert.equal(childStarted.options.status, '_START_')

const childDone = sessionStatusProjection({ title: '架构专家 · 处理完成', status: 'completed' }, {
  ...childContext,
  sequence: 23,
  eventKind: 'session.status',
})
const childFailed = sessionStatusProjection({ title: '架构专家 · 处理失败', status: 'failed' }, {
  ...childContext,
  sequence: 24,
  eventKind: 'session.error',
})
assert.equal(childDone.options.messageId, childStarted.options.messageId)
assert.equal(childDone.options.status, '_DONE_')
assert.equal(childFailed.options.messageId, childStarted.options.messageId)
assert.equal(childFailed.options.status, '_ERROR_')

const teamRunning = teamSnapshotProjection({
  teamId: 'team-1',
  name: 'ByClaw研发专家团',
  captainSessionId: 'root-session',
  members: [{ id: 'member-1', name: '架构舵手 · 梁远图' }],
  tasks: [{ id: 'task-1', status: 'running' }],
}, {
  archived: false,
  capturedAt: '2026-08-28T08:00:00.000Z',
}, {
  ...childContext,
  sessionId: 'root-session',
  parentSessionId: undefined,
  rootSessionId: 'root-session',
  externalParentSessionId: 'byclaw-session',
  scope: 'team',
  depth: 0,
  sequence: 'team-1:running',
  eventKind: 'agent-teams/snapshot',
  parentMessageId: 'root-message',
  messageIdPrefix: 'root-message',
})
const teamPayload = JSON.parse(teamRunning.content)
assert.equal(teamRunning.options.contentType, '3015')
assert.equal(teamRunning.options.objectType, 'tool_call')
assert.equal(teamRunning.options.eventType, EventType.ANSWER_DELTA)
assert.equal(teamRunning.options.messageId, 'root-message:team:team-1')
assert.equal(teamRunning.options.parentMessageId, 'root-message')
assert.equal(teamRunning.options.status, '_START_')
assert.equal(teamPayload.title, 'Agent Team · ByClaw研发专家团')
assert.equal(teamPayload.status, '_START_')
assert.equal(teamPayload.eventKind, 'agent-teams/snapshot')
assert.equal(teamPayload.schemaVersion, 2)
assert.equal(teamPayload.team.teamId, 'team-1')
assert.equal(teamRunning.options.metadata.session_scope, 'team')

const teamDone = teamSnapshotProjection(teamPayload.team, {
  archived: true,
  capturedAt: '2026-08-28T08:01:00.000Z',
}, {
  ...childContext,
  sessionId: 'root-session',
  parentSessionId: undefined,
  rootSessionId: 'root-session',
  externalParentSessionId: 'byclaw-session',
  scope: 'team',
  depth: 0,
  sequence: 'team-1:archived',
  eventKind: 'agent-teams/snapshot',
  parentMessageId: 'root-message',
  messageIdPrefix: 'root-message',
})
assert.equal(teamDone.options.messageId, teamRunning.options.messageId)
assert.equal(teamDone.options.status, '_DONE_')
assert.equal(JSON.parse(teamDone.content).status, '_DONE_')

const emittedChunks = []
const runtimeSessions = new Map()
const runtime = new ByClawDshSessionRuntime({
  root: {
    on() { return () => undefined },
    sessions: { get(id) { return runtimeSessions.get(String(id)) } },
  },
}, {
  agentTemplateDir: '/missing',
  sourceAgentType: 'BYCLAW_DSH_0027024710',
  emitter: {
    async emitChunk(...args) { emittedChunks.push(args) },
    async emitEvent() { throw new Error('session runtime still emitted the legacy custom event envelope') },
  },
})
const streamFrames = new WeakMap()
async function forwardLive(turn, session, turnNumber, stepNumber, chunk) {
  if (!streamFrames.has(turn)) streamFrames.set(turn, liveStreamFrames())
  for (const frame of streamFrames.get(turn)(session, turnNumber, stepNumber, chunk)) {
    await runtime.forwardAssistantStream(turn, session, frame)
  }
}
const runtimeTurn = {
  context: { sessionId: 'byclaw-session', traceId: 'trace-1' },
  rootSessionId: 'root-session',
  rootMessageId: 'root-message',
  rootLabel: '主 Agent',
  childTurns: new Map([['child-session', 1]]),
}
const runtimeChild = {
  id: 'child-session',
  header: { parentSession: 'root-session', delegationDepth: 1 },
  ...sessionLog([]),
}
runtimeSessions.set('child-session', runtimeChild)
await runtime.emitSessionEvent(
  runtimeTurn,
  runtimeChild,
  '30:status',
  'session.status',
  'running',
  '子 Agent 正在处理任务',
)
await runtime.emitSessionEvent(
  runtimeTurn,
  runtimeChild,
  '31:think',
  'think',
  'running',
  'Think',
  { text: '分析依赖关系' },
)
assert.equal(emittedChunks.length, 2)
const [, , statusContent, statusOptions] = emittedChunks[0]
const [, , thinkContent, thinkOptions] = emittedChunks[1]
assert.equal(statusContent.content, '子 Agent · 子 Agent 正在处理任务')
assert.equal(statusContent.metadata.session_scope, 'child')
assert.equal(statusOptions.contentType, '3009')
assert.equal(statusOptions.messageId, 'dsh:child-session')
assert.equal(statusOptions.parentMessageId, 'root-message')
assert.equal(statusOptions.metadata.session_scope, 'child')
assert.equal(statusOptions.metadata.external_root_session_id, 'root-session')
assert.equal(statusOptions.metadata.host_session_id, 'byclaw-session')
assert.equal(statusOptions.metadata.session_status, 'running')
assert.equal(statusOptions.metadata.child_name, '子 Agent')
assert.equal(thinkContent.content, '分析依赖关系')
assert.equal(thinkContent.metadata.session_scope, 'child')
assert.equal(thinkOptions.eventType, 'reasoningLogDelta')
assert.equal(thinkOptions.contentType, '1001')
assert.equal(thinkOptions.objectType, undefined)
assert.equal(thinkOptions.status, undefined)
assert.equal(thinkOptions.parentMessageId, 'dsh:child-session')

const timedTurn = {
  ...runtimeTurn,
  answer: '',
  forwarding: Promise.resolve(),
  responseSessionId: 'root-session',
  bufferedReasoning: new Map(),
  reasoningChunks: new TimedChunkBatcher(),
  answerChunks: new TimedChunkBatcher(),
  reasoningChunkSequences: new Map(),
  chunkSequences: new Map(),
}
await forwardLive(timedTurn, runtimeChild, 1, 1, { type: 'text-delta', index: 0, text: '短子输出' })
assert.equal(emittedChunks.length, 2, 'short child output must wait for the bounded timer')
await new Promise(resolve => setTimeout(resolve, 100))
await timedTurn.forwarding
assert.equal(emittedChunks.length, 3)
assert.equal(emittedChunks[2][2].content, '短子输出')
assert.equal(emittedChunks[2][2].metadata.event_kind, 'session.output')
assert.equal(emittedChunks[2][2].metadata.child_turn, 1)
assert.equal(emittedChunks[2][2].metadata.child_run_id, 'child-session:1')

let releaseCongestedForwarding
const emittedBeforeCongestion = emittedChunks.length
const congestedTurn = {
  ...timedTurn,
  forwarding: new Promise(resolve => { releaseCongestedForwarding = resolve }),
  answerChunks: new TimedChunkBatcher(),
  chunkSequences: new Map(),
  chunkFlushTimer: undefined,
}
await forwardLive(congestedTurn, runtimeChild, 3, 1, { type: 'text-delta', index: 0, text: '队列拥塞前' })
await new Promise(resolve => setTimeout(resolve, 100))
const firstQueuedFlush = congestedTurn.forwarding
await forwardLive(congestedTurn, runtimeChild, 3, 1, { type: 'text-delta', index: 0, text: '队列拥塞后' })
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(
  congestedTurn.forwarding,
  firstQueuedFlush,
  'an overdue chunk buffer must not enqueue another flush while the first flush is waiting',
)
releaseCongestedForwarding()
await congestedTurn.forwarding
emittedChunks.length = emittedBeforeCongestion

await forwardLive(timedTurn, runtimeChild, 2, 1, { type: 'text-delta', index: 0, text: '边界前输出' })
await runtime.flushStepBuffers(timedTurn, runtimeChild, 2, 1)
assert.equal(emittedChunks.length, 4)
assert.equal(emittedChunks[3][2].content, '边界前输出')
assert.equal(emittedChunks[3][2].metadata.child_turn, 2)
await new Promise(resolve => setTimeout(resolve, 100))
await timedTurn.forwarding
assert.equal(emittedChunks.length, 4, 'boundary flush must cancel the pending duplicate callback')

const orderedTurn = {
  ...runtimeTurn,
  answer: '',
  forwarding: Promise.resolve(),
  responseSessionId: 'root-session',
  bufferedReasoning: new Map(),
  reasoningChunks: new TimedChunkBatcher(),
  answerChunks: new TimedChunkBatcher(),
  reasoningChunkSequences: new Map(),
  chunkSequences: new Map(),
}
const orderedStart = emittedChunks.length
await forwardLive(orderedTurn, runtimeChild, 4, 1, { type: 'reasoning-delta', index: 0, text: '先思考' })
await forwardLive(orderedTurn, runtimeChild, 4, 1, { type: 'text-delta', index: 0, text: '后回答' })
assert.equal(emittedChunks.length, orderedStart + 1,
  'the first answer chunk must flush earlier reasoning before the answer can be projected')
assert.equal(emittedChunks[orderedStart][2].content, '先思考')
assert.equal(emittedChunks[orderedStart][2].metadata.event_kind, 'think')
await runtime.flushStepBuffers(orderedTurn, runtimeChild, 4, 1)
assert.equal(emittedChunks[orderedStart + 1][2].content, '后回答')

const streamingThoughtTurn = {
  ...orderedTurn,
  reasoningChunks: new TimedChunkBatcher(),
  answerChunks: new TimedChunkBatcher(),
  reasoningChunkSequences: new Map(),
  chunkSequences: new Map(),
  chunkFlushTimer: undefined,
  chunkFlushQueued: false,
}
const streamingThoughtStart = emittedChunks.length
await forwardLive(streamingThoughtTurn, runtimeChild, 5, 1, { type: 'reasoning-delta', index: 0, text: '正在流式分析' })
await new Promise(resolve => setTimeout(resolve, 100))
await streamingThoughtTurn.forwarding
assert.equal(emittedChunks.length, streamingThoughtStart + 1,
  'reasoning must become visible before the assistant block ends')
const firstThoughtOptions = emittedChunks[streamingThoughtStart][3]
await forwardLive(streamingThoughtTurn, runtimeChild, 5, 1, { type: 'reasoning-delta', index: 0, text: '，继续更新' })
await new Promise(resolve => setTimeout(resolve, 100))
await streamingThoughtTurn.forwarding
assert.equal(emittedChunks[streamingThoughtStart + 1][3].messageId, firstThoughtOptions.messageId,
  'streamed reasoning chunks from one block must update the same thinking row')

const rootSession = {
  id: 'root-session',
  header: { delegationDepth: 0 },
  ...sessionLog([]),
}
runtimeSessions.set('root-session', rootSession)
const boundaryTracker = new ByClawSessionActivityTracker('root-session')
boundaryTracker.observeTurnActive(true)
const boundaryTurn = {
  ...orderedTurn,
  forwarding: Promise.resolve(),
  runtime: boundaryTracker,
  teamGate: { waiting: false, observe() {} },
  announcedChildren: new Set(),
  toolNames: new Map(),
  toolMutations: new Map(),
  teamSnapshots: undefined,
}
const boundaryStart = emittedChunks.length
await runtime.forwardEvent(boundaryTurn, rootSession, {
  type: 'turn/end',
  seq: 42,
  data: { turn: 4, reason: { kind: 'completed' } },
})
await boundaryTurn.forwarding
assert.equal(emittedChunks.length, boundaryStart + 1,
  'a root turn/end must publish captain idle even while the outer team request remains open')
assert.equal(emittedChunks[boundaryStart][2].metadata.event_kind, 'session.runtime')
assert.equal(emittedChunks[boundaryStart][2].metadata.root_active, false)

const teamPlanStart = emittedChunks.length
const liveTeam = {
  teamId: 'team-1',
  captainSessionId: 'root-session',
  members: [{ id: 'child-session', name: '架构专家' }],
  tasks: [{ id: 'task-1', subject: '完成架构设计', status: 'in_progress', state: 'running', assignee: '架构专家' }],
}
await runtime.emitTeamTaskPlans(boundaryTurn, liveTeam, 'team-1:running', false)
assert.equal(emittedChunks.length, teamPlanStart + 2, 'one team snapshot must project parent and child task plans')
const [, , parentPlanContent, parentPlanOptions] = emittedChunks[teamPlanStart]
const [, , childPlanContent, childPlanOptions] = emittedChunks[teamPlanStart + 1]
assert.equal(parentPlanOptions.contentType, '2008')
assert.equal(parentPlanOptions.messageId, 'root-message:team:team-1:plan')
assert.equal(parentPlanContent.metadata.session_scope, 'parent')
assert.equal(childPlanOptions.contentType, '2008')
assert.equal(childPlanOptions.messageId, 'dsh:child-session:team:team-1:plan')
assert.equal(childPlanOptions.parentMessageId, 'dsh:child-session')
assert.equal(childPlanContent.metadata.session_scope, 'child')
assert.equal(JSON.parse(childPlanContent.content).steps[0].sub_steps[0].tool_metadata.status, 'in_progress')

await runtime.emitTeamTaskPlans(boundaryTurn, {
  ...liveTeam,
  tasks: [{ ...liveTeam.tasks[0], status: 'completed', state: 'completed' }],
}, 'team-1:completed', true)
assert.equal(emittedChunks[teamPlanStart + 2][3].messageId, parentPlanOptions.messageId,
  'parent plan updates must replace the same card')
assert.equal(emittedChunks[teamPlanStart + 3][3].messageId, childPlanOptions.messageId,
  'child plan updates must replace the same card')
assert.equal(JSON.parse(emittedChunks[teamPlanStart + 3][2].content).steps[0].sub_steps[0].tool_metadata.status,
  'completed')
await runtime.close()

console.log('ByClaw native presentation projection checks passed')
