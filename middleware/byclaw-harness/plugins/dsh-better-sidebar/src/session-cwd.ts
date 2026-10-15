import type { Context } from './context-types.ts'
import { requireAbsolute } from './fs-tree.ts'
import { SidebarError } from './wire.ts'

/**
 * Resolve a session cwd while preserving the first-paint fallback used by
 * filesystem, Git, and normal terminal requests.
 * @param ctx - live host services containing attached sessions.
 * @param sessionId - session whose working directory is requested.
 * @param clientCwd - list-summary fallback while the session hydrates.
 * @returns an absolute working directory.
 */
export function sessionCwdOf(ctx: Context, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') {
    try {
      return requireAbsolute(clientCwd)
    } catch {
      throw new SidebarError('bad-request', `invalid working directory "${clientCwd}"`)
    }
  }
  return process.cwd()
}
