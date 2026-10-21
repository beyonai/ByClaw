import { sessionLog } from './session-runtime-fixtures.mjs'
import assert from 'node:assert/strict'
import { EventType } from '@byclaw/by-framework'
import {
  appendByClawContext,
  appendByClawInboundUserMessage,
  buildByClawInboundTurnContext,
  ByClawSessionWorkspaceRegistry,
  byClawInboundText,
  byClawInboundTurnContextDeclaration,
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
import {
  byClawModelErrorFromRequestFailure,
  sanitizeProviderErrorText,
  terminalByClawModelError,
} from '../lib/model-error.js'
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

const authFailure = byClawModelErrorFromRequestFailure({
  code: 'AUTH',
  status: 401,
  message: '401: {"message":"Incorrect API key provided: sk-secret123456","type":"invalid_request_error","code":"invalid_api_key"}',
})
assert.deepEqual(authFailure, {
  schemaVersion: 1,
  domain: 'MODEL',
  code: 'AUTH',
  httpStatus: 401,
  providerCode: 'invalid_api_key',
  providerMessage: 'Incorrect API key provided: [redacted]',
  retryable: false,
})
assert.deepEqual(
  byClawTurnFailurePresentation(authFailure),
  { code: 'AUTH', message: '模型服务请求失败，请稍后重试或联系管理员。' },
)
assert.equal(sanitizeProviderErrorText('Authorization: Bearer token-value Cookie=session-secret'),
  'Authorization: [redacted] Cookie=[redacted]')
assert.equal(
  sanitizeProviderErrorText('{"api_key":"plain-secret","token":"another-secret","message":"failed"}'),
  '{"api_key":"[redacted]","token":"[redacted]","message":"failed"}',
)
assert.deepEqual(byClawModelErrorFromRequestFailure({
  code: 'RATE_LIMIT', status: 429, message: 'Too many requests',
}), {
  schemaVersion: 1, domain: 'MODEL', code: 'RATE_LIMIT', httpStatus: 429,
  providerMessage: 'Too many requests', retryable: true,
})
assert.equal(byClawModelErrorFromRequestFailure({ code: 'UNKNOWN', status: 403, message: 'Forbidden' }).code, 'AUTH')
assert.equal(byClawModelErrorFromRequestFailure({ code: 'UNKNOWN', status: 400, message: 'bad payload' }).code, 'INVALID_REQUEST')
assert.equal(byClawModelErrorFromRequestFailure({ code: 'UNKNOWN', message: 'socket ECONNRESET' }).code, 'TRANSPORT')
assert.equal(byClawModelErrorFromRequestFailure({ code: 'UNKNOWN', message: 'maximum context window exceeded' }).code, 'CONTEXT_LENGTH')
assert.equal(terminalByClawModelError({ code: 'AUTH' }, { kind: 'retry' }), undefined,
  'a model attempt recovered by provider retry or failover must remain invisible')
assert.equal(terminalByClawModelError({ code: 'AUTH' }, undefined)?.code, 'AUTH')
const failureChunks = []
await emitByClawTurnFailure({
  emitter: { async emitChunk(...args) { failureChunks.push(args) } },
  sessionId: '20087515',
  traceId: 'trace-error',
  rootSessionId: '20087515',
  messageId: '20087521',
  sourceAgentType: 'BYCLAW_DSH',
  error: authFailure,
})
assert.equal(failureChunks.length, 1)
assert.equal(failureChunks[0][2].content, '模型服务请求失败，请稍后重试或联系管理员。')
assert.equal(failureChunks[0][2].metadata.error_domain, 'MODEL')
assert.equal(failureChunks[0][2].metadata.error_code, 'AUTH')
assert.equal(failureChunks[0][2].metadata.http_status, 401)
assert.equal(failureChunks[0][2].metadata.provider_code, 'invalid_api_key')
assert.equal(failureChunks[0][2].metadata.provider_message.includes('sk-secret'), false)
assert.equal(failureChunks[0][2].metadata.diagnostic_id, 'trace-error:model')
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

const referencedFilesTurn = buildByClawInboundTurnContext({
  header: {
    messageId: 'turn-referenced-files',
    sessionId: workspace.externalSessionId,
    metadata: { project_info: { project_id: 20014944 } },
  },
  content: [],
  extraPayload: {
    resource_list: [{
      resourceId: '/by/.sessions/350860623218590448/过程报告.md',
      resourceType: 'COMMON_FILE',
      resourceName: '过程报告.md',
    }, {
      resourceId: '/by/.shared/共享规范.md',
      resourceType: 'COMMON_FILE',
      resourceName: '共享规范.md',
    }, {
      resourceId: '/素材/需求说明.md',
      resourceType: 'COMMON_FILE',
      resourceName: '需求说明.md',
    }],
  },
}, storage.byRoot)
assert.deepEqual(referencedFilesTurn.resources[0], {
  resourceId: '/by/.sessions/350860623218590448/过程报告.md',
  resourceType: 'COMMON_FILE',
  resourceName: '过程报告.md',
  referenceSource: 'session',
  filePath: '/srv/byclaw/by/.sessions/350860623218590448/过程报告.md',
})
assert.deepEqual(referencedFilesTurn.resources[1], {
  resourceId: '/by/.shared/共享规范.md',
  resourceType: 'COMMON_FILE',
  resourceName: '共享规范.md',
  referenceSource: 'shared',
  filePath: '/srv/byclaw/by/.shared/共享规范.md',
})
assert.deepEqual(referencedFilesTurn.resources[2], {
  resourceId: '/素材/需求说明.md',
  resourceType: 'COMMON_FILE',
  resourceName: '需求说明.md',
  referenceSource: 'project-cloud',
  filePath: '/素材/需求说明.md',
})
const referencedFilesDeclaration = byClawInboundTurnContextDeclaration(referencedFilesTurn)
assert.match(referencedFilesDeclaration, /resource_usage: .*session.*直接使用文件系统工具读取/u)
assert.match(referencedFilesDeclaration, /resource_usage: .*shared.*本地共享目录/u)
assert.match(referencedFilesDeclaration, /resource_usage: .*project-cloud.*project-context.*20014944.*project-cloud-knowledge.*\/素材\/需求说明\.md/u)

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
assert.match(first[1].content[0].text, /默认使用当前会话的过程文件目录/u)
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

const processWorkspace = { ...workspace, cwd: workspace.sessionRoot }
const oldContextLog = sessionLog([persistedContextEvent])
const updatedContext = appendByClawContext(oldContextLog, [userMessage], processWorkspace)
assert.equal(updatedContext.length, 2, 'a restored project context must receive the new cwd')
assert.ok(updatedContext[1].content[0].text.includes(`cwd: ${workspace.sessionRoot}`))
oldContextLog.appendEvent({ type: 'user/message', data: updatedContext[1] })
assert.deepEqual(appendByClawContext(oldContextLog, [userMessage], processWorkspace), [userMessage],
  'the new workspace declaration must be injected only once')

const delegated = appendByClawContext({
  header: { parentSession: 'parent' },
  ...sessionLog([{ type: 'seed/a' }, persistedContextEvent], 2),
}, [userMessage], workspace)
assert.equal(delegated.length, 2)
assert.deepEqual(delegated[1].source, { kind: 'plugin', plugin: 'byclaw-context' })

console.info('ByClaw session context verification passed')
