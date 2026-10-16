/** Canonical process-file workspace and the narrowly supported legacy project transition. */
import { join, relative, resolve } from 'node:path'

export function byClawSessionCwd(externalSessionId: string, byRoot = '/by'): string {
  // Business ids are single directory names, never paths supplied by the model.
  if (!/^[a-zA-Z0-9_-]+$/u.test(externalSessionId)) throw new Error('Invalid ByClaw workspace session id')
  return join(resolve(byRoot), '.sessions', externalSessionId)
}

export function isLegacyProjectCwd(cwd: string | undefined, byRoot = '/by'): boolean {
  if (cwd === undefined) return false
  return [...new Set([resolve(byRoot), '/by'])].some(root => {
    const projectId = relative(join(root, 'projects'), resolve(cwd))
    return /^[a-zA-Z0-9_-]+$/u.test(projectId)
  })
}

/** No cross-session, arbitrary-directory or reverse transition is permitted. */
export function isLegacyProjectWorkspaceTransition(
  currentCwd: string | undefined, nextCwd: string | undefined, externalSessionId: string, byRoot = '/by',
): boolean {
  return nextCwd !== undefined && resolve(nextCwd) === byClawSessionCwd(externalSessionId, byRoot)
    && isLegacyProjectCwd(currentCwd, byRoot)
}
