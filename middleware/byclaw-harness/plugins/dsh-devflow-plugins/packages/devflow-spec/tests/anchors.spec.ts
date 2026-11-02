// The Definition-owned anchor vocabulary and the structural predicates every
// write must pass: id legality, the Source of truth section, the two-way
// citation relation, and how verdicts roll up to one freshness.
import { describe, expect, it } from 'vitest'
import {
  ANCHOR_KINDS,
  SOURCE_OF_TRUTH_HEADING,
  checkAnchorCitations,
  checkWaivers,
  citedAnchorIds,
  hasSourceOfTruth,
  isAnchorKind,
  isValidSpecId,
  worstFreshness,
} from '@zhchxiao123/dsh-devflow-spec'
import type { AnchorVerdict, SpecAnchor } from '@zhchxiao123/dsh-devflow-spec'

const symbolAnchor: SpecAnchor = { id: 'a1', kind: 'symbol', file: 'packages/devflow/src/types.ts', symbol: 'CreateRejectionCode' }
const churnAnchor: SpecAnchor = { id: 'a2', kind: 'churn', file: 'packages/devflow/src/journal.ts' }

describe('anchor kinds', () => {
  it('narrows the three declared kinds and nothing else', () => {
    for (const kind of ANCHOR_KINDS) expect(isAnchorKind(kind)).toBe(true)
    expect(isAnchorKind('line-range')).toBe(false)
    expect(isAnchorKind(undefined)).toBe(false)
  })
})

describe('spec id legality', () => {
  it('accepts slash-joined scope segments', () => {
    expect(isValidSpecId('@zhchxiao123/dsh-devflow/backend/error-handling')).toBe(true)
    expect(isValidSpecId('guides/cross-layer')).toBe(true)
    expect(isValidSpecId('versioning')).toBe(true)
  })

  it('rejects traversal at the id, before any path is built', () => {
    expect(isValidSpecId('../escape')).toBe(false)
    expect(isValidSpecId('a/../b')).toBe(false)
    expect(isValidSpecId('.')).toBe(false)
  })

  it('rejects segments no directory name may carry', () => {
    expect(isValidSpecId('/leading')).toBe(false)
    expect(isValidSpecId('trailing/')).toBe(false)
    expect(isValidSpecId('Upper/case')).toBe(false)
    expect(isValidSpecId('has space/x')).toBe(false)
    expect(isValidSpecId('back\\slash')).toBe(false)
  })
})

describe('Source of truth section', () => {
  it('finds the exact second-level heading', () => {
    expect(hasSourceOfTruth(`# Title\n\n## ${SOURCE_OF_TRUTH_HEADING}\n\n| Anchor |\n`)).toBe(true)
    expect(hasSourceOfTruth(`## ${SOURCE_OF_TRUTH_HEADING}   \n`)).toBe(true)
  })

  it('rejects a document that only alludes to one', () => {
    expect(hasSourceOfTruth('# Title\n\nThe source of truth is types.ts.\n')).toBe(false)
    expect(hasSourceOfTruth(`### ${SOURCE_OF_TRUTH_HEADING}\n`)).toBe(false)
    expect(hasSourceOfTruth('## Source Of Truth\n')).toBe(false)
  })
})

describe('anchor citations', () => {
  it('collects cited ids, trimmed and deduplicated', () => {
    expect([...citedAnchorIds('rests on [[a1]] and [[ a1 ]] plus [[a2]]')].sort()).toEqual(['a1', 'a2'])
    expect(citedAnchorIds('no citations here').size).toBe(0)
  })

  it('accepts a document whose declared anchors are all cited', () => {
    expect(checkAnchorCitations([symbolAnchor, churnAnchor], 'claim [[a1]], other claim [[a2]]')).toBeUndefined()
  })

  it('rejects a duplicate anchor id, which would make citations ambiguous', () => {
    const defect = checkAnchorCitations([symbolAnchor, { ...churnAnchor, id: 'a1' }], 'claim [[a1]]')
    expect(defect?.code).toBe('duplicate-anchor-id')
    expect(defect?.message).toContain('a1')
  })

  it('rejects an anchor nothing cites', () => {
    const defect = checkAnchorCitations([symbolAnchor, churnAnchor], 'only [[a1]] is cited')
    expect(defect?.code).toBe('uncited-anchor')
    expect(defect?.message).toContain('a2')
  })

  it('rejects a citation no anchor defines', () => {
    const defect = checkAnchorCitations([symbolAnchor], 'claim [[a1]] and claim [[a9]]')
    expect(defect?.code).toBe('unknown-anchor')
    expect(defect?.message).toContain('a9')
  })
})

describe('waived scopes', () => {
  const id = 'excalidraw-monorepo/examples/rationale'

  it('accepts several scopes the document does not itself cover', () => {
    expect(checkWaivers(id, ['examples/with-nextjs', 'examples/with-script-in-browser'])).toBeUndefined()
    expect(checkWaivers(id, [])).toBeUndefined()
  })

  it('rejects an entry no directory name could carry, with the id code', () => {
    const defect = checkWaivers(id, ['examples/with-nextjs', '../escape'])
    expect(defect?.code).toBe('invalid-id')
    expect(defect?.message).toContain('../escape')
  })

  it('rejects waiving the document\'s own id', () => {
    const defect = checkWaivers(id, [id])
    expect(defect?.code).toBe('self-waiver')
    expect(defect?.message).toContain(id)
  })

  it('rejects waiving any scope the document lives under', () => {
    expect(checkWaivers(id, ['excalidraw-monorepo'])?.code).toBe('self-waiver')
    expect(checkWaivers(id, ['excalidraw-monorepo/examples'])?.code).toBe('self-waiver')
  })

  it('allows a scope below the document, which the document does not cover', () => {
    // list('excalidraw-monorepo/examples/rationale/deep') would not answer with
    // this document, so that scope is genuinely undocumented and waivable.
    expect(checkWaivers(id, [`${id}/deep`])).toBeUndefined()
    // A shared prefix that is not a whole segment is a different scope too.
    expect(checkWaivers(id, ['excalidraw-monorepo-tools'])).toBeUndefined()
  })

  it('judges neither whether a waived scope exists nor whether it is waived twice', () => {
    expect(checkWaivers(id, ['nobody/expects-this'])).toBeUndefined()
    expect(checkWaivers(id, ['examples/with-nextjs', 'examples/with-nextjs'])).toBeUndefined()
  })
})

describe('rolled-up freshness', () => {
  const fresh: AnchorVerdict = { id: 'a1', status: 'fresh' }
  const stale: AnchorVerdict = { id: 'a2', status: 'stale', reason: 'symbol renamed' }
  const unevaluable: AnchorVerdict = { id: 'a3', status: 'unevaluable', reason: 'no git' }

  it('reports fresh only when every anchor is fresh', () => {
    expect(worstFreshness([fresh, fresh])).toBe('fresh')
    expect(worstFreshness([])).toBe('fresh')
  })

  it('lets one definite failure outrank any number of unknowns', () => {
    expect(worstFreshness([fresh, unevaluable, stale])).toBe('stale')
  })

  it('never folds unevaluable into fresh', () => {
    expect(worstFreshness([fresh, unevaluable])).toBe('unevaluable')
  })
})
