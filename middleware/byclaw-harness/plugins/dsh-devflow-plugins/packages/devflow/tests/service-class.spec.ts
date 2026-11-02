// Which edges each service class may take. The shape that matters is the
// superset relation: a class adds shortcuts and removes nothing, so no journal
// that replays under `standard` can stop replaying under another class.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SERVICE_CLASS, DEV_STAGES, SERVICE_CLASSES, isLegalTransition, isReworkEdge, isServiceClass } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevStage, ServiceClass } from '@zhchxiao123/dsh-devflow'

const LOCATIONS: readonly CardLocation[] = [...DEV_STAGES, 'blocked']

/** Every legal move of one class, as `from->to` strings. */
function edgesOf(serviceClass: ServiceClass, blockedFrom?: DevStage): Set<string> {
  const edges = new Set<string>()
  for (const from of LOCATIONS) {
    for (const to of LOCATIONS) {
      if (isLegalTransition(from, to, { serviceClass, blockedFrom })) edges.add(`${from}->${to}`)
    }
  }
  return edges
}

describe('service classes', () => {
  it('narrows exactly the closed vocabulary', () => {
    expect(SERVICE_CLASSES).toEqual(['standard', 'express', 'emergency'])
    for (const value of SERVICE_CLASSES) expect(isServiceClass(value)).toBe(true)
    for (const value of ['', 'STANDARD', 'urgent', 7, null, undefined]) {
      expect(isServiceClass(value)).toBe(false)
    }
    expect(isServiceClass(DEFAULT_SERVICE_CLASS)).toBe(true)
  })

  it('leaves standard identical to the pipeline, and treats an unstated class as standard', () => {
    const standard = edgesOf('standard')
    const unstated = new Set<string>()
    for (const from of LOCATIONS) {
      for (const to of LOCATIONS) if (isLegalTransition(from, to)) unstated.add(`${from}->${to}`)
    }
    expect(unstated).toEqual(standard)
    expect(standard.has('draft->developing')).toBe(false)
    expect(standard.has('reviewing->done')).toBe(false)
    expect(standard.has('developing->done')).toBe(false)
  })

  // The invariant the whole design rests on: a class only ever adds.
  it.each(SERVICE_CLASSES)('keeps %s a superset of standard', (serviceClass) => {
    const standard = edgesOf('standard')
    const classed = edgesOf(serviceClass)
    for (const edge of standard) expect(classed.has(edge)).toBe(true)
  })

  it.each([
    { serviceClass: 'express', added: ['draft->developing', 'reviewing->done'] },
    { serviceClass: 'emergency', added: ['draft->developing', 'developing->done'] },
  ] as const)('gives $serviceClass exactly its shortcuts', ({ serviceClass, added }) => {
    const standard = edgesOf('standard')
    const extra = [...edgesOf(serviceClass)].filter(edge => !standard.has(edge))
    expect(extra.sort()).toEqual([...added].sort())
  })

  // A shortcut jumps forward; it is never a way back, so the reason contract
  // that guards rework does not apply to any of them.
  it('counts no shortcut as rework', () => {
    for (const serviceClass of SERVICE_CLASSES) {
      const standard = edgesOf('standard')
      for (const edge of edgesOf(serviceClass)) {
        if (standard.has(edge)) continue
        const [from, to] = edge.split('->') as [CardLocation, CardLocation]
        expect(isReworkEdge(from, to)).toBe(false)
      }
    }
  })

  it('keeps done terminal and the blocked bypass class-independent', () => {
    for (const serviceClass of SERVICE_CLASSES) {
      for (const to of LOCATIONS) {
        expect(isLegalTransition('done', to, { serviceClass })).toBe(false)
      }
      for (const stage of DEV_STAGES) {
        expect(isLegalTransition(stage, 'blocked', { serviceClass })).toBe(stage !== 'done')
      }
      // A blocked card recovers to the stage it interrupted and nowhere else,
      // whatever shortcuts its class would otherwise offer.
      expect(edgesOf(serviceClass, 'developing')).toEqual(
        new Set([...edgesOf('standard', 'developing'), ...[...edgesOf(serviceClass)].filter(
          edge => !edgesOf('standard').has(edge),
        )]),
      )
      expect(isLegalTransition('blocked', 'done', { serviceClass, blockedFrom: 'developing' })).toBe(false)
    }
  })
})
