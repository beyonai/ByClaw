/**
 * The pure renderer: empty board, stage-ordered counts with the blocked
 * bypass, claimed lines, brace sanitization, and the byte cap (truncation
 * announced; counts and guidance survive even when no claimed line fits).
 */
import { describe, expect, it } from 'vitest'
import { renderSnapshot, SNAPSHOT_MAX_BYTES } from '../src/snapshot.ts'
import type { SnapshotCard } from '../src/types.ts'

function card(id: string, stage: SnapshotCard['stage'], title = `Title of ${id}`, claimed = false): SnapshotCard {
  return { id, title, stage, claimed }
}

describe('renderSnapshot', () => {
  it('renders nothing for an empty board', () => {
    expect(renderSnapshot([])).toBe('')
  })

  it('renders stage counts in pipeline order, the blocked count, claimed lines, and the guidance line', () => {
    const text = renderSnapshot([
      card('05-e', 'done'),
      card('02-b', 'draft'),
      card('03-c', 'developing', 'Parser rewrite', true),
      card('04-d', 'blocked', 'Stuck migration', true),
      card('01-a', 'draft'),
    ])
    expect(text).toBe([
      'Devflow board: 5 cards (draft 2, developing 1, done 1, blocked 1).',
      'Claimed: 03-c [developing] Parser rewrite',
      'Claimed: 04-d [blocked] Stuck migration',
      'New requirements start with devflow_create; process knowledge lives in the devflow-workflow skill.',
    ].join('\n'))
  })

  it('speaks of a single card in the singular', () => {
    expect(renderSnapshot([card('01-a', 'draft')])).toContain('Devflow board: 1 card (draft 1).')
  })

  it('breaks {{ }} pairs from card-derived text so the prompt renderer cannot read them as variable references', () => {
    const text = renderSnapshot([{ id: '01-{{a}}', title: 'Support {{env}} templates', stage: 'developing', claimed: true }])
    expect(text).toContain('Claimed: 01-{ {a} } [developing] Support { {env} } templates')
    expect(text).not.toMatch(/\{\{[\s\S]*\}\}/)
  })

  it('drops claimed lines from the end and announces the drop once the cap is exceeded', () => {
    const cards = Array.from({ length: 30 }, (_, index) =>
      card(`${String(index + 1).padStart(2, '0')}-card`, 'developing', `A long enough claimed-card title number ${String(index + 1)}`, true))

    const text = renderSnapshot(cards)

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES)
    // Earlier entries survive; the drop is taken from the end and announced.
    expect(text).toContain('Claimed: 01-card')
    expect(text).toContain('claimed list truncated:')
    expect(text).toContain('New requirements start with devflow_create')
  })

  it('keeps the counts and the truncation notice even when not one claimed line fits', () => {
    const text = renderSnapshot([card('01-a', 'developing', 'x'.repeat(2 * SNAPSHOT_MAX_BYTES), true)])

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES)
    expect(text).not.toContain('Claimed:')
    expect(text).toContain('claimed list truncated: 1 more')
    expect(text).toContain('Devflow board: 1 card (developing 1).')
  })
})
