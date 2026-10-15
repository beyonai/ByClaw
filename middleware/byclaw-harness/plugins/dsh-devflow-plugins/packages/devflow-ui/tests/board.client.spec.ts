// Board projections derive both compact nesting and stage-centric lanes from
// one fetched card set; no view gets a private interpretation of the domain.
import { describe, expect, it } from 'vitest'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevCard } from '@zhchxiao123/dsh-devflow/client'
import { BOARD_STAGES, displayStage, groupByParent, isActive, ordered, projectKanban } from '../src/client/board.ts'

function card(id: string, stage: CardLocation = 'developing', parent?: string): DevCard {
  return {
    id: DevflowCardId(id),
    root: '/ws/.devflow',
    title: `Card ${id}`,
    stage,
    stageRevision: 4,
    serviceClass: 'standard',
    ...parent === undefined ? {} : { parent: DevflowCardId(parent) },
    body: '',
    path: `tasks/${id}/card.md`,
    artifacts: [],
    artifactRecords: [],
  }
}

describe('board grouping', () => {
  it('nests children under their parent and reports the parent\'s progress', () => {
    const rows = groupByParent([
      card('0003-slice-b', 'blocked', '0001-big'),
      card('0004-standalone', 'ready'),
      card('0001-big', 'developing'),
      card('0002-slice-a', 'done', '0001-big'),
    ])
    expect(rows.map(row => row.card.id)).toEqual(['0001-big', '0004-standalone'])
    expect(rows[0].children.map(child => child.id)).toEqual(['0003-slice-b', '0002-slice-a'])
    expect(rows[0]).toMatchObject({ doneChildren: 1, blockedChildren: true })
    expect(rows[1]).toMatchObject({ children: [], doneChildren: 0, blockedChildren: false })
  })

  it('promotes an orphan child so no card can vanish from the board', () => {
    const rows = groupByParent([card('0006-orphan', 'developing', '0099-archived')])
    expect(rows.map(row => row.card.id)).toEqual(['0006-orphan'])
    expect(rows[0].children).toEqual([])
  })

  it('orders active cards before done ones at both levels', () => {
    const rows = groupByParent([
      card('0001-done-parent', 'done'),
      card('0002-open-parent', 'draft'),
      card('0003-done-child', 'done', '0002-open-parent'),
      card('0004-open-child', 'reviewing', '0002-open-parent'),
    ])
    expect(rows.map(row => row.card.id)).toEqual(['0002-open-parent', '0001-done-parent'])
    expect(rows[0].children.map(child => child.id)).toEqual(['0004-open-child', '0003-done-child'])
    expect(ordered([]).length).toBe(0)
    expect(isActive(card('0005-x', 'done'))).toBe(false)
  })
})

describe('Kanban projection', () => {
  it('puts leaf work into seven stage columns and blocked cards into their origin', () => {
    const blocked = card('0003-blocked', 'blocked')
    blocked.blockedFrom = 'reviewing'
    const projection = projectKanban([
      card('0002-done', 'done'),
      blocked,
      card('0001-ready', 'ready'),
    ])

    expect(BOARD_STAGES).toEqual(['draft', 'designing', 'ready', 'developing', 'reviewing', 'testing', 'done'])
    expect(projection.independent.ready.map(item => item.id)).toEqual(['0001-ready'])
    expect(projection.independent.reviewing.map(item => item.id)).toEqual(['0003-blocked'])
    expect(projection.independent.done.map(item => item.id)).toEqual(['0002-done'])
    expect(projection.counts).toMatchObject({ ready: 1, reviewing: 1, done: 1 })
    expect(displayStage(blocked)).toBe('reviewing')
  })

  it('uses parents as swimlane headers and counts each child only in its own stage', () => {
    const blocked = card('0004-slice-c', 'blocked', '0001-big')
    blocked.blockedFrom = 'developing'
    const projection = projectKanban([
      card('0001-big', 'designing'),
      card('0002-slice-a', 'done', '0001-big'),
      card('0003-slice-b', 'testing', '0001-big'),
      blocked,
      card('0005-standalone', 'draft'),
      card('0006-orphan', 'ready', '0099-archived'),
    ])

    expect(projection.swimlanes).toHaveLength(1)
    expect(projection.swimlanes[0]).toMatchObject({
      parent: { id: '0001-big' },
      doneChildren: 1,
      childTotal: 3,
      blockedChildren: true,
    })
    expect(projection.swimlanes[0].stages.developing.map(item => item.id)).toEqual(['0004-slice-c'])
    expect(projection.swimlanes[0].stages.testing.map(item => item.id)).toEqual(['0003-slice-b'])
    expect(projection.swimlanes[0].stages.done.map(item => item.id)).toEqual(['0002-slice-a'])
    expect(projection.independent.draft.map(item => item.id)).toEqual(['0005-standalone'])
    expect(projection.independent.ready.map(item => item.id)).toEqual(['0006-orphan'])
    expect(projection.counts).toMatchObject({ draft: 1, ready: 1, developing: 1, testing: 1, done: 1 })
  })

  it('keeps malformed blocked cards in an explicit fallback group', () => {
    const lost = card('0001-lost', 'blocked')
    const child = card('0003-child-lost', 'blocked', '0002-parent')
    const projection = projectKanban([lost, card('0002-parent', 'draft'), child])

    expect(displayStage(lost)).toBeUndefined()
    expect(projection.unresolved.map(item => item.id)).toEqual(['0001-lost'])
    expect(projection.swimlanes[0].unresolved.map(item => item.id)).toEqual(['0003-child-lost'])
    expect(Object.values(projection.counts).reduce((total, count) => total + count, 0)).toBe(0)
  })
})
