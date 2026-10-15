/**
 * The review's written record: one Markdown document per attempt, carrying
 * what was in scope, what was covered, and every finding.
 *
 * It is written on both outcomes, unlike the veto-only report of
 * `dsh-devflow-agent-gate`. A passing review is evidence too — a gate that
 * left a trace only when it refused would make a clean review
 * indistinguishable from one that never ran — and writing it unconditionally
 * is what lets registering it on the card be best-effort: the directory keeps
 * the authoritative copy either way.
 * @module @zhchxiao123/dsh-devflow-review-gate/report
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SEVERITY_ORDER, countBySeverity } from './checker.ts'
import { ReviewError } from './ocr.ts'
import type {
  CoverageAccount,
  DelegatePreview,
  ReviewComment,
  ReviewSeverity,
} from './types.ts'

/** Everything the report states about one attempt. */
export interface ReviewReport {
  card: string
  edge: string
  revision: number
  /** The artifact kind the report is filed under, for the frontmatter label. */
  kind: string
  verdict: 'allow' | 'veto'
  preview: DelegatePreview
  /** The commit the working tree was at, resolved when git could answer. */
  head?: string
  /** The edge's configured base ref, present in range mode. */
  baseRef?: string
  coverage: CoverageAccount
  comments: readonly ReviewComment[]
}

/** `reportDir`-relative file name for one attempt, unique per card, edge, and revision. */
export function reportFileName(card: string, edge: string, revision: number): string {
  return `${card}-${edge.replace('->', '-')}-r${revision}.md`
}

/** Render one finding as a Markdown bullet. */
function renderComment(comment: ReviewComment): string {
  const place = comment.startLine === undefined
    ? `\`${comment.path}\` (unplaced)`
    : `\`${comment.path}:${comment.startLine}${comment.endLine === undefined || comment.endLine === comment.startLine ? '' : `-${comment.endLine}`}\``
  const category = comment.category === undefined ? '' : ` [${comment.category}]`
  return `- **${place}**${category} — ${comment.content.trim()}`
}

/**
 * Render the report.
 *
 * The frontmatter carries the scope and coverage fields rather than burying
 * them in prose: a card has no git identity of its own, so a report that did
 * not state which range it covered could not be audited afterwards at all.
 * @param report - what the review found and what it covered.
 * @returns the Markdown document.
 */
export function renderReport(report: ReviewReport): string {
  const bySeverity = new Map<ReviewSeverity, ReviewComment[]>()
  for (const comment of report.comments) {
    const bucket = bySeverity.get(comment.severity) ?? []
    bucket.push(comment)
    bySeverity.set(comment.severity, bucket)
  }
  const findings = SEVERITY_ORDER.flatMap((severity) => {
    const bucket = bySeverity.get(severity)
    if (bucket === undefined || bucket.length === 0) return []
    return ['', `### ${severity}`, '', ...bucket.map(renderComment)]
  })

  return [
    '---',
    `card: ${report.card}`,
    `kind: ${report.kind}`,
    `title: Code review for ${report.edge}`,
    `verdict: ${report.verdict}`,
    `mode: ${report.preview.mode}`,
    ...report.baseRef === undefined ? [] : [`base_ref: ${report.baseRef}`],
    ...report.preview.mergeBase === undefined ? [] : [`merge_base: ${report.preview.mergeBase}`],
    ...report.head === undefined ? [] : [`head: ${report.head}`],
    `total_files: ${report.coverage.totalFiles}`,
    `reviewed_files: ${report.coverage.reviewedFiles}`,
    `skipped_files: ${report.coverage.skippedFiles}`,
    `coverage_rate: ${report.coverage.coverageRate}%`,
    `findings: ${report.comments.length}`,
    '---',
    '',
    '## Summary',
    '',
    summarize(report),
    '',
    '## Findings',
    report.comments.length === 0 ? '\nNone.' : findings.join('\n'),
    '',
    '## Skipped',
    '',
    report.coverage.skipped.length === 0
      ? 'None — every file in scope was reviewed.'
      : report.coverage.skipped.map(entry => `- \`${entry.path}\` — ${entry.reason}`).join('\n'),
    '',
    '## Scope',
    '',
    `Selected by \`ocr delegate preview\` in ${report.preview.mode} mode over \`${report.preview.repository}\`.`,
    '',
    ...report.preview.reviewable.map(file => `- \`${file.path}\` (${file.status}, +${file.insertions}/-${file.deletions})`),
    ...report.preview.excluded.length === 0
      ? []
      : ['', 'Excluded by the CLI:', '', ...report.preview.excluded.map(file => `- \`${file.path}\` — ${file.excludeReason}`)],
    '',
  ].join('\n')
}

/** The one-line account a reader sees before any detail. */
function summarize(report: ReviewReport): string {
  const outcome = report.verdict === 'veto' ? 'The move was refused.' : 'The move was admitted.'
  return `Reviewed ${report.coverage.reviewedFiles} of ${report.coverage.totalFiles} files `
    + `(${report.coverage.coverageRate}% coverage) and reported ${countBySeverity(report.comments)}. ${outcome}`
}

/**
 * Write the report and return its path.
 *
 * A failure here is a fault rather than a warning: the report is the rework
 * input a veto points at, and admitting a move whose record could not be kept
 * would leave the review unauditable in exactly the case that matters.
 * @param reportDir - the configured directory, created if absent.
 * @param report - what to write.
 * @returns the absolute path written.
 */
export async function writeReport(reportDir: string, report: ReviewReport): Promise<string> {
  const path = join(reportDir, reportFileName(report.card, report.edge, report.revision))
  try {
    await mkdir(reportDir, { recursive: true })
    await writeFile(path, renderReport(report), 'utf8')
  } catch (error) {
    throw new ReviewError(`the review report could not be written to ${path}: ${String(error)}`)
  }
  return path
}
