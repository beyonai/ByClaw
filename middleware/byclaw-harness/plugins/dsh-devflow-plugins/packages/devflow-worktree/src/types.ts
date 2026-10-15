/**
 * Types of the worktree dispatch record.
 * @module @zhchxiao123/dsh-devflow-worktree/types
 */

/**
 * A card's dispatch record, read from the newest artifact of the configured
 * kind. The artifact is Markdown whose frontmatter carries exactly these
 * three plain-scalar fields; further fields are tolerated so a deployment can
 * annotate a dispatch without breaking the fence.
 */
export interface WorktreeDispatch {
  /** Branch the card is developed on, e.g. `devflow/0007-slug`. */
  readonly branch: string
  /** Ref the card's changes are measured against, e.g. `main`. */
  readonly base: string
  /** Absolute path of the linked worktree the card is dispatched to. */
  readonly worktree: string
}
