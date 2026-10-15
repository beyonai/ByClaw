import { join } from 'node:path'
import { browserGoalEnabled, resolveGoalConfig } from './goal-config.js'
import type { BrowserTextServiceFactory } from './goal-types.js'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { BrowserBrokerClient } from './broker-client.js'
import {
  type BrowserGoalServices,
  BrowserSessionController,
  type BrowserSessionBroker,
  type BrowserToolInput,
} from './browser-session-controller.js'
import type { TurnBoundaryProjectionSource } from './turn-identity.js'
import { readBrowserSecretFromEnvironment } from './secret-fd.js'
import type { BrowserAction } from './protocol.js'
import { validScrollFields } from './browser-scroll.js'

export const name = 'dsh-browser-use'

export const inject = ['tools', 'sessionProjections']

export interface Config {
  maxContexts?: number
  maxQueue?: number
  idleBrowserMs?: number
  leaseTimeoutMs?: number
}

export type BrowserPluginConfig = Config

export const Config: z<Config> = z.object({
  maxContexts: z.number().default(4),
  maxQueue: z.number().default(32),
  idleBrowserMs: z.number().default(30_000),
  leaseTimeoutMs: z.number().default(900_000),
})

const SAFE_PRESS_KEYS = new Set([
  'Tab', 'Enter', 'Escape', 'Space', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
])
const MAX_URL_CHARS = 4_096
const MAX_VALUE_CHARS = 16_384
const MAX_WAIT_MS = 10_000
const MAX_BATCH_ACTIONS = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.every(key => allowed.includes(key))
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_CHARS) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function validDomain(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253
    || value.includes('/') || value.includes('@') || value.includes('\\')) return false
  try {
    const parsed = new URL(`http://${value}`)
    return !parsed.username && !parsed.password && parsed.pathname === '/'
      && !parsed.search && !parsed.hash && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function positiveIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validObservationId(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 128)
}

function validWaitFor(value: Record<string, unknown>, discriminator: 'operation' | 'kind'): boolean {
  const allowed = [discriminator, 'selector', 'role', 'text', 'url', 'networkIdle', 'timeout']
  const conditions = ['selector', 'role', 'text', 'url', 'networkIdle'].filter(key => value[key] !== undefined)
  return hasExactlyKeys(value, allowed) && conditions.length === 1
    && (value.selector === undefined || (typeof value.selector === 'string' && value.selector.length > 0 && value.selector.length <= 1_024))
    && (value.role === undefined || (typeof value.role === 'string' && value.role.length > 0 && value.role.length <= 128))
    && (value.text === undefined || (typeof value.text === 'string' && value.text.length > 0 && value.text.length <= 1_024))
    && (value.url === undefined || (typeof value.url === 'string' && value.url.length > 0 && value.url.length <= MAX_URL_CHARS))
    && (value.networkIdle === undefined || value.networkIdle === true)
    && (value.timeout === undefined || (Number.isSafeInteger(value.timeout) && (value.timeout as number) > 0 && (value.timeout as number) <= MAX_WAIT_MS))
}

function validBatchAction(value: unknown): value is BrowserAction {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  const { kind, ...rest } = value
  try {
    assertBrowserToolInput({ operation: kind, ...rest })
    return !['open', 'status', 'inspect', 'act', 'screenshot', 'close', 'runGoal', 'goalControl'].includes(kind)
  } catch {
    return false
  }
}

function invalidArguments(detail: string): never {
  throw new Error(`browser-invalid-arguments (${detail})`)
}

function batchActionIssue(value: unknown, index: number): string | undefined {
  if (!isRecord(value)) return `field "actions[${index}]" must be an object`
  if (typeof value.kind !== 'string') return `field "actions[${index}]" is missing required "kind"`
  if (!validBatchAction(value)) return `field "actions[${index}]" has invalid fields for kind "${value.kind}"`
  return undefined
}

export function assertBrowserToolInput(value: unknown): asserts value is BrowserToolInput {
  if (!isRecord(value) || typeof value.operation !== 'string') {
    invalidArguments('field "operation" is required and must be a string')
  }
  switch (value.operation) {
    case 'runGoal': {
      const { operation: _op, goal: _goal, maxSteps: _steps, maxRunMs: _ms, successText: _text, successUrl: _url, ...open } = value
      assertBrowserToolInput({ operation: 'open', ...open })
      if (!hasExactlyKeys(value, ['operation', 'goal', 'startUrl', 'allowedDomains', 'allowSubmit', 'maxSteps', 'maxRunMs', 'successText', 'successUrl'])
        || typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > 4000
        || (value.maxSteps !== undefined && (!Number.isSafeInteger(value.maxSteps) || (value.maxSteps as number) < 1 || (value.maxSteps as number) > 100))
        || (value.maxRunMs !== undefined && (!Number.isSafeInteger(value.maxRunMs) || (value.maxRunMs as number) < 1000 || (value.maxRunMs as number) > 900000))
        || (value.successText !== undefined && (typeof value.successText !== 'string' || !value.successText.trim() || value.successText.length > 1000))
        || (value.successUrl !== undefined && !validHttpUrl(value.successUrl))) invalidArguments('invalid goal or goal budget')
      return
    }
    case 'goalControl':
      if (!hasExactlyKeys(value, ['operation', 'runId', 'generation', 'command'])
        || typeof value.runId !== 'string' || !value.runId || value.runId.length > 128
        || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
        || !['pause', 'resume', 'cancel', 'state'].includes(value.command as string)) invalidArguments('invalid goal control')
      return
    case 'open':
      if (!hasExactlyKeys(value, ['operation', 'startUrl', 'allowedDomains', 'allowSubmit'])
        || (value.startUrl !== undefined && !validHttpUrl(value.startUrl))
        || (value.allowedDomains !== undefined && (!Array.isArray(value.allowedDomains)
          || value.allowedDomains.length > 64 || !value.allowedDomains.every(validDomain)))
        || (value.allowSubmit !== undefined && typeof value.allowSubmit !== 'boolean')) {
        invalidArguments('open accepts only valid startUrl, allowedDomains, and allowSubmit fields')
      }
      return
    case 'inspect':
      if (!hasExactlyKeys(value, ['operation', 'detail'])
        || (value.detail !== undefined && value.detail !== 'compact' && value.detail !== 'full')) {
        invalidArguments('inspect detail must be compact or full')
      }
      return
    case 'scroll':
      if (!hasExactlyKeys(value, ['operation', 'element', 'deltaX', 'deltaY', 'observationId']) || !validScrollFields(value)) {
        invalidArguments('scroll requires finite deltaY (optional deltaX), each within -10000..10000; element must be an observed positive index')
      }
      return
    case 'status':
    case 'focus':
    case 'close':
      if (!hasExactlyKeys(value, ['operation'])) invalidArguments(`operation "${value.operation}" accepts no additional fields`)
      return
    case 'navigate':
      if (!hasExactlyKeys(value, ['operation', 'url', 'observationId']) || !validHttpUrl(value.url)
        || !validObservationId(value.observationId)) {
        invalidArguments('field "url" must be an HTTP(S) URL and observationId must be a non-empty string when provided')
      }
      return
    case 'click':
      if (!hasExactlyKeys(value, ['operation', 'element', 'observationId']) || !positiveIndex(value.element)
        || !validObservationId(value.observationId)) {
        invalidArguments('field "element" must be a positive integer and observationId must be a non-empty string when provided')
      }
      return
    case 'fill':
    case 'select':
      if (!hasExactlyKeys(value, ['operation', 'element', 'value', 'observationId'])
        || !positiveIndex(value.element) || typeof value.value !== 'string'
        || value.value.length > MAX_VALUE_CHARS || !validObservationId(value.observationId)) invalidArguments('fields "element" and "value" are required; element must be a positive integer and value at most 16384 characters')
      return
    case 'press':
      if (!hasExactlyKeys(value, ['operation', 'key'])
        || typeof value.key !== 'string' || !SAFE_PRESS_KEYS.has(value.key)) {
        invalidArguments(`field "key" must be one of: ${[...SAFE_PRESS_KEYS].join(', ')}`)
      }
      return
    case 'wait':
      if (!hasExactlyKeys(value, ['operation', 'milliseconds'])
        || !Number.isSafeInteger(value.milliseconds) || (value.milliseconds as number) < 0
        || (value.milliseconds as number) > MAX_WAIT_MS) invalidArguments(`field "milliseconds" must be an integer between 0 and ${MAX_WAIT_MS}`)
      return
    case 'waitFor':
      if (!validWaitFor(value, 'operation')) invalidArguments('waitFor requires exactly one of selector, role, text, url, or networkIdle; timeout must be 1..10000')
      return
    case 'act':
      if (!hasExactlyKeys(value, ['operation', 'actions']) || !Array.isArray(value.actions)) {
        invalidArguments('field "actions" is required and must be an array')
      }
      if (value.actions.length === 0 || value.actions.length > MAX_BATCH_ACTIONS) {
        invalidArguments(`field "actions" must contain between 1 and ${MAX_BATCH_ACTIONS} items`)
      }
      for (let index = 0; index < value.actions.length; index += 1) {
        const issue = batchActionIssue(value.actions[index], index)
        if (issue) invalidArguments(issue)
      }
      return
    case 'screenshot': {
      if (!hasExactlyKeys(value, ['operation', 'type', 'fullPage', 'element', 'clip', 'quality'])
        || (value.type !== undefined && value.type !== 'png' && value.type !== 'jpeg')
        || (value.fullPage !== undefined && typeof value.fullPage !== 'boolean')
        || (value.element !== undefined && !positiveIndex(value.element))
        || (value.element !== undefined && (value.fullPage !== undefined || value.clip !== undefined))
        || (value.fullPage === true && value.clip !== undefined)
        || (value.quality !== undefined && (!Number.isSafeInteger(value.quality) || (value.quality as number) < 1 || (value.quality as number) > 100 || value.type !== 'jpeg'))) {
        invalidArguments('screenshot fields are invalid; quality is allowed only for jpeg and element cannot be combined with fullPage or clip')
      }
      if (value.clip !== undefined && (!isRecord(value.clip)
        || !hasExactlyKeys(value.clip, ['x', 'y', 'width', 'height'])
        || !['x', 'y', 'width', 'height'].every(key => {
          const component = (value.clip as Record<string, unknown>)[key]
          return typeof component === 'number' && Number.isFinite(component)
        })
        || (value.clip.x as number) < 0 || (value.clip.y as number) < 0
        || (value.clip.width as number) <= 0 || (value.clip.height as number) <= 0)) invalidArguments('field "clip" requires finite x/y >= 0 and width/height > 0')
      return
    }
    default:
      invalidArguments(`field "operation" has unsupported value "${value.operation}"`)
  }
}

function branch(
  operation: BrowserToolInput['operation'],
  properties: Record<string, Record<string, unknown>> = {},
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { operation: { type: 'string', const: operation }, ...properties },
    required: ['operation', ...required],
  }
}

function actionBranch(
  kind: BrowserAction['kind'],
  properties: Record<string, Record<string, unknown>> = {},
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { kind: { type: 'string', const: kind }, ...properties },
    required: ['kind', ...required],
  }
}

const BATCH_ACTION_SCHEMA = {
  oneOf: [
    actionBranch('scroll', {
      deltaY: { type: 'number', minimum: -10000, maximum: 10000 },
      deltaX: { type: 'number', minimum: -10000, maximum: 10000 },
      element: { type: 'integer', minimum: 1 }, observationId: { type: 'string' },
    }, ['deltaY']),
    actionBranch('focus'),
    actionBranch('navigate', { url: { type: 'string' }, observationId: { type: 'string' } }, ['url']),
    actionBranch('click', { element: { type: 'integer' }, observationId: { type: 'string' } }, ['element']),
    actionBranch('fill', { element: { type: 'integer' }, value: { type: 'string' }, observationId: { type: 'string' } }, ['element', 'value']),
    actionBranch('select', { element: { type: 'integer' }, value: { type: 'string' }, observationId: { type: 'string' } }, ['element', 'value']),
    actionBranch('press', { key: { type: 'string' } }, ['key']),
    actionBranch('wait', { milliseconds: { type: 'integer' } }, ['milliseconds']),
    actionBranch('waitFor', {
      selector: { type: 'string' }, role: { type: 'string' }, text: { type: 'string' },
      url: { type: 'string' }, networkIdle: { type: 'boolean' }, timeout: { type: 'integer' },
    }),
  ],
} as const

const BROWSER_PARAMETERS = {
  // Function-tool providers require an object-rooted parameter schema. The
  // operation branches below retain the closed, per-operation argument shape.
  type: 'object',
  oneOf: [
    branch('open', {
      startUrl: { type: 'string' },
      allowedDomains: { type: 'array', items: { type: 'string' } },
      allowSubmit: { type: 'boolean' },
    }),
    branch('status'),
    branch('focus'),
    branch('inspect', { detail: { type: 'string', enum: ['compact', 'full'] } }),
    branch('scroll', {
      deltaY: { type: 'number', minimum: -10000, maximum: 10000 },
      deltaX: { type: 'number', minimum: -10000, maximum: 10000 },
      element: { type: 'integer', minimum: 1 }, observationId: { type: 'string' },
    }, ['deltaY']),
    branch('navigate', { url: { type: 'string' }, observationId: { type: 'string' } }, ['url']),
    branch('click', { element: { type: 'integer' }, observationId: { type: 'string' } }, ['element']),
    branch('fill', { element: { type: 'integer' }, value: { type: 'string' }, observationId: { type: 'string' } }, ['element', 'value']),
    branch('select', { element: { type: 'integer' }, value: { type: 'string' }, observationId: { type: 'string' } }, ['element', 'value']),
    branch('press', { key: { type: 'string' } }, ['key']),
    branch('wait', { milliseconds: { type: 'integer' } }, ['milliseconds']),
    branch('waitFor', {
      selector: { type: 'string' }, role: { type: 'string' }, text: { type: 'string' },
      url: { type: 'string' }, networkIdle: { type: 'boolean' }, timeout: { type: 'integer' },
    }),
    branch('act', { actions: { type: 'array', items: BATCH_ACTION_SCHEMA } }, ['actions']),
    branch('screenshot', {
      type: { type: 'string', enum: ['png', 'jpeg'] }, fullPage: { type: 'boolean' },
      element: { type: 'integer' }, clip: { type: 'object' }, quality: { type: 'integer' },
    }),
    branch('close'),
  ],
} as const

const DOWNLOAD_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    path: { type: 'string', required: true },
    size: { type: 'integer', required: true },
  },
} as const

const GOAL_BRANCHES = [
  branch('runGoal', {
    goal: { type: 'string', minLength: 1, maxLength: 4000, description: '目标及用户已提供的信息；不猜测缺失的账号或个人信息。' },
    startUrl: { type: 'string', maxLength: 4096, description: 'HTTP(S) 起始页；省略则继续当前页。' },
    allowedDomains: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 253 }, description: '允许访问的域；新会话省略时取 startUrl 域，已有会话不得扩大。' },
    allowSubmit: { type: 'boolean', description: '用户授权提交后才设 true；默认禁止表单提交。不能完整识别所有业务写操作。' },
    maxSteps: { type: 'integer', minimum: 1, maximum: 100, description: '动作上限，不得超过部署预算；省略用部署值。' },
    maxRunMs: { type: 'integer', minimum: 1000, maximum: 900000, description: '总时限毫秒，不得超过部署预算；含暂停时间。' },
    successText: { type: 'string', minLength: 1, maxLength: 1000, description: '可选成功条件：最终可见页面包含此文本；与 successUrl 同时提供时均须满足。' },
    successUrl: { type: 'string', maxLength: 4096, description: '可选成功条件：最终 URL 完全相等；并非服务端业务校验。' },
  }, ['goal']),
  branch('goalControl', { runId: { type: 'string', minLength: 1, maxLength: 128 }, generation: { type: 'integer', minimum: 0 },
    command: { type: 'string', enum: ['pause', 'resume', 'cancel', 'state'] } }, ['runId', 'generation', 'command']),
]
const GOAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    runId: { type: 'string', required: true }, status: { type: 'string', enum: ['reported_done', 'verified', 'blocked', 'needs_user', 'failed', 'cancelled'], required: true }, reason: { type: 'string', required: true },
    ...Object.fromEntries(['actions', 'decisions', 'textCalls', 'elapsedMs', 'jevMs', 'textMs', 'browserMs', 'inputTokens', 'outputTokens'].map(k => [k, { type: 'number', required: true }])),
    downloads: { type: 'array', required: true, items: DOWNLOAD_SCHEMA },
    steps: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { operation: { type: 'string', required: true }, target: { type: 'integer' }, dispatched: { type: 'boolean', required: true } } } },
  },
}
function browserTool(controller: BrowserSessionController, goalEnabled: boolean): ToolDefinition {
  const defined = defineTool({
    name: 'browser',
    description: '在授权域内操作共享登录态的浏览器。先 open；元素只能用本次观察索引。act 最多32步，动作使用 kind，已返回新观察；勿重放已执行步骤。waitFor 仅一个条件，时限≤10000ms。默认禁止表单提交，仍须遵守业务授权。scroll 可指定观察到的滚动容器，返回即时位移；截图单独调用。' + (goalEnabled ? '复杂目标可用 runGoal；reported_done 仅模型判断，verified 仅页面条件成立。goalControl 可暂停/继续/取消，暂停完成后再人工接管。' : ''),
    parameters: {
      operation: { type: 'string', required: true },
      detail: { type: 'string' }, deltaY: { type: 'number' }, deltaX: { type: 'number' },
      startUrl: { type: 'string' },
      allowedDomains: { type: 'array', items: { type: 'string' } },
      allowSubmit: { type: 'boolean' },
      url: { type: 'string' },
      element: { type: 'integer' },
      value: { type: 'string' },
      key: { type: 'string' },
      milliseconds: { type: 'integer' },
      observationId: { type: 'string' }, selector: { type: 'string' }, role: { type: 'string' },
      text: { type: 'string' }, networkIdle: { type: 'boolean' }, timeout: { type: 'integer' },
      actions: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true } },
      type: { type: 'string' }, fullPage: { type: 'boolean' }, clip: { type: 'object', properties: {}, additionalProperties: true },
      quality: { type: 'integer' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          ...(goalEnabled ? { goal: GOAL_SCHEMA, control: { type: 'object', additionalProperties: false, properties: {
            runId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, generation: { type: 'integer', required: true },
            status: { type: 'string', enum: ['running', 'pausing', 'paused', 'cancelled'], required: true }, deadline: { type: 'number', required: true },
            pauseDeadline: { type: 'number' }, decisions: { type: 'integer', required: true }, actions: { type: 'integer', required: true },
          } } } : {}),
          observation: {
            type: 'object', additionalProperties: false,
            properties: {
              url: { type: 'string', required: true },
              title: { type: 'string', required: true },
              text: { type: 'string', required: true },
              ready: { type: 'boolean', required: true },
              elementCount: { type: 'integer', required: true },
              observationId: { type: 'string', required: true },
              omittedElements: { type: 'integer' },
              elements: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    index: { type: 'integer', required: true },
                    tag: { type: 'string', required: true },
                    role: { type: 'string' },
                    name: { type: 'string', required: true },
                    type: { type: 'string' },
                    value: { type: 'string' },
                    disabled: { type: 'boolean', required: true },
                    checked: { oneOf: [{ type: 'boolean' }, { type: 'string', enum: ['mixed'] }] }, selectedValue: { type: 'string' }, readonly: { type: 'boolean' },
                    required: { type: 'boolean' }, multiple: { type: 'boolean' },
                    accept: { type: 'string' }, expanded: { type: 'boolean' },
                    visible: { type: 'boolean' }, inViewport: { type: 'boolean' }, covered: { type: 'boolean' },
                    scrollable: { type: 'boolean' },
                  },
                },
              },
              blockingLayers: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    tag: { type: 'string', required: true },
                    role: { type: 'string' },
                    name: { type: 'string', required: true },
                    className: { type: 'string' },
                  },
                },
              },
            },
          },
          action: {
            type: 'object', additionalProperties: false,
            properties: {
              changed: { type: 'boolean', required: true },
              dispatched: { type: 'boolean', required: true },
              textDrift: { type: 'boolean', required: true },
              url: { type: 'string' },
              downloads: { type: 'array', items: DOWNLOAD_SCHEMA },
              scroll: {
                type: 'object', additionalProperties: false,
                properties: {
                  beforeX: { type: 'number', required: true }, beforeY: { type: 'number', required: true },
                  afterX: { type: 'number', required: true }, afterY: { type: 'number', required: true },
                  deltaX: { type: 'number', required: true }, deltaY: { type: 'number', required: true },
                },
              },
            },
          },
          screenshot: {
            type: 'object', additionalProperties: false,
            properties: {
              mimeType: { type: 'string', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              size: { type: 'integer', required: true },
              sha256: { type: 'string', required: true },
              path: { type: 'string', required: true },
            },
          },
          session: {
            type: 'object', additionalProperties: false,
            properties: {
              open: { type: 'boolean', required: true },
              url: { type: 'string' },
              title: { type: 'string' },
              observationId: { type: 'string' },
              allowSubmit: { type: 'boolean' },
              allowedDomains: { type: 'array', items: { type: 'string' } },
              remainingIdleMs: { type: 'integer' },
              expiredReason: { type: 'string' },
            },
          },
          steps: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: true,
              properties: { index: { type: 'integer', required: true }, action: { type: 'object', additionalProperties: true, properties: {} } },
            },
          },
        },
      } as any,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      assertBrowserToolInput(args)
      if (!goalEnabled && ['runGoal', 'goalControl'].includes(args.operation)) throw new Error('browser-goal-disabled')
      return controller.execute(args, exec.agent, exec.signal)
    },
  })
  return { ...defined, parameters: { ...BROWSER_PARAMETERS, oneOf: [...BROWSER_PARAMETERS.oneOf, ...(goalEnabled ? GOAL_BRANCHES : [])] } as unknown as Record<string, unknown> }
}

function resolved(config: Config): Required<Config> {
  return {
    maxContexts: config.maxContexts ?? 4,
    maxQueue: config.maxQueue ?? 32,
    idleBrowserMs: config.idleBrowserMs ?? 30_000,
    leaseTimeoutMs: config.leaseTimeoutMs ?? 900_000,
  }
}

/** Register the real DSH tool around an injected broker; exported for integration tests. */
export function registerBrowserTool(
  ctx: Context,
  config: Config,
  broker: BrowserSessionBroker,
  lifecycle: { readonly shutdownOnDispose?: boolean; readonly goal?: BrowserGoalServices } = {},
): BrowserSessionController {
  const options = resolved(config)
  const projections = (ctx as unknown as {
    sessionProjections: TurnBoundaryProjectionSource
  }).sessionProjections
  const controller = new BrowserSessionController({
    broker,
    projections,
    ...(lifecycle.goal ? { goal: lifecycle.goal } : {}),
    maxContexts: options.maxContexts,
    maxQueue: options.maxQueue,
    leaseTimeoutMs: options.leaseTimeoutMs,
    ...(lifecycle.shutdownOnDispose === undefined
      ? {}
      : { shutdownOnDispose: lifecycle.shutdownOnDispose }),
  })
  ctx.tools.register(browserTool(controller, lifecycle.goal !== undefined))

  ctx.on('agent/disposed', ({ agent }) => {
    void controller.closeAgent(String(agent.id))
  })
  const sessionEvents = ctx as unknown as {
    on(name: string, callback: (...args: any[]) => unknown): () => void
  }
  sessionEvents.on('session/disposed', (session: { id: unknown }) => {
    void controller.closeSession(String(session.id))
  })
  ctx.effect(() => async () => controller.dispose(), 'dsh-browser-use: drain browser sessions')
  return controller
}

export function apply(ctx: Context, config: Config): void {
  ctx.logger.info(`[byclaw-browser-goal] ${browserGoalEnabled() ? 'enabled' : 'disabled'}`)
  const socketPath = process.env.BYCLAW_BROWSER_SOCKET ?? '/run/byclaw-browser/browserd.sock'
  const secret = readBrowserSecretFromEnvironment()
  const ownsRuntime = ['true', '1'].includes(process.env.BYCLAW_BROWSER_OWNS_RUNTIME ?? '')
  registerBrowserTool(
    ctx,
    config,
    new BrowserBrokerClient({ socketPath, secret }),
    { shutdownOnDispose: ownsRuntime, ...(browserGoalEnabled() ? { goal: {
      config: resolveGoalConfig(),
      artifactRoot: process.env.BYCLAW_BROWSER_GOAL_ARTIFACT_DIR ?? join(process.cwd(), '.byclaw-browser-artifacts'),
      text: { forAgent: agent => {
        const service = (ctx as unknown as { byclawBrowserText?: BrowserTextServiceFactory }).byclawBrowserText
        return service?.forAgent(agent) ?? { async generate() { throw new Error('browser-goal-text-unavailable') } }
      } },
      log: (event, data) => ctx.logger.info(`[byclaw-browser-goal] ${event} ${JSON.stringify(data)}`),
    } satisfies BrowserGoalServices } : {}) },
  )
}
