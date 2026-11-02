/**
 * Vocabulary types of the agent admission gate: the per-edge check
 * configuration, the checker's structured verdict, and the durable
 * verdict-cache record. Runtime code lives in the package root.
 * @module @zhchxiao123/dsh-devflow-agent-gate/types
 */

/** One edge's admission check. */
export interface EdgeCheck {
  /** Registered subagent provider each one-shot checker starts on. */
  provider: string
  /**
   * Artifact kinds whose newest registration is inlined into the checker
   * prompt. A kind with no registration is skipped — requiring presence is the
   * mechanical artifact gate's contract, composed ahead of this one.
   */
  inputs?: string[]
  /** The deployment's check instruction, leading the checker prompt. */
  prompt: string
}

/**
 * The structured verdict a checker must end its reply with, as the last
 * parsable fenced JSON block. A reply carrying no such block fails closed.
 */
export interface CheckerVerdict {
  verdict: 'allow' | 'veto'
  /** One-line account, recorded in the journal check or the veto reason. */
  summary: string
  /** Individual findings, recorded in the veto report. */
  findings?: string[]
}

/**
 * Identity of one check outcome: the same key means the checker would see the
 * same card body (immutable after creation), the same input contents (records
 * are immutable, so kind:rev pairs pin them), and the same instruction — so
 * the recorded verdict is reused instead of re-dispatching. The card and root
 * are part of the key because input revisions are per-card journal facts:
 * without them, one card's approval could admit another card's move.
 */
export interface VerdictCacheKey {
  edge: string
  root: string
  card: string
  /** Sorted `kind:rev` pairs of the inputs the checker saw. */
  inputs: string[]
  /** SHA-256 hex of the configured check instruction. */
  promptSha256: string
}

/**
 * Durable record of one verdict under `verdictCacheDir`. The key detail is
 * stored in full so a hit requires field-by-field equality (cheap insurance
 * against a filename-hash collision) and so a human can audit or delete one
 * cached decision.
 */
export interface VerdictCacheRecord {
  key: VerdictCacheKey
  verdict: CheckerVerdict['verdict']
  summary: string
  /** The veto report the cached rejection keeps pointing at. */
  reportPath?: string
  /** ISO timestamp of the original check. */
  at: string
}
