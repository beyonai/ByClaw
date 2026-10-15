/** Dynamic ByClaw AI-model resolution and DSH LLM route registration. */

import { modelFetch } from './model-fetch.ts'
import { eligibleModel, type ModelCandidate, type ModelRequirements } from '@byclaw/byclaw-model-router'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createDecipheriv } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { sanitizeByClawOperationalLog } from './operational-log.ts'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import {
  resolveImageAttachmentAccess,
  resolveRetryPolicy,
  type AdapterRegistrationHandle,
  type GenerateOptions,
  type LlmAdapter,
  type PreparedAdapterCall,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import {
  createProvider,
  defaultProviderAuthContext,
  InMemoryCredentialStore,
  type Api,
  type Model,
  type ModelThinkingLevel,
  type Provider,
  type ProviderHeaders,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
  type ThinkingBudgets,
  type ThinkingLevelMap,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'
import { minimaxProvider } from '@earendil-works/pi-ai/providers/minimax'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { togetherProvider } from '@earendil-works/pi-ai/providers/together'
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai'

const AIMODEL_CONFIG_KEY = 'byai:aimodel:config'
const AIMODEL_TYPELIST_KEY = 'byai:aimodel:typelist'
const AIMODEL_TYPELIST_FIELD = 'LLM'
const AUTH_TOKEN_SM4_KEY_ENV = 'BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX'
export const BYCLAW_REDIS_MODEL_ENABLED_ENV = 'BYCLAW_REDIS_MODEL_ENABLED'
export const DSH_LLM_LOG_ENV = 'DSH_LLM_LOG'
const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 8_192
const DEFAULT_IDLE_TIMEOUT_SECONDS = 600
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024
const PROVIDER_PREFIX = 'baiying-m-'

export type ByClawModelProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

type ProviderFactory = () => Provider<Api>

export interface ByClawProviderAdapter {
  providerName: string
  modelProtocol: string
  api: ByClawModelProtocol
  /** Reasoning wire format inherited from this exact supplier/protocol pair. */
  autoThinkingFormat: string
  /** Optional supplier-native thinking envelope applied after pi-ai serialization. */
  nativeThinking?: 'minimax-openai-adaptive' | 'minimax-anthropic-adaptive' | 'anthropic-adaptive'
  createBehavior: ProviderFactory
}

interface ByClawModelRedis {
  hget(key: string, field: string): Promise<string | null>
}

interface AiModelRecord {
  authToken?: unknown
  instanceId?: unknown
  instanceParam?: unknown
  isDefault?: unknown
  maxContentToken?: unknown
  modelCode?: unknown
  modelName?: unknown
  modelDesc?: unknown
  modelType?: unknown
  status?: unknown
  url?: unknown
}

interface MaterializedModel {
  selection: ByClawModelSelection
  profile: ResolvedPiAiProviderProfile
  /** Immutable route used when native adaptive explicitly overrides a canonical default. */
  adaptiveOverride?: {
    selection: ByClawModelSelection
    profile: ResolvedPiAiProviderProfile
  }
  token: string
  reasoning: ResolvedByClawReasoning
}

/** Non-secret diagnostic attached to one resolved model selection. */
export interface ByClawModelSelection extends ModelSelection {
  sourceModelId?: string
  protocol?: ByClawModelProtocol
  semanticProvider?: string
  resolution: 'explicit' | 'default' | 'last-good' | 'fallback' | 'local'
}

/** Static deployment fallback used only when Redis and last-good resolution are unavailable. */
export interface ByClawModelFallback {
  provider?: string
  model?: string
}

/** Model-source options resolved once when the integration starts. */
export interface ByClawModelRuntimeOptions extends ByClawModelFallback {
  /** Whether runtime bindings may read and register Redis AI-model routes. */
  redisModelsEnabled?: boolean
  /** Safe final-wire request audit level; omission reads `DSH_LLM_LOG`. */
  llmRequestLogLevel?: ByClawLlmRequestLogLevel
}

export type ByClawLlmRequestLogLevel = 'off' | 'info'

export interface ByClawLlmRequestAuditRecord {
  event: 'byclaw.llm.provider.request'
  provider: string
  model: string
  protocol: Api
  /** Adapter-call effort; DSH may already have materialized a model default into it. */
  callEffort: string | null
  wireThinking: Readonly<Record<string, unknown>>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function nonNegativeInt(value: unknown): number | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function numericFlag(value: unknown): number | undefined {
  if (typeof value === 'boolean') return value ? 1 : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Parse the deployment switch that selects Redis or local DSH models. */
export function resolveByClawRedisModelsEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (normalized === '' || ['true', '1', 'on', 'yes'].includes(normalized)) return true
  if (['false', '0', 'off', 'no'].includes(normalized)) return false
  throw new Error(`${BYCLAW_REDIS_MODEL_ENABLED_ENV} must be true/false, 1/0, on/off, or yes/no`)
}

/** Resolve plugin configuration before consulting the SDK-style environment fallback. */
export function resolveByClawLlmRequestLogLevel(
  configured: ByClawLlmRequestLogLevel | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ByClawLlmRequestLogLevel {
  if (configured !== undefined) return configured
  const value = environment[DSH_LLM_LOG_ENV]?.trim().toLowerCase() ?? ''
  if (value === '' || value === 'off') return 'off'
  if (value === 'info') return 'info'
  throw new Error(`${DSH_LLM_LOG_ENV} must be off or info`)
}

/** Match baiying-enhance's stable provider route derivation. */
export function byClawProviderKey(modelId: string): string {
  const trimmed = modelId.trim()
  const unsigned = trimmed.startsWith('-') ? `neg-${trimmed.slice(1)}` : trimmed
  const normalized = unsigned.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown'
  return `${PROVIDER_PREFIX}${normalized}`
}

/** Read `prologue.modelId` from a string or object exactly as baiying-enhance does. */
export function byClawPrologueModelId(value: unknown): string | undefined {
  const source = record(value)
  if (source === undefined) return undefined
  let prologue: unknown = source['prologue']
  if (typeof prologue === 'string' && prologue.trim() !== '') {
    try { prologue = JSON.parse(prologue) as unknown } catch { return undefined }
  }
  const id = text(record(prologue)?.['modelId'])
  return id === '' ? undefined : id
}

/** Decrypt a baiying-enhance SM4 token when the shared key is configured. */
export function decryptByClawAuthToken(token: string): string {
  const keyHex = process.env[AUTH_TOKEN_SM4_KEY_ENV]?.trim() ?? ''
  if (!/^[0-9a-fA-F]{32}$/u.test(keyHex)) return token
  try {
    const cipher = Buffer.from(token, 'base64')
    if (cipher.length === 0 || cipher.length % 16 !== 0) return token
    const decipher = createDecipheriv('sm4-ecb', Buffer.from(keyHex, 'hex'), null)
    return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8').trim() || token
  } catch {
    return token
  }
}

function streamsProvider(api: ByClawModelProtocol, streams: ProviderStreams): Provider<Api> {
  return createProvider({
    id: `byclaw-${api}`,
    auth: { apiKey: { name: api, resolve: () => Promise.resolve(undefined) } },
    models: [],
    api: streams,
  })
}

const PROVIDER_ADAPTERS = new Map<string, ByClawProviderAdapter>()

function registerProviderAdapter(
  providerName: string,
  modelProtocol: string,
  api: ByClawModelProtocol,
  autoThinkingFormat: string,
  createBehavior: ProviderFactory,
  nativeThinking?: ByClawProviderAdapter['nativeThinking'],
): void {
  PROVIDER_ADAPTERS.set(`${providerName}\0${modelProtocol}`, {
    providerName, modelProtocol, api, autoThinkingFormat, createBehavior, nativeThinking,
  })
}

// This is deliberately an exact provider/protocol registry. It contains no
// model ids and never consults pi-ai's built-in model catalog.
registerProviderAdapter('DeepSeek', 'OpenAI', 'openai-completions', 'deepseek', deepseekProvider as ProviderFactory)
registerProviderAdapter('DeepSeek', 'Anthropic', 'anthropic-messages', 'anthropic', () => streamsProvider('anthropic-messages', anthropicMessagesApi()))
registerProviderAdapter('OpenAI', 'OpenAI', 'openai-completions', 'openai', () => streamsProvider('openai-completions', openAICompletionsApi()))
registerProviderAdapter('OpenAI', 'OpenAI Responses', 'openai-responses', 'openai', openaiProvider as ProviderFactory)
registerProviderAdapter('OpenAI', 'Anthropic', 'anthropic-messages', 'anthropic', () => streamsProvider('anthropic-messages', anthropicMessagesApi()))
registerProviderAdapter(
  'Anthropic',
  'Anthropic',
  'anthropic-messages',
  'anthropic',
  anthropicProvider as ProviderFactory,
  'anthropic-adaptive',
)
registerProviderAdapter('OpenRouter', 'OpenAI', 'openai-completions', 'openrouter', openrouterProvider as ProviderFactory)
registerProviderAdapter('OpenRouter', 'Anthropic', 'anthropic-messages', 'anthropic', openrouterProvider as ProviderFactory)
registerProviderAdapter('Together', 'OpenAI', 'openai-completions', 'together', togetherProvider as ProviderFactory)
registerProviderAdapter('ZAI', 'OpenAI', 'openai-completions', 'zai', zaiProvider as ProviderFactory)
registerProviderAdapter(
  'MINIMAX',
  'Anthropic',
  'anthropic-messages',
  'anthropic',
  minimaxProvider as ProviderFactory,
  'minimax-anthropic-adaptive',
)
registerProviderAdapter(
  'MINIMAX',
  'OpenAI',
  'openai-completions',
  'openai',
  () => streamsProvider('openai-completions', openAICompletionsApi()),
  'minimax-openai-adaptive',
)
registerProviderAdapter('Qwen', 'OpenAI', 'openai-completions', 'qwen', () => streamsProvider('openai-completions', openAICompletionsApi()))
registerProviderAdapter('Qwen', 'Qwen', 'openai-completions', 'qwen', () => streamsProvider('openai-completions', openAICompletionsApi()))
registerProviderAdapter('VOLCENGINE', 'OpenAI', 'openai-completions', 'openai', () => streamsProvider('openai-completions', openAICompletionsApi()))

/** Resolve only the provider behavior. Model ids are intentionally irrelevant. */
export function resolveByClawProviderAdapter(instanceParam: Record<string, unknown>): ByClawProviderAdapter {
  const providerName = text(instanceParam['providerName'])
  const modelProtocol = text(instanceParam['modelProtocol'])
  const adapter = PROVIDER_ADAPTERS.get(`${providerName}\0${modelProtocol}`)
  if (adapter === undefined) {
    throw new Error(`BYCLAW_PROVIDER_ADAPTER_NOT_FOUND: providerName=${JSON.stringify(providerName)} modelProtocol=${JSON.stringify(modelProtocol)}`)
  }
  return adapter
}


function auditRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function copyAuditScalar(target: Record<string, unknown>, source: Readonly<Record<string, unknown>>, key: string): void {
  const value = source[key]
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) target[key] = value
}

function copyAuditObject(
  target: Record<string, unknown>,
  source: Readonly<Record<string, unknown>>,
  key: string,
  members: readonly string[],
): void {
  const nested = auditRecord(source[key])
  if (nested === undefined) return
  const selected: Record<string, unknown> = {}
  for (const member of members) copyAuditScalar(selected, nested, member)
  if (Object.keys(selected).length > 0) target[key] = selected
}

/** Project only final provider thinking controls; never traverse request content. */
export function byClawWireThinking(api: Api, payload: unknown): Readonly<Record<string, unknown>> {
  const source = auditRecord(payload)
  if (source === undefined) return {}
  const selected: Record<string, unknown> = {}
  if (api === 'openai-completions') {
    for (const key of ['reasoning_effort', 'reasoning_split', 'enable_thinking', 'thinking_token_budget', 'thinking_budget']) {
      copyAuditScalar(selected, source, key)
    }
    copyAuditScalar(selected, source, 'thinking')
    copyAuditObject(selected, source, 'thinking', ['type', 'clear_thinking'])
    copyAuditObject(selected, source, 'reasoning', ['effort', 'enabled'])
    copyAuditObject(selected, source, 'chat_template_kwargs', ['enable_thinking', 'preserve_thinking'])
    copyAuditObject(selected, source, 'chat_template_args', ['enable_thinking'])
  } else if (api === 'openai-responses') {
    copyAuditObject(selected, source, 'reasoning', ['effort', 'summary'])
  } else if (api === 'anthropic-messages') {
    copyAuditObject(selected, source, 'thinking', ['type', 'budget_tokens', 'display'])
    copyAuditObject(selected, source, 'output_config', ['effort'])
  }
  return selected
}

type RequestAuditSink = (record: ByClawLlmRequestAuditRecord) => void

const REQUEST_THINKING_MODE = new AsyncLocalStorage<'disabled'>()

/** Keep both definitions intact while avoiding the Bailian false positive seen for their original order. */
function orderBailianDevflowTools(payload: unknown): Record<string, unknown> | undefined {
  const source = auditRecord(payload)
  const tools = source?.['tools']
  if (!Array.isArray(tools)) return undefined
  const nameOf = (tool: unknown): unknown => auditRecord(auditRecord(tool)?.['function'])?.['name']
  const readIndex = tools.findIndex(tool => nameOf(tool) === 'devflow_read_spec')
  const recordIndex = tools.findIndex(tool => nameOf(tool) === 'devflow_record_iron_rule')
  if (readIndex < 0 || recordIndex < 0 || recordIndex < readIndex) return undefined
  const ordered = [...tools]
  const [recordTool] = ordered.splice(recordIndex, 1)
  ordered.splice(readIndex, 0, recordTool)
  return { ...source, tools: ordered }
}

function usesBailianToolOrder(baseUrl: string, adapter: ByClawProviderAdapter, instanceParam: Record<string, unknown>): boolean {
  if (adapter.providerName === 'Qwen' || record(instanceParam['reasoningConfig'])?.['compatFormat'] === 'bailian') return true
  try {
    const hostname = new URL(baseUrl).hostname
    return hostname === 'dashscope.aliyuncs.com'
      || hostname.endsWith('.dashscope.aliyuncs.com')
      || /^dashscope-[a-z]+\.aliyuncs\.com$/.test(hostname)
      || hostname.endsWith('.maas.aliyuncs.com')
  } catch {
    return false
  }
}

function bailianToolOrderOptions<T extends StreamOptions | SimpleStreamOptions | undefined>(options: T): T {
  const previous = options?.onPayload
  return {
    ...options,
    onPayload: async (payload, model) => {
      const replacement = await previous?.(payload, model)
      return orderBailianDevflowTools(replacement ?? payload) ?? replacement
    },
  } as T
}

async function* requestThinkingStream(
  options: GenerateOptions,
  dispatch: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  if (options.reasoningEffort !== 'off') {
    yield* dispatch()
    return
  }
  // PiAiAdapter intentionally erases `off` before constructing
  // SimpleStreamOptions. Preserve that one piece of per-call intent in async
  // context so concurrent sessions cannot overwrite each other's mode.
  const iterator = REQUEST_THINKING_MODE.run('disabled', () => dispatch()[Symbol.asyncIterator]())
  try {
    while (true) {
      const next = await REQUEST_THINKING_MODE.run('disabled', () => iterator.next())
      if (next.done === true) return
      yield next.value
    }
  } finally {
    await REQUEST_THINKING_MODE.run('disabled', async () => { await iterator.return?.() })
  }
}

class ByClawPiAiAdapter extends PiAiAdapter {
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await super.prepareCall(provider, model, signal)
    return {
      model: prepared.model,
      stream: options => requestThinkingStream(options, () => prepared.stream(options)),
    }
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return requestThinkingStream(options, () => super.stream(options))
  }
}

function auditOptions<T extends StreamOptions | SimpleStreamOptions | undefined>(
  options: T,
  audit: RequestAuditSink | undefined,
  callEffort: string | undefined,
): T {
  if (audit === undefined) return options
  const previous = options?.onPayload
  return {
    ...options,
    onPayload: async (payload, model) => {
      const replacement = await previous?.(payload, model)
      const finalPayload = replacement === undefined ? payload : replacement
      try {
        audit({
          event: 'byclaw.llm.provider.request',
          provider: model.provider,
          model: model.id,
          protocol: model.api,
          callEffort: callEffort ?? null,
          wireThinking: byClawWireThinking(model.api, finalPayload),
        })
      } catch {
        // Operational diagnostics cannot change or prevent provider dispatch.
      }
      return replacement
    },
  } as T
}

function nativeThinkingOptions<T extends StreamOptions | SimpleStreamOptions | undefined>(
  options: T,
  adapter: ByClawProviderAdapter,
  reasoning: ResolvedByClawReasoning,
): T {
  if (adapter.nativeThinking === undefined || !reasoning.reasoning || reasoning.capability !== 'adaptive') return options
  const previous = options?.onPayload
  return {
    ...options,
    onPayload: async (payload, model) => {
      const replacement = await previous?.(payload, model)
      const finalPayload = (replacement === undefined ? payload : replacement) as Record<string, unknown>
      const transformed = { ...finalPayload }
      const disabled = REQUEST_THINKING_MODE.getStore() === 'disabled'
      if (adapter.nativeThinking === 'minimax-openai-adaptive') {
        // MiniMax's OpenAI-compatible API models adaptive thinking as its own
        // envelope, not as an OpenAI reasoning_effort value. Keep canonical
        // efforts usable inside DSH, but remove that implementation detail from
        // the wire request so adaptive-only models are not given a fake effort.
        delete transformed['reasoning_effort']
        transformed['thinking'] = { type: disabled ? 'disabled' : 'adaptive' }
        transformed['reasoning_split'] = true
      } else if (adapter.nativeThinking === 'minimax-anthropic-adaptive') {
        // MiniMax's Anthropic-compatible endpoint accepts its native adaptive
        // switch, but Claude-only display/output_config controls do not belong
        // on this supplier's wire payload.
        transformed['thinking'] = { type: disabled ? 'disabled' : 'adaptive' }
        delete transformed['output_config']
        delete transformed['reasoning_split']
      } else {
        // Native adaptive is a mode, not an effort. When no canonical effort
        // reaches pi-ai (default/explicit adaptive), force the native mode and
        // omit output_config; canonical efforts retain pi-ai's mapped value.
        // Explicit off is carried in request-local async context because
        // PiAiAdapter intentionally erases `off` before provider serialization.
        const serializedThinking = record(transformed['thinking'])
        transformed['thinking'] = disabled
          ? { type: 'disabled' }
          : { type: 'adaptive', display: text(serializedThinking?.['display']) || 'summarized' }
        if (disabled || record(options)?.['reasoning'] === undefined) delete transformed['output_config']
      }
      return transformed
    },
  } as T
}

function executionStreams(
  provider: Provider<Api>,
  adapter: ByClawProviderAdapter,
  reasoning: ResolvedByClawReasoning,
  fetch: typeof globalThis.fetch,
  audit?: RequestAuditSink,
  bailianToolOrder = false,
): ProviderStreams {
  const withTransportTimeouts = <T extends { fetch?: typeof globalThis.fetch } | undefined>(options: T): T => {
    if (options?.fetch !== undefined) return options
    return { ...options, fetch } as T
  }
  const withToolOrder = <T extends StreamOptions | SimpleStreamOptions | undefined>(options: T): T =>
    bailianToolOrder && adapter.api === 'openai-completions' ? bailianToolOrderOptions(options) : options
  return {
    stream: (model, context, options) => provider.stream(
      model,
      context,
      auditOptions(withToolOrder(nativeThinkingOptions(withTransportTimeouts(options), adapter, reasoning)), audit, undefined),
    ),
    streamSimple: (model, context, options) => {
      const timedOptions = auditOptions(
        withToolOrder(nativeThinkingOptions(withTransportTimeouts(options), adapter, reasoning)),
        audit,
        options?.reasoning,
      )
      const level = options?.reasoning
      if (reasoning.capability !== 'budget' || (level !== 'xhigh' && level !== 'max')) {
        return provider.streamSimple(model, context, timedOptions)
      }
      // Budget completeness is validated while materializing the model.
      const budget = reasoning.rawThinkingBudgets.get(level) as number
      // pi-ai 0.85.1 clamps xhigh/max to high before indexing
      // ThinkingBudgets. Project only this call's selected raw value into the
      // high slot so its serializer emits the exact configured wire budget.
      return provider.streamSimple(model, context, {
        ...timedOptions,
        thinkingBudgets: { ...timedOptions?.thinkingBudgets, high: budget },
      })
    },
  }
}

const THINKING_LEVELS = new Set<ModelThinkingLevel>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

function thinkingLevel(value: unknown, fallback?: ModelThinkingLevel): ModelThinkingLevel | undefined {
  const normalized = text(value).toLowerCase() as ModelThinkingLevel
  return THINKING_LEVELS.has(normalized) ? normalized : fallback
}

interface ResolvedByClawReasoning {
  reasoning: boolean
  capability?: string
  defaultLevel?: ModelThinkingLevel
  supportedEfforts: ReadonlySet<ModelThinkingLevel>
  rawThinkingBudgets: ReadonlyMap<ModelThinkingLevel, number>
  thinkingLevelMap?: ThinkingLevelMap
  thinkingBudgets?: ThinkingBudgets
  compat?: Model<Api>['compat']
}

/** Translate ByClaw reasoning metadata into the model fields consumed by pi-ai. */
export function byClawReasoningFields(
  instanceParam: Record<string, unknown>,
  adapter?: ByClawProviderAdapter,
): {
  reasoning: boolean
  defaultLevel?: ModelThinkingLevel
  thinkingLevelMap?: ThinkingLevelMap
  thinkingBudgets?: ThinkingBudgets
  compat?: Model<Api>['compat']
} {
  const resolved = resolveByClawReasoning(instanceParam, adapter)
  return {
    reasoning: resolved.reasoning,
    ...resolved.defaultLevel === undefined ? {} : { defaultLevel: resolved.defaultLevel },
    ...resolved.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: resolved.thinkingLevelMap },
    ...resolved.thinkingBudgets === undefined ? {} : { thinkingBudgets: resolved.thinkingBudgets },
    ...resolved.compat === undefined ? {} : { compat: resolved.compat },
  }
}

function resolveByClawReasoning(
  instanceParam: Record<string, unknown>,
  adapter?: ByClawProviderAdapter,
): ResolvedByClawReasoning {
  const raw = record(instanceParam['reasoningConfig']) ?? {}
  const capability = text(raw['capability']).toLowerCase()
  const enabled = raw['enabled'] === true && capability !== '' && capability !== 'unsupported'
  if (!enabled) return {
    reasoning: false,
    supportedEfforts: new Set(['off']),
    rawThinkingBudgets: new Map(),
  }
  const configuredDefault = text(raw['defaultLevel']).toLowerCase()
  // `adaptive` is a provider mode rather than a pi-ai ModelThinkingLevel. Do
  // not invent a medium/high surrogate: the exact provider adapter expresses
  // the native mode later, while DSH simply omits reasoningEffort.
  let defaultLevel = configuredDefault === ''
    ? 'medium'
    : configuredDefault === 'adaptive'
      ? undefined
      : thinkingLevel(configuredDefault)
  const configuredSupported = Array.isArray(raw['supportedEfforts']) ? raw['supportedEfforts'] : []
  const supportedEfforts = new Set<ModelThinkingLevel>(['off'])
  // baiying-enhance treats an absent/empty list as all canonical runtime
  // levels. Keep that contract here (adaptive remains unsupported by pi-ai).
  const effectiveSupported = configuredSupported.length === 0
    ? ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    : configuredSupported
  for (const value of effectiveSupported) {
    const level = thinkingLevel(value)
    if (level === undefined) {
      // Supported Efforts is configuration/UI metadata. Values newer than the
      // local pi-ai union (including `adaptive`) must not make a session fail.
      continue
    }
    supportedEfforts.add(level)
  }
  // A stale UI/default pairing should not take the model route down. Ignore a
  // default the advertised set cannot represent; explicit supported choices
  // still pass through normally.
  if (defaultLevel !== undefined && !supportedEfforts.has(defaultLevel)) defaultLevel = undefined
  if (adapter === undefined) {
    throw new Error('BYCLAW_REASONING_CONFIG_INVALID: enabled reasoning requires exact provider adapter context')
  }
  const configuredFormat = text(raw['compatFormat']).toLowerCase()
  const format = configuredFormat === 'auto' || configuredFormat === ''
    ? adapter.autoThinkingFormat
    : configuredFormat
  const defaultEffortMap = format === 'deepseek'
    ? { minimal: 'high', low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' }
    : {}
  const effortMap = record(raw['effortMap']) ?? defaultEffortMap
  const thinkingLevelMap: ThinkingLevelMap = {}
  for (const level of THINKING_LEVELS) {
    if (level === 'off') continue // absent means supported and sends no effort: genuinely off
    if (!supportedEfforts.has(level)) {
      thinkingLevelMap[level] = null
      continue
    }
    const wire = text(effortMap[level])
    // A missing entry is the explicit identity mapping used by
    // baiying-enhance; configured right-hand values remain completely opaque.
    thinkingLevelMap[level] = wire || level
  }
  const budgets: ThinkingBudgets = {}
  const rawThinkingBudgets = new Map<ModelThinkingLevel, number>()
  for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
    const budget = positiveInt(record(raw['budgets'])?.[level])
    if (budget !== undefined) rawThinkingBudgets.set(level, budget)
  }
  if (capability === 'budget') {
    for (const level of supportedEfforts) {
      if (level !== 'off' && !rawThinkingBudgets.has(level)) {
        throw new Error(`BYCLAW_REASONING_CONFIG_INVALID: budget effort ${level} has no configured positive integer token budget`)
      }
    }
  }
  for (const level of ['minimal', 'low', 'medium', 'high'] as const) {
    const budget = rawThinkingBudgets.get(level)
    if (budget !== undefined) budgets[level] = budget
  }
  if (adapter.api === 'anthropic-messages') {
    // The Anthropic serializer determines the transport. Existing backend
    // records may retain a known OpenAI compatibility label; accept it as
    // metadata but never copy it into the Anthropic model compat object.
    const knownMetadataFormats = new Set([
      'anthropic', 'openai', 'openrouter', 'deepseek', 'together', 'zai',
      'qwen', 'bailian', 'qwen-chat-template',
    ])
    if (!knownMetadataFormats.has(format)) {
      throw new Error(`BYCLAW_REASONING_CONFIG_INVALID: unsupported compatFormat ${JSON.stringify(format)}`)
    }
    return {
      reasoning: true,
      capability,
      defaultLevel,
      supportedEfforts,
      rawThinkingBudgets,
      thinkingLevelMap,
      ...Object.keys(budgets).length === 0 ? {} : { thinkingBudgets: budgets },
      // This opt-in belongs to the exact Anthropic supplier/protocol adapter,
      // not a model-name heuristic. pi-ai then serializes canonical efforts as
      // thinking.type=adaptive plus output_config.effort. Other Anthropic-wire
      // suppliers (including MINIMAX) retain their existing behavior.
      ...(adapter.nativeThinking === 'anthropic-adaptive' && capability === 'adaptive'
        ? { compat: { forceAdaptiveThinking: true } as Model<Api>['compat'] }
        : {}),
    }
  }
  const supportedFormats = new Set([
    'openai', 'openrouter', 'deepseek', 'together', 'zai', 'qwen', 'qwen-chat-template',
  ])
  if (format !== 'bailian' && !supportedFormats.has(format)) {
    throw new Error(`BYCLAW_REASONING_CONFIG_INVALID: unsupported compatFormat ${JSON.stringify(format)}`)
  }
  const compat = {
    supportsDeveloperRole: raw['supportsDeveloperRole'] === true,
    // pi-ai has no Bailian label, but its qwen serializer is wire-equivalent:
    // top-level enable_thinking plus optional reasoning_effort. The explicit
    // budget field below completes Bailian's budget-mode contract.
    thinkingFormat: format === 'bailian' ? 'qwen' : format,
    supportsReasoningEffort: capability === 'effort'
      || capability === 'adaptive'
      || (capability === 'binary' && format === 'openai'),
    ...(format === 'bailian' && capability === 'budget'
      ? { thinkingTokenBudgetField: 'thinking_budget' }
      : {}),
  } as Model<Api>['compat']
  return {
    reasoning: true,
    capability,
    defaultLevel,
    supportedEfforts,
    rawThinkingBudgets,
    thinkingLevelMap,
    ...Object.keys(budgets).length === 0 ? {} : { thinkingBudgets: budgets },
    compat,
  }
}

function headersOf(instanceParam: Record<string, unknown>): ProviderHeaders | undefined {
  const headers: Record<string, string> = {}
  const raw = instanceParam['headers']
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const item = record(entry)
      const key = text(item?.['key'])
      const value = text(item?.['value'])
      if (key !== '' && value !== '') headers[key] = value
    }
  } else {
    for (const [key, value] of Object.entries(record(raw) ?? {})) {
      const normalized = text(value)
      if (key.trim() !== '' && normalized !== '') headers[key.trim()] = normalized
    }
  }
  return Object.keys(headers).length === 0 ? undefined : headers
}

function samplingParamsOf(instanceParam: Record<string, unknown>): Record<string, unknown> | undefined {
  const params: Record<string, unknown> = {}
  for (const [source, target] of [
    ['temperature', 'temperature'], ['topP', 'top_p'],
    ['frequencyPenalty', 'frequency_penalty'], ['presencePenalty', 'presence_penalty'],
  ] as const) {
    const value = Number(instanceParam[source])
    if (Number.isFinite(value)) params[target] = value
  }
  return Object.keys(params).length === 0 ? undefined : params
}

function retryPolicy(instanceParam: Record<string, unknown>, route: string) {
  const maxRetries = nonNegativeInt(instanceParam['maxRetries'])
  const retrySeconds = positiveInt(instanceParam['retryIntervalSec'])
  return resolveRetryPolicy({
    mode: 'normal',
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(retrySeconds === undefined ? {} : { backoff: {
      initialDelayMs: retrySeconds * 1_000,
      maxDelayMs: Math.max(10_000, retrySeconds * 1_000),
    } }),
  }, `byclaw-dsh: provider "${route}" retryPolicy`)
}

function idleTimeoutMs(): number {
  return (positiveInt(process.env['BYCLAW_LLM_IDLE_TIME']) ?? DEFAULT_IDLE_TIMEOUT_SECONDS) * 1_000
}

function materialize(
  raw: AiModelRecord,
  modelId: string,
  resolution: 'explicit' | 'default',
  audit?: RequestAuditSink,
): MaterializedModel | undefined {
  if (numericFlag(raw.status) !== 1) return undefined
  const baseUrl = text(raw.url)
  const modelCode = text(raw.modelCode)
  const encryptedToken = text(raw.authToken)
  if (baseUrl === '' || modelCode === '' || encryptedToken === '') return undefined
  const instanceParam = record(raw.instanceParam) ?? {}
  const providerAdapter = resolveByClawProviderAdapter(instanceParam)
  const protocol = providerAdapter.api
  const route = byClawProviderKey(modelId)
  const contextWindow = positiveInt(raw.maxContentToken) ?? DEFAULT_CONTEXT_WINDOW
  const maxTokens = positiveInt(instanceParam['maxTokens']) ?? DEFAULT_MAX_TOKENS
  const abilities = Array.isArray(instanceParam['abilities'])
    ? instanceParam['abilities'].map(value => text(value)).filter(Boolean)
    : []
  const input: Array<'text' | 'image'> = abilities.includes('7') ? ['text', 'image'] : ['text']
  const reasoning = resolveByClawReasoning(instanceParam, providerAdapter)
  const bailianToolOrder = usesBailianToolOrder(baseUrl, providerAdapter, instanceParam)
  const headers = headersOf(instanceParam)
  const samplingParams = samplingParamsOf(instanceParam)
  const connectTimeoutMs = positiveInt(instanceParam['connectTimeoutSec'])
  const configuredConnectTimeoutMs = connectTimeoutMs === undefined ? undefined : connectTimeoutMs * 1_000
  const readTimeoutMs = (positiveInt(instanceParam['readTimeoutSec']) ?? (idleTimeoutMs() / 1_000)) * 1_000
  const requestFetch = modelFetch(configuredConnectTimeoutMs, readTimeoutMs)
  const displayName = text(raw.modelName) || modelCode
  const createProfile = (
    profileRoute: string,
    profileDefault: ModelThinkingLevel | undefined,
  ): ResolvedPiAiProviderProfile => {
    const model = {
      id: modelCode,
      name: displayName,
      api: protocol,
      provider: profileRoute,
      baseUrl,
      reasoning: reasoning.reasoning,
      ...reasoning.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: reasoning.thinkingLevelMap },
      input,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
      ...samplingParams === undefined ? {} : { samplingParams },
      ...headers === undefined ? {} : { headers },
      ...reasoning.compat === undefined ? {} : { compat: reasoning.compat },
    } as Model<Api>
    const piProvider = createProvider({
      id: profileRoute,
      name: displayName,
      baseUrl,
      ...headers === undefined ? {} : { headers },
      auth: {
        apiKey: {
          name: profileRoute,
          resolve: ({ credential }) => Promise.resolve({
            auth: credential?.key === undefined ? {} : { apiKey: credential.key },
            source: profileRoute,
          }),
        },
      },
      models: [model],
      api: executionStreams(providerAdapter.createBehavior(), providerAdapter, reasoning, requestFetch, audit, bailianToolOrder),
    })
    return {
      provider: profileRoute,
      displayName,
      api: protocol,
      baseURL: baseUrl,
      defaultContextWindow: contextWindow,
      defaultMaxTokens: maxTokens,
      defaultInput: input,
      streamIdleTimeoutMs: readTimeoutMs,
      maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
      requestImagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
      requestImageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
      retryPolicy: retryPolicy(instanceParam, profileRoute),
      piProvider,
      modelErrors: new Map(),
      configuredMaxTokens: new Map([[modelCode, maxTokens]]),
      ...profileDefault === undefined ? {} : { reasoning: profileDefault },
      ...reasoning.thinkingBudgets === undefined ? {} : { thinkingBudgets: reasoning.thinkingBudgets },
    }
  }
  const profile = createProfile(route, reasoning.defaultLevel)
  const selection: ByClawModelSelection = {
    provider: route,
    model: modelCode,
    sourceModelId: modelId,
    protocol,
    semanticProvider: providerAdapter.providerName,
    resolution,
  }
  const adaptiveOverride = providerAdapter.nativeThinking === 'anthropic-adaptive'
    && reasoning.capability === 'adaptive'
    ? (() => {
        // `:` cannot occur in byClawProviderKey() output, so the internal mode
        // route cannot collide with a real model id that happens to end in an
        // adaptive-looking suffix.
        const adaptiveRoute = `${route}:adaptive`
        return {
          selection: { ...selection, provider: adaptiveRoute },
          profile: createProfile(adaptiveRoute, undefined),
        }
      })()
    : undefined
  return {
    selection,
    profile,
    ...adaptiveOverride === undefined ? {} : { adaptiveOverride },
    token: decryptByClawAuthToken(encryptedToken),
    reasoning,
  }
}

function parseJson(value: string | null): unknown {
  if (value === null || value.trim() === '') return undefined
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

function modelIdOf(raw: AiModelRecord): string {
  return text(raw.instanceId) || text(raw.modelCode)
}

function defaultRecord(value: unknown): { raw: AiModelRecord; modelId: string } | undefined {
  if (!Array.isArray(value)) return undefined
  const usable = value.filter((entry): entry is AiModelRecord => {
    const candidate = record(entry) as AiModelRecord | undefined
    if (candidate === undefined || numericFlag(candidate.status) !== 1) return false
    const modelType = text(candidate.modelType).toUpperCase()
    return modelType === '' || modelType === AIMODEL_TYPELIST_FIELD
  })
  const defaults = usable.filter(entry => numericFlag(entry.isDefault) === 1)
  if (defaults.length !== 1) throw new Error(`ByClaw default LLM requires exactly one usable default (found ${defaults.length})`)
  const selected = defaults[0]
  if (selected === undefined) return undefined
  const modelId = modelIdOf(selected)
  return modelId === '' ? undefined : { raw: selected, modelId }
}

/**
 * Resolve ByClaw model bindings on demand and expose them as hot-swappable DSH routes.
 * Secrets remain associated with immutable in-memory profile objects and are never serialized.
 */
export class ByClawDynamicModelRuntime {
  private profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  private readonly tokens = new WeakMap<ResolvedPiAiProviderProfile, string>()
  private readonly reasonings = new Map<string, ResolvedByClawReasoning>()
  private readonly lastGood = new Map<string, ByClawModelSelection>()
  private readonly routeModelIds = new Map<string, string>()
  private registration: AdapterRegistrationHandle | undefined
  private readonly adapter: PiAiAdapter
  private readonly fallback: ByClawModelSelection | undefined
  private readonly redisModelsEnabled: boolean
  private readonly requestAudit: RequestAuditSink | undefined

  constructor(
    private readonly ctx: Context,
    private readonly redis: ByClawModelRedis,
    options: ByClawModelRuntimeOptions,
  ) {
    const provider = options.provider?.trim() ?? ''
    const model = options.model?.trim() ?? ''
    if ((provider === '') !== (model === '')) throw new Error('byclaw-dsh fallback provider and model must be configured together')
    this.fallback = provider === '' ? undefined : { provider, model, resolution: 'fallback' }
    this.redisModelsEnabled = options.redisModelsEnabled ?? true
    const requestLogLevel = resolveByClawLlmRequestLogLevel(options.llmRequestLogLevel)
    this.requestAudit = requestLogLevel === 'info'
      ? record => this.ctx.logger.info('[byclaw-dsh] LLM provider request audit %o', record)
      : undefined
    if (!this.redisModelsEnabled && this.fallback === undefined) {
      throw new Error('byclaw-dsh requires a local provider and model when Redis model resolution is disabled')
    }
    this.adapter = new ByClawPiAiAdapter({
      profiles: () => this.profiles,
      resolveApiKey: async (_provider, profile) => this.tokens.get(profile),
      auth: {
        credentials: new InMemoryCredentialStore(),
        authContext: defaultProviderAuthContext(),
      },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
        attachments,
        hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
        ref,
      ),
    })
  }

  /** Resolve one root/template/member binding from the configured model source. */
  async resolve(
    bindingId: string,
    requestedModelId?: string,
    requestedThinkingLevel?: string,
  ): Promise<ByClawModelSelection> {
    if (!this.redisModelsEnabled) {
      const local = this.fallback
      if (local === undefined) throw new Error('byclaw-dsh local model configuration was lost after startup')
      return { provider: local.provider, model: local.model, resolution: 'local' }
    }
    const requested = requestedModelId?.trim() ?? ''
    if (requested !== '') {
      let explicit: MaterializedModel | undefined
      let explicitError: unknown
      try {
        explicit = await this.readExplicit(requested)
      } catch (error: unknown) {
        explicitError = error
      }
      if (explicit !== undefined) return this.publish(bindingId, explicit, requestedThinkingLevel)
      const detail = explicitError === undefined ? '' : `: ${String(explicitError)}`
      this.ctx.logger.warn(
        `byclaw-dsh: requested AI model ${requested} is unavailable for ${bindingId}${detail}; falling back to the Redis default LLM`,
      )
    }
    const fallback = await this.readDefault()
    if (fallback !== undefined) return this.publish(bindingId, fallback, requestedThinkingLevel)
    const previous = this.lastGood.get(bindingId)
    if (previous !== undefined) {
      this.ctx.logger.warn(`byclaw-dsh: Redis AI model resolution failed for ${bindingId}; retaining its last-good route`)
      return this.withThinking(
        { ...previous, resolution: 'last-good' },
        this.reasonings.get(previous.provider),
        requestedThinkingLevel,
      )
    }
    if (this.fallback !== undefined) {
      this.ctx.logger.warn(`byclaw-dsh: Redis AI model resolution failed for ${bindingId}; using the configured DSH fallback`)
      return { ...this.fallback }
    }
    throw new Error(`byclaw-dsh could not resolve an AI model for ${bindingId}, and no fallback is configured`)
  }

  /** Identify the configured model behind a registered route without exposing credentials. */
  routingModelId(provider: string, model: string): string | undefined {
    const profile = this.profiles.get(provider)
    return profile?.configuredMaxTokens.has(model) ? this.routeModelIds.get(provider) : undefined
  }

  /** Export metadata only for caller-supplied model IDs; malformed entries cannot poison the whole pool. */
  async routingCandidates(ids: readonly string[]): Promise<ModelCandidate[]> {
    const candidates = await Promise.all([...new Set(ids)].map(async id => {
      try {
        const raw = record(parseJson(await this.hget(AIMODEL_CONFIG_KEY, id))) as AiModelRecord | undefined
        if (raw === undefined || materialize(raw, id, 'explicit', this.requestAudit) === undefined) return undefined
        const kind = text(raw.modelType).toUpperCase()
        if (kind !== '' && kind !== AIMODEL_TYPELIST_FIELD) return undefined
        return this.routingMetadata(raw, id)
      } catch (error: unknown) {
        this.ctx.logger.warn(`byclaw-dsh: model ${id} is unavailable for automatic routing: ${sanitizeByClawOperationalLog(error)}`)
        return undefined
      }
    }))
    return candidates.filter((candidate): candidate is ModelCandidate => candidate !== undefined)
  }

  /** A Jev selection resolves exactly; it never silently changes to the Redis default or last-good route. */
  async resolveExact(modelId: string, required: ModelRequirements): Promise<ByClawModelSelection> {
    if (!this.redisModelsEnabled) throw new Error('Automatic model routing requires Redis model records')
    const raw = record(parseJson(await this.hget(AIMODEL_CONFIG_KEY, modelId))) as AiModelRecord | undefined
    if (raw === undefined || !eligibleModel(this.routingMetadata(raw, modelId), required)) throw new Error(`Selected model ${modelId} no longer meets the task requirements`)
    const model = materialize(raw, modelId, 'explicit', this.requestAudit)
    if (model === undefined) throw new Error(`Selected model ${modelId} is unavailable`)
    return this.publish(`model-router:${modelId}`, model, required.reasoningEffort)
  }

  private routingMetadata(raw: AiModelRecord, id: string): ModelCandidate {
    const params = record(raw.instanceParam) ?? {}
    const abilities = Array.isArray(params['abilities']) ? params['abilities'].map(text) : []
    const reasoning = resolveByClawReasoning(params, resolveByClawProviderAdapter(params))
    const inputPrice = params['routingInputPrice']
    if (inputPrice !== undefined && (typeof inputPrice !== 'number' || !Number.isFinite(inputPrice) || inputPrice < 0)) throw new Error(`Model ${id} routingInputPrice must be a nonnegative price per million input tokens`)
    return {
      id, name: text(raw.modelName) || text(raw.modelCode),
      description: text(params['routingDescription']) || text(raw.modelDesc) || text(raw.modelName) || text(raw.modelCode),
      tools: abilities.includes('3'), vision: abilities.includes('7'),
      contextWindow: positiveInt(raw.maxContentToken) ?? DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: positiveInt(params['maxTokens']) ?? DEFAULT_MAX_TOKENS,
      supportedEfforts: [...reasoning.supportedEfforts, ...(reasoning.capability === 'adaptive' ? ['adaptive'] : [])],
      ...inputPrice === undefined ? {} : { inputPrice },
      ...text(params['routingAccountId']) === '' ? {} : { accountId: text(params['routingAccountId']) },
    }
  }

  private async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.redis.hget(key, field)
    } catch (error: unknown) {
      this.ctx.logger.warn(`byclaw-dsh: Redis AI model read failed for ${key}/${field}: ${sanitizeByClawOperationalLog(error)}`)
      return null
    }
  }

  private async readExplicit(modelId: string): Promise<MaterializedModel | undefined> {
    const raw = record(parseJson(await this.hget(AIMODEL_CONFIG_KEY, modelId))) as AiModelRecord | undefined
    return raw === undefined ? undefined : materialize(raw, modelId, 'explicit', this.requestAudit)
  }

  private async readDefault(): Promise<MaterializedModel | undefined> {
    const selected = defaultRecord(parseJson(await this.hget(AIMODEL_TYPELIST_KEY, AIMODEL_TYPELIST_FIELD)))
    return selected === undefined ? undefined : materialize(selected.raw, selected.modelId, 'default', this.requestAudit)
  }

  private publish(
    bindingId: string,
    materialized: MaterializedModel,
    requestedThinkingLevel?: string,
  ): ByClawModelSelection {
    // DSH's finite reasoningEffort type cannot carry the provider-native
    // `adaptive` mode. An immutable route with no canonical profile default
    // preserves an explicit adaptive override (for example over default high)
    // without inventing an effort value or sharing mutable state across calls.
    const active = text(requestedThinkingLevel).toLowerCase() === 'adaptive'
      && materialized.adaptiveOverride !== undefined
      ? materialized.adaptiveOverride
      : materialized
    const selection = this.withThinking(
      { ...active.selection },
      materialized.reasoning,
      requestedThinkingLevel,
    )
    const next = new Map(this.profiles)
    next.set(active.selection.provider, active.profile)
    this.tokens.set(active.profile, materialized.token)
    this.reasonings.set(active.selection.provider, materialized.reasoning)
    this.profiles = next
    if (materialized.selection.sourceModelId !== undefined) this.routeModelIds.set(active.selection.provider, materialized.selection.sourceModelId)
    const routes = [...next.keys()].sort()
    if (this.registration === undefined) {
      // The local DSH workspace package and this integration's published peer can
      // carry distinct nominal brand symbols; the runtime adapter contract is structural.
      this.registration = this.ctx.llm.registerAdapter(routes, this.adapter as unknown as LlmAdapter)
    }
    else this.registration.replace(routes)
    this.lastGood.set(bindingId, selection)
    return selection
  }

  private withThinking(
    selection: ByClawModelSelection,
    reasoning: ResolvedByClawReasoning | undefined,
    requestedThinkingLevel?: string,
  ): ByClawModelSelection {
    const requested = text(requestedThinkingLevel).toLowerCase()
    if (requested === '') return selection
    const level = thinkingLevel(requested)
    // DSH/pi-ai owns a deliberately finite reasoningEffort union. Provider
    // modes such as `adaptive` (and future unknown values) are handled by the
    // exact provider adapter, so omitting them here is safer than coercing or
    // rejecting the whole request.
    if (level === undefined) return selection
    // A non-reasoning model exposes no DSH reasoning capability at all, so
    // even `off` must be represented by omitting reasoningEffort. Forwarding
    // it would make DSH reject the turn during capability validation before
    // the provider request is built. Also ignore stale non-off UI values here;
    // the backend model switch remains the authority for this exact route.
    if (reasoning === undefined || !reasoning.reasoning) return selection
    if (!reasoning.supportedEfforts.has(level)) {
      if (reasoning.capability === 'adaptive') return selection
      throw new Error(`BYCLAW_UNSUPPORTED_REASONING_EFFORT: ${JSON.stringify(requested)}`)
    }
    return { ...selection, reasoningEffort: level as ModelSelection['reasoningEffort'] }
  }
}
