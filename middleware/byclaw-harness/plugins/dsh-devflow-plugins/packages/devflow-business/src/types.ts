/**
 * Vocabulary types of the business-knowledge plugin: the document shape on
 * disk, the write input, the closed rejection set, and the optional
 * `devflowBusiness` service other plugins read knowledge through.
 *
 * The bucket vocabulary is closed for the same reason the card stage list is:
 * a sixth bucket is a modelling decision, not a deployment choice, and an open
 * set would let one escape review as a config value.
 * @module @zhchxiao123/dsh-devflow-business/types
 */

import type {} from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional business-knowledge seam published by this plugin. Reading is
     * also possible through the ordinary file tools — the fs guard fences
     * writes only — so this service exists for consumers that want the parsed
     * shape rather than the bytes. Consumers read it with
     * `ctx.get('devflowBusiness')`; a deployment without the plugin has no
     * business knowledge at all.
     */
    devflowBusiness: DevflowBusiness
  }
}

/**
 * The closed set of buckets a document lives in. Each answers a different
 * question about one business domain, and the reading order is the list order:
 * meaning first, then the constraints that cross scenarios, then how a
 * scenario reaches the systems, then why things are the way they are, then
 * what belongs to a neighbouring domain.
 */
export type BusinessBucket = 'meta' | 'principle' | 'scenario' | 'practice' | 'reference'

/**
 * Whether a claim has been confirmed by a human.
 *
 * `pending-review` is what every write produces. `confirmed` is reachable only
 * by editing the file, which is a reviewed change — the same posture iron
 * rules take toward `owner: admin`, and for the same reason: the force of the
 * stronger state comes from the review, so minting it from a chat turn would
 * skip exactly what gives it that force.
 */
export type BusinessStatus = 'confirmed' | 'pending-review'

/** One parsed document under a bucket directory. */
export interface BusinessDoc {
  /** The filename stem — the authoritative id, cited as `[[id]]`. */
  readonly id: string
  /** Which bucket directory it was found in. */
  readonly bucket: BusinessBucket
  /** One-line statement from the frontmatter. */
  readonly title: string
  /** `confirmed` only when the file says so; every other value reads as pending. */
  readonly status: BusinessStatus
  /** Source-manifest entry ids this document rests on; never empty. */
  readonly sources: readonly string[]
  /** What the claim applies to, in the domain's own words. */
  readonly scope: string
  /** Absolute path of the document file. */
  readonly path: string
  /** The Markdown body below the frontmatter, trimmed. */
  readonly body: string
  /** Ids the body cites as `[[id]]`, in first-appearance order, deduplicated. */
  readonly cites: readonly string[]
  /** When a human last confirmed the claim, as written in the frontmatter. */
  readonly lastConfirmed?: string
  /**
   * Workspace-relative paths this document claims to describe.
   *
   * `undefined` means none were declared, which is NOT the same as declaring
   * an empty set: drift is unknowable without a declaration, and "unknown"
   * must not read as "rotten".
   */
  readonly watches?: readonly string[]
}

/** Everything one discovery pass found, including what it refused. */
export interface BusinessDocSet {
  /** Absolute workspace root the declared watch paths resolve against. */
  readonly projectRoot: string
  /** Absolute path of the business root, whether or not it exists. */
  readonly businessDir: string
  /** Parsed documents ordered by bucket, then by id. */
  readonly docs: readonly BusinessDoc[]
  /** Source ids registered in `source-manifest.yaml`. */
  readonly sources: readonly string[]
  /** Human-readable reasons individual files were skipped or corrected. */
  readonly warnings: readonly string[]
}

/** The parsed halves of one document file. */
export interface ParsedBusinessFile {
  readonly frontmatter: Readonly<Record<string, string>>
  readonly body: string
}

/**
 * The closed set of reasons a write is refused.
 *
 * Every one of these is decided before the first byte reaches disk, so a
 * refused write leaves the knowledge base exactly as it was. There is
 * deliberately no code for an unreferenced document: a citation lives in a
 * DIFFERENT document here, so the first document of a new domain is always
 * uncited, and refusing it would refuse the only correct authoring order.
 * Orphan detection belongs to {@link BusinessHygieneReport}.
 */
export type BusinessWriteRejection =
  | 'invalid-id'
  | 'invalid-title'
  | 'unknown-bucket'
  | 'no-sources'
  | 'unregistered-source'
  | 'dangling-reference'
  | 'exists'

/** What the tool and the service both supply to the shared write path. */
export interface BusinessWriteInput {
  readonly id: string
  readonly bucket: BusinessBucket
  readonly title: string
  readonly body: string
  /**
   * Source-manifest entry ids this claim rests on. Inline URLs are refused on
   * purpose: allowing them would let a claim bypass source registration, and
   * "unregistered material is not a source" is the first discipline of
   * distillation.
   */
  readonly sources: readonly string[]
  /** What the claim applies to, in the domain's own words. */
  readonly scope: string
  /** Workspace-relative paths this document describes; for `scenario` and `reference`. */
  readonly watches?: readonly string[]
  /**
   * Ids this document replaces; they are deleted after the replacement lands.
   * One id revises in place, several merge a cluster — the only way the
   * knowledge base shrinks instead of only growing.
   */
  readonly replaces?: readonly string[]
}

/** The settled outcome, phrased for whichever surface asked. */
export interface BusinessWriteOutcome {
  readonly ok: boolean
  /** The closed rejection code; absent on success. */
  readonly code?: BusinessWriteRejection
  readonly text: string
}

/** One document whose declared paths have all disappeared. */
export interface BusinessZombie {
  readonly id: string
  /** Paths the document declared, none of which still exist. */
  readonly declared: readonly string[]
}

/**
 * Whole-base health, which is a different question from whether one write is
 * legal. Nothing here interrupts a turn: business knowledge is a reference,
 * and its reader owes it a look rather than a fight.
 */
export interface BusinessHygieneReport {
  /** Documents nothing cites, excluding buckets where being uncited is normal. */
  readonly orphans: readonly string[]
  /** Documents whose every declared path is gone. */
  readonly zombies: readonly BusinessZombie[]
  /** Ids of documents awaiting human confirmation. */
  readonly pendingReview: readonly string[]
}

/** The read surface other plugins reach business knowledge through. */
export interface DevflowBusiness {
  /**
   * One document from the calling agent's workspace.
   * @param agent - the agent whose workspace carries the knowledge base.
   * @param id - the document id.
   * @returns the parsed document, or `undefined` when no such id exists.
   */
  read(agent: Agent, id: string): Promise<BusinessDoc | undefined>
  /**
   * Every document, optionally narrowed to one bucket.
   * @param agent - the agent whose workspace carries the knowledge base.
   * @param bucket - the bucket to narrow to; all buckets when omitted.
   * @returns the documents in bucket order, then id order.
   */
  list(agent: Agent, bucket?: BusinessBucket): Promise<readonly BusinessDoc[]>
  /**
   * Whole-base health for the calling agent's workspace.
   * @param agent - the agent whose workspace carries the knowledge base.
   * @returns the orphan, zombie, and pending-review sets.
   */
  hygiene(agent: Agent): Promise<BusinessHygieneReport>
}
