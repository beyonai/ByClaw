/** Translate an already resolved platform model at the native execution boundary. */
import type { ByClawModelConnection } from './model-runtime.ts'

const MESSAGES = {
  CODEX_MODEL_CONNECTION_UNAVAILABLE: '未能取得所选模型的完整连接配置，请检查模型管理配置；本次未启动 Codex。',
  CODEX_MODEL_PROTOCOL_UNSUPPORTED: '所选模型的接口协议不兼容，当前 Codex 执行适配仅支持 OpenAI Responses，请切换兼容模型。',
  CODEX_MODEL_HEADERS_UNSUPPORTED: '所选模型配置了自定义请求头，当前 Codex 执行适配尚不支持传递，请切换兼容的模型连接。',
  CODEX_MODEL_REASONING_UNSUPPORTED: '所选模型的思考模式无法转换为当前 Codex 支持的档位，请调整模型或思考档位。',
} as const

export type CodingModelErrorCode = keyof typeof MESSAGES
export interface CodingModelError {
  schemaVersion: 1
  domain: 'CODEX_CONFIGURATION'
  code: CodingModelErrorCode
  retryable: false
  httpStatus?: never
  providerCode?: never
  providerMessage?: never
}

/** Only fixed allowlisted messages may reach the existing assistant error channel. */
export class CodingModelConfigurationError extends Error {
  readonly configurationError: CodingModelError
  constructor(code: CodingModelErrorCode) {
    super(code)
    this.configurationError = { schemaVersion: 1, domain: 'CODEX_CONFIGURATION', code, retryable: false }
  }
}
export function codingModelErrorMessage(error: CodingModelError): string {
  return `${MESSAGES[error.code]}（${error.code}）`
}

/** No credential in argv or persistent config; pass only to this owned process. */
export function codingModelEnvironment(connection: ByClawModelConnection | undefined): Readonly<Record<string, string>> {
  if (!connection?.baseUrl || !connection.model || !connection.apiKey) {
    throw new CodingModelConfigurationError('CODEX_MODEL_CONNECTION_UNAVAILABLE')
  }
  if (connection.protocol !== 'openai-responses') throw new CodingModelConfigurationError('CODEX_MODEL_PROTOCOL_UNSUPPORTED')
  if (connection.headers && Object.keys(connection.headers).length) throw new CodingModelConfigurationError('CODEX_MODEL_HEADERS_UNSUPPORTED')
  let url: URL
  try { url = new URL(connection.baseUrl) } catch { throw new CodingModelConfigurationError('CODEX_MODEL_CONNECTION_UNAVAILABLE') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new CodingModelConfigurationError('CODEX_MODEL_CONNECTION_UNAVAILABLE')
  }
  const effort = connection.reasoningEffort
  const mapped = effort === undefined ? undefined : connection.thinkingLevelMap?.[effort as keyof NonNullable<ByClawModelConnection['thinkingLevelMap']>]
  const wireEffort = effort === 'off' ? 'off' : mapped === undefined ? effort : mapped
  if (wireEffort === null || (wireEffort !== undefined && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(wireEffort))) {
    throw new CodingModelConfigurationError('CODEX_MODEL_REASONING_UNSUPPORTED')
  }
  return Object.freeze({ BYCLAW_CODEX_CONNECTION: JSON.stringify({ baseUrl: connection.baseUrl,
    model: connection.model, apiKey: connection.apiKey, reasoningEffort: wireEffort === 'off' ? 'none' : wireEffort }) })
}
