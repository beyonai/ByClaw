/**
 * What a checker is asked and what its answer is taken to mean: the prompt one
 * rule group becomes, the verdict block read back out of the reply, and the
 * coverage account those verdicts are held to.
 *
 * The rule text is passed through untouched. It is the repository's own
 * standard when `.opencodereview/rule.json` supplies it, and editing it here
 * would mean the gate reviewing against something other than what the project
 * asked for. The one thing that needs saying about it is said in the closing
 * contract instead — see {@link CHECKER_CONTRACT}.
 * @module @zhchxiao123/dsh-devflow-review-gate/checker
 */

import { ReviewError } from './ocr.ts'
import type {
  CheckerVerdict,
  CoverageAccount,
  FileDiff,
  ReviewComment,
  ReviewSeverity,
  SkippedFile,
} from './types.ts'

/** Severity ladder, most severe first; the order a veto threshold compares against. */
export const SEVERITY_ORDER: readonly ReviewSeverity[] = ['critical', 'high', 'medium', 'low']

/**
 * The fixed closing instruction every checker gets, after the card, the rule,
 * and the diffs.
 *
 * The tool-name sentence is not decoration. `ocr`'s built-in rules name the
 * tools of its own review agent — the Go ruleset says to "use `file_read` and
 * `code_search` to establish the relevant call sites" — and a checker here
 * holds the harness toolset instead. The rule text cannot be rewritten to fix
 * that without the gate editing the project's standard, so the contract
 * disambiguates and the rule stays verbatim.
 */
export const CHECKER_CONTRACT = [
  'Review only the diffs above, only against the rule above.',
  'The rule may name review tools by the names open-code-review gives them (for example `file_read`, `code_search`). Those are that tool\'s names for reading a file and searching the codebase; use whichever equivalent tools you actually have.',
  'You are a read-only reviewer: do not call any devflow tool and do not write or edit any file.',
  'Every file listed above must end up in `reviewed` or in `skipped` with a concrete reason. Do not omit a file from both.',
  'End your reply with exactly one fenced JSON block of this shape:',
  '```json',
  '{"reviewed":["path/a.ts"],"skipped":[{"path":"path/b.bin","reason":"binary"}],'
  + '"comments":[{"path":"path/a.ts","content":"...","start_line":12,"end_line":14,'
  + '"category":"bug","severity":"high"}]}',
  '```',
  'Severity is one of critical, high, medium, low. Report a finding only when you believe it is real.',
].join('\n')

/** What the prompt needs to say about the card the review belongs to. */
export interface CardContext {
  id: string
  title: string
  body: string
}

/**
 * Assemble one rule group's checker prompt.
 *
 * The card's own text goes in here rather than through `ocr delegate
 * --background`: the CLI only echoes that text back to its caller, and the
 * caller assembling the prompt is this function, so the round trip would buy
 * nothing while inheriting the flag's size limits.
 * @param card - the moving card, as business context for the review.
 * @param edge - the `from->to` edge being decided.
 * @param rule - the rule group's body, passed through verbatim.
 * @param diffs - the group's files and what each changed.
 * @returns the checker's user message.
 */
export function buildCheckerPrompt(
  card: CardContext,
  edge: string,
  rule: string,
  diffs: readonly FileDiff[],
): string {
  const files = diffs.map(diff => [
    `--- file ${diff.path} (${diff.status})${diff.whole ? ' — new file, shown in full' : ''} ---`,
    diff.text.trimEnd(),
  ].join('\n'))
  return [
    `You are reviewing devflow card ${card.id} on edge ${edge}.`,
    '',
    `# Card: ${card.title}`,
    '',
    card.body.trim(),
    '',
    '# Review rule',
    '',
    rule.trim(),
    '',
    '# Changes',
    '',
    files.join('\n\n'),
    '',
    '# Contract',
    '',
    CHECKER_CONTRACT,
  ].join('\n')
}

/**
 * Read the verdict out of a checker's reply.
 *
 * The last parsable block wins, so a checker may quote the contract above
 * without its example being mistaken for its answer.
 * @param reply - the checker's text output.
 * @returns the parsed verdict.
 */
export function parseCheckerVerdict(reply: string): CheckerVerdict {
  const blocks = [...reply.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  for (let index = blocks.length - 1; index >= 0; index--) {
    const verdict = decodeVerdict(blocks[index]?.[1])
    if (verdict !== undefined) return verdict
  }
  throw new ReviewError('the checker replied without a parsable verdict block')
}

/** Decode one candidate block; anything outside the verdict shape is `undefined`. */
function decodeVerdict(raw: string | undefined): CheckerVerdict | undefined {
  /* v8 ignore next -- matchAll always captures group 1; the guard satisfies indexed access. */
  if (raw === undefined) return undefined
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // Swallowed: a block that is not JSON is simply not the verdict block.
    return undefined
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  const reviewed = decodeStrings(record.reviewed)
  const skipped = decodeSkipped(record.skipped)
  const comments = decodeComments(record.comments)
  if (reviewed === undefined || skipped === undefined || comments === undefined) return undefined
  return { reviewed, skipped, comments }
}

/** Decode an absent-or-string-array field; a malformed one rejects the block. */
function decodeStrings(value: unknown): string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) return undefined
  return value as string[]
}

/** Decode the skipped list; an entry without a reason rejects the block. */
function decodeSkipped(value: unknown): SkippedFile[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const skipped: SkippedFile[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const record = entry as Record<string, unknown>
    if (typeof record.path !== 'string') return undefined
    if (typeof record.reason !== 'string' || record.reason.trim() === '') return undefined
    skipped.push({ path: record.path, reason: record.reason })
  }
  return skipped
}

/**
 * Decode the findings. An unrecognized `severity` rejects the whole block
 * rather than defaulting: severity is what the veto threshold compares
 * against, so guessing one would decide the move on a value the checker never
 * gave. Category is carried through as written, being decided on by nobody.
 */
function decodeComments(value: unknown): ReviewComment[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const comments: ReviewComment[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const record = entry as Record<string, unknown>
    if (typeof record.path !== 'string') return undefined
    if (typeof record.content !== 'string' || record.content.trim() === '') return undefined
    const severity = record.severity
    if (typeof severity !== 'string' || !SEVERITY_ORDER.includes(severity as ReviewSeverity)) return undefined
    comments.push({
      path: record.path,
      content: record.content,
      severity: severity as ReviewSeverity,
      ...decodeLine(record.start_line, 'startLine'),
      ...decodeLine(record.end_line, 'endLine'),
      ...typeof record.category === 'string' ? { category: record.category } : {},
    })
  }
  return comments
}

/**
 * Decode one optional line number. `ocr` reports a comment it could not place
 * as line zero, which is an absence rather than a position, so it is dropped
 * here and the report says the finding is unplaced.
 */
function decodeLine(value: unknown, key: 'startLine' | 'endLine'): Partial<Record<typeof key, number>> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return {}
  return { [key]: value }
}

/**
 * Hold the verdicts to the file list the CLI produced.
 *
 * Coverage is the whole reason the CLI selects the files rather than the
 * reviewer: a checker that quietly reviewed half its group would otherwise
 * look identical to one that reviewed all of it. A file accounted for by
 * neither list is a fault, and so is one the group was never given.
 * @param expected - every reviewable path, as the preview listed it.
 * @param verdicts - one verdict per rule group.
 * @returns what the review covered.
 */
export function accountCoverage(
  expected: readonly string[],
  verdicts: readonly CheckerVerdict[],
): CoverageAccount {
  const wanted = new Set(expected)
  const reviewed = new Set<string>()
  const skipped = new Map<string, SkippedFile>()
  for (const verdict of verdicts) {
    for (const path of verdict.reviewed) {
      if (!wanted.has(path)) throw new ReviewError(`a checker reported reviewing ${path}, which was not in its review scope`)
      reviewed.add(path)
    }
    for (const entry of verdict.skipped) {
      if (!wanted.has(entry.path)) throw new ReviewError(`a checker reported skipping ${entry.path}, which was not in its review scope`)
      if (!reviewed.has(entry.path)) skipped.set(entry.path, entry)
    }
  }
  for (const path of reviewed) skipped.delete(path)
  const unaccounted = [...wanted].filter(path => !reviewed.has(path) && !skipped.has(path))
  if (unaccounted.length > 0) {
    throw new ReviewError(`the review accounted for neither reviewing nor skipping ${unaccounted.join(', ')}`)
  }
  const total = wanted.size
  return {
    totalFiles: total,
    reviewedFiles: reviewed.size,
    skippedFiles: skipped.size,
    coverageRate: total === 0 ? 100 : Math.round((reviewed.size / total) * 1000) / 10,
    skipped: [...skipped.values()],
  }
}

/**
 * Whether a finding is severe enough to veto.
 * @param severity - the finding's severity.
 * @param threshold - the edge's configured floor, or `never`.
 */
export function vetoes(severity: ReviewSeverity, threshold: ReviewSeverity | 'never'): boolean {
  if (threshold === 'never') return false
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(threshold)
}

/**
 * Findings counted by severity, most severe first, as the phrase both the
 * veto reason and the report summary read from — `2 critical, 1 high`.
 *
 * A breakdown rather than a single worst severity: it is total over any list,
 * including an empty one, so neither caller needs a fallback for a case that
 * cannot happen, and it tells a reader how much rework there is rather than
 * only how bad the worst of it is.
 * @param comments - the findings to count.
 * @returns the phrase, or `no findings` when there are none.
 */
export function countBySeverity(comments: readonly ReviewComment[]): string {
  const counts = SEVERITY_ORDER
    .map(severity => ({ severity, count: comments.filter(comment => comment.severity === severity).length }))
    .filter(entry => entry.count > 0)
    .map(entry => `${entry.count} ${entry.severity}`)
  return counts.length === 0 ? 'no findings' : counts.join(', ')
}
