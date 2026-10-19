import { resolveTeamStateRoot } from '../lib/runtime-state.js'
/** Deterministic control-plane regression verification. */

import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { createTeamDir, readTeam } from '../lib/state.js'
import { canAppendControlledTaskBatch, classifyTeamSettlement } from '../lib/lifecycle.js'
import { listRuntimeInstances, registerRuntimeInstance } from '../lib/catalog.js'

const workspace = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-controlled-'))
const catalogDir = join(workspace, 'global-catalog')
const definitions = new Map()
const listeners = new Map()
const liveAgents = new Map()
const persistedAgents = new Map()
const deliveries = []
const steeredMessages = []
let childSeq = 0
let captainResumeCount = 0
let captainCancelCount = 0
let concludedTurnCount = 0
const turnOverrides = new Map()
const modelOverrides = {
  set(id, selection) { if (selection === undefined) turnOverrides.delete(id); else turnOverrides.set(id, selection) },
  get(id) { return turnOverrides.get(id) },
}

function session(parentSession, cwd = workspace) {
  return {
    header: { cwd, parentSession },
    snapshotEvents() { return [] }, ownEvents() { return [] },
    append() {},
    requestHeader() {
      return { config: { provider: 'fake', model: 'fake-model', reasoningEffort: 'high' } }
    },
  }
}

function agent(id, parentSession, cwd = workspace) {
  return {
    id,
    status: 'idle',
    options: { provider: 'fake', model: 'fake-model' },
    session: session(parentSession, cwd),
    steer(message) { steeredMessages.push({ agentId: id, message }) },
    cancel() {
      if (id === 'captain') captainCancelCount += 1
    },
    whenIdle() { return Promise.resolve() },
  }
}

const captain = agent('captain')
liveAgents.set(captain.id, captain)

const ctx = {
  effect(setup) { return setup() },
  tools: {
    register(definition) { definitions.set(definition.name, definition) },
  },
  on(name, listener) {
    const current = listeners.get(name) ?? []
    current.push(listener)
    listeners.set(name, current)
    return () => listeners.set(name, current.filter(candidate => candidate !== listener))
  },
  agents: {
    get(id) { return liveAgents.get(id) },
    withoutInitiator(operation) { return operation() },
    async resume({ resumeSessionId }) {
      const resumed = persistedAgents.get(resumeSessionId)
      if (!resumed) throw new Error(`persisted agent ${resumeSessionId} was not found`)
      captainResumeCount += 1
      liveAgents.set(resumeSessionId, resumed)
      return {
        agent: resumed,
        async dispose() { liveAgents.delete(resumeSessionId) },
      }
    },
  },
  llm: { async resolveCallConfig(config) { return config } },
  subagents: {
    async sendMessage(parent, childId, content, options) { return this[deliverSubagentPrompt](parent, childId, content, { kind: 'subagent', sessionId: parent.id }, options.signal, 'steer') },
    getProvider(name) {
      return name === 'spawn' ? { prepareContinuable() {}, inheritsParentContext: false, capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true } } : undefined
    },
    list() { return ['spawn'] },
    async startActivation() {
      const child = agent(`member-${++childSeq}`, captain.id)
      child.status = 'running'
      liveAgents.set(child.id, child)
      return { childId: child.id, messageId: `welcome-${childSeq}`, result: new Promise(() => {}), async dispose() {} }
    },
    async listChildren() { return [] },
    async listDescendants() { return [] },
    async [deliverSubagentPrompt](_parent, childId, content) {
      deliveries.push({ childId, content })
      const child = liveAgents.get(childId)
      if (child) child.status = 'running'
      return `delivery-${deliveries.length}`
    },
    interrupt() {},
  },
  logger: { debug() {}, warn() {} },
}

registerAgentTeamsTools(ctx, {
  modelOverrides,
  memberSelectionRuntime: {
    withPending: async (_parent, _label, _selection, _member, operation) => operation(),
    withNextRequest: async (_parent, _label, _child, _selection, _member, operation) => operation(),
    restoreBaseline() {},
  },
  stateDir: '.agent-teams',
  memberProvider: 'spawn',
  memberMaxDepth: 1,
  controlledWorkflow: true,
  maxTaskAttempts: 2,
  catalogDir,
})

function execFor(subject) {
  return {
    agent: subject,
    signal: new AbortController().signal,
    concludeTurn() { concludedTurnCount += 1 },
  }
}

async function call(name, args, subject = captain) {
  const definition = definitions.get(name)
  if (!definition) throw new Error(`missing tool ${name}`)
  return definition.execute(args, execFor(subject))
}

function publishStatus(subject, status) {
  subject.status = status
  for (const listener of listeners.get('agent/status') ?? []) listener({ agent: subject, status })
}

async function publishRequestError(subject, failure) {
  const chain = [...(listeners.get('agent/request-error') ?? [])]
  const dispatch = index => index >= chain.length
    ? Promise.resolve(undefined)
    : chain[index]({
      agent: subject,
      turn: 1,
      step: 1,
      provider: 'fake',
      failure,
      retryPolicy: undefined,
      signal: new AbortController().signal,
    }, () => dispatch(index + 1))
  await dispatch(0)
}

async function publishToolResult(subject, name, args, isError = false) {
  const exec = Object.freeze({
    name,
    arguments: Object.freeze(args),
    agent: subject,
    callId: `${name}-call`,
    rootCallId: `${name}-call`,
    token: Symbol(name),
    signal: new AbortController().signal,
  })
  const result = isError
    ? Object.freeze({ isError: true, error: { message: 'failed' }, content: Object.freeze([]) })
    : Object.freeze({ isError: false, value: {}, content: Object.freeze([]) })
  const chain = [...(listeners.get('tools/post-execute') ?? [])]
  const dispatch = index => index >= chain.length
    ? Promise.resolve({ kind: 'accept' })
    : chain[index](exec, result, () => dispatch(index + 1))
  await dispatch(0)
}

const stateRoot = resolveTeamStateRoot(workspace, '.agent-teams')
const state = () => readTeam(stateRoot, 'controlled')
const task = async id => (await state())?.tasks.find(candidate => candidate.id === id)

console.log('dsh-agent-teams controlled workflow verification')
try {
  await call('agent_teams_create', { name: 'Controlled', description: 'deterministic workflow' })
  const added = await call('agent_teams_add_member', { name: 'worker', role: 'implement and verify' })
  const worker = liveAgents.get(added.member_id)
  publishStatus(worker, 'idle')

  let idleWakeRejected = false
  try {
    await call('agent_teams_send_message', { to: 'worker', content: 'Start preparatory work before assignment.' })
  } catch (error) {
    idleWakeRejected = /active task|controlled/i.test(String(error))
  }
  if (!idleWakeRejected) throw new Error('controlled workflow allowed a message to wake an unassigned member')

  let explicitContractRejected = false
  try {
    await call('agent_teams_create_task', { subject: 'missing contract', assignee: 'worker' })
  } catch (error) {
    explicitContractRejected = /dependencies|required_tools|acceptance/i.test(String(error))
  }
  if (!explicitContractRejected) throw new Error('controlled task creation accepted an implicit workflow contract')

  const t1 = await call('agent_teams_create_task', {
    subject: 'implementation',
    description: 'Implement the requested environment changes.',
    assignee: 'worker',
    dependencies: [],
    acceptance_criteria: 'Required tools ran successfully and the implementation is summarized.',
    required_tools: ['skill:bycli', 'tool:codegraph_explore', 'tool:bash'],
  })
  const t2 = await call('agent_teams_create_task', {
    subject: 'quota branch',
    description: 'Exercise terminal provider failure handling.',
    assignee: 'worker',
    dependencies: [t1.task_id],
    acceptance_criteria: 'The task stops after a terminal provider failure.',
    required_tools: [],
  })
  const t3 = await call('agent_teams_create_task', {
    subject: 'attempt branch',
    description: 'Exercise bounded lost-turn recovery.',
    assignee: 'worker',
    dependencies: [t2.task_id],
    acceptance_criteria: 'The configured attempt ceiling is enforced.',
    required_tools: [],
  })

  const lifecycleFixture = {
    lifecycle: 'running',
    members: [{ status: 'idle' }],
    tasks: [
      { id: 'root', status: 'failed', dependencies: [] },
      { id: 'child', status: 'pending', dependencies: ['root'] },
    ],
  }
  if (classifyTeamSettlement(lifecycleFixture) !== 'blocked') {
    throw new Error('headless lifecycle barrier did not recognize a dependency-blocked DAG')
  }
  lifecycleFixture.tasks[0].status = 'completed'
  if (classifyTeamSettlement(lifecycleFixture) !== 'active') {
    throw new Error('headless lifecycle barrier treated a runnable task as settled')
  }
  lifecycleFixture.tasks[1].status = 'completed'
  if (classifyTeamSettlement(lifecycleFixture) !== 'completed') {
    throw new Error('headless lifecycle barrier did not recognize a completed DAG')
  }
  if (!canAppendControlledTaskBatch(lifecycleFixture)) {
    throw new Error('completed controlled DAG did not allow a new task batch')
  }
  lifecycleFixture.tasks[0].status = 'failed'
  if (canAppendControlledTaskBatch(lifecycleFixture)) {
    throw new Error('failed controlled DAG incorrectly allowed a new task batch')
  }
  lifecycleFixture.tasks[0].status = 'completed'

  if (deliveries.length !== 0 || (await state())?.lifecycle !== 'draft') {
    throw new Error('controlled draft dispatched work before graph validation')
  }

  const batchOverride = { provider: 'conversation', model: 'selected-model' }
  modelOverrides.set(captain.id, batchOverride)
  await call('agent_teams_start', {})
  await new Promise(resolve => setTimeout(resolve, 5))
  if (concludedTurnCount !== 1 || captainCancelCount !== 0) {
    throw new Error('validated controlled workflow did not conclude its successful dispatch cleanly')
  }
  const started = await task(t1.task_id)
  if (started?.status !== 'claimed' || deliveries.length !== 1 || (await state())?.lifecycle !== 'running') {
    throw new Error('validated controlled workflow did not dispatch exactly one root task')
  }
  const startedState = await state()
  if (startedState?.tasks.some(candidate => candidate.executionModel?.provider !== batchOverride.provider
    || candidate.executionModel?.model !== batchOverride.model
    || candidate.executionModel?.reasoningEffort !== undefined)) {
    throw new Error('controlled start did not freeze one effort-clearing conversation route onto every DAG task')
  }
  modelOverrides.set(captain.id, undefined)

  const claim1 = await call('agent_teams_claim_task', { task_id: t1.task_id }, worker)
  await call('agent_teams_update_task', {
    task_id: t1.task_id,
    status: 'in_progress',
    attempt_id: claim1.attempt_id,
  }, worker)

  let missingReceiptRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: t1.task_id,
      status: 'completed',
      output: 'implementation done',
      attempt_id: claim1.attempt_id,
    }, worker)
  } catch (error) {
    missingReceiptRejected = /required tool|receipt/i.test(String(error))
  }
  if (!missingReceiptRejected) throw new Error('controlled completion ignored missing receipts')

  await publishToolResult(worker, 'skill', { name: 'bycli' })
  // MCP tools are surfaced by Harness with a qualified runtime name, while
  // workflow contracts deliberately use the stable leaf capability name.
  await publishToolResult(worker, 'mcp__codegraph__codegraph_explore', { query: 'inspect environment' })
  await publishToolResult(worker, 'bash', { command: 'pytest' }, true)
  let failedToolRejected = false
  try {
    await call('agent_teams_update_task', {
      task_id: t1.task_id,
      status: 'completed',
      output: 'implementation done',
      attempt_id: claim1.attempt_id,
    }, worker)
  } catch (error) {
    failedToolRejected = /tool:bash/.test(String(error))
  }
  if (!failedToolRejected) throw new Error('failed tool result satisfied a required receipt')

  await publishToolResult(worker, 'bash', { command: 'pytest' })
  await call('agent_teams_update_task', {
    task_id: t1.task_id,
    status: 'completed',
    output: 'implementation done',
    attempt_id: claim1.attempt_id,
  }, worker)

  publishStatus(worker, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const quotaAttempt = await task(t2.task_id)
  if (quotaAttempt?.status !== 'claimed') throw new Error('quota task was not dispatched after its dependency')
  const deliveriesBeforeQuota = deliveries.length
  await publishRequestError(worker, { message: 'Insufficient Balance', code: 'QUOTA', status: 402 })
  publishStatus(worker, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const quotaFailed = await task(t2.task_id)
  if (quotaFailed?.status !== 'failed'
    || quotaFailed.attempt !== quotaAttempt.attempt
    || deliveries.length !== deliveriesBeforeQuota) {
    throw new Error('terminal QUOTA failure was re-dispatched')
  }

  const replacementOverride = { provider: 'replacement', model: 'replacement-model', reasoningEffort: 'low' }
  modelOverrides.set(captain.id, replacementOverride)
  await call('agent_teams_reassign_task', { task_id: t2.task_id, assignee: 'captain', reason: 'replace route' })
  if ((await task(t2.task_id))?.executionModel?.provider !== replacementOverride.provider) {
    throw new Error('manual reassignment did not replace the old DAG execution route')
  }
  modelOverrides.set(captain.id, undefined)
  await call('agent_teams_reassign_task', { task_id: t2.task_id, assignee: 'captain', reason: 'restore baseline route' })
  if ((await task(t2.task_id))?.executionModel !== undefined) {
    throw new Error('manual reassignment without an override retained the old conversation route')
  }
  await call('agent_teams_update_task', { task_id: t2.task_id, status: 'in_progress' })
  await call('agent_teams_update_task', { task_id: t2.task_id, status: 'completed', output: 'quota handled' })

  const attempt1 = await task(t3.task_id)
  if (attempt1?.attempt !== 1) throw new Error('attempt branch did not start at attempt 1')
  publishStatus(worker, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const attempt2 = await task(t3.task_id)
  publishStatus(worker, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const exhausted = await task(t3.task_id)
  if (attempt2?.attempt !== 2 || exhausted?.attempt !== 2 || exhausted.status !== 'failed') {
    throw new Error('task attempt ceiling did not stop lost-turn recovery')
  }

  const nextCaptain = agent('next-captain')
  liveAgents.set(nextCaptain.id, nextCaptain)

  const discovered = await call('agent_teams_list_instances', {}, nextCaptain)
  const discoveredTeam = discovered.instances.find(instance => instance.team_id === 'controlled')
  if (discoveredTeam?.captain_session_id !== captain.id || discoveredTeam.status !== 'active'
    || discoveredTeam.lifecycle !== 'running'
    || discoveredTeam.members[0]?.name !== 'worker'
    || discoveredTeam.members[0]?.role !== 'implement and verify') {
    throw new Error('fresh session could not discover the existing active team globally')
  }

  const inspected = await call('agent_teams_get_instance', { team_id: 'controlled' }, nextCaptain)
  if (inspected.team_id !== 'controlled' || inspected.member_count !== 1 || inspected.task_count !== 3
    || inspected.members[0]?.name !== 'worker' || inspected.members[0]?.provider !== 'fake') {
    throw new Error('fresh session could not inspect global team details')
  }

  let unattachedStatusGuided = false
  try {
    await call('agent_teams_status', {}, nextCaptain)
  } catch (error) {
    unattachedStatusGuided = /agent_teams_list_instances/.test(String(error))
  }
  if (!unattachedStatusGuided) throw new Error('unattached status did not guide the caller to global discovery')

  const pointers = await listRuntimeInstances(catalogDir)
  if (pointers.length !== 1 || pointers[0]?.captainSessionId !== captain.id
    || (await state())?.captainSessionId !== captain.id) {
    throw new Error('read-only global discovery changed runtime ownership')
  }

  const sameNameOtherConversation = await call('agent_teams_create', {
    name: 'Controlled',
    description: 'same template display name in another root conversation',
  }, nextCaptain)
  if (sameNameOtherConversation.team_id === 'controlled' || sameNameOtherConversation.reused !== false) {
    throw new Error('a separate captain conversation reused or collided with the existing same-name runtime')
  }
  const isolatedTeam = await readTeam(stateRoot, sameNameOtherConversation.team_id)
  if (isolatedTeam?.captainSessionId !== nextCaptain.id || isolatedTeam.name !== 'Controlled') {
    throw new Error('same-name runtime was not isolated to its creating captain conversation')
  }

  const sharedWorkspace = join(workspace, 'shared-workspace')
  const sharedStateRoot = resolveTeamStateRoot(sharedWorkspace, '.agent-teams')
  const sharedCaptain = agent('shared-captain', undefined, sharedWorkspace)
  const sharedWorker = agent('shared-worker', sharedCaptain.id, sharedWorkspace)
  sharedWorker.status = 'running'
  liveAgents.set(sharedCaptain.id, sharedCaptain)
  liveAgents.set(sharedWorker.id, sharedWorker)
  await createTeamDir(sharedStateRoot, {
    id: 'shared-runtime',
    name: 'Shared runtime team',
    description: 'Accepts non-preemptive work from another session.',
    captainSessionId: sharedCaptain.id,
    createdAt: Date.now(),
    controlledWorkflow: true,
    lifecycle: 'running',
    members: [{
      id: sharedWorker.id,
      name: 'shared-engineer',
      role: 'implementation',
      provider: 'fake',
      model: 'fake-model',
      joinedAt: Date.now(),
      status: 'working',
    }],
    tasks: [{
      id: 't1',
      subject: 'existing work',
      description: 'Must not be changed or preempted.',
      status: 'in_progress',
      assignee: 'shared-engineer',
      dependencies: [],
      acceptanceCriteria: 'Existing output is preserved.',
      requiredTools: [],
      receipts: [],
      attempt: 1,
      attemptId: 'existing-attempt',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }],
    taskSeq: 1,
  })
  await registerRuntimeInstance(
    catalogDir,
    sharedStateRoot,
    sharedWorkspace,
    await readTeam(sharedStateRoot, 'shared-runtime'),
  )

  const requester = agent('requester', undefined, join(workspace, 'requester-workspace'))
  const observer = agent('observer', undefined, join(workspace, 'observer-workspace'))
  liveAgents.set(requester.id, requester)
  liveAgents.set(observer.id, observer)
  const sharedMetadata = await call('agent_teams_get_instance', { team_id: 'shared-runtime' }, requester)
  if (sharedMetadata.members[0]?.name !== 'shared-engineer'
    || sharedMetadata.members[0]?.status !== 'working') {
    throw new Error('requester could not inspect the shared team composition')
  }

  const deliveriesBeforeSubmission = deliveries.length
  const concludedBeforeSubmission = concludedTurnCount
  const submittedOverride = { provider: 'requester-provider', model: 'requester-model', reasoningEffort: 'high' }
  modelOverrides.set(requester.id, submittedOverride)
  const submitted = await call('agent_teams_submit_task', {
    team_id: 'shared-runtime',
    subject: 'new independent work',
    description: 'Run only after the assigned member finishes existing work.',
    assignee: 'shared-engineer',
    acceptance_criteria: 'Return a non-empty result without changing t1.',
    required_tools: [],
  }, requester)
  const sharedAfterSubmit = await readTeam(sharedStateRoot, 'shared-runtime')
  const existingAfterSubmit = sharedAfterSubmit?.tasks.find(candidate => candidate.id === 't1')
  const queuedAfterSubmit = sharedAfterSubmit?.tasks.find(candidate => candidate.id === submitted.task_id)
  if (existingAfterSubmit?.status !== 'in_progress'
    || existingAfterSubmit.attemptId !== 'existing-attempt'
    || queuedAfterSubmit?.status !== 'pending'
    || queuedAfterSubmit.requesterSessionId !== requester.id
    || queuedAfterSubmit.executionModel?.provider !== submittedOverride.provider
    || queuedAfterSubmit.executionModel?.model !== submittedOverride.model
    || queuedAfterSubmit.executionModel?.reasoningEffort !== submittedOverride.reasoningEffort
    || deliveries.length !== deliveriesBeforeSubmission) {
    throw new Error('cross-session submission preempted or mutated existing work')
  }
  modelOverrides.set(requester.id, undefined)
  if (concludedTurnCount !== concludedBeforeSubmission + 1) {
    throw new Error('cross-session submission kept the requester turn alive instead of waiting for an event wake')
  }

  const requesterView = await call('agent_teams_get_submitted_task', {
    team_id: 'shared-runtime',
    task_id: submitted.task_id,
  }, requester)
  if (requesterView.status !== 'pending') throw new Error('requester could not read its queued task')
  let observerRejected = false
  try {
    await call('agent_teams_get_submitted_task', {
      team_id: 'shared-runtime',
      task_id: submitted.task_id,
    }, observer)
  } catch (error) {
    observerRejected = /requester|submitted/i.test(String(error))
  }
  if (!observerRejected) throw new Error('another session could read the requester-scoped task result')

  await call('agent_teams_update_task', {
    task_id: 't1',
    status: 'completed',
    output: 'existing work completed unchanged',
    attempt_id: 'existing-attempt',
  }, sharedWorker)
  publishStatus(sharedWorker, 'idle')
  await new Promise(resolve => setTimeout(resolve, 20))
  const sharedAfterIdle = await readTeam(sharedStateRoot, 'shared-runtime')
  const dispatched = sharedAfterIdle?.tasks.find(candidate => candidate.id === submitted.task_id)
  if (dispatched?.status !== 'claimed' || deliveries.length !== deliveriesBeforeSubmission + 1) {
    throw new Error('submitted task did not wait for existing work before dispatch')
  }
  const submittedClaim = await call('agent_teams_claim_task', { task_id: submitted.task_id }, sharedWorker)
  await call('agent_teams_update_task', {
    task_id: submitted.task_id,
    status: 'in_progress',
    attempt_id: submittedClaim.attempt_id,
  }, sharedWorker)
  await call('agent_teams_update_task', {
    task_id: submitted.task_id,
    status: 'completed',
    output: 'new independent work completed',
    attempt_id: submittedClaim.attempt_id,
  }, sharedWorker)
  const requesterWake = steeredMessages.find(entry => entry.agentId === requester.id)
  const requesterWakeText = requesterWake?.message?.content?.[0]?.text ?? ''
  if (!requesterWakeText.includes(submitted.task_id)
    || !requesterWakeText.includes('new independent work completed')) {
    throw new Error('submitted task completion did not actively wake its requester with the result')
  }
  const completedSubmission = await call('agent_teams_get_submitted_task', {
    team_id: 'shared-runtime',
    task_id: submitted.task_id,
  }, requester)
  if (completedSubmission.status !== 'completed'
    || completedSubmission.output !== 'new independent work completed') {
    throw new Error('requester could not read its submitted task result')
  }

  const draftWorkspace = join(workspace, 'draft-workspace')
  const draftStateRoot = resolveTeamStateRoot(draftWorkspace, '.agent-teams')
  const draftCaptain = agent('draft-captain', undefined, draftWorkspace)
  const draftWorker = agent('draft-worker', draftCaptain.id, draftWorkspace)
  liveAgents.set(draftCaptain.id, draftCaptain)
  liveAgents.set(draftWorker.id, draftWorker)
  const emptyDraft = {
    id: 'empty-draft-runtime',
    name: 'Empty draft runtime',
    captainSessionId: draftCaptain.id,
    createdAt: Date.now(),
    controlledWorkflow: true,
    lifecycle: 'draft',
    members: [{
      id: draftWorker.id,
      name: 'draft-engineer',
      role: 'implementation',
      provider: 'fake',
      model: 'fake-model',
      joinedAt: Date.now(),
      status: 'idle',
    }],
    tasks: [],
    taskSeq: 0,
  }
  await createTeamDir(draftStateRoot, emptyDraft)
  await registerRuntimeInstance(catalogDir, draftStateRoot, draftWorkspace, emptyDraft)
  liveAgents.delete(draftCaptain.id)
  persistedAgents.set(draftCaptain.id, draftCaptain)
  const draftSubmission = await call('agent_teams_submit_task', {
    team_id: 'empty-draft-runtime',
    subject: 'first shared task',
    description: 'Open an otherwise empty controlled team safely.',
    assignee: 'draft-engineer',
    acceptance_criteria: 'Complete the first shared task.',
    required_tools: [],
  }, requester)
  const openedDraft = await readTeam(draftStateRoot, 'empty-draft-runtime')
  if (openedDraft?.lifecycle !== 'running'
    || openedDraft.tasks.find(candidate => candidate.id === draftSubmission.task_id)?.status !== 'claimed'
    || captainResumeCount !== 1) {
    throw new Error('first external task did not restore its captain and safely open an empty controlled draft')
  }

  console.log('  PASS  draft/start DAG gate')
  console.log('  PASS  successful tool and Skill receipt completion gate')
  console.log('  PASS  terminal LLM failure circuit breaker')
  console.log('  PASS  bounded lost-turn recovery')
  console.log('  PASS  headless parent/child lifecycle classification')
  console.log('  PASS  controlled idle-member message wake guard')
  console.log('  PASS  cross-session global team metadata discovery')
  console.log('  PASS  non-preemptive requester-scoped task submission')
  console.log('  PASS  first shared task restores its captain and safely opens an empty controlled draft')
} finally {
  await rm(workspace, { recursive: true, force: true })
}

console.log('\nall controlled workflow checks passed')
