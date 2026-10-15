/** ByClaw control over DSH Web launch-token and browser-session authentication. */

import { timingSafeEqual } from 'node:crypto'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

export const BYCLAW_DSH_WEB_AUTH_TOKEN_ENV = 'BYCLAW_DSH_WEB_AUTH_TOKEN' as const
export const BYCLAW_DSH_WEB_AUTH_ENABLED_ENV = 'BYCLAW_DSH_WEB_AUTH_ENABLED' as const

/** Resolve the fixed token, explicit authentication bypass, or default DSH authentication. */
export function resolveByClawWebAuthToken(environment: NodeJS.ProcessEnv): string | false | undefined {
  const configured = environment[BYCLAW_DSH_WEB_AUTH_ENABLED_ENV]?.trim().toLowerCase() ?? ''
  if (['false', '0', 'off', 'no'].includes(configured)) return false
  if (configured === '' || ['true', '1', 'on', 'yes'].includes(configured)) {
    return environment[BYCLAW_DSH_WEB_AUTH_TOKEN_ENV]
  }
  throw new Error(`${BYCLAW_DSH_WEB_AUTH_ENABLED_ENV} must be true/false, 1/0, on/off, or yes/no`)
}

export type ByClawWebAuthConnection = Pick<
  HostConnectionHandle,
  'authenticatedUrl' | 'authorizeIndex' | 'requestRejection'
>

interface FixedTokenAdapter {
  generation: symbol
  mode: 'fixed-token'
  publicToken: string
  internalToken: string
}

interface DisabledAdapter {
  generation: symbol
  mode: 'disabled'
}

type ActiveAdapter = FixedTokenAdapter | DisabledAdapter

interface ConnectionDispatcher {
  originalAuthenticatedUrl: ByClawWebAuthConnection['authenticatedUrl']
  originalAuthorizeIndex: ByClawWebAuthConnection['authorizeIndex']
  originalRequestRejection: ByClawWebAuthConnection['requestRejection']
  authenticatedUrl: ByClawWebAuthConnection['authenticatedUrl']
  authorizeIndex: ByClawWebAuthConnection['authorizeIndex']
  requestRejection: ByClawWebAuthConnection['requestRejection']
  active?: ActiveAdapter
}

const dispatchers = new WeakMap<ByClawWebAuthConnection, ConnectionDispatcher>()

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes)
}

function dispatcherFor(connection: ByClawWebAuthConnection): ConnectionDispatcher {
  const existing = dispatchers.get(connection)
  if (existing !== undefined) return existing

  const originalAuthenticatedUrl = connection.authenticatedUrl
  const originalAuthorizeIndex = connection.authorizeIndex
  const originalRequestRejection = connection.requestRejection
  const dispatcher: ConnectionDispatcher = {
    originalAuthenticatedUrl,
    originalAuthorizeIndex,
    originalRequestRejection,
    authenticatedUrl(baseUrl: string): string {
      const active = dispatcher.active
      if (active?.mode === 'disabled') {
        const url = new URL(baseUrl)
        url.pathname = '/'
        url.search = ''
        url.hash = ''
        return url.href
      }
      const url = new URL(originalAuthenticatedUrl.call(connection, baseUrl))
      if (active?.mode === 'fixed-token') url.searchParams.set('token', active.publicToken)
      return url.href
    },
    authorizeIndex(request, response): boolean {
      const active = dispatcher.active
      if (active?.mode === 'disabled') return true
      if (active?.mode !== 'fixed-token') return originalAuthorizeIndex.call(connection, request, response)
      const url = new URL(request.url ?? '/', 'http://dsh.invalid')
      const tokens = url.searchParams.getAll('token')
      if (tokens.length !== 1 || !tokenMatches(tokens[0] ?? '', active.publicToken)) {
        return originalAuthorizeIndex.call(connection, request, response)
      }
      url.searchParams.set('token', active.internalToken)
      return originalAuthorizeIndex.call(connection, {
        method: request.method,
        headers: request.headers,
        url: `${url.pathname}${url.search}`,
      }, response)
    },
    requestRejection(request) {
      const rejection = originalRequestRejection.call(connection, request)
      return dispatcher.active?.mode === 'disabled' && rejection === 401 ? undefined : rejection
    },
  }
  dispatchers.set(connection, dispatcher)
  connection.authenticatedUrl = dispatcher.authenticatedUrl
  connection.authorizeIndex = dispatcher.authorizeIndex
  connection.requestRejection = dispatcher.requestRejection
  return dispatcher
}

/**
 * Present one deployment token while retaining DSH's random internal token,
 * signed-cookie exchange, request trust checks, and API/WebSocket auth.
 */
export function overrideByClawWebAuthToken(
  connection: ByClawWebAuthConnection,
  configuredToken: string,
): () => void {
  const publicToken = configuredToken.trim()
  if (publicToken === '') throw new Error(`${BYCLAW_DSH_WEB_AUTH_TOKEN_ENV} must be non-empty`)

  const dispatcher = dispatcherFor(connection)

  const internalUrl = new URL(dispatcher.originalAuthenticatedUrl.call(connection, 'http://127.0.0.1'))
  const internalToken = internalUrl.searchParams.get('token')
  if (internalToken === null || internalToken === '') {
    throw new Error('byclaw-dsh could not resolve the DSH browser launch token')
  }

  const generation = Symbol('byclaw-web-auth-generation')
  dispatcher.active = { generation, mode: 'fixed-token', publicToken, internalToken }
  return () => {
    if (dispatcher.active?.generation === generation) dispatcher.active = undefined
  }
}

/** Disable DSH browser token and cookie checks while retaining Host/Origin trust rejection. */
export function disableByClawWebAuthentication(connection: ByClawWebAuthConnection): () => void {
  const dispatcher = dispatcherFor(connection)
  const generation = Symbol('byclaw-web-auth-disabled-generation')
  dispatcher.active = { generation, mode: 'disabled' }
  return () => {
    if (dispatcher.active?.generation === generation) dispatcher.active = undefined
  }
}
