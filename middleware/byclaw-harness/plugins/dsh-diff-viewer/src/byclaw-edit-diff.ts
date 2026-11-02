/** Host-safe ByClaw edit-diff protocol and mutation-tool mapping. */

import { diffLines } from 'diff'

export type ByClawEditDiffPhase = 'running' | 'applied' | 'failed'
export type ByClawEditDiffOperation = 'edit' | 'write' | 'git'
export type ByClawFileChangeType = 'added' | 'modified' | 'deleted' | 'renamed'

export interface DiffHunkLike {
  path: string
  oldPath?: string
  oldText: string | null
  newText: string | null
  binary?: boolean
}

export interface ByClawEditDiffFile extends DiffHunkLike {
  /** Optional host path used by tool-card UIs; `path` remains workspace-relative and portable. */
  absolutePath?: string
  changeType: ByClawFileChangeType
  additions: number
  deletions: number
  binary: boolean
}

export interface ByClawEditDiffEvent {
  type: 'edit_diff'
  schemaVersion: 1
  eventId: string
  phase: ByClawEditDiffPhase
  operation: ByClawEditDiffOperation
  sessionId: string
  files: ByClawEditDiffFile[]
  error?: string
}

export interface ByClawEditDiffInput {
  eventId: string
  phase: ByClawEditDiffPhase
  operation: ByClawEditDiffOperation
  sessionId: string
  argsRaw?: string
  diffs?: readonly DiffHunkLike[]
  error?: string
}

function parseArgs(argsRaw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

/** Derive replay-safe call-time diffs from DSH edit/write arguments. */
export function callTimeDiffs(toolName: string, argsRaw: string): DiffHunkLike[] | null {
  const args = parseArgs(argsRaw)
  if (args === undefined) return null
  if (toolName === 'write') {
    const path = stringArg(args, 'file_path')
    const content = stringArg(args, 'content')
    return path === undefined || content === undefined ? null : [{ path, oldText: null, newText: content }]
  }
  if (toolName === 'edit') {
    const path = stringArg(args, 'file_path')
    const oldText = stringArg(args, 'old_string')
    const newText = stringArg(args, 'new_string')
    return path === undefined || oldText === undefined || newText === undefined
      ? null
      : [{ path, oldText: oldText || null, newText }]
  }
  return null
}

function lineStats(oldText: string | null, newText: string | null): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const change of diffLines(oldText ?? '', newText ?? '')) {
    const count = change.count ?? 0
    if (change.added) additions += count
    if (change.removed) deletions += count
  }
  return { additions, deletions }
}

function changeType(diff: DiffHunkLike): ByClawFileChangeType {
  if (diff.oldPath !== undefined && diff.oldPath !== diff.path) return 'renamed'
  if (diff.oldText === null) return 'added'
  if (diff.newText === null) return 'deleted'
  return 'modified'
}

/** Build one universal ByClaw event, preferring applied result hunks over call arguments. */
export function buildByClawEditDiffEvent(input: ByClawEditDiffInput): ByClawEditDiffEvent | null {
  const fallback = input.argsRaw === undefined ? null : callTimeDiffs(input.operation, input.argsRaw)
  const diffs = input.diffs !== undefined && input.diffs.length > 0 ? input.diffs : fallback
  if (diffs === null || diffs === undefined || diffs.length === 0) return null
  const files = diffs.map(diff => ({
    ...diff,
    changeType: changeType(diff),
    ...lineStats(diff.oldText, diff.newText),
    binary: diff.binary === true,
  }))
  return {
    type: 'edit_diff',
    schemaVersion: 1,
    eventId: input.eventId,
    phase: input.phase,
    operation: input.operation,
    sessionId: input.sessionId,
    files,
    ...(input.error === undefined ? {} : { error: input.error }),
  }
}
