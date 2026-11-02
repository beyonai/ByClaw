/** Opaque repository/worktree target carried inside terminal tab metadata. */
export interface TerminalGitTarget {
  repositoryId: string
  worktreeId: string
}

/** Metadata reserved for terminals opened from the Worktrees tab. */
export interface WorktreeTerminalMeta {
  terminalGitTarget: TerminalGitTarget
}

/**
 * Read an opaque Worktrees target from persisted terminal metadata.
 * @param meta - untrusted persisted plugin metadata.
 * @returns the two opaque IDs, or undefined when the metadata is not a target.
 */
export function terminalGitTargetOf(meta: unknown): TerminalGitTarget | undefined {
  if (meta === null || typeof meta !== 'object') return undefined
  const target = (meta as { terminalGitTarget?: unknown }).terminalGitTarget
  if (target === null || typeof target !== 'object') return undefined
  const candidate = target as Record<string, unknown>
  if (typeof candidate.repositoryId !== 'string' || typeof candidate.worktreeId !== 'string') return undefined
  return { repositoryId: candidate.repositoryId, worktreeId: candidate.worktreeId }
}
