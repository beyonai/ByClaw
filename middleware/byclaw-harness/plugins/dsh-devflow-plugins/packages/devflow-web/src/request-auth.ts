/** WebServer route registration is not authentication: every route must ask the live Connection owner. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { IncomingMessage } from 'node:http'
import { isTrustedRequest } from './request-trust.ts'

/** Keep this plugin's authority restriction in addition to the host's signed-cookie and trust checks. */
export function requestRejection(ctx: Context, request: IncomingMessage, trustedHosts: readonly string[]): 401 | 403 | undefined {
  if (!isTrustedRequest(request, trustedHosts)) return 403
  try {
    const connection = ctx.get('connection')
    return connection ? connection.requestRejection(request) : 401
  } catch { return 401 }
}
