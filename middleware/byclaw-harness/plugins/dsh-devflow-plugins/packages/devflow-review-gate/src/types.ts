/**
 * Vocabulary types of the OCR review gate: the severity ladder findings are
 * thresholded against, and the per-edge policy the listener decides from once
 * the deployment's configuration has been validated. The configuration's own
 * (wider, unvalidated) shape lives beside its schema in the package root —
 * config is a boundary, so what a deployment may write and what the listener
 * may assume are deliberately different types.
 * @module @zhchxiao123/dsh-devflow-review-gate/types
 */

/**
 * Finding severity, restated from `ocr delegate`'s comment contract. Ordered
 * from most to least severe, which is the order a veto threshold compares
 * against. This is an external specification rather than a deployment choice:
 * a divergence from the upstream vocabulary is a defect in this copy, not a
 * configurable preference.
 */
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low'

/**
 * Finding category, restated from the same upstream contract as
 * {@link ReviewSeverity}. Merge-extensible on purpose: the gate never decides
 * on a category — it carries one through to the report so a reader can triage
 * — so a category a newer CLI or a checker invents is reported verbatim rather
 * than dropped or rejected. Severity, which the veto threshold does compare
 * against, is closed for exactly the opposite reason.
 */
export type ReviewCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'test'
  | 'style'
  | 'documentation'
  | 'other'
  | (string & {})

/** Veto threshold, or `never` for a gate that reviews and reports without ever vetoing. */
export type VetoThreshold = ReviewSeverity | 'never'

/**
 * How `ocr delegate` was asked to scope the change. Merge-extensible: the CLI
 * owns this vocabulary, and an unrecognized mode from a newer build is carried
 * into the report rather than rejected.
 */
export type DelegateMode = 'workspace' | 'range' | 'commit' | (string & {})

/** One file `ocr delegate preview` selected for review. */
export interface ReviewableFile {
  path: string
  /**
   * Git's status for the file (`added`, `modified`, …), carried verbatim.
   * Workspace mode can report one path twice — a staged deletion followed by
   * an untracked recreation — so `(path, status)` is the file's identity here,
   * never `path` alone.
   */
  status: string
  insertions: number
  deletions: number
}

/** One file `ocr delegate preview` filtered out, and why. */
export interface ExcludedFile extends ReviewableFile {
  /** The CLI's reason, e.g. `unsupported_ext`. Carried verbatim into the report. */
  excludeReason: string
}

/**
 * The scope of one review, as `ocr delegate preview` resolved it. `from`,
 * `to`, and `mergeBase` are present in range mode and absent in workspace
 * mode — the gate takes every diff it reads from `mergeBase`, never from the
 * ref it asked for, because the CLI has already done the merge-base
 * resolution.
 */
export interface DelegatePreview {
  mode: DelegateMode
  repository: string
  from?: string
  to?: string
  mergeBase?: string
  reviewable: ReviewableFile[]
  excluded: ExcludedFile[]
}

/**
 * One rule group from `ocr delegate rule`: the files sharing a rule, and the
 * rule itself. The CLI groups by rule content, so the rule text appears once
 * however many files match it.
 */
export interface RuleGroup {
  /** The glob the rule was matched by, or `default` for the fallback rule. */
  pattern: string
  /** Where the rule came from, e.g. `system` for a built-in. */
  source: string
  /** The rule's Markdown body, passed to a checker verbatim. */
  rule: string
  files: string[]
}

/** What one reviewed file changed, as a checker is shown it. */
export interface FileDiff {
  path: string
  /** The preview's status for the file; `(path, status)` is its identity. */
  status: string
  /** A unified diff, or the file's whole content when {@link FileDiff.whole} is set. */
  text: string
  /**
   * Set when `text` is the file's entire content rather than a diff — an
   * untracked file in workspace mode, which has no HEAD side to diff against
   * and whose every line is therefore new code.
   */
  whole: boolean
}

/** One finding a checker reported, in the shape `ocr delegate`'s contract defines. */
export interface ReviewComment {
  path: string
  /** What is wrong, in the checker's words. */
  content: string
  /** Line range in the new file; absent when the checker could not place it. */
  startLine?: number
  endLine?: number
  /** Carried verbatim for triage; the gate never decides on it. */
  category?: ReviewCategory
  /** The axis the veto threshold compares against, so this one is closed. */
  severity: ReviewSeverity
}

/** A file a checker declined to review, and why it said so. */
export interface SkippedFile {
  path: string
  reason: string
}

/** One checker's answer for one rule group. */
export interface CheckerVerdict {
  /** Paths the checker reports it reviewed. */
  reviewed: string[]
  /** Paths it declined, each with a reason. */
  skipped: SkippedFile[]
  comments: ReviewComment[]
}

/** What one review covered, once every group's verdict is in. */
export interface CoverageAccount {
  totalFiles: number
  reviewedFiles: number
  skippedFiles: number
  /** Reviewed over total, as a percentage rounded to one decimal place. */
  coverageRate: number
  skipped: SkippedFile[]
}

/** One edge's review policy, as the listener sees it after validation. */
export interface ResolvedEdgeReview {
  /** Subagent provider the per-group checkers start on. */
  provider: string
  /**
   * Base ref the card's changes are measured against. Present selects range
   * mode (`ocr delegate preview --from <baseRef> --to HEAD`); absent selects
   * workspace mode, which reviews uncommitted changes only.
   *
   * A card carries no git identity of its own, so this ref is the deployment's
   * answer to "what did this card change" — see the README's Known Limitations
   * for what that costs when several cards are in flight on one branch.
   */
  baseRef?: string
  /** Lowest severity that vetoes the move; `never` reviews and reports without vetoing. */
  vetoAtOrAbove: VetoThreshold
}
