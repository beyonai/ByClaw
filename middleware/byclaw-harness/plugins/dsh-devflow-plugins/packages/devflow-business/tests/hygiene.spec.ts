// Whole-base health: the total-miss-only zombie judgement, orphan detection
// that skips the buckets where being uncited is normal, and the review queue
// as a projection nothing can promote a claim by editing.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assess, renderHygiene, renderReviewQueue, REVIEW_QUEUE, zombieOf } from '../src/hygiene.ts'
import type { BusinessBucket, BusinessDoc } from '../src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function doc(overrides: Partial<BusinessDoc> & { id: string; bucket: BusinessBucket }): BusinessDoc {
  return {
    title: `Title of ${overrides.id}`,
    status: 'pending-review',
    sources: ['s1'],
    scope: 'all',
    path: `/nowhere/${overrides.id}.md`,
    body: '',
    cites: [],
    ...overrides,
  }
}

describe('zombieOf', () => {
  it('reports a document only when EVERY declared path is gone', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))
    await mkdir(join(root, 'services', 'alive'), { recursive: true })

    const allGone = await zombieOf(doc({ id: 'dead', bucket: 'scenario', watches: ['services/gone/', 'services/also-gone/'] }), root)
    const partial = await zombieOf(doc({ id: 'moved', bucket: 'scenario', watches: ['services/alive/', 'services/gone/'] }), root)

    expect(allGone).toEqual({ id: 'dead', declared: ['services/gone/', 'services/also-gone/'] })
    // A partial miss is ordinary directory reorganization. Reporting it as rot
    // would train everyone to ignore the signal.
    expect(partial).toBeUndefined()
  })

  it('says nothing about a document that declared no paths', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))

    expect(await zombieOf(doc({ id: 'undeclared', bucket: 'meta' }), root)).toBeUndefined()
    expect(await zombieOf(doc({ id: 'empty', bucket: 'meta', watches: [] }), root)).toBeUndefined()
  })
})

describe('assess', () => {
  it('reports uncited meta, principle, and reference documents only', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))
    const docs = [
      doc({ id: 'used-term', bucket: 'meta' }),
      doc({ id: 'unused-term', bucket: 'meta' }),
      doc({ id: 'unused-principle', bucket: 'principle' }),
      doc({ id: 'unused-reference', bucket: 'reference' }),
      // A scenario is an entry point a human reaches for, and a practice
      // records why something happened; neither exists to be cited.
      doc({ id: 'lonely-scenario', bucket: 'scenario', cites: ['used-term'] }),
      doc({ id: 'lonely-practice', bucket: 'practice' }),
    ]

    const report = await assess(docs, root)

    expect(report.orphans).toEqual(['unused-principle', 'unused-reference', 'unused-term'])
  })

  it('orders several zombies by id so a report reads the same twice', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))
    const docs = [
      doc({ id: 'z-later', bucket: 'scenario', watches: ['gone/'] }),
      doc({ id: 'a-earlier', bucket: 'reference', watches: ['also-gone/'] }),
    ]

    const report = await assess(docs, root)

    expect(report.zombies.map(zombie => zombie.id)).toEqual(['a-earlier', 'z-later'])
  })

  it('collects the pending set and leaves confirmed documents out', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))
    const docs = [
      doc({ id: 'settled', bucket: 'scenario', status: 'confirmed' }),
      doc({ id: 'open', bucket: 'scenario' }),
    ]

    const report = await assess(docs, root)

    expect(report.pendingReview).toEqual(['open'])
  })
})

describe('renderReviewQueue', () => {
  it('lists exactly the pending documents and says editing it promotes nothing', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))

    await renderReviewQueue(root, [
      doc({ id: 'open-b', bucket: 'principle' }),
      doc({ id: 'settled', bucket: 'meta', status: 'confirmed' }),
      doc({ id: 'open-a', bucket: 'meta' }),
    ])

    const queue = await readFile(join(root, REVIEW_QUEUE), 'utf8')
    expect(queue).toContain('promotes nothing')
    expect(queue.indexOf('id: open-a')).toBeLessThan(queue.indexOf('id: open-b'))
    expect(queue).not.toContain('id: settled')
  })

  it('writes an empty queue rather than omitting the key', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))

    await renderReviewQueue(root, [doc({ id: 'settled', bucket: 'meta', status: 'confirmed' })])

    expect(await readFile(join(root, REVIEW_QUEUE), 'utf8')).toContain('pending:\n  []')
  })

  it('survives an unwritable root, because the queue is derived state', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-hygiene-'))
    await writeFile(join(root, REVIEW_QUEUE), 'placeholder\n')

    // A directory where the projection file must go: the write fails, and the
    // documents it describes are already committed, so nothing may throw.
    await expect(renderReviewQueue(join(root, REVIEW_QUEUE), [doc({ id: 'open', bucket: 'meta' })])).resolves.toBeUndefined()
  })
})

describe('renderHygiene', () => {
  it('names each failing dimension and warns against presenting pending claims as facts', () => {
    const text = renderHygiene({
      orphans: ['unused-term'],
      zombies: [{ id: 'dead', declared: ['services/gone/'] }],
      pendingReview: ['open'],
    })

    expect(text).toContain('Zombie documents')
    expect(text).toContain('unused-term')
    expect(text).toContain('Do not present these as established domain facts')
  })

  it('says so plainly when the base is healthy', () => {
    expect(renderHygiene({ orphans: [], zombies: [], pendingReview: [] })).toContain('healthy')
  })
})
