/**
 * Collecting what each reviewed file actually changed. `ocr delegate` answers
 * which files are in scope and which rule governs them; the diffs themselves
 * come from git, taken against the merge base the preview already resolved
 * rather than against the ref the gate asked for.
 *
 * Workspace mode has one case git cannot express as a diff: an untracked file
 * has no HEAD side, so `git diff` says nothing about it. Such a file is read
 * whole, because every line of it is new code — dropping it instead would
 * leave a file the CLI selected for review silently unreviewed.
 * @module @zhchxiao123/dsh-devflow-review-gate/diff
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ReviewError, runCapture } from './ocr.ts'
import type { CommandInvocation } from './ocr.ts'
import type { DelegatePreview, FileDiff, ReviewableFile } from './types.ts'

/**
 * Collect the change for one reviewed file.
 *
 * In range mode the diff is taken from `preview.mergeBase`, which the CLI
 * resolved; re-resolving it here could disagree with the file list that came
 * from it. In workspace mode an empty `git diff HEAD` means the file is
 * untracked rather than unchanged — the CLI would not have selected an
 * unchanged file — so its content stands in for a diff.
 * @param ctx - context carrying the shell executor.
 * @param git - the git executable, working directory, and time budget.
 * @param preview - the resolved review scope.
 * @param file - the file to collect.
 * @returns the file's diff, or its whole content when git has no diff for it.
 */
export async function collectDiff(
  ctx: Context,
  git: CommandInvocation,
  preview: DelegatePreview,
  file: ReviewableFile,
): Promise<FileDiff> {
  const range = preview.mergeBase === undefined ? 'HEAD' : `${preview.mergeBase}..HEAD`
  const text = await runCapture(ctx, git, ['diff', range, '--', file.path])
  if (text.trim() !== '') {
    return { path: file.path, status: file.status, text, whole: false }
  }
  return {
    path: file.path,
    status: file.status,
    text: await readWholeFile(preview.repository, file.path),
    whole: true,
  }
}

/**
 * Read a file git produced no diff for. A read failure is a fault rather than
 * an empty review entry: the CLI listed the path, so a file that cannot be
 * read is a gap in the review, not an absence of changes.
 */
async function readWholeFile(repository: string, path: string): Promise<string> {
  try {
    return await readFile(join(repository, path), 'utf8')
  } catch (error) {
    throw new ReviewError(`could not read ${path}, which git reported no diff for: ${String(error)}`)
  }
}

/**
 * Collect every reviewed file's change, in preview order.
 *
 * Files are keyed by `(path, status)` throughout: workspace mode can report
 * one path twice — a staged deletion followed by an untracked recreation — and
 * collapsing those to one entry would drop half of what changed.
 * @param ctx - context carrying the shell executor.
 * @param git - the git executable, working directory, and time budget.
 * @param preview - the resolved review scope.
 * @param files - the reviewable files to collect, usually one rule group's.
 * @returns one entry per input file, in the order given.
 */
export async function collectDiffs(
  ctx: Context,
  git: CommandInvocation,
  preview: DelegatePreview,
  files: readonly ReviewableFile[],
): Promise<FileDiff[]> {
  const diffs: FileDiff[] = []
  for (const file of files) {
    diffs.push(await collectDiff(ctx, git, preview, file))
  }
  return diffs
}

/**
 * The files of one rule group, resolved back to their preview entries.
 *
 * The CLI's rule groups carry paths; the review's coverage account is kept by
 * `(path, status)`, so a path the preview reported twice contributes both
 * entries to its group. A group naming a path the preview never listed is a
 * fault: the two answers came from the same CLI run and disagreeing about the
 * file set means the gate cannot account for coverage at all.
 * @param preview - the resolved review scope.
 * @param paths - one rule group's file list.
 * @returns the matching preview entries, in preview order.
 */
export function filesOfGroup(preview: DelegatePreview, paths: readonly string[]): ReviewableFile[] {
  const wanted = new Set(paths)
  const matched = preview.reviewable.filter(file => wanted.has(file.path))
  const found = new Set(matched.map(file => file.path))
  const missing = paths.filter(path => !found.has(path))
  if (missing.length > 0) {
    throw new ReviewError(`ocr delegate rule named ${missing.join(', ')}, which its own preview did not list`)
  }
  return matched
}
