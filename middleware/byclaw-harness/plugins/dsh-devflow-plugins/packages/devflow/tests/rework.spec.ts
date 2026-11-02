// Where review and verification can send a card back to. The pipeline's
// forward edges are covered by the store's own specs; this is about the two
// stages that own a fault — `developing` when the implementation is wrong,
// `designing` when the design is.
import { describe, expect, it } from 'vitest'
import { DEV_STAGES, isLegalTransition, isReworkEdge } from '@zhchxiao123/dsh-devflow'
import type { DevStage } from '@zhchxiao123/dsh-devflow'

describe('rework edges', () => {
  it.each([
    { from: 'developing', to: 'designing' },
    { from: 'reviewing', to: 'developing' },
    { from: 'reviewing', to: 'designing' },
    { from: 'testing', to: 'developing' },
    { from: 'testing', to: 'designing' },
  ] as const)('sends $from back to $to, and counts it as rework', ({ from, to }) => {
    expect(isLegalTransition(from, to)).toBe(true)
    expect(isReworkEdge(from, to)).toBe(true)
  })

  // `developing` joined this list: implementing a design is the most common
  // way to discover it is wrong, and without the edge the only route back was
  // `developing -> reviewing -> designing`, which journals a review nobody ran.
  it('does not let anything else reach designing', () => {
    const reaching = DEV_STAGES.filter(stage => isLegalTransition(stage, 'designing'))
    expect(reaching).toEqual(['draft', 'developing', 'reviewing', 'testing'])
    // `draft -> designing` is the pipeline's first forward edge, not a rework.
    expect(isReworkEdge('draft', 'designing')).toBe(false)
  })

  it('leaves developing by review or by design rework, and nothing else', () => {
    const exits = DEV_STAGES.filter(stage => isLegalTransition('developing', stage))
    expect(exits).toEqual(['designing', 'reviewing'])
    expect(isReworkEdge('developing', 'reviewing')).toBe(false)
  })

  it('keeps every forward edge, and done terminal', () => {
    const forward: [DevStage, DevStage][] = [
      ['draft', 'designing'],
      ['designing', 'ready'],
      ['ready', 'developing'],
      ['developing', 'reviewing'],
      ['reviewing', 'testing'],
      ['testing', 'done'],
    ]
    for (const [from, to] of forward) {
      expect(isLegalTransition(from, to)).toBe(true)
      expect(isReworkEdge(from, to)).toBe(false)
    }
    // Nothing leaves `done`: reopening a delivered card would also have to
    // reach into the archive, which the seam cannot read.
    for (const stage of DEV_STAGES) expect(isLegalTransition('done', stage)).toBe(false)
    expect(isLegalTransition('done', 'blocked')).toBe(false)
  })
})
