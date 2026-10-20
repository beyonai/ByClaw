/** Turn-scoped net file-change aggregation and ByClaw snapshot persistence. */

import {
  buildByClawEditDiffEvent,
  type ByClawEditDiffFile,
  type ByClawEditDiffOperation,
} from '@byclaw/dsh-diff-viewer/byclaw-edit-diff'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ToolEnvironmentFiles } from './tool-environment-files.ts'

export interface AggregatedFileChange extends ByClawEditDiffFile {
  sources: ByClawEditDiffOperation[]
}

function workspaceRelativePath(workspace: string, path: string): string | undefined {
  const root = resolve(workspace)
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const scoped = relative(root, absolute)
  if (scoped === '' || scoped === '..' || scoped.startsWith(`..${sep}`) || isAbsolute(scoped)) return undefined
  return scoped.split(sep).join('/')
}

/** Keep user-facing edit events inside the active project and normalize paths for stable aggregation. */
export function normalizeWorkspaceEditDiffFiles<T extends ByClawEditDiffFile>(
  workspace: string,
  files: readonly T[],
): T[] {
  return files.flatMap(file => {
    const path = workspaceRelativePath(workspace, file.path)
    if (path === undefined) return []
    const { oldPath, ...rest } = file
    const normalizedOldPath = oldPath === undefined ? undefined : workspaceRelativePath(workspace, oldPath)
    return [{
      ...rest,
      path,
      absolutePath: resolve(workspace, path),
      ...(normalizedOldPath === undefined ? {} : { oldPath: normalizedOldPath }),
    } as unknown as T]
  })
}

/** Keep the first before-image and latest after-image for every changed path. */
export class ByClawFileChangeAccumulator {
  private readonly entries = new Map<string, AggregatedFileChange>()

  add(files: readonly ByClawEditDiffFile[], source: ByClawEditDiffOperation): void {
    for (const file of files) {
      const current = this.entries.get(file.path)
      this.entries.set(file.path, {
        ...file,
        oldText: current?.oldText ?? file.oldText,
        sources: [...new Set([...(current?.sources ?? []), source])],
      })
    }
  }

  files(): AggregatedFileChange[] {
    const result: AggregatedFileChange[] = []
    for (const entry of this.entries.values()) {
      if (entry.oldText === entry.newText && entry.oldPath === undefined) continue
      const normalized = buildByClawEditDiffEvent({
        eventId: 'summary', phase: 'applied', operation: 'git', sessionId: 'summary', diffs: [entry],
      })?.files[0]
      if (normalized !== undefined) result.push({ ...normalized, sources: entry.sources })
    }
    return result
  }
}

function userFsRoot(workspace: string, configured?: string): string | undefined {
  const explicit = configured?.trim() || process.env['BYCLAW_USER_FS_ROOT']?.trim()
  if (explicit) return resolve(explicit)
  for (const marker of [`${sep}.sessions${sep}`, `${sep}projects${sep}`]) {
    const index = workspace.lastIndexOf(marker)
    if (index > 0) return workspace.slice(0, index)
  }
  return undefined
}

export interface FileChangesSummaryPayload {
  type: 'file_changes'
  version: 2
  sessionId: string
  summary: { total: number; added: number; modified: number; deleted: number }
  files: Array<{
    uuid: string
    path: string
    changeType: 'added' | 'modified' | 'deleted'
    binary: boolean
    additions: number
    deletions: number
    sources: string[]
  }>
}

/** Persist detail snapshots where ByClaw UserFS can read them and return the 3016 payload. */
export async function persistFileChangesSummary(
  workspace: string,
  sessionId: string,
  changes: readonly AggregatedFileChange[],
  options: {
    /** ByClaw UserFS root; overrides `BYCLAW_USER_FS_ROOT` and the workspace-marker inference. */
    userFsRoot?: string
    /** Write snapshots into the separate tool environment holding the user tree. */
    files?: ToolEnvironmentFiles
  } = {},
): Promise<FileChangesSummaryPayload | undefined> {
  const scopedChanges = normalizeWorkspaceEditDiffFiles(workspace, changes)
  const root = userFsRoot(resolve(workspace), options.userFsRoot)
  if (root === undefined || scopedChanges.length === 0) return undefined
  const directory = join(root, '.file_changes', sessionId, 'files')
  // `ctx.fs` text writes create parent directories on their own.
  if (options.files === undefined) await mkdir(directory, { recursive: true })
  const files: FileChangesSummaryPayload['files'] = []
  for (const change of scopedChanges) {
    const uuid = randomUUID()
    const changeType = change.changeType === 'renamed' ? 'modified' : change.changeType
    const absolutePath = isAbsolute(change.path) ? change.path : resolve(workspace, change.path)
    const detail = {
      version: 2, uuid, sessionId, filePath: change.path, workspace, absolutePath, changeType,
      changed: true, binary: change.binary, contentEncoding: 'utf-8',
      originalExists: change.oldText !== null, modifiedExists: change.newText !== null,
      originalSize: Buffer.byteLength(change.oldText ?? ''), modifiedSize: Buffer.byteLength(change.newText ?? ''),
      originalContent: change.oldText, modifiedContent: change.newText,
      additions: change.additions, deletions: change.deletions, sources: change.sources,
    }
    if (options.files === undefined) await writeFile(join(directory, `${uuid}.json`), JSON.stringify(detail), 'utf8')
    else await options.files.writeText(join(directory, `${uuid}.json`), JSON.stringify(detail))
    files.push({
      uuid, path: change.path, changeType, binary: change.binary,
      additions: change.additions, deletions: change.deletions, sources: change.sources,
    })
  }
  return {
    type: 'file_changes', version: 2, sessionId,
    summary: {
      total: files.length,
      added: files.filter(file => file.changeType === 'added').length,
      modified: files.filter(file => file.changeType === 'modified').length,
      deleted: files.filter(file => file.changeType === 'deleted').length,
    },
    files,
  }
}
