/** Dynamic ByClaw AI-model loading verification without model network calls. */

import { createCipheriv } from 'node:crypto'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import { normalizeContext } from '@earendil-works/pi-ai'
import * as ModelRuntime from '../lib/model-runtime.js'

const {
  ByClawDynamicModelRuntime,
  byClawReasoningFields,
  byClawPrologueModelId,
  decryptByClawAuthToken,
  resolveByClawLlmRequestLogLevel,
  resolveByClawProviderAdapter,
} = ModelRuntime

assert.equal(resolveByClawLlmRequestLogLevel(undefined, {}), 'off')
assert.equal(resolveByClawLlmRequestLogLevel(undefined, { DSH_LLM_LOG: 'info' }), 'info')
assert.equal(resolveByClawLlmRequestLogLevel('off', { DSH_LLM_LOG: 'invalid' }), 'off')
assert.equal(resolveByClawLlmRequestLogLevel('info', { DSH_LLM_LOG: 'invalid' }), 'info')
assert.throws(() => resolveByClawLlmRequestLogLevel(undefined, { DSH_LLM_LOG: 'invalid' }), /DSH_LLM_LOG/)

const openAIAdapter = resolveByClawProviderAdapter({ providerName: 'OpenAI', modelProtocol: 'OpenAI' })
const anthropicAdapter = resolveByClawProviderAdapter({ providerName: 'Anthropic', modelProtocol: 'Anthropic' })
const deepSeekAdapter = resolveByClawProviderAdapter({ providerName: 'DeepSeek', modelProtocol: 'OpenAI' })
const minimaxOpenAIAdapter = resolveByClawProviderAdapter({ providerName: 'MINIMAX', modelProtocol: 'OpenAI' })

const explicitRecord = {
  instanceId: '20010925',
  modelCode: 'deepseek-v4-flash',
  modelName: 'DeepSeek V4 Flash Anthropic',
  status: 1,
  url: 'https://model.example/anthropic',
  authToken: 'model-secret',
  maxContentToken: 128000,
  instanceParam: {
    providerName: 'Anthropic',
    modelProtocol: 'Anthropic',
    maxTokens: 8192,
    maxRetries: 0,
    abilities: ['3'],
    headers: [{ key: 'X-ByClaw-Route', value: 'writing' }],
    temperature: 0.2,
    topP: 0.8,
    frequencyPenalty: 0.1,
    presencePenalty: -0.1,
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'high',
      supportedEfforts: ['high', 'max'],
      effortMap: { high: 'provider-high', max: 'provider-maximum' },
      compatFormat: 'anthropic',
    },
  },
}
const defaultRecord = {
  instanceId: '10000482',
  modelCode: 'MiniMax-M3',
  modelName: 'MiniMax M3',
  modelType: 'LLM',
  status: 1,
  isDefault: 1,
  url: 'https://model.example/v1',
  authToken: 'default-secret',
  instanceParam: { providerName: 'OpenAI', modelProtocol: 'OpenAI', maxTokens: 4096, abilities: ['3', '7'] },
}

const defaultReasoningCompatibility = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    effortMap: { high: 'provider-high' },
    compatFormat: 'openai',
  },
}, openAIAdapter).compat
if (defaultReasoningCompatibility?.supportsDeveloperRole !== false) {
  throw new Error('ByClaw OpenAI-compatible models must default to the portable system role')
}
const explicitReasoningCompatibility = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    effortMap: { high: 'provider-high' },
    compatFormat: 'openai',
    supportsDeveloperRole: true,
  },
}, openAIAdapter).compat
if (explicitReasoningCompatibility?.supportsDeveloperRole !== true) {
  throw new Error('ByClaw model metadata did not enable the developer role explicitly')
}
const exactDeepSeek = deepSeekAdapter
assert.equal(exactDeepSeek.api, 'openai-completions')
assert.equal(exactDeepSeek.providerName, 'DeepSeek')
assert.equal(
  resolveByClawProviderAdapter({ providerName: 'DeepSeek', modelProtocol: 'Anthropic' }).api,
  'anthropic-messages',
  'a provider protocol override must use an explicit adapter rather than another provider identity',
)
assert.equal(
  resolveByClawProviderAdapter({ providerName: 'OpenAI', modelProtocol: 'OpenAI Responses' }).api,
  'openai-responses',
)
assert.equal(
  resolveByClawProviderAdapter({ providerName: 'OpenAI', modelProtocol: 'Anthropic' }).api,
  'anthropic-messages',
  'OpenAI supplier with an Anthropic protocol override must use the explicit Anthropic serializer',
)
assert.equal(
  resolveByClawProviderAdapter({ providerName: 'VOLCENGINE', modelProtocol: 'OpenAI' }).api,
  'openai-completions',
  'the built-in VOLCENGINE supplier must have an explicit completions adapter',
)
assert.equal(minimaxOpenAIAdapter.api, 'openai-completions')
assert.equal(minimaxOpenAIAdapter.nativeThinking, 'minimax-openai-adaptive',
  'MINIMAX + OpenAI must use its exact adaptive-thinking payload adapter')
assert.equal(anthropicAdapter.nativeThinking, 'anthropic-adaptive',
  'Anthropic + Anthropic must opt into pi-ai adaptive thinking without model-name matching')
assert.equal(
  resolveByClawProviderAdapter({ providerName: 'MINIMAX', modelProtocol: 'Anthropic' }).nativeThinking,
  'minimax-anthropic-adaptive',
  'MINIMAX + Anthropic must have its own supplier-native adaptive payload boundary',
)
for (const invalid of [
  { providerName: 'deepseek', modelProtocol: 'OpenAI' },
  { providerName: 'DeepSeek', modelProtocol: 'OpenAI Responses' },
  { providerName: 'Unknown', modelProtocol: 'OpenAI' },
]) {
  assert.throws(
    () => resolveByClawProviderAdapter(invalid),
    /BYCLAW_PROVIDER_ADAPTER_NOT_FOUND/,
    'provider/protocol matching must be exact and must not infer from either field',
  )
}

const strictReasoning = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['high', 'max'],
    effortMap: { high: 'wire-high-custom', max: 'wire-max-custom' },
    compatFormat: 'deepseek',
  },
}, deepSeekAdapter)
assert.equal(strictReasoning.thinkingLevelMap?.off, undefined, 'off must disable thinking by omitting an effort')
assert.equal(strictReasoning.thinkingLevelMap?.minimal, null, 'undeclared efforts must be strictly unsupported')
assert.equal(strictReasoning.thinkingLevelMap?.high, 'wire-high-custom', 'wire values must not be normalized')
assert.equal(strictReasoning.thinkingLevelMap?.max, 'wire-max-custom', 'extended wire values must be preserved')
const adaptiveReasoning = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'adaptive',
    defaultLevel: 'adaptive',
    supportedEfforts: ['adaptive', 'future-effort'],
    compatFormat: 'auto',
  },
}, minimaxOpenAIAdapter)
assert.equal(adaptiveReasoning.defaultLevel, undefined,
  'adaptive must stay a provider mode instead of being coerced into a pi-ai effort')
assert.equal(adaptiveReasoning.thinkingLevelMap?.high, null,
  'adaptive-only configuration must not invent canonical effort choices')
const adaptiveWithEffort = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'adaptive',
    defaultLevel: 'high',
    supportedEfforts: ['adaptive', 'high'],
    compatFormat: 'auto',
  },
}, minimaxOpenAIAdapter)
assert.equal(adaptiveWithEffort.defaultLevel, 'high')
assert.equal(adaptiveWithEffort.thinkingLevelMap?.high, 'high',
  'a canonical effort explicitly offered alongside adaptive must keep the normal pi-ai path')
const anthropicAdaptiveReasoning = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'adaptive',
    defaultLevel: 'high',
    supportedEfforts: ['low', 'high', 'xhigh', 'max'],
    compatFormat: 'auto',
  },
}, anthropicAdapter)
assert.equal(anthropicAdaptiveReasoning.compat?.forceAdaptiveThinking, true,
  'exact Anthropic adaptive configuration must enable pi-ai native adaptive serialization')
assert.equal(byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    compatFormat: 'auto',
  },
}, anthropicAdapter).compat, undefined,
'non-adaptive Anthropic configuration must retain the legacy enabled+budget serializer')
assert.equal(byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'adaptive',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    compatFormat: 'auto',
  },
}, resolveByClawProviderAdapter({ providerName: 'MINIMAX', modelProtocol: 'Anthropic' })).compat, undefined,
'MINIMAX + Anthropic must not inherit the Anthropic supplier adaptive override')
assert.equal(byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'future-effort',
    supportedEfforts: ['high', 'future-effort'],
    compatFormat: 'openai',
  },
}, openAIAdapter).defaultLevel, undefined,
'a default outside the local pi-ai union must be ignored instead of coerced or rejected')
for (const compatFormat of ['anthropic', 'unknown-format']) {
  assert.throws(() => byClawReasoningFields({
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'high',
      supportedEfforts: ['high'],
      effortMap: { high: 'wire-high' },
      compatFormat,
    },
  }, openAIAdapter), /BYCLAW_REASONING_CONFIG_INVALID/,
  `OpenAI-compatible reasoning must reject ${compatFormat} instead of falling back to auto-detection`)
}
const autoDeepSeek = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['low', 'high', 'max'],
    compatFormat: 'auto',
  },
}, deepSeekAdapter)
assert.equal(autoDeepSeek.compat?.thinkingFormat, 'deepseek')
assert.equal(autoDeepSeek.thinkingLevelMap?.low, 'high')
assert.equal(autoDeepSeek.thinkingLevelMap?.high, 'high')
assert.equal(autoDeepSeek.thinkingLevelMap?.max, 'max')
const emptySupported = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'medium',
    supportedEfforts: [],
    compatFormat: 'openai',
  },
}, openAIAdapter)
for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
  assert.equal(emptySupported.thinkingLevelMap?.[level], level,
    'empty supportedEfforts must expose every canonical pi-ai level')
}
const bailianBudget = byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'budget',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    budgets: { high: 2048 },
    compatFormat: 'bailian',
  },
}, openAIAdapter)
assert.equal(bailianBudget.compat?.thinkingFormat, 'qwen')
assert.equal(bailianBudget.compat?.thinkingTokenBudgetField, 'thinking_budget')
for (const [supportedEfforts, budgets, missing] of [
  [['high'], {}, 'high'],
  [['high', 'max'], { high: 2048 }, 'max'],
]) {
  assert.throws(() => byClawReasoningFields({
    reasoningConfig: {
      enabled: true,
      capability: 'budget',
      defaultLevel: 'high',
      supportedEfforts,
      budgets,
      compatFormat: 'bailian',
    },
  }, openAIAdapter), new RegExp(`BYCLAW_REASONING_CONFIG_INVALID: budget effort ${missing}`),
  'every supported budget effort must have a ByClaw-configured positive integer budget')
}
assert.doesNotThrow(() => byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    effortMap: { high: 'wire-high' },
    compatFormat: 'anthropic',
  },
}, anthropicAdapter))
assert.doesNotThrow(() => byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    effortMap: { high: 'wire-high' },
    compatFormat: 'deepseek',
  },
}, anthropicAdapter), 'Anthropic transport must accept a known backend compat label as non-wire metadata')
assert.throws(() => byClawReasoningFields({
  reasoningConfig: {
    enabled: true,
    capability: 'effort',
    defaultLevel: 'high',
    supportedEfforts: ['high'],
    effortMap: { high: 'wire-high' },
    compatFormat: 'unknown-format',
  },
}, anthropicAdapter), /BYCLAW_REASONING_CONFIG_INVALID/,
'Anthropic transport must still reject unknown compat metadata')
const values = new Map([
  ['byai:aimodel:config\0' + explicitRecord.instanceId, JSON.stringify(explicitRecord)],
  ['byai:aimodel:typelist\0LLM', JSON.stringify([defaultRecord])],
])
let redisReads = 0
const redis = {
  async hget(key, field) {
    redisReads += 1
    return values.get(`${key}\0${field}`) ?? null
  },
}
const registrations = []
const warnings = []
const requestAudits = []
let throwRequestAuditLog = false
const imageRef = {
  attachmentId: `sha256:${'0'.repeat(64)}`,
  mediaType: 'image/png',
  width: 1,
  height: 1,
}
const imageHostPath = '/attachments/image.png'
const imageReadonlyPath = '/workspace/.attachments/image.png'
const attachments = {
  imageHostPath(ref) {
    assert.equal(ref, imageRef)
    return imageHostPath
  },
}
const ctx = {
  logger: {
    warn(message) { warnings.push(message) },
    info(message, record) {
      if (String(message).includes('LLM provider request audit')) requestAudits.push(record)
      if (throwRequestAuditLog) throw new Error('request audit logger failed')
    },
  },
  get(name) {
    if (name === 'attachments') return attachments
    if (name === 'fs') {
      return {
        processPathFromHostPath(hostPath) {
          assert.equal(hostPath, imageHostPath)
          return imageReadonlyPath
        },
      }
    }
    return undefined
  },
  llm: {
    registerAdapter(routes, adapter) {
      const registration = { routes: [...routes], adapter }
      registrations.push(registration)
      const dispose = () => undefined
      dispose.replace = next => { registration.routes = [...next] }
      return dispose
    },
  },
}

const wireRequests = []
const wireResponses = []
const wireServer = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk.toString('utf8') })
  request.on('end', () => {
    const parsedBody = JSON.parse(body)
    wireRequests.push({ path: request.url, headers: request.headers, body: parsedBody })
    const respond = () => {
      if (response.destroyed) return
      wireResponses.push(parsedBody.model)
      if (request.url.endsWith('/responses') || request.url.endsWith('/messages')) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'expected audit verifier response' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of [
        '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
        '{"choices":[{"delta":{"content":"wire-ok"},"index":0,"finish_reason":null}]}',
        '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
        '[DONE]',
      ]) response.write(`data: ${event}\n\n`)
      response.end()
    }
    if (request.headers['x-byclaw-wire'] === 'connect-timeout') {
      const timer = setTimeout(respond, 3_000)
      response.once('close', () => { clearTimeout(timer) })
    } else respond()
  })
})
await new Promise(resolve => wireServer.listen(0, '127.0.0.1', resolve))
const wireAddress = wireServer.address()
if (wireAddress === null || typeof wireAddress === 'string') throw new Error('wire test server did not bind')
const wireBaseUrl = `http://127.0.0.1:${wireAddress.port}/v1`
const deepSeekWireRecord = {
  instanceId: 'wire-deepseek',
  modelCode: 'deepseek-online-id',
  modelName: 'DeepSeek wire model',
  status: 1,
  url: wireBaseUrl,
  authToken: 'wire-deepseek-token',
  instanceParam: {
    providerName: 'DeepSeek',
    modelProtocol: 'OpenAI',
    connectTimeoutSec: 2,
    headers: [{ key: 'X-ByClaw-Wire', value: 'deepseek' }],
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'high',
      supportedEfforts: ['low', 'high', 'max'],
      compatFormat: 'auto',
    },
  },
}
const bailianWireRecord = {
  instanceId: 'wire-bailian',
  modelCode: 'bailian-online-id',
  modelName: 'Bailian wire model',
  status: 1,
  url: wireBaseUrl,
  authToken: 'wire-bailian-token',
  instanceParam: {
    providerName: 'Qwen',
    modelProtocol: 'OpenAI',
    maxTokens: 65536,
    headers: [{ key: 'X-ByClaw-Wire', value: 'bailian' }],
    reasoningConfig: {
      enabled: true,
      capability: 'budget',
      defaultLevel: 'high',
      supportedEfforts: ['high', 'max'],
      budgets: { high: 2048, max: 32768 },
      compatFormat: 'bailian',
    },
  },
}
const bailianDeepSeekWireRecord = {
  ...deepSeekWireRecord,
  instanceId: 'wire-bailian-deepseek',
  modelCode: 'bailian-deepseek-online-id',
  instanceParam: {
    ...deepSeekWireRecord.instanceParam,
    reasoningConfig: { ...deepSeekWireRecord.instanceParam.reasoningConfig, compatFormat: 'bailian' },
  },
}
const bailianEffortWireRecord = {
  ...bailianWireRecord,
  instanceId: 'wire-bailian-effort',
  modelCode: 'bailian-effort-online-id',
  authToken: 'wire-bailian-effort-token',
  instanceParam: {
    ...bailianWireRecord.instanceParam,
    headers: [{ key: 'X-ByClaw-Wire', value: 'bailian-effort' }],
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'high',
      supportedEfforts: ['high'],
      effortMap: { high: 'provider-high' },
      compatFormat: 'bailian',
    },
  },
}
const missingExtendedBudgetRecord = {
  ...bailianWireRecord,
  instanceId: 'wire-bailian-missing-max-budget',
  modelCode: 'bailian-missing-max-budget',
  authToken: 'wire-bailian-missing-budget-token',
  instanceParam: {
    ...bailianWireRecord.instanceParam,
    reasoningConfig: {
      ...bailianWireRecord.instanceParam.reasoningConfig,
      budgets: { high: 2048 },
    },
  },
}
const binaryOpenAIWireRecord = {
  instanceId: 'wire-openai-binary',
  modelCode: 'binary-openai-online-id',
  modelName: 'OpenAI binary thinking model',
  status: 1,
  url: wireBaseUrl,
  authToken: 'wire-openai-binary-token',
  instanceParam: {
    providerName: 'OpenAI',
    modelProtocol: 'OpenAI',
    maxTokens: 8192,
    headers: [{ key: 'X-ByClaw-Wire', value: 'openai-binary' }],
    reasoningConfig: {
      enabled: true,
      capability: 'binary',
      defaultLevel: 'high',
      supportedEfforts: ['high'],
      compatFormat: 'auto',
    },
  },
}
const minimaxAdaptiveWireRecord = {
  instanceId: 'wire-minimax-adaptive',
  modelCode: 'MiniMax-M3',
  modelName: 'MiniMax M3 adaptive wire model',
  status: 1,
  url: wireBaseUrl,
  authToken: 'wire-minimax-token',
  instanceParam: {
    providerName: 'MINIMAX',
    modelProtocol: 'OpenAI',
    maxTokens: 8192,
    headers: [{ key: 'X-ByClaw-Wire', value: 'minimax-adaptive' }],
    reasoningConfig: {
      enabled: true,
      capability: 'adaptive',
      defaultLevel: 'adaptive',
      supportedEfforts: ['adaptive', 'high'],
      compatFormat: 'auto',
    },
  },
}
const connectTimeoutWireRecord = {
  instanceId: 'wire-connect-timeout',
  modelCode: 'connect-timeout-online-id',
  modelName: 'Connection timeout model',
  status: 1,
  url: wireBaseUrl,
  authToken: 'wire-connect-timeout-token',
  instanceParam: {
    providerName: 'OpenAI',
    modelProtocol: 'OpenAI',
    connectTimeoutSec: 1,
    readTimeoutSec: 5,
    maxRetries: 0,
    headers: [{ key: 'X-ByClaw-Wire', value: 'connect-timeout' }],
  },
}
const responsesWireRecord = {
  instanceId: 'wire-openai-responses',
  modelCode: 'responses-online-id',
  modelName: 'OpenAI Responses wire model',
  status: 1,
  url: wireBaseUrl,
  authToken: 'wire-responses-token',
  instanceParam: {
    providerName: 'OpenAI',
    modelProtocol: 'OpenAI Responses',
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'high',
      supportedEfforts: ['high'],
      effortMap: { high: 'provider-high' },
      compatFormat: 'openai',
    },
  },
}
const anthropicWireRecord = {
  instanceId: 'wire-anthropic',
  modelCode: 'anthropic-online-id',
  modelName: 'Anthropic wire model',
  status: 1,
  url: wireBaseUrl,
  authToken: 'wire-anthropic-token',
  instanceParam: {
    providerName: 'Anthropic',
    modelProtocol: 'Anthropic',
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'high',
      supportedEfforts: ['high'],
      effortMap: { high: 'provider-high' },
      compatFormat: 'anthropic',
    },
  },
}
const anthropicAdaptiveWireRecord = {
  ...anthropicWireRecord,
  instanceId: 'wire-anthropic-adaptive',
  modelCode: 'anthropic-adaptive-online-id',
  modelName: 'Anthropic adaptive wire model',
  authToken: 'wire-anthropic-adaptive-token',
  instanceParam: {
    ...anthropicWireRecord.instanceParam,
    reasoningConfig: {
      enabled: true,
      capability: 'adaptive',
      defaultLevel: 'high',
      supportedEfforts: ['low', 'high', 'xhigh', 'max'],
      compatFormat: 'auto',
    },
  },
}
const anthropicAdaptiveDefaultWireRecord = {
  ...anthropicAdaptiveWireRecord,
  instanceId: 'wire-anthropic-adaptive-default',
  modelCode: 'anthropic-adaptive-default-online-id',
  authToken: 'wire-anthropic-adaptive-default-token',
  instanceParam: {
    ...anthropicAdaptiveWireRecord.instanceParam,
    reasoningConfig: {
      ...anthropicAdaptiveWireRecord.instanceParam.reasoningConfig,
      defaultLevel: 'adaptive',
      supportedEfforts: ['adaptive'],
    },
  },
}
const minimaxAnthropicAdaptiveWireRecord = {
  ...anthropicAdaptiveDefaultWireRecord,
  instanceId: 'wire-minimax-anthropic-adaptive',
  modelCode: 'MiniMax-M3-anthropic',
  modelName: 'MiniMax M3 Anthropic adaptive wire model',
  authToken: 'wire-minimax-anthropic-token',
  instanceParam: {
    ...anthropicAdaptiveDefaultWireRecord.instanceParam,
    providerName: 'MINIMAX',
    modelProtocol: 'Anthropic',
  },
}
// Fixtures preserve the two active production provider/protocol shapes that
// previously fell outside the adapter/reasoning matrix.
const openAIAnthropicFixture = {
  instanceId: '10109779',
  modelCode: 'openai-supplier-anthropic-wire',
  modelName: 'OpenAI supplier via Anthropic protocol',
  status: 1,
  url: 'https://model.example/anthropic-override',
  authToken: 'openai-anthropic-secret',
  instanceParam: {
    providerName: 'OpenAI',
    modelProtocol: 'Anthropic',
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'medium',
      supportedEfforts: [],
      compatFormat: 'auto',
    },
  },
}
const anthropicDeepSeekMetadataFixture = {
  instanceId: '20020386',
  modelCode: 'anthropic-wire-deepseek-metadata',
  modelName: 'Anthropic protocol with legacy DeepSeek metadata',
  status: 1,
  url: 'https://model.example/anthropic',
  authToken: 'anthropic-deepseek-metadata-secret',
  instanceParam: {
    providerName: 'Anthropic',
    modelProtocol: 'Anthropic',
    reasoningConfig: {
      enabled: true,
      capability: 'effort',
      defaultLevel: 'high',
      supportedEfforts: ['high'],
      compatFormat: 'deepseek',
    },
  },
}
values.set(`byai:aimodel:config\0${deepSeekWireRecord.instanceId}`, JSON.stringify(deepSeekWireRecord))
values.set(`byai:aimodel:config\0${bailianWireRecord.instanceId}`, JSON.stringify(bailianWireRecord))
values.set(`byai:aimodel:config\0${bailianDeepSeekWireRecord.instanceId}`, JSON.stringify(bailianDeepSeekWireRecord))
values.set(`byai:aimodel:config\0${bailianEffortWireRecord.instanceId}`, JSON.stringify(bailianEffortWireRecord))
values.set(`byai:aimodel:config\0${missingExtendedBudgetRecord.instanceId}`, JSON.stringify(missingExtendedBudgetRecord))
values.set(`byai:aimodel:config\0${binaryOpenAIWireRecord.instanceId}`, JSON.stringify(binaryOpenAIWireRecord))
values.set(`byai:aimodel:config\0${minimaxAdaptiveWireRecord.instanceId}`, JSON.stringify(minimaxAdaptiveWireRecord))
values.set(`byai:aimodel:config\0${connectTimeoutWireRecord.instanceId}`, JSON.stringify(connectTimeoutWireRecord))
values.set(`byai:aimodel:config\0${responsesWireRecord.instanceId}`, JSON.stringify(responsesWireRecord))
values.set(`byai:aimodel:config\0${anthropicWireRecord.instanceId}`, JSON.stringify(anthropicWireRecord))
values.set(`byai:aimodel:config\0${anthropicAdaptiveWireRecord.instanceId}`, JSON.stringify(anthropicAdaptiveWireRecord))
values.set(`byai:aimodel:config\0${anthropicAdaptiveDefaultWireRecord.instanceId}`, JSON.stringify(anthropicAdaptiveDefaultWireRecord))
values.set(`byai:aimodel:config\0${minimaxAnthropicAdaptiveWireRecord.instanceId}`, JSON.stringify(minimaxAnthropicAdaptiveWireRecord))
values.set(`byai:aimodel:config\0${openAIAnthropicFixture.instanceId}`, JSON.stringify(openAIAnthropicFixture))
values.set(`byai:aimodel:config\0${anthropicDeepSeekMetadataFixture.instanceId}`, JSON.stringify(anthropicDeepSeekMetadataFixture))

if (byClawPrologueModelId({ prologue: JSON.stringify({ modelId: 20010925 }) }) !== '20010925') {
  throw new Error('string prologue model id was not normalized')
}
if (typeof ModelRuntime.resolveByClawRedisModelsEnabled !== 'function') {
  throw new Error('Redis model environment switch was not implemented')
}
for (const value of [undefined, '', 'true', '1', 'on', 'yes']) {
  if (ModelRuntime.resolveByClawRedisModelsEnabled(value) !== true) {
    throw new Error(`Redis model switch did not enable ${String(value)}`)
  }
}
for (const value of ['false', '0', 'off', 'no']) {
  if (ModelRuntime.resolveByClawRedisModelsEnabled(value) !== false) {
    throw new Error(`Redis model switch did not disable ${value}`)
  }
}
try {
  ModelRuntime.resolveByClawRedisModelsEnabled('sometimes')
  throw new Error('invalid Redis model switch was accepted')
} catch (error) {
  if (!String(error).includes('BYCLAW_REDIS_MODEL_ENABLED')) throw error
}

const readsBeforeLocal = redisReads
const localRuntime = new ByClawDynamicModelRuntime(ctx, redis, {
  provider: 'local-provider',
  model: 'local-model',
  redisModelsEnabled: false,
})
const localEmployee = await localRuntime.resolve('employee:local', '20010925')
const localRoot = await localRuntime.resolve('root:local')
if (localEmployee.provider !== 'local-provider' || localEmployee.model !== 'local-model'
  || localEmployee.resolution !== 'local'
  || localRoot.provider !== 'local-provider' || localRoot.model !== 'local-model'
  || localRoot.resolution !== 'local'
  || redisReads !== readsBeforeLocal) {
  throw new Error('disabled Redis model resolution did not use the local model exclusively')
}
try {
  new ByClawDynamicModelRuntime(ctx, redis, { redisModelsEnabled: false })
  throw new Error('disabled Redis models accepted missing local provider/model')
} catch (error) {
  if (!String(error).includes('local provider and model')) throw error
}

const runtime = new ByClawDynamicModelRuntime(ctx, redis, { provider: 'static-fallback', model: 'fallback-model' })
const employee = await runtime.resolve('employee:1', '20010925')
if (employee.provider !== 'baiying-m-20010925' || employee.model !== 'deepseek-v4-flash'
  || employee.protocol !== 'anthropic-messages' || employee.resolution !== 'explicit') {
  throw new Error('explicit employee model did not become its Anthropic DSH route')
}
const employeeHigh = await runtime.resolve('employee:thinking', '20010925', 'high')
assert.equal(employeeHigh.reasoningEffort, 'high', 'the per-turn thinking level must reach DSH ModelSelection')
const employeeOff = await runtime.resolve('employee:thinking-off', '20010925', 'off')
assert.equal(employeeOff.reasoningEffort, 'off', 'the per-turn off choice must reach DSH ModelSelection')
const employeeFutureEffort = await runtime.resolve('employee:thinking-future', '20010925', 'future-effort')
assert.equal(employeeFutureEffort.reasoningEffort, undefined,
  'a value outside the DSH/pi-ai reasoningEffort union must be ignored without failing the session')
await assert.rejects(
  runtime.resolve('employee:thinking-invalid', '20010925', 'medium'),
  /BYCLAW_UNSUPPORTED_REASONING_EFFORT/,
  'supportedEfforts must be a strict per-turn whitelist',
)
const main = await runtime.resolve('root:user')
if (main.provider !== 'baiying-m-10000482' || main.model !== 'MiniMax-M3'
  || main.protocol !== 'openai-completions' || main.resolution !== 'default') {
  throw new Error('root Agent did not resolve the Redis default LLM')
}
const disabledThinkingOff = await runtime.resolve('root:thinking-disabled-off', undefined, 'off')
assert.equal(disabledThinkingOff.reasoningEffort, undefined,
  'a non-reasoning model must omit off so DSH capability validation accepts the turn')
const disabledThinkingStaleHigh = await runtime.resolve('root:thinking-disabled-stale', undefined, 'high')
assert.equal(disabledThinkingStaleHigh.reasoningEffort, undefined,
  'a non-reasoning model must ignore a stale non-off session effort instead of rejecting the turn')
if (registrations[0]?.routes.join(',') !== 'baiying-m-10000482,baiying-m-20010925') {
  throw new Error('dynamic DSH provider routes were not atomically expanded')
}
if (JSON.stringify({ employee, main }).includes('model-secret') || JSON.stringify({ employee, main }).includes('default-secret')) {
  throw new Error('model credentials leaked into selections')
}

// Exercise the real DSH adapter consuming our pi-ai providers, rather than only
// observing registration: incompatible provider contracts fail at this boundary.
const adapter = registrations[0].adapter
assert.equal(
  adapter.config.resolveAttachments?.(),
  attachments,
  'dynamic model adapter did not resolve the durable attachment service',
)
assert.deepEqual(
  adapter.config.resolveImageAccess?.(attachments, imageRef),
  { readonlyPath: imageReadonlyPath },
  'dynamic model adapter did not bridge image attachments into the tool execution world',
)
assert.deepEqual(await adapter.listModels(employee.provider), [{
  provider: 'baiying-m-20010925',
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash Anthropic',
  inputModalities: ['text'],
}])
assert.deepEqual(await adapter.resolveModel(main.provider, main.model), {
  provider: 'baiying-m-10000482',
  id: 'MiniMax-M3',
  name: 'MiniMax M3',
  inputModalities: ['text', 'image'],
  context: { contextWindow: 128000 },
  defaultMaxTokens: 4096,
})
const preparedEmployee = await adapter.prepareCall(employee.provider, employee.model)
assert.equal(preparedEmployee.model.defaultMaxTokens, 8192)
assert.equal(preparedEmployee.model.reasoning.defaultEffort, 'high')
assert.ok(preparedEmployee.model.reasoning.efforts.some(effort => effort.id === 'high'))
assert.ok(preparedEmployee.model.reasoning.efforts.some(effort => effort.id === 'max'))
const employeeProfile = adapter.config.profiles().get(employee.provider)
assert.equal(employeeProfile.retryPolicy.maxRetries, 0, 'maxRetries=0 must disable retries instead of restoring defaults')
const employeePiModel = employeeProfile.piProvider.getModels()[0]
assert.equal(employeePiModel.id, explicitRecord.modelCode, 'modelCode must be used verbatim without catalog lookup')
assert.equal(employeePiModel.name, explicitRecord.modelName, 'displayName must only become the dynamic model name')
assert.equal(employeePiModel.baseUrl, explicitRecord.url, 'the ByClaw instance URL must override provider defaults')
assert.deepEqual(employeePiModel.headers, { 'X-ByClaw-Route': 'writing' })
assert.deepEqual(employeePiModel.samplingParams, {
  temperature: 0.2,
  top_p: 0.8,
  frequency_penalty: 0.1,
  presence_penalty: -0.1,
})
assert.equal(employeePiModel.thinkingLevelMap.high, 'provider-high')
assert.equal(employeePiModel.thinkingLevelMap.max, 'provider-maximum')

const openAIAnthropic = await runtime.resolve('production-shape:10109779', '10109779', 'medium')
assert.equal(openAIAnthropic.protocol, 'anthropic-messages')
assert.equal(openAIAnthropic.semanticProvider, 'OpenAI')
const anthropicDeepSeekMetadata = await runtime.resolve('production-shape:20020386', '20020386', 'high')
assert.equal(anthropicDeepSeekMetadata.protocol, 'anthropic-messages')
assert.equal(anthropicDeepSeekMetadata.semanticProvider, 'Anthropic')
const anthropicMetadataModel = adapter.config.profiles()
  .get(anthropicDeepSeekMetadata.provider).piProvider.getModels()[0]
assert.equal(anthropicMetadataModel.compat, undefined,
  'OpenAI compat metadata must not alter an Anthropic serializer model')

// Exercise the actual pi-ai serializer and SSE parser. This catches route-id
// auto-detection regressions that profile-only assertions cannot see.
try {
  for (const [record, expected] of [
    [deepSeekWireRecord, {
      level: 'high',
      authorization: 'Bearer wire-deepseek-token', header: 'deepseek',
      thinking: { type: 'enabled' }, reasoningEffort: 'high', thinkingBudget: undefined,
    }],
    [bailianWireRecord, {
      level: 'high',
      authorization: 'Bearer wire-bailian-token', header: 'bailian',
      thinking: undefined, reasoningEffort: undefined, thinkingBudget: 2048,
    }],
    [bailianWireRecord, {
      level: 'max',
      authorization: 'Bearer wire-bailian-token', header: 'bailian',
      thinking: undefined, reasoningEffort: undefined, thinkingBudget: 32768,
    }],
    [bailianEffortWireRecord, {
      level: 'high',
      authorization: 'Bearer wire-bailian-effort-token', header: 'bailian-effort',
      thinking: undefined, reasoningEffort: 'provider-high', thinkingBudget: undefined,
    }],
    [binaryOpenAIWireRecord, {
      level: 'high',
      authorization: 'Bearer wire-openai-binary-token', header: 'openai-binary',
      thinking: undefined, reasoningEffort: 'high', thinkingBudget: undefined,
    }],
    [binaryOpenAIWireRecord, {
      level: 'off',
      authorization: 'Bearer wire-openai-binary-token', header: 'openai-binary',
      thinking: undefined, reasoningEffort: undefined, thinkingBudget: undefined,
    }],
    [minimaxAdaptiveWireRecord, {
      level: 'adaptive',
      authorization: 'Bearer wire-minimax-token', header: 'minimax-adaptive',
      thinking: { type: 'adaptive' }, reasoningEffort: undefined, thinkingBudget: undefined,
      reasoningSplit: true,
    }],
    [minimaxAdaptiveWireRecord, {
      level: 'high',
      authorization: 'Bearer wire-minimax-token', header: 'minimax-adaptive',
      thinking: { type: 'adaptive' }, reasoningEffort: undefined, thinkingBudget: undefined,
      reasoningSplit: true,
    }],
  ]) {
    const selection = await runtime.resolve(`wire:${record.instanceId}:${expected.level}`, record.instanceId, expected.level)
    if (expected.level === 'adaptive') {
      assert.equal(selection.reasoningEffort, undefined,
        'adaptive must not be forced into the finite DSH reasoningEffort type')
    }
    const profile = adapter.config.profiles().get(selection.provider)
    const piModel = profile.piProvider.getModels()[0]
    let done
    for await (const event of profile.piProvider.streamSimple(
      piModel,
      { messages: [{ role: 'user', content: 'verify wire shape', timestamp: 0 }] },
      {
        apiKey: record.authToken,
        ...(expected.level === 'adaptive' ? {}
          : { reasoning: expected.level }),
        thinkingBudgets: profile.thinkingBudgets,
      },
    )) {
      if (event.type === 'done') done = event
    }
    assert.equal(done?.message.content.some(block => block.type === 'text' && block.text === 'wire-ok'), true,
      'pi-ai must parse the local SSE response into a completed assistant message')
    const request = wireRequests.at(-1)
    assert.equal(request.path, '/v1/chat/completions')
    assert.equal(request.headers.authorization, expected.authorization)
    assert.equal(request.headers['x-byclaw-wire'], expected.header)
    assert.equal(request.body.model, record.modelCode)
    assert.deepEqual(request.body.thinking, expected.thinking)
    assert.equal(request.body.reasoning_effort, expected.reasoningEffort)
    assert.equal(request.body.thinking_budget, expected.thinkingBudget)
    assert.equal(request.body.reasoning_split, expected.reasoningSplit)
    if (record === bailianWireRecord || record === bailianEffortWireRecord) {
      assert.equal(request.body.enable_thinking, true)
    }
  }
  const devflowTools = [
    { name: 'devflow_show', description: 'Show a card', parameters: { type: 'object', properties: {} } },
    { name: 'devflow_read_spec', description: 'Read one spec unchanged', parameters: { type: 'object', properties: { id: { type: 'string' } } } },
    { name: 'devflow_record_iron_rule', description: 'Record one rule unchanged', parameters: { type: 'object', properties: { id: { type: 'string' } } } },
    { name: 'devflow_write_spec', description: 'Write one spec unchanged', parameters: { type: 'object', properties: {} } },
  ]
  const serializedToolDefinitions = []
  for (const [record, expectedNames] of [
    [bailianWireRecord, ['devflow_show', 'devflow_record_iron_rule', 'devflow_read_spec', 'devflow_write_spec']],
    [bailianDeepSeekWireRecord, ['devflow_show', 'devflow_record_iron_rule', 'devflow_read_spec', 'devflow_write_spec']],
    [deepSeekWireRecord, devflowTools.map(tool => tool.name)],
  ]) {
    const selection = await runtime.resolve(`wire:devflow-tool-order:${record.instanceId}`, record.instanceId)
    const profile = adapter.config.profiles().get(selection.provider)
    for await (const _event of profile.piProvider.streamSimple(
      profile.piProvider.getModels()[0],
      // pi-ai 1.x providers take a normalized transcript; tools ride its leading system message.
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 0 }], tools: devflowTools }),
      { apiKey: record.authToken, maxRetries: 0 },
    )) { /* consume the response so the request reaches the wire server */ }
    const wireTools = wireRequests.at(-1).body.tools
    assert.deepEqual(wireTools.map(tool => tool.function.name), expectedNames)
    serializedToolDefinitions.push([...wireTools].sort((left, right) => left.function.name.localeCompare(right.function.name)))
    assert.deepEqual(
      wireTools.map(tool => tool.function.description).sort(),
      devflowTools.map(tool => tool.description).sort(),
      'the compatibility ordering must preserve every tool definition unchanged',
    )
  }
  assert.deepEqual(serializedToolDefinitions[0], serializedToolDefinitions[1],
    'Bailian DeepSeek and Qwen routes must keep the same serialized tool schemas')
  assert.deepEqual(serializedToolDefinitions[0], serializedToolDefinitions[2],
    'Bailian compatibility must change only tool order, not the serialized schemas')
  // Exercise the real registered adapter for `off`: PiAiAdapter removes that
  // value before its provider options, so only the integration's per-request
  // context can preserve the explicit disabled intent without shared state.
  const minimaxOff = await runtime.resolve(
    'wire:minimax:off-real-adapter', minimaxAdaptiveWireRecord.instanceId, 'off',
  )
  const preparedMinimaxOff = await adapter.prepareCall(minimaxOff.provider, minimaxOff.model)
  for await (const _event of preparedMinimaxOff.stream({
    provider: minimaxOff.provider,
    model: minimaxOff.model,
    reasoningEffort: 'off',
    messages: [],
  })) {
    // Consumption proves the prepared-call path carries the request-local mode.
  }
  assert.deepEqual(wireRequests.at(-1).body.thinking, { type: 'disabled' })
  assert.equal(wireRequests.at(-1).body.reasoning_split, true)
  assert.equal(wireRequests.at(-1).body.reasoning_effort, undefined)
  const requestsBeforeConcurrentModes = wireRequests.length
  await Promise.all([
    (async () => {
      for await (const _event of preparedMinimaxOff.stream({
        provider: minimaxOff.provider,
        model: minimaxOff.model,
        reasoningEffort: 'off',
        messages: [],
      })) { /* consume */ }
    })(),
    (async () => {
      for await (const _event of preparedMinimaxOff.stream({
        provider: minimaxOff.provider,
        model: minimaxOff.model,
        messages: [],
      })) { /* consume */ }
    })(),
  ])
  assert.deepEqual(
    wireRequests.slice(requestsBeforeConcurrentModes).map(request => request.body.thinking?.type).sort(),
    ['adaptive', 'disabled'],
    'concurrent MiniMax calls must keep their request-local thinking modes isolated',
  )

  const dispatchThroughRegisteredAdapter = async (record, requestedLevel) => {
    const selection = await runtime.resolve(
      `wire:registered:${record.instanceId}:${requestedLevel ?? 'default'}`,
      record.instanceId,
      requestedLevel,
    )
    const prepared = await adapter.prepareCall(selection.provider, selection.model)
    for await (const _event of prepared.stream({
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      messages: [],
    })) { /* consume */ }
    return { selection, request: wireRequests.at(-1) }
  }

  const anthropicDefaultAdaptive = await dispatchThroughRegisteredAdapter(
    anthropicAdaptiveDefaultWireRecord,
  )
  assert.deepEqual(anthropicDefaultAdaptive.request.body.thinking,
    { type: 'adaptive', display: 'summarized' })
  assert.equal(anthropicDefaultAdaptive.request.body.output_config, undefined,
    'default adaptive is a native mode and must not invent an effort')

  const anthropicDefaultHigh = await dispatchThroughRegisteredAdapter(anthropicAdaptiveWireRecord)
  assert.deepEqual(anthropicDefaultHigh.request.body.thinking,
    { type: 'adaptive', display: 'summarized' })
  assert.deepEqual(anthropicDefaultHigh.request.body.output_config, { effort: 'high' })

  const anthropicExplicitAdaptive = await dispatchThroughRegisteredAdapter(
    anthropicAdaptiveWireRecord,
    'adaptive',
  )
  assert.match(anthropicExplicitAdaptive.selection.provider, /:adaptive$/,
    'explicit adaptive over a canonical default must use an immutable native-mode route')
  assert.equal(anthropicExplicitAdaptive.selection.reasoningEffort, undefined)
  assert.deepEqual(anthropicExplicitAdaptive.request.body.thinking,
    { type: 'adaptive', display: 'summarized' })
  assert.equal(anthropicExplicitAdaptive.request.body.output_config, undefined,
    'explicit adaptive must override the configured default effort')

  for (const effort of ['low', 'high', 'max']) {
    const anthropicEffort = await dispatchThroughRegisteredAdapter(anthropicAdaptiveWireRecord, effort)
    assert.deepEqual(anthropicEffort.request.body.thinking,
      { type: 'adaptive', display: 'summarized' })
    assert.deepEqual(anthropicEffort.request.body.output_config, { effort })
  }

  const anthropicOff = await dispatchThroughRegisteredAdapter(anthropicAdaptiveWireRecord, 'off')
  assert.deepEqual(anthropicOff.request.body.thinking, { type: 'disabled' })
  assert.equal(anthropicOff.request.body.output_config, undefined)

  const concurrentAnthropicStart = wireRequests.length
  await Promise.all([
    dispatchThroughRegisteredAdapter(anthropicAdaptiveWireRecord, 'adaptive'),
    dispatchThroughRegisteredAdapter(anthropicAdaptiveWireRecord, 'high'),
    dispatchThroughRegisteredAdapter(anthropicAdaptiveWireRecord, 'off'),
  ])
  assert.deepEqual(
    wireRequests.slice(concurrentAnthropicStart).map(request => ({
      thinking: request.body.thinking,
      effort: request.body.output_config?.effort,
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    [
      { thinking: { type: 'adaptive', display: 'summarized' }, effort: undefined },
      { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' },
      { thinking: { type: 'disabled' }, effort: undefined },
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    'concurrent Anthropic calls must isolate adaptive, canonical effort, and off modes',
  )

  const minimaxAnthropic = await dispatchThroughRegisteredAdapter(minimaxAnthropicAdaptiveWireRecord)
  assert.deepEqual(minimaxAnthropic.request.body.thinking, { type: 'adaptive' })
  assert.equal(minimaxAnthropic.request.body.output_config, undefined)
  assert.equal(minimaxAnthropic.request.body.reasoning_split, undefined)
  const minimaxAnthropicOff = await dispatchThroughRegisteredAdapter(
    minimaxAnthropicAdaptiveWireRecord,
    'off',
  )
  assert.deepEqual(minimaxAnthropicOff.request.body.thinking, { type: 'disabled' })
  assert.equal(minimaxAnthropicOff.request.body.output_config, undefined)
  assert.equal(minimaxAnthropicOff.request.body.reasoning_split, undefined)
  const requestsBeforeMissingBudget = wireRequests.length
  assert.throws(() => byClawReasoningFields(
    missingExtendedBudgetRecord.instanceParam,
    resolveByClawProviderAdapter(missingExtendedBudgetRecord.instanceParam),
  ), /BYCLAW_REASONING_CONFIG_INVALID: budget effort max has no configured positive integer token budget/)
  assert.equal(wireRequests.length, requestsBeforeMissingBudget,
    'an incomplete ByClaw budget configuration must fail before the HTTP request')
  const timeoutSelection = await runtime.resolve(
    'wire:connect-timeout', connectTimeoutWireRecord.instanceId,
  )
  assert.equal(timeoutSelection.model, connectTimeoutWireRecord.modelCode,
    'connect-timeout fixture must resolve explicitly rather than through fallback')
  const timeoutProfile = adapter.config.profiles().get(timeoutSelection.provider)
  let timeoutError
  for await (const event of timeoutProfile.piProvider.streamSimple(
    timeoutProfile.piProvider.getModels()[0],
    { messages: [{ role: 'user', content: 'delay response headers', timestamp: 0 }] },
    { apiKey: connectTimeoutWireRecord.authToken, maxRetries: 0 },
  )) {
    if (event.type === 'error') timeoutError = event.error
  }
  assert.equal(timeoutError, undefined,
    'an established connection must allow response headers after connectTimeoutSec')
  assert.equal(wireResponses.includes(connectTimeoutWireRecord.modelCode), true)

  const shortHeaderRecord = {
    ...connectTimeoutWireRecord,
    instanceId: 'wire-short-headers',
    modelCode: 'short-headers-online-id',
    instanceParam: { ...connectTimeoutWireRecord.instanceParam, readTimeoutSec: 1 },
  }
  values.set(`byai:aimodel:config\0${shortHeaderRecord.instanceId}`, JSON.stringify(shortHeaderRecord))
  const shortSelection = await runtime.resolve('wire:short-headers', shortHeaderRecord.instanceId)
  const shortProfile = adapter.config.profiles().get(shortSelection.provider)
  let headerError
  for await (const event of shortProfile.piProvider.streamSimple(
    shortProfile.piProvider.getModels()[0],
    { messages: [{ role: 'user', content: 'delay response headers', timestamp: 0 }] },
    { apiKey: shortHeaderRecord.authToken, maxRetries: 0 },
  )) {
    if (event.type === 'error') headerError = event.error
  }
  assert.equal(headerError?.stopReason, 'error')
  assert.match(headerError?.errorMessage ?? '', /timed out|TIMEOUT|abort/i)
  assert.equal(wireResponses.includes(shortHeaderRecord.modelCode), false,
    'the independent first-response deadline must still stop a stalled request')


  assert.equal(requestAudits.length, 0, 'provider request auditing must default to off')

  const previousLlmLog = process.env.DSH_LLM_LOG
  try {
    process.env.DSH_LLM_LOG = 'info'
    const envRuntime = new ByClawDynamicModelRuntime(ctx, redis, {})
    const envSelection = await envRuntime.resolve('wire:audit-env', deepSeekWireRecord.instanceId, 'high')
    const envAdapter = registrations.at(-1).adapter
    const envProfile = envAdapter.config.profiles().get(envSelection.provider)
    const secretPrompt = 'audit-prompt-must-not-leak'
    const secretSystem = 'audit-system-must-not-leak'
    const secretTool = 'audit_tool_must_not_leak'
    for await (const _event of envProfile.piProvider.streamSimple(
      envProfile.piProvider.getModels()[0],
      {
        systemPrompt: secretSystem,
        messages: [{ role: 'user', content: secretPrompt, timestamp: 0 }],
        tools: [{
          name: secretTool,
          description: 'audit-tool-description-must-not-leak',
          parameters: { type: 'object', properties: { secret_argument: { type: 'string' } } },
        }],
      },
      {
        apiKey: deepSeekWireRecord.authToken,
        reasoning: 'high',
        onPayload: payload => ({ ...payload, reasoning_effort: 'hook-final-effort' }),
      },
    )) {
      // Consumption proves that audit wrapping preserves provider dispatch.
    }
    const envAudit = requestAudits.at(-1)
    assert.deepEqual(envAudit, {
      event: 'byclaw.llm.provider.request',
      provider: envSelection.provider,
      model: deepSeekWireRecord.modelCode,
      protocol: 'openai-completions',
      callEffort: 'high',
      wireThinking: { reasoning_effort: 'hook-final-effort', thinking: { type: 'enabled' } },
    }, 'the audit must observe the final payload returned by an existing onPayload callback')
    assert.equal(wireRequests.at(-1).body.reasoning_effort, 'hook-final-effort',
      'audit composition must preserve an existing onPayload replacement')
    const serializedAudit = JSON.stringify(envAudit)
    for (const secret of [
      secretPrompt,
      secretSystem,
      secretTool,
      'audit-tool-description-must-not-leak',
      'secret_argument',
      deepSeekWireRecord.authToken,
      wireBaseUrl,
      'authorization',
    ]) {
      assert.equal(serializedAudit.includes(secret), false, `request audit leaked ${secret}`)
    }

    process.env.DSH_LLM_LOG = 'invalid'
    const logsBeforeOff = requestAudits.length
    const offRuntime = new ByClawDynamicModelRuntime(ctx, redis, { llmRequestLogLevel: 'off' })
    const offSelection = await offRuntime.resolve('wire:audit-off', deepSeekWireRecord.instanceId, 'high')
    const offAdapter = registrations.at(-1).adapter
    const offProfile = offAdapter.config.profiles().get(offSelection.provider)
    for await (const _event of offProfile.piProvider.streamSimple(
      offProfile.piProvider.getModels()[0],
      { messages: [{ role: 'user', content: 'off audit request', timestamp: 0 }] },
      { apiKey: deepSeekWireRecord.authToken, reasoning: 'high' },
    )) {
      // Explicit off must bypass the invalid environment and still dispatch.
    }
    assert.equal(requestAudits.length, logsBeforeOff, 'explicit off must suppress request audit records')

    const infoRuntime = new ByClawDynamicModelRuntime(ctx, redis, { llmRequestLogLevel: 'info' })
    for (const [record, expectedProtocol] of [
      [responsesWireRecord, 'openai-responses'],
      [anthropicWireRecord, 'anthropic-messages'],
      [anthropicAdaptiveWireRecord, 'anthropic-messages'],
    ]) {
      const selection = await infoRuntime.resolve(`wire:audit:${record.instanceId}`, record.instanceId, 'high')
      const infoAdapter = registrations.at(-1).adapter
      const profile = infoAdapter.config.profiles().get(selection.provider)
      for await (const _event of profile.piProvider.streamSimple(
        profile.piProvider.getModels()[0],
        { messages: [{ role: 'user', content: 'protocol audit request', timestamp: 0 }] },
        { apiKey: record.authToken, reasoning: 'high' },
      )) {
        // A 401 still proves onPayload observed the final serialized request.
      }
      assert.equal(requestAudits.at(-1).protocol, expectedProtocol)
    }
    assert.deepEqual(requestAudits.at(-3).wireThinking,
      { reasoning: { effort: 'provider-high', summary: 'auto' } })
    assert.equal(requestAudits.at(-2).wireThinking.thinking.type, 'enabled')
    assert.equal(typeof requestAudits.at(-2).wireThinking.thinking.budget_tokens, 'number')
    assert.deepEqual(requestAudits.at(-1).wireThinking, {
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    })
    const anthropicAdaptiveRequest = wireRequests.at(-1).body
    assert.deepEqual(anthropicAdaptiveRequest.thinking, { type: 'adaptive', display: 'summarized' })
    assert.deepEqual(anthropicAdaptiveRequest.output_config, { effort: 'high' })
    assert.equal(anthropicAdaptiveRequest.thinking.budget_tokens, undefined,
      'adaptive Anthropic must not fall back to legacy budget thinking')

    const auditAnthropicMode = async (record, requestedLevel) => {
      const selection = await infoRuntime.resolve(
        `wire:audit:anthropic-mode:${record.instanceId}:${requestedLevel ?? 'default'}`,
        record.instanceId,
        requestedLevel,
      )
      const prepared = await registrations.at(-1).adapter.prepareCall(selection.provider, selection.model)
      for await (const _event of prepared.stream({
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
        messages: [],
      })) { /* consume */ }
      return requestAudits.at(-1)
    }
    assert.deepEqual((await auditAnthropicMode(
      anthropicAdaptiveDefaultWireRecord,
    )).wireThinking, {
      thinking: { type: 'adaptive', display: 'summarized' },
    }, 'audit must report the final default-adaptive Anthropic wire payload')
    assert.deepEqual((await auditAnthropicMode(
      anthropicAdaptiveWireRecord,
      'adaptive',
    )).wireThinking, {
      thinking: { type: 'adaptive', display: 'summarized' },
    }, 'audit must report explicit adaptive overriding the canonical profile default')
    assert.deepEqual((await auditAnthropicMode(anthropicAdaptiveWireRecord, 'off')).wireThinking, {
      thinking: { type: 'disabled' },
    }, 'audit must report the final disabled Anthropic wire payload')
    assert.deepEqual((await auditAnthropicMode(
      minimaxAnthropicAdaptiveWireRecord,
    )).wireThinking, {
      thinking: { type: 'adaptive' },
    }, 'MiniMax Anthropic audit must omit Claude-only effort and display controls')

    const minimaxSelection = await infoRuntime.resolve(
      'wire:audit:minimax', minimaxAdaptiveWireRecord.instanceId, 'high',
    )
    const minimaxProfile = registrations.at(-1).adapter.config.profiles().get(minimaxSelection.provider)
    for await (const _event of minimaxProfile.piProvider.streamSimple(
      minimaxProfile.piProvider.getModels()[0],
      { messages: [{ role: 'user', content: 'minimax audit request', timestamp: 0 }] },
      { apiKey: minimaxAdaptiveWireRecord.authToken, reasoning: 'high' },
    )) {
      // The audit must observe the provider-native payload after transformation.
    }
    assert.deepEqual(requestAudits.at(-1).wireThinking, {
      reasoning_split: true,
      thinking: { type: 'adaptive' },
    })
    assert.equal(wireRequests.at(-1).body.reasoning_effort, undefined,
      'MiniMax adaptive requests must never leak the canonical DSH effort onto the wire')

    throwRequestAuditLog = true
    const failureSelection = await infoRuntime.resolve('wire:audit-logger-failure', deepSeekWireRecord.instanceId, 'high')
    const failureAdapter = registrations.at(-1).adapter
    const failureProfile = failureAdapter.config.profiles().get(failureSelection.provider)
    let failureDone = false
    for await (const event of failureProfile.piProvider.streamSimple(
      failureProfile.piProvider.getModels()[0],
      { messages: [{ role: 'user', content: 'logger failure request', timestamp: 0 }] },
      { apiKey: deepSeekWireRecord.authToken, reasoning: 'high' },
    )) {
      if (event.type === 'done') failureDone = true
    }
    assert.equal(failureDone, true, 'an audit logger failure must not prevent provider completion')
  } finally {
    throwRequestAuditLog = false
    registrations.splice(1)
    if (previousLlmLog === undefined) delete process.env.DSH_LLM_LOG
    else process.env.DSH_LLM_LOG = previousLlmLog
  }
} finally {
  await new Promise((resolve, reject) => wireServer.close(error => error === undefined ? resolve() : reject(error)))
}

values.set('byai:aimodel:config\0' + explicitRecord.instanceId, JSON.stringify({
  ...explicitRecord,
  instanceParam: { ...explicitRecord.instanceParam, maxTokens: 16384 },
}))
await runtime.resolve('employee:1', '20010925')
assert.equal(registrations.length, 1, 'a model refresh must retain the registered adapter')
assert.equal((await adapter.resolveModel(employee.provider, employee.model)).defaultMaxTokens, 16384)
assert.equal(preparedEmployee.model.defaultMaxTokens, 8192, 'prepared calls must retain their original provider snapshot')

values.delete(`byai:aimodel:config${String.fromCharCode(0)}20010925`)
values.delete(`byai:aimodel:typelist${String.fromCharCode(0)}LLM`)
const retained = await runtime.resolve('employee:1')
if (retained.provider !== employee.provider || retained.resolution !== 'last-good') {
  throw new Error('resource binding did not retain its last-good model')
}
const emptyRuntime = new ByClawDynamicModelRuntime(ctx, redis, { provider: 'static-fallback', model: 'fallback-model' })
const fallback = await emptyRuntime.resolve('root:new')
if (fallback.provider !== 'static-fallback' || fallback.model !== 'fallback-model' || fallback.resolution !== 'fallback') {
  throw new Error('configured static route was not used as the final fallback')
}

for (const records of [[], [defaultRecord, { ...defaultRecord, instanceId: 'other-default', modelCode: 'other', isDefault: 1 }]]) {
  values.set('byai:aimodel:typelist\0LLM', JSON.stringify(records))
  const strict = new ByClawDynamicModelRuntime(ctx, redis, {})
  try {
    await strict.resolve('root:strict')
    throw new Error('ambiguous or absent default model was accepted')
  } catch (error) {
    if (!String(error).includes('default LLM')) throw error
  }
}
values.set('byai:aimodel:typelist\0LLM', JSON.stringify([defaultRecord]))
const strict = new ByClawDynamicModelRuntime(ctx, redis, {})
const defaultedEmployee = await strict.resolve('employee:missing', '-2000')
if (defaultedEmployee.provider !== 'baiying-m-10000482'
  || defaultedEmployee.model !== 'MiniMax-M3'
  || defaultedEmployee.resolution !== 'default'
  || !warnings.some(message => message.includes('requested AI model -2000 is unavailable')
    && message.includes('falling back to the Redis default LLM'))) {
  throw new Error('missing explicit employee model did not fall back to the Redis default LLM')
}
const corruptExplicitRuntime = new ByClawDynamicModelRuntime(ctx, redis, {})
corruptExplicitRuntime.readExplicit = async () => { throw new Error('corrupt explicit model record') }
const recoveredCorruptEmployee = await corruptExplicitRuntime.resolve('employee:corrupt', 'broken-record')
if (recoveredCorruptEmployee.provider !== 'baiying-m-10000482'
  || recoveredCorruptEmployee.resolution !== 'default'
  || !warnings.some(message => message.includes('broken-record')
    && message.includes('corrupt explicit model record')
    && message.includes('falling back to the Redis default LLM'))) {
  throw new Error('corrupt explicit employee model did not fall back to the Redis default LLM')
}

const previousKey = process.env.BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX
try {
  const keyHex = '00112233445566778899aabbccddeeff'
  process.env.BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX = keyHex
  const cipher = createCipheriv('sm4-ecb', Buffer.from(keyHex, 'hex'), null)
  const encrypted = Buffer.concat([cipher.update('decrypted-secret', 'utf8'), cipher.final()]).toString('base64')
  if (decryptByClawAuthToken(encrypted) !== 'decrypted-secret') throw new Error('SM4 model token was not decrypted')
} finally {
  if (previousKey === undefined) delete process.env.BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX
  else process.env.BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX = previousKey
}

console.log('ByClaw dynamic AI-model loading checks passed')
