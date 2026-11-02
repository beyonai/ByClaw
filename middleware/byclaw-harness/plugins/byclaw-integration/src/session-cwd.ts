/** Internal session paths, project execution workspaces, and supported legacy transitions. */
import { lstat, mkdir, readlink, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

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

/** Project-local alias for the canonical, persistent conversation directory. */
export function byClawProjectSessionAlias(
  projectId: unknown, externalSessionId: string, byRoot = '/by',
): string | undefined {
  const projectCwd = byClawProjectCwd(projectId, byRoot)
  if (projectCwd === undefined) return undefined
  // Reuse the canonical validator so neither identifier can introduce a path segment.
  byClawSessionCwd(externalSessionId, byRoot)
  return join(projectCwd, '.session', `session_${externalSessionId}`)
}

/**
 * Idempotently expose one canonical session directory inside its DSH project.
 * Existing non-links and links to another target fail closed and are never replaced.
 */
export async function ensureByClawProjectSessionAlias(sessionRoot: string, alias: string): Promise<void> {
  const canonicalRoot = resolve(sessionRoot)
  const aliasPath = resolve(alias)
  await mkdir(canonicalRoot, { recursive: true })
  await mkdir(dirname(aliasPath), { recursive: true })
  const validateExisting = async (): Promise<void> => {
    const entry = await lstat(aliasPath)
    if (!entry.isSymbolicLink()) {
      throw new Error(`ByClaw project session alias already exists and is not a symbolic link: ${aliasPath}`)
    }
    const target = resolve(dirname(aliasPath), await readlink(aliasPath))
    if (target !== canonicalRoot) {
      throw new Error(`ByClaw project session alias points to an unexpected target: ${aliasPath}`)
    }
  }
  try {
    await validateExisting()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      await symlink(canonicalRoot, aliasPath, 'dir')
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== 'EEXIST') throw createError
      await validateExisting()
    }
  }
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
