import { sessionLog } from './session-runtime-fixtures.mjs'
import assert from 'node:assert/strict'
import { EventType } from '@byclaw/by-framework'
import {
  appendByClawContext,
  appendByClawInboundUserMessage,
  buildByClawInboundTurnContext,
  ByClawSessionWorkspaceRegistry,
  byClawInboundText,
  resolveByClawByRoot,
  resolveByClawStorageLayout,
  assertByClawRootBinding,
  byClawTurnModelOverride,
  foldByClawRootBinding,
  foldByClawSessionWorkspace,
  isLegacyByClawRootBindingCandidate,
} from '../lib/index.js'
import {
  byClawTurnFailurePresentation,
  emitByClawTurnFailure,
  resolveByClawTurnModelSelection,
} from '../lib/session-runtime.js'
import * as dshSession from '@deepseek-ai/dsh-session'
import * as integration from '../lib/index.js'

const workspace = {
  externalSessionId: '350860623218590448',
  cwd: '/workspace/byclaw',
  userCode: 'test-user',
  userName: '陈舵主',
  sessionRoot: '/srv/byclaw/by/.sessions/350860623218590448',
  sharedRoot: '/srv/byclaw/by/.shared',
  defaultOutputRoot: '/srv/byclaw/by/.sessions/350860623218590448',
}
const businessText = '帮我找架构助手，重新研究 ByClaw 前后端的架构。'

assert.deepEqual(byClawTurnModelOverride({
  rel_model_id: ' 20033843 ',
  thinkingLevel: ' high ',
}), { modelId: '20033843', thinkingLevel: 'high' })
assert.deepEqual(byClawTurnModelOverride({ thinking_level: 'off' }), { thinkingLevel: 'off' })
assert.deepEqual(byClawTurnModelOverride({
  rel_model_id: '', rel_model_code: 'must-not-be-used', rel_model_name: 'must-not-be-used',
}), {}, 'model code and display name must never substitute for the authoritative model id')

const templateSelection = {
  provider: 'baiying-m-10014488',
  model: 'deepseek-v4.1-flash',
  sourceModelId: '10014488',
}
const modelResolutionCalls = []
const resolveModel = async (...args) => {
  modelResolutionCalls.push(args)
  return { provider: `baiying-m-${args[1]}`, model: args[1], reasoningEffort: args[2] }
}
assert.equal(await resolveByClawTurnModelSelection({
  bindingId: 'root:user:session', preparedSelection: templateSelection, override: {}, resolveModel,
}), templateSelection, 'a template selection remains authoritative when this turn has no override')
assert.equal(modelResolutionCalls.length, 0)
assert.deepEqual(await resolveByClawTurnModelSelection({
  bindingId: 'root:user:session',
  preparedSelection: templateSelection,
  override: { modelId: '20033843', thinkingLevel: 'high' },
  resolveModel,
}), { provider: 'baiying-m-20033843', model: '20033843', reasoningEffort: 'high' })
assert.deepEqual(modelResolutionCalls.pop(), ['root:user:session', '20033843', 'high'])
assert.deepEqual(await resolveByClawTurnModelSelection({
  bindingId: 'root:user:session',
  preparedSelection: templateSelection,
  override: { thinkingLevel: 'low' },
  resolveModel,
}), { provider: 'baiying-m-10014488', model: '10014488', reasoningEffort: 'low' })
assert.deepEqual(modelResolutionCalls.pop(), ['root:user:session', '10014488', 'low'])

assert.deepEqual(
  byClawTurnFailurePresentation(new Error('DSH turn failed: 429 insufficient_quota; private upstream detail')),
  { code: 'MODEL_QUOTA_EXHAUSTED', message: '模型服务额度不足，请切换模型或联系管理员。' },
)
assert.deepEqual(
  byClawTurnFailurePresentation(new Error('BYCLAW_PROVIDER_ADAPTER_NOT_FOUND: private adapter detail')),
  { code: 'MODEL_CONFIG_INVALID', message: '当前模型配置不可用，请切换模型或联系管理员。' },
)
const failureChunks = []
await emitByClawTurnFailure({
  emitter: { async emitChunk(...args) { failureChunks.push(args) } },
  sessionId: '20087515',
  traceId: 'trace-error',
  rootSessionId: '20087515',
  messageId: '20087521',
  sourceAgentType: 'BYCLAW_DSH',
  error: new Error('429 insufficient_quota with private upstream detail'),
})
assert.equal(failureChunks.length, 1)
assert.equal(failureChunks[0][2].content, '模型服务额度不足，请切换模型或联系管理员。')
assert.equal(failureChunks[0][2].metadata.error_code, 'MODEL_QUOTA_EXHAUSTED')
assert.equal(failureChunks[0][2].content.includes('private upstream detail'), false)
assert.equal(failureChunks[0][3].eventType, EventType.ANSWER_DELTA)
assert.equal(failureChunks[0][3].status, '_ERROR_')

assert.equal(byClawInboundText(businessText), businessText)
assert.equal(byClawInboundText(businessText).includes('<user-request>'), false)
assert.equal(byClawInboundText(businessText).includes('<byclaw-session-workspace>'), false)

const recordedInbound = []
appendByClawInboundUserMessage({
  append(type, data, options) {
    recordedInbound.push({ type, data, options })
  },
}, businessText)
assert.equal(recordedInbound.length, 1)
assert.equal(recordedInbound[0].type, 'user/message')
assert.equal(recordedInbound[0].data.source.kind, 'user')
assert.equal(recordedInbound[0].data.content[0].text, businessText)
assert.deepEqual(recordedInbound[0].options, { surfaceOp: 'append' })

assert.equal(dshSession.KNOWN_SESSION_EVENT_TYPES.has('byclaw/session-workspace'), false)
assert.equal(dshSession.KNOWN_SESSION_EVENT_TYPES.has('byclaw/root-binding'), false)
assert.equal(integration.registerByClawSessionEventType, undefined)
assert.equal(integration.ensureByClawSessionWorkspace, undefined)
assert.equal(integration.ensureByClawRootBinding, undefined)

const bindingEvents = [{ type: 'byclaw/root-binding', data: {
  kind: 'template', templateId: 'employee:20010801',
} }]
assert.deepEqual(foldByClawRootBinding(bindingEvents), bindingEvents[0].data)
assert.throws(
  () => foldByClawRootBinding([
    ...bindingEvents,
    { type: 'byclaw/root-binding', data: { kind: 'main' } },
  ]),
  /conflicting root bindings/u,
)
assert.throws(
  () => assertByClawRootBinding(bindingEvents, { kind: 'main' }),
  /already bound to template "employee:20010801"/u,
)
assert.throws(
  () => assertByClawRootBinding([], { kind: 'main' }),
  /has no durable root binding/u,
)

const legacyEvents = [{ type: 'byclaw/session-workspace', data: workspace }]
assert.equal(isLegacyByClawRootBindingCandidate(legacyEvents), true)
assert.deepEqual(foldByClawSessionWorkspace(legacyEvents), {
  externalSessionId: workspace.externalSessionId,
  cwd: workspace.cwd,
})
assert.throws(
  () => foldByClawSessionWorkspace([
    ...legacyEvents,
    { type: 'byclaw/session-workspace', data: { ...workspace, cwd: '/workspace/other' } },
  ]),
  /conflicting session workspaces/u,
)

const registry = new ByClawSessionWorkspaceRegistry()
const rootSession = {
  id: '350860623218590448',
  header: { id: '350860623218590448', createdAt: 1, cwd: '/workspace/byclaw' },
  ...sessionLog([]),
}
assert.deepEqual(registry.registerRoot(rootSession, workspace.externalSessionId, workspace), workspace)
assert.deepEqual(registry.get(rootSession.id), workspace)
assert.throws(
  () => new ByClawSessionWorkspaceRegistry().registerRoot({
    ...rootSession,
    ...sessionLog([{ type: 'byclaw/session-workspace', data: { ...workspace, cwd: '/workspace/other' } }]),
  }, workspace.externalSessionId),
  /conflicts with SessionHeader\.cwd/u,
)

const childSession = {
  id: 'child-1',
  header: { id: 'child-1', createdAt: 2, parentSession: rootSession.id },
  ...sessionLog([]),
}
assert.deepEqual(registry.inherit(childSession), workspace)
assert.deepEqual(registry.get(childSession.id), workspace)
assert.deepEqual(registry.inherit({
  id: 'grandchild-1',
  header: { id: 'grandchild-1', createdAt: 3, parentSession: childSession.id },
  ...sessionLog([]),
}), workspace)
assert.throws(
  () => registry.inherit({
    id: 'orphan',
    header: { id: 'orphan', createdAt: 4, parentSession: 'missing-parent' },
    ...sessionLog([]),
  }),
  /has no live ByClaw workspace/u,
)

const userMessage = {
  id: 'user-message',
  role: 'user',
  content: [{ type: 'text', text: businessText }],
  source: { kind: 'user' },
}
const session = {
  header: {},
  ...sessionLog([]),
}

const storage = resolveByClawStorageLayout({
  externalSessionId: workspace.externalSessionId,
  workspace: '/srv/byclaw/by/projects',
})
assert.deepEqual(storage, {
  byRoot: '/srv/byclaw/by',
  sessionRoot: workspace.sessionRoot,
  sharedRoot: workspace.sharedRoot,
  defaultOutputRoot: workspace.defaultOutputRoot,
})

assert.equal(resolveByClawByRoot({
  workspace: '/by/projects/20014944',
}), '/by')

assert.equal(
  typeof integration.resolveByClawLocalE2eStorageRoot,
  'function',
  'local E2E storage must be guarded by an explicit environment switch',
)
const resolveLocalE2eStorageRoot = integration.resolveByClawLocalE2eStorageRoot
assert.equal(resolveLocalE2eStorageRoot({
  FILE_STORAGE_LOCAL_PATH: '/tmp/byclaw-e2e',
}), undefined)
assert.equal(resolveLocalE2eStorageRoot({
  BYCLAW_DSH_LOCAL_E2E_STORAGE_ENABLED: 'false',
  FILE_STORAGE_LOCAL_PATH: '/tmp/byclaw-e2e',
}), undefined)
assert.equal(resolveLocalE2eStorageRoot({
  BYCLAW_DSH_LOCAL_E2E_STORAGE_ENABLED: 'true',
  FILE_STORAGE_LOCAL_PATH: ' /tmp/byclaw-e2e ',
}), '/tmp/byclaw-e2e')
assert.throws(
  () => resolveLocalE2eStorageRoot({
    BYCLAW_DSH_LOCAL_E2E_STORAGE_ENABLED: 'true',
  }),
  /requires FILE_STORAGE_LOCAL_PATH/u,
)
assert.throws(
  () => resolveLocalE2eStorageRoot({
    BYCLAW_DSH_LOCAL_E2E_STORAGE_ENABLED: 'sometimes',
    FILE_STORAGE_LOCAL_PATH: '/tmp/byclaw-e2e',
  }),
  /must be a boolean/u,
)

const localE2eByRoot = resolveByClawByRoot({
  workspace: '/by/projects/20014944',
  userCode: '0027024710',
  localE2eStorageRoot: '/tmp/byclaw-e2e',
})
assert.equal(localE2eByRoot, '/tmp/byclaw-e2e/byclaw-0027024710/by')
assert.equal(
  integration.resolveByClawInboundPath('/by/projects/20014944', localE2eByRoot),
  '/tmp/byclaw-e2e/byclaw-0027024710/by/projects/20014944',
)
assert.throws(
  () => resolveByClawByRoot({
    workspace: '/by/projects/20014944',
    localE2eStorageRoot: '/tmp/byclaw-e2e',
  }),
  /requires a ByClaw user code/u,
)

const inboundTurn = buildByClawInboundTurnContext({
  header: {
    messageId: 'turn-1',
    sessionId: workspace.externalSessionId,
    userCode: workspace.userCode,
    userName: workspace.userName,
    metadata: {
      language: 'zh_CN',
      project_info: {
        project_id: 20014944,
        project_name: '测试研发项目',
        workspace: '/by/projects/20014944',
        project_resources: [{ id: 'cloud-1', name: '研发资料' }],
      },
      authConnectorList: { dws: true, gmail: false },
      channelExtension: { forbidden: 'must-not-sync' },
    },
  },
  content: [{
    role: 'user',
    content: {
      text: businessText,
      files: [{
        fileId: 'file-1',
        fileName: '需求说明.pdf',
        filePath: '/by/.sessions/350860623218590448/需求说明.pdf',
        fileUrl: 'commonFile/preview?id=file-1',
        fileSize: 2048,
        fileType: 'application/pdf',
      }],
    },
  }],
  extraPayload: {
    resource_list: [{
      resourceId: 'kb-1',
      resourceType: 'KG_DOC',
      resourceName: '研发知识库',
      resourceCode: 'knowledge-base',
    }],
    groupChat: { forbidden: 'must-not-sync' },
    multi_agent: { forbidden: 'must-not-sync' },
  },
}, storage.byRoot)
assert.equal(inboundTurn.messageId, 'turn-1')
assert.equal(inboundTurn.language, 'zh_CN')
assert.equal(inboundTurn.attachments[0].fileName, '需求说明.pdf')
assert.equal(inboundTurn.attachments[0].filePath, `${storage.sessionRoot}/需求说明.pdf`)
assert.equal(inboundTurn.project.workspace, '/srv/byclaw/by/projects/20014944')
assert.equal(inboundTurn.resources[0].resourceName, '研发知识库')
assert.deepEqual(inboundTurn.connectors, { dws: true, gmail: false })

const deepSeekGlobalFallbackTurn = buildByClawInboundTurnContext({
  header: {
    messageId: 'turn-deepseek-global-fallback',
    sessionId: workspace.externalSessionId,
    metadata: {
      authConnectorList: { 'deepseek-web-search': false },
    },
  },
  content: [],
  extraPayload: {},
}, storage.byRoot)
assert.deepEqual(deepSeekGlobalFallbackTurn.connectors, { 'deepseek-web-search': true })
assert.match(
  byClawInboundTurnContextDeclaration(deepSeekGlobalFallbackTurn),
  /connector_availability: \{"deepseek-web-search":true\}/u,
)
registry.registerSessionTurn(rootSession.id, { ...inboundTurn, messageId: 'original-turn' })
registry.registerPendingSessionTurn(rootSession.id, userMessage.id, inboundTurn)
assert.equal(registry.getTurnForMessages(rootSession.id, [])?.messageId, 'original-turn')
assert.equal(registry.getTurnForMessages(rootSession.id, [userMessage]), inboundTurn)
const steeredStep = appendByClawContext(
  session, [userMessage], workspace, registry.getTurnForMessages(rootSession.id, [userMessage]),
)
assert.match(steeredStep.at(-1).content[0].text, /需求说明\.pdf/u)
assert.match(steeredStep.at(-1).content[0].text, /研发知识库/u)
registry.clearPendingSessionTurn(rootSession.id, userMessage.id)
registry.clearSessionTurn(rootSession.id, 'original-turn')
registry.registerTurn(workspace.externalSessionId, inboundTurn)
assert.equal(registry.getTurn(childSession.id), inboundTurn)
registry.clearTurn(workspace.externalSessionId, inboundTurn.messageId)
assert.equal(registry.getTurn(childSession.id), undefined)

const first = appendByClawContext(session, [userMessage], workspace, inboundTurn)
assert.equal(first.length, 3)
assert.equal(first[0], userMessage)
assert.deepEqual(first[1].source, { kind: 'plugin', plugin: 'byclaw-context' })
assert.match(first[1].content[0].text, /session_id: 350860623218590448/u)
assert.match(first[1].content[0].text, /cwd: \/workspace\/byclaw/u)
assert.match(first[1].content[0].text, /default_output_root: \/srv\/byclaw\/by\/\.sessions\/350860623218590448/u)
assert.match(first[1].content[0].text, /默认落盘/u)
assert.match(first[2].content[0].text, /需求说明\.pdf/u)
assert.match(first[2].content[0].text, /研发知识库/u)
assert.match(first[2].content[0].text, /测试研发项目/u)
assert.match(first[2].content[0].text, /gmail/u)
assert.doesNotMatch(first[2].content[0].text, /channelExtension|groupChat|multi_agent|must-not-sync/u)
assert.doesNotMatch(first[1].content[0].text, /<user-request>/u)
assert.doesNotMatch(first[1].content[0].text, /byclaw-runtime-capabilities/u)
assert.doesNotMatch(first[1].content[0].text, /CodeGraph/u)

const persistedContextEvent = {
  id: 'context-event',
  timestamp: 2,
  type: 'user/message',
  data: first[1],
}
const resumed = appendByClawContext({
  header: {},
  ...sessionLog([
    persistedContextEvent,
    { id: 'turn-context-event', timestamp: 3, type: 'user/message', data: first[2] },
  ]),
}, [userMessage], workspace, inboundTurn)
assert.deepEqual(resumed, [userMessage])

const delegated = appendByClawContext({
  header: { parentSession: 'parent' },
  ...sessionLog([{ type: 'seed/a' }, persistedContextEvent], 2),
}, [userMessage], workspace)
assert.equal(delegated.length, 2)
assert.deepEqual(delegated[1].source, { kind: 'plugin', plugin: 'byclaw-context' })

console.info('ByClaw session context verification passed')
