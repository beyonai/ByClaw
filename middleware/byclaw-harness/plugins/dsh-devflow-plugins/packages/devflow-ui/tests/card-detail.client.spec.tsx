// @vitest-environment jsdom
// The detail sheet's readers of the S1 wire additions: the artifact section
// over `card.artifactRecords` and the timeline's recorded gate verdicts from
// `entry.gate.checks`. Legacy shapes — payloads carrying only the `artifacts`
// path projection, transitions without a gate or with only `approvedBy` — are
// pinned by the existing surface specs and stay untouched here.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from './harness-doubles.ts'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevCard, DevflowJournalEntry } from '@zhchxiao123/dsh-devflow/client'
import { CardDetail, type CardDetailProps } from '../src/client/board-view.tsx'
// Type-only: pulls the plugin's LocaleNamespaceMap merge into this program.
import type {} from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: CardDetailProps['t'] = makeTranslate(zh)

function card(over: Omit<Partial<DevCard>, 'id'> & { id: string }): DevCard {
  return {
    root: '/workspace/.devflow',
    title: `Card ${over.id}`,
    stage: 'developing',
    stageRevision: 4,
    body: '',
    path: `tasks/${over.id}/card.md`,
    artifacts: [],
    artifactRecords: [],
    ...over,
    id: DevflowCardId(over.id),
  }
}

function renderDetail(shown: DevCard, entries?: readonly DevflowJournalEntry[]) {
  return render(
    <CardDetail
      card={shown}
      cards={[shown]}
      entries={entries}
      holder={undefined}
      openable={[]}
      openCardDetail={vi.fn()}
      openSession={vi.fn()}
      t={t}
    />,
  )
}

describe('card detail artifact records and gate verdicts', () => {
  it('keeps path-only artifacts visible when an older payload has no records array', () => {
    const shown = card({
      id: '0000-old-payload',
      artifacts: ['artifacts/legacy.md'],
      artifactRecords: undefined,
    })
    renderDetail(shown)
    expect(screen.getByText('artifacts/legacy.md')).toBeTruthy()
  })

  it('renders the legacy no-artifacts fallback and flat requirement and relation blocks', () => {
    const shown = card({
      id: '0000-flat',
      body: 'Requirement body',
      parent: DevflowCardId('0099-archived'),
      artifacts: undefined,
      artifactRecords: undefined,
    })
    const { container } = renderDetail(shown)
    const detail = container.firstElementChild!
    expect(detail.textContent).toContain('Requirement body')
    expect(detail.textContent).toContain('0099-archived')
    expect(detail.textContent).toContain('暂无产物')
    expect(detail.querySelector('details')).toBeNull()
  })

  it('lists every registration with kind, stage, and revision, marking only the latest of a re-registered kind', () => {
    const shown = card({
      id: '0001-versions',
      artifacts: ['artifacts/2-design.md', 'artifacts/5-design.md', 'artifacts/7-review.md'],
      artifactRecords: [
        { path: 'artifacts/2-design.md', kind: 'design', rev: 2, stage: 'designing' },
        { path: 'artifacts/5-design.md', kind: 'design', rev: 5, stage: 'designing' },
        { path: 'artifacts/7-review.md', kind: 'review', rev: 7, stage: 'reviewing' },
      ],
    })
    const { container } = renderDetail(shown)
    const rows = [...container.querySelectorAll('[class*="artifactRow"]')]
    // History is the point: the superseded design registration stays listed.
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('artifacts/2-design.md'),
      expect.stringContaining('artifacts/5-design.md'),
      expect.stringContaining('artifacts/7-review.md'),
    ])
    expect(rows[0].textContent).toContain('design')
    expect(rows[0].textContent).toContain('方案设计')
    expect(rows[0].textContent).toContain('rev 2')
    expect(rows[2].textContent).toContain('review')
    expect(rows[2].textContent).toContain('评审')
    expect(rows[2].textContent).toContain('rev 7')
    // The marker sits on the re-registered kind's newest revision alone: not
    // on the version it superseded, and not on the once-registered kind.
    expect(rows.map(row => row.querySelector('[class*="artifactLatest"]') !== null)).toEqual([false, true, false])
    expect(rows[1].querySelector('[class*="artifactLatest"]')?.textContent).toBe('最新')
    // Read-only: a registration line carries no control.
    expect(container.querySelectorAll('[class*="artifactRow"] button, [class*="artifactRow"] input')).toHaveLength(0)
  })

  it('shows a neutral placeholder for a registration predating kinds, which never takes the marker', () => {
    const shown = card({
      id: '0002-legacy',
      artifacts: ['artifacts/notes.md', 'artifacts/more-notes.md'],
      artifactRecords: [
        { path: 'artifacts/notes.md', rev: 3, stage: 'developing' },
        { path: 'artifacts/more-notes.md', rev: 6, stage: 'developing' },
      ],
    })
    const { container } = renderDetail(shown)
    const rows = [...container.querySelectorAll('[class*="artifactRow"]')]
    expect(rows[0].textContent).toContain('artifacts/notes.md')
    expect(rows[0].textContent).toContain('未标注 kind')
    expect(rows[0].textContent).toContain('开发中')
    expect(rows[0].textContent).toContain('rev 3')
    // Path-only registrations supersede nothing, however many there are.
    expect(container.querySelector('[class*="artifactLatest"]')).toBeNull()
  })

  it('renders each recorded gate verdict beside the human approval, cached prefix verbatim', () => {
    const shown = card({ id: '0003-gated', stage: 'designing', stageRevision: 2 })
    renderDetail(shown, [
      { rev: 1, at: '2026-08-01T00:00:00Z', type: 'created', by: { kind: 'human' } },
      {
        rev: 2,
        at: '2026-08-02T00:00:00Z',
        type: 'transition',
        from: 'draft',
        to: 'designing',
        by: { kind: 'human' },
        gate: {
          approvedBy: { kind: 'human', name: 'reviewer' },
          checks: [
            { by: { kind: 'agent' }, verdict: 'allowed', summary: '[cached] structure holds' },
            { by: { kind: 'agent', session: 'ses-checker' }, verdict: 'allowed' },
          ],
        },
      },
    ])
    const entry = screen.getByRole('list', { name: '流转时间线' }).querySelector('li')!
    // Both gate facts of one committed move render, the approval as before.
    expect(entry.textContent).toContain('人工审批 · 人工 reviewer')
    expect(entry.textContent).toContain('闸门放行 · 智能体:[cached] structure holds')
    // A summaryless verdict still names its actor.
    expect(entry.textContent).toContain('闸门放行 · ses-checker')
  })

  it('renders a checks-only gate without inventing an approval note', () => {
    const shown = card({ id: '0004-agent-only', stage: 'ready', stageRevision: 2 })
    renderDetail(shown, [
      { rev: 1, at: '2026-08-01T00:00:00Z', type: 'created', by: { kind: 'human' } },
      {
        rev: 2,
        at: '2026-08-02T00:00:00Z',
        type: 'transition',
        from: 'designing',
        to: 'ready',
        by: { kind: 'agent', session: 'ses-worker' },
        gate: { checks: [{ by: { kind: 'agent' }, verdict: 'allowed', summary: 'design answers the PRD' }] },
      },
    ])
    const entry = screen.getByRole('list', { name: '流转时间线' }).querySelector('li')!
    expect(entry.textContent).toContain('闸门放行 · 智能体:design answers the PRD')
    expect(entry.textContent).not.toContain('人工审批')
  })
})
