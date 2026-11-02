// The artifact-kind and gate-check vocabulary at the durable boundary: kinded
// artifact entries and widened gates decode, entries predating both fields
// decode to the same shapes they always had, and the record fold derives one
// registration list every consumer shares.
import { describe, expect, it } from 'vitest'
import { decodeJournalEntry, foldArtifactRecords, foldJournal } from '@zhchxiao123/dsh-devflow'
import type { DevflowJournalEntry } from '@zhchxiao123/dsh-devflow'

function entry(value: object): DevflowJournalEntry {
  return decodeJournalEntry(value)
}

const CREATED = { rev: 1, at: 't1', type: 'created', by: { kind: 'human', name: 'dev' } }

describe('decodeJournalEntry artifact kinds', () => {
  it('decodes a kinded artifact entry and omits the key for an unkinded one', () => {
    expect(entry({ rev: 2, at: 't', type: 'artifact', path: 'artifacts/2-design.md', stage: 'designing', kind: 'design' }))
      .toMatchObject({ type: 'artifact', path: 'artifacts/2-design.md', kind: 'design' })
    const legacy = entry({ rev: 2, at: 't', type: 'artifact', path: 'artifacts/design.md', stage: 'designing' })
    expect('kind' in legacy).toBe(false)
  })

  it.each([
    { label: 'empty kind', value: { rev: 2, at: 't', type: 'artifact', path: 'a', stage: 'draft', kind: '' } },
    { label: 'non-string kind', value: { rev: 2, at: 't', type: 'artifact', path: 'a', stage: 'draft', kind: 7 } },
  ])('rejects $label loudly', ({ value }) => {
    expect(() => entry(value)).toThrow('"kind" must be a non-empty string')
  })
})

describe('decodeJournalEntry gate checks', () => {
  const TRANSITION = { rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing' }

  it('decodes a checks-only gate, an approval-only gate, and both together', () => {
    const check = { by: { kind: 'agent', session: 'checker' }, verdict: 'allowed', summary: 'lint clean' }
    expect(entry({ ...TRANSITION, gate: { checks: [check] } }))
      .toMatchObject({ gate: { checks: [check] } })
    const checksOnly = entry({ ...TRANSITION, gate: { checks: [check] } }) as { gate: { approvedBy?: unknown } }
    expect('approvedBy' in checksOnly.gate).toBe(false)
    expect(entry({ ...TRANSITION, gate: { approvedBy: { kind: 'human' } } }))
      .toMatchObject({ gate: { approvedBy: { kind: 'human' } } })
    expect(entry({ ...TRANSITION, gate: { approvedBy: { kind: 'human' }, checks: [{ by: { kind: 'agent' }, verdict: 'allowed' }] } }))
      .toMatchObject({ gate: { approvedBy: { kind: 'human' }, checks: [{ by: { kind: 'agent' }, verdict: 'allowed' }] } })
  })

  it('omits the summary key when a check carries none', () => {
    const decoded = entry({ ...TRANSITION, gate: { checks: [{ by: { kind: 'agent' }, verdict: 'allowed' }] } }) as {
      gate: { checks: object[] }
    }
    expect('summary' in decoded.gate.checks[0]).toBe(false)
  })

  it.each([
    { label: 'an empty gate', gate: {}, message: '"gate" requires "approvedBy" or "checks"' },
    { label: 'non-array checks', gate: { checks: 'lint' }, message: '"gate.checks" must be an array' },
    { label: 'a non-object check', gate: { checks: ['lint'] }, message: 'gate check must be a JSON object' },
    { label: 'a refusing verdict', gate: { checks: [{ by: { kind: 'agent' }, verdict: 'denied' }] }, message: 'gate check field "verdict" must be "allowed" (got "denied")' },
    { label: 'a check without an actor', gate: { checks: [{ verdict: 'allowed' }] }, message: 'actor must be a JSON object' },
    { label: 'an empty check summary', gate: { checks: [{ by: { kind: 'agent' }, verdict: 'allowed', summary: '' }] }, message: '"summary" must be a non-empty string' },
  ])('rejects $label loudly', ({ gate, message }) => {
    expect(() => entry({ ...TRANSITION, gate })).toThrow(message)
  })
})

describe('foldArtifactRecords', () => {
  it('derives records in registration order, with kinds only where the entry carries one', () => {
    const entries = [
      entry(CREATED),
      entry({ rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing' }),
      entry({ rev: 3, at: 't', type: 'artifact', path: 'artifacts/design.md', stage: 'designing' }),
      entry({ rev: 4, at: 't', type: 'artifact', path: 'artifacts/4-design.md', stage: 'designing', kind: 'design' }),
      entry({ rev: 5, at: 't', type: 'claim-expired', previousOwner: { kind: 'agent' }, by: { kind: 'command' } }),
    ]
    const records = foldArtifactRecords(entries)
    expect(records).toEqual([
      { path: 'artifacts/design.md', rev: 3, stage: 'designing' },
      { path: 'artifacts/4-design.md', kind: 'design', rev: 4, stage: 'designing' },
    ])
    expect('kind' in records[0]).toBe(false)
    // The fold's own artifact list stays this list's path projection.
    expect(foldJournal(entries).artifacts).toEqual(records.map(record => record.path))
  })

  it('derives no records from a journal without artifact entries', () => {
    expect(foldArtifactRecords([entry(CREATED)])).toEqual([])
  })
})
