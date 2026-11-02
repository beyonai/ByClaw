import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ByClawAsyncTeamGate, ByClawDshSessionRuntime } from '../lib/session-runtime.js'
import { ByClawDshCommandHandler } from '../lib/worker.js'
import { AskAgentCommand, MessageHeader } from '@byclaw/by-framework'
const workspace = await mkdtemp(join(tmpdir(), 'byclaw-cancel-'))
try {
  for (const ids of [[], ['member-a', 'member-b', 'member-c', 'member-d']]) {
    const calls = []
    let resident = [...ids]
    const agent = { id: 'root', session: { id: 'root', header: { cwd: workspace } }, cancel() { calls.push('root') }, whenIdle() { return Promise.resolve() } }
    const ctx = { root: { on() { return () => {} } }, logger: { debug() {}, warn() {} },
      subagents: { async listChildren(id) { assert.equal(id, 'root'); return resident.map(id => ({ id })) },
        async drainChildren(owner, children) { assert.equal(owner, agent); calls.push(...children); resident = [] } } }
    const runtime = new ByClawDshSessionRuntime(ctx, { stateDir: '.agent-teams' })
    const turn = { teamGate: new ByClawAsyncTeamGate() }
    runtime.active.set('root', turn)
    runtime.messageAgents.set('message', agent)
    await runtime.cancel('message', 'user stop')
    assert.ok(calls.includes('root'))
    assert.deepEqual(calls.filter(id => id !== 'root'), ids, 'team mode drains each member; solo drains none')
    assert.throws(() => turn.teamGate.assertHealthy(), /user stop/)
    const count = calls.length
    await runtime.cancel('message', 'duplicate stop')
    assert.equal(calls.length, count, 'cancel is idempotent')
    await runtime.close()
  }
  const command = new AskAgentCommand(new MessageHeader('m', 's', 't'), 'hello')
  const handler = new ByClawDshCommandHandler({ async ask() { return { answer: '', dshSessionId: 's' } } })
  await assert.rejects(handler.process(command, { isCancelRequested: () => true }), { name: 'TaskCancelledError' })
  const runtime = new ByClawDshSessionRuntime({ root: { on() { return () => {} } }, logger: { debug() {}, warn() {} } }, { stateDir: '.agent-teams' })
  let attempts = 0
  runtime.handles.set('still-running', { handle: { async dispose() {
    if (++attempts === 1) throw new Error('execution has not stopped')
  } } })
  await assert.rejects(runtime.close({ requireStopped: true }), /execution teardown failed/)
  assert.equal(runtime.handles.size, 1, 'failed stop remains available for retry')
  await runtime.close({ requireStopped: true })
  assert.equal(attempts, 2)
  assert.equal(runtime.handles.size, 0)
  // A request already admitted by the worker may still be resolving its model.
  // Forced close must fence and join setup before confirming execution teardown.
  let modelEntered, releaseModel
  const enteredModel = new Promise(resolve => { modelEntered = resolve })
  const modelReady = new Promise(resolve => { releaseModel = resolve })
  let created = 0, directories = 0, closed = false
  const pendingRuntime = new ByClawDshSessionRuntime({
    root: { on() { return () => {} } }, logger: { debug() {}, warn() {} },
    agents: { get() {}, async create() { created++; throw new Error('late root creation') } },
  }, {
    stateDir: '.agent-teams', byRoot: workspace, workspace,
    sessionMetadata: { get() {}, resolveRootSessionId: id => id },
    async resolveModel() { modelEntered(); await modelReady; return { provider: 'test', model: 'test' } },
    async ensureDirectory() { directories++ },
  })
  const pendingCommand = new AskAgentCommand(new MessageHeader('pending', 'pending-session', 't'), 'hello')
  const pendingAsk = pendingRuntime.ask(pendingCommand, { isCancelRequested: () => false })
  const pendingResult = pendingAsk.then(() => undefined, error => error)
  await enteredModel
  const pendingClose = pendingRuntime.close({ requireStopped: true }).then(() => { closed = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(closed, false, 'forced close must wait for admitted model/setup work to be fenced')
  } finally { releaseModel() }
  assert.match(String(await pendingResult), /runtime closed/)
  await pendingClose
  assert.equal(created, 0, 'no root may be created after close begins')
  assert.equal(directories, 0, 'late model resolution must stop before workspace setup')
  await assert.rejects(pendingRuntime.ask(pendingCommand, { isCancelRequested: () => false }), /runtime closed/)
  let createEntered, releaseCreate
  const enteredCreate = new Promise(resolve => { createEntered = resolve })
  const createReady = new Promise(resolve => { releaseCreate = resolve })
  let disposedLateRoot = 0, creatingClosed = false
  const creatingRuntime = new ByClawDshSessionRuntime({
    root: { on() { return () => {} } }, logger: { debug() {}, warn() {} },
    agents: { get() {}, async create({ sessionId }) {
      createEntered(); await createReady
      return { agent: { id: sessionId, session: { header: { cwd: workspace } } },
        async dispose() { disposedLateRoot++ } }
    } },
    sessionPersistence: { async open() { throw Object.assign(new Error('missing'), { name: 'SessionPersistenceNotFoundError' }) } },
  }, {
    stateDir: '.agent-teams', byRoot: workspace, workspace,
    sessionMetadata: { get() {}, resolveRootSessionId: id => id },
    async resolveModel() { return { provider: 'test', model: 'test' } },
    async ensureDirectory() {},
  })
  // Metadata IO is independent of admission and covered by its own integration suite.
  creatingRuntime.ensureRootMetadata = async () => {}
  const creatingResult = creatingRuntime.ask(pendingCommand, { isCancelRequested: () => false })
    .then(() => undefined, error => error)
  await enteredCreate
  const creatingClose = creatingRuntime.close({ requireStopped: true }).then(() => { creatingClosed = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(creatingClosed, false, 'close must join a root factory already in flight')
  } finally { releaseCreate() }
  assert.match(String(await creatingResult), /runtime closed/)
  await creatingClose
  assert.equal(disposedLateRoot, 1, 'a late-created handle must be disposed before close acknowledges')
  assert.equal(creatingRuntime.handles.size, 0)

  let failingCreateEntered, releaseFailingCreate, cleanupAttempts = 0
  const failingCreateStarted = new Promise(resolve => { failingCreateEntered = resolve })
  const failingCreateReady = new Promise(resolve => { releaseFailingCreate = resolve })
  const failingSetupRuntime = new ByClawDshSessionRuntime({ ...creatingRuntime.ctx,
    agents: { get() {}, async create({ sessionId }) {
      failingCreateEntered(); await failingCreateReady
      return { agent: { id: sessionId, session: { header: { cwd: workspace } } },
        async dispose() { if (++cleanupAttempts <= 2) throw new Error('root is still executing') } }
    } },
  }, creatingRuntime.options)
  failingSetupRuntime.ensureRootMetadata = async () => { throw new Error('metadata unavailable') }
  const failedSetup = failingSetupRuntime.ask(pendingCommand, { isCancelRequested: () => false })
    .then(() => undefined, error => error)
  await failingCreateStarted
  const failedStop = failingSetupRuntime.close({ requireStopped: true })
  const stopFailure = assert.rejects(failedStop, /execution teardown failed/)
  releaseFailingCreate()
  assert.match(String(await failedSetup), /metadata validation and handle cleanup failed/)
  await stopFailure
  assert.equal(failingSetupRuntime.handles.size, 1, 'failed cleanup during admission must retain its handle')
  await failingSetupRuntime.close({ requireStopped: true })
  assert.equal(cleanupAttempts, 3)
  assert.equal(failingSetupRuntime.handles.size, 0)

  let borrowedRunning = true, borrowedChildren = ['borrowed-child']
  const borrowedAgent = { id: 'borrowed-root', session: { id: 'borrowed-root', header: { cwd: workspace } },
    cancel() { borrowedRunning = false }, async whenIdle() { assert.equal(borrowedRunning, false) } }
  const borrowedRuntime = new ByClawDshSessionRuntime({
    root: { on() { return () => {} } }, logger: { debug() {}, warn() {} },
    subagents: { async listChildren() { return borrowedChildren.map(id => ({ id })) },
      async drainChildren(agent, children) { assert.equal(agent, borrowedAgent); assert.deepEqual(children, borrowedChildren); borrowedChildren = [] } },
  }, { stateDir: '.agent-teams' })
  borrowedRuntime.handles.set('borrowed-root', { mode: 'reuse', handle: { agent: borrowedAgent, async dispose() {} } })
  await borrowedRuntime.close({ requireStopped: true })
  assert.equal(borrowedRunning, false, 'reuse handles must cancel their borrowed live root despite their no-op disposer')
  assert.deepEqual(borrowedChildren, [], 'reuse handles must drain their own children')
  for (const lateLookup of [false, true]) {
    let lookupEntered, releaseLookup
    const lookupStarted = new Promise(resolve => { lookupEntered = resolve })
    const lookupReady = new Promise(resolve => { releaseLookup = resolve })
    let parkedSettled = false, streamFinished = false
    const parkedRuntime = new ByClawDshSessionRuntime({
      root: { on() { return () => {} } }, logger: { info() {}, debug() {}, warn() {} },
    }, { stateDir: '.agent-teams', interactionStore: { async findPending() {
      lookupEntered(); if (lateLookup) await lookupReady
      return { interactionId: 'pending-interaction' }
    } } })
    const parkedResult = parkedRuntime.ask(pendingCommand, {
      isCancelRequested: () => false, setStreamFinished(value) { streamFinished = value },
    }).then(value => { parkedSettled = true; return value }, error => { parkedSettled = true; return error })
    await lookupStarted
    if (!lateLookup) await new Promise(resolve => setImmediate(resolve))
    await parkedRuntime.close({ requireStopped: true })
    releaseLookup()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(parkedSettled, true, 'forced close must settle parked recovery requests and prevent late parking')
    assert.equal(parkedRuntime.coldRecoveryParking.has('pending-session', pendingCommand.header.userCode, 'pending'), false)
    if (lateLookup) assert.match(String(await parkedResult), /runtime closed/)
    else {
      assert.equal(streamFinished, true, 'a parked replay must not emit a second terminal frame during teardown')
      assert.equal((await parkedResult).answer, '')
    }
  }

  const previousBusyEnter = process.env.BYCLAW_DSH_BUSY_ENTER
  process.env.BYCLAW_DSH_BUSY_ENTER = 'steer'
  try {
    let steered = false, foregroundSettled = false
    const foregroundAgent = { id: 'pending-session', ctx: {}, status: 'running',
      session: { id: 'pending-session', header: { cwd: join(workspace, '.sessions', 'pending-session') } },
      steer() { steered = true }, async whenIdle() {} }
    const foregroundRuntime = new ByClawDshSessionRuntime({
      get() {}, root: { on() { return () => {} } }, agents: { get() { return foregroundAgent } },
    }, { stateDir: '.agent-teams', byRoot: workspace,
      workspaceRegistry: { registerPendingSessionTurn() {}, clearPendingSessionTurn() {}, clearSessionTurn() {} } })
    foregroundRuntime.flushTurnBuffers = async () => {}
    const foregroundOwner = { rootSessionId: 'pending-session', responseSessionId: 'pending-session',
      teamGate: new ByClawAsyncTeamGate(), forwarding: Promise.resolve() }
    foregroundOwner.teamGate.observe({ type: 'turn/start', data: { turn: 1 } })
    foregroundOwner.teamGate.observe({ type: 'tool/call', data: { name: 'agent_teams_start', callId: 'start' } })
    foregroundRuntime.active.set('pending-session', foregroundOwner)
    const foregroundResult = foregroundRuntime.performForegroundAsk(foregroundOwner, pendingCommand,
      { isCancelRequested: () => false }, 'pending steering input')
      .then(value => { foregroundSettled = true; return value }, error => { foregroundSettled = true; return error })
    await new Promise(resolve => setImmediate(resolve))
    if (!steered) throw await foregroundResult
    assert.equal(steered, true)
    assert.equal(foregroundSettled, false, 'the steer has not emitted turn/start or turn/end')
    await foregroundRuntime.close({ requireStopped: true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(foregroundSettled, true, 'forced close must unblock foreground input with no admission event')
    assert.match(String(await foregroundResult), /runtime closed/)
    assert.equal(foregroundRuntime.pendingForeground.size, 0)
  } finally {
    if (previousBusyEnter === undefined) delete process.env.BYCLAW_DSH_BUSY_ENTER
    else process.env.BYCLAW_DSH_BUSY_ENTER = previousBusyEnter
  }
  console.log('DSH single-agent / team cancellation and Gateway terminal status verification passed')
} finally { await rm(workspace, { recursive: true, force: true }) }
