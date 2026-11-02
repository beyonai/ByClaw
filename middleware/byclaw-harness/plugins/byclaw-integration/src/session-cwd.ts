/** Internal session paths, project execution workspaces, and supported legacy transitions. */
import { join, relative, resolve } from 'node:path'

export function byClawSessionCwd(externalSessionId: string, byRoot = '/by'): string {
  // Business ids are single directory names, never paths supplied by the model.
  if (!/^[a-zA-Z0-9_-]+$/u.test(externalSessionId)) throw new Error('Invalid ByClaw workspace session id')
  return join(resolve(byRoot), '.sessions', externalSessionId)
}

/** Project identity comes from the authenticated gateway metadata, never a tool argument. */
export function byClawProjectCwd(projectId: unknown, byRoot = '/by'): string | undefined {
  const id = String(projectId ?? '').trim()
  return /^-?\d+$/u.test(id) ? join(resolve(byRoot), '.shared', `project_${id}`) : undefined
}

export function isProjectSharedCwd(cwd: string | undefined, byRoot = '/by'): boolean {
  return cwd !== undefined && /^project_-?\d+$/u.test(relative(join(resolve(byRoot), '.shared'), resolve(cwd)))
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
  return nextCwd !== undefined && (
    (resolve(nextCwd) === byClawSessionCwd(externalSessionId, byRoot) && isLegacyProjectCwd(currentCwd, byRoot))
    || (isProjectSharedCwd(nextCwd, byRoot) && currentCwd !== undefined
      && (resolve(currentCwd) === byClawSessionCwd(externalSessionId, byRoot) || isLegacyProjectCwd(currentCwd, byRoot)))
  )
}
