/**
 * Whole-base health: which documents nothing cites, which describe paths that
 * are all gone, and which still await human confirmation.
 *
 * None of this interrupts a turn. A stale iron rule is an obligation and
 * blocks; business knowledge is a REFERENCE, and its reader owes it a look
 * rather than a fight. The report is pulled — by the distillation skill's own
 * self-check step, or by any consumer of the `devflowBusiness` service — never
 * pushed into a model step.
 * @module @zhchxiao123/dsh-devflow-business/hygiene
 */

import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SOURCE_MANIFEST } from './store.ts'
import type { BusinessDoc, BusinessHygieneReport, BusinessZombie } from './types.ts'

/** The projection file listing what still needs a human. */
export const REVIEW_QUEUE = 'review-queue.yaml'

/**
 * Buckets where being uncited is the normal resting state.
 *
 * A `scenario` is an entry point a human reaches for directly, and a
 * `practice` records why something happened — neither exists to be cited by
 * another document. Reporting them as orphans would bury the cases that
 * matter: a `meta` term nothing uses, or a `principle` no scenario applies.
 */
const UNCITED_IS_NORMAL: ReadonlySet<string> = new Set(['scenario', 'practice'])

/** Whether `path` exists at all. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // stat is the try's only operation, so a missing path is the only failure.
    return false
  }
}

/**
 * Measure one document's watch declaration against the tree.
 *
 * A TOTAL miss is reported. A partial one is ordinary directory
 * reorganization, and reporting it as rot would train people to ignore the
 * signal — a false positive here costs the whole mechanism.
 * @param doc - the document to measure.
 * @param projectRoot - absolute root the declared paths resolve against.
 * @returns the zombie record, or `undefined` when the document declared
 *   nothing or still describes something that exists.
 */
export async function zombieOf(doc: BusinessDoc, projectRoot: string): Promise<BusinessZombie | undefined> {
  const watches = doc.watches
  if (watches === undefined || watches.length === 0) return undefined
  const present = await Promise.all(watches.map(async watch => await pathExists(join(projectRoot, watch))))
  return present.some(exists => exists) ? undefined : { id: doc.id, declared: watches }
}

/**
 * Assess the whole base.
 *
 * Orphan detection lives here rather than in the write path on purpose: a
 * citation lives in a DIFFERENT document, so the first document of a domain is
 * always uncited, and refusing it at write time would refuse the only correct
 * authoring order — meaning first, then the scenarios that use it.
 * @param docs - every parsed document.
 * @param projectRoot - absolute root the declared paths resolve against.
 * @returns the orphan, zombie, and pending-review sets, each id-ordered.
 */
export async function assess(docs: readonly BusinessDoc[], projectRoot: string): Promise<BusinessHygieneReport> {
  const cited = new Set(docs.flatMap(doc => [...doc.cites]))
  const orphans = docs
    .filter(doc => !UNCITED_IS_NORMAL.has(doc.bucket) && !cited.has(doc.id))
    .map(doc => doc.id)
    .sort()
  const zombies = (await Promise.all(docs.map(async doc => await zombieOf(doc, projectRoot))))
    .filter((zombie): zombie is BusinessZombie => zombie !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
  const pendingReview = docs.filter(doc => doc.status === 'pending-review').map(doc => doc.id).sort()
  return { orphans, zombies, pendingReview }
}

/**
 * Rebuild the review-queue projection.
 *
 * The queue is derived, never authoritative: the status of record is the
 * `status:` line in each document, and this file is regenerated from those.
 * Editing the queue promotes nothing.
 * @param businessDir - absolute business root.
 * @param docs - every document the base will hold after the current write.
 * @returns nothing; a write failure is swallowed and logged by the caller's
 *   own path, because a stale projection must not fail a committed document.
 */
export async function renderReviewQueue(businessDir: string, docs: readonly BusinessDoc[]): Promise<void> {
  const pending = docs.filter(doc => doc.status === 'pending-review').sort((left, right) => left.id.localeCompare(right.id))
  const lines = [
    "# Derived from every document's status line; regenerated on each write.",
    '# Editing this file promotes nothing — confirm a claim by editing its own',
    '# status line, which is a reviewed change.',
    'pending:',
    ...pending.length === 0
      ? ['  []']
      : pending.flatMap(doc => [
        `  - id: ${doc.id}`,
        `    bucket: ${doc.bucket}`,
        `    title: ${JSON.stringify(doc.title)}`,
        `    sources: ${doc.sources.join(' ')}`,
      ]),
  ]
  await writeFile(join(businessDir, REVIEW_QUEUE), `${lines.join('\n')}\n`, 'utf8').catch(() => {
    // The queue is a projection of state already committed to the documents;
    // losing it costs visibility, never truth, and the next write rebuilds it.
  })
}

/**
 * Render a hygiene report for a human or a skill's self-check step.
 * @param report - the assessed report.
 * @returns the report as text, or a single line when the base is healthy.
 */
export function renderHygiene(report: BusinessHygieneReport): string {
  const sections: string[] = []
  if (report.zombies.length > 0) {
    sections.push(
      'Zombie documents (every declared path is gone — they describe nothing that still exists):\n'
      + report.zombies.map(zombie => `  ${zombie.id}: ${zombie.declared.join(' ')}`).join('\n'),
    )
  }
  if (report.orphans.length > 0) {
    sections.push(`Uncited meta/principle/reference documents: ${report.orphans.join(', ')}`)
  }
  if (report.pendingReview.length > 0) {
    sections.push(
      `Awaiting human confirmation (${String(report.pendingReview.length)}, listed in ${REVIEW_QUEUE}): ${report.pendingReview.join(', ')}\n`
      + '  Do not present these as established domain facts. High-risk semantics — API contracts,\n'
      + '  DB meanings, MQ schemas, state machines, security policy — need confirmation before use.',
    )
  }
  return sections.length > 0
    ? sections.join('\n\n')
    : `Business knowledge is healthy: nothing uncited, nothing orphaned by a vanished path, nothing awaiting review. Sources are registered in ${SOURCE_MANIFEST}.`
}
