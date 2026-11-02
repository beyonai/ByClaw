// @vitest-environment jsdom
// The full sidebar's default view: stage columns, requirement swimlanes, and
// the bounded completed-work presentation.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevCard } from '@zhchxiao123/dsh-devflow/client'
import { makeTranslate } from './harness-doubles.ts'
import { KanbanBoard } from '../src/client/kanban-view.tsx'
import type { KanbanBoardProps } from '../src/client/kanban-view.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: KanbanBoardProps['t'] = makeTranslate(zh)

function card(id: string, stage: CardLocation = 'developing', over: Partial<DevCard> = {}): DevCard {
  return {
    id: DevflowCardId(id),
    root: '/ws/.devflow',
    title: `Card ${id}`,
    stage,
    stageRevision: 4,
    serviceClass: 'standard',
    body: '',
    path: `tasks/${id}/card.md`,
    artifacts: [],
    artifactRecords: [],
    ...over,
  }
}

function stageCell(scope: HTMLElement, stage: string): HTMLElement {
  const cell = [...scope.querySelectorAll<HTMLElement>(`[data-stage="${stage}"]`)]
    .find(candidate => candidate.className.includes('kanbanCell'))
  if (cell === undefined) throw new Error(`missing ${stage} stage cell`)
  return cell
}

describe('KanbanBoard card structure', () => {
  // These specs are about the card's markup, not about which decision it is
  // open to, so this offers what a card with no family relations would get.
  const actions = {
    archive: vi.fn(),
    abandon: vi.fn(),
    offered: (c: DevCard) => c.stage === 'done' ? 'archive' as const : 'abandon' as const,
    t,
  }

  it('puts a card\'s actions inside its own box, without nesting one button in another', () => {
    const { container } = render(<KanbanBoard
      cards={[card('0001-open', 'developing'), card('0002-finished', 'done')]}
      openCardDetail={vi.fn()}
      actions={actions}
      t={t}
    />)

    // A button inside a button is invalid markup: the browser hands the inner
    // one's click to the outer, so an action would open the card instead.
    expect(container.querySelectorAll('button button')).toHaveLength(0)

    const drop = screen.getByRole('button', { name: '放弃' })
    const box = drop.closest('[class*="kanbanCard"]')
    expect(box).not.toBeNull()
    // The opener is a sibling within that same box, so the action reads as
    // belonging to the card rather than floating beneath it.
    expect(box?.querySelector('[class*="kanbanCardOpener"]')).not.toBeNull()
  })

  it('keeps the card content inside the opener, so restructuring the box does not empty it', () => {
    const open = vi.fn()
    render(<KanbanBoard
      cards={[card('0001-open', 'developing', { title: 'Reachable title' })]}
      openCardDetail={open}
      actions={actions}
      t={t}
    />)

    const opener = screen.getByRole('button', { name: '查看 0001-open 详情' })
    expect(opener.textContent).toContain('Reachable title')
    expect(opener.textContent).toContain('0001-open')

    fireEvent.click(opener)
    expect(open).toHaveBeenCalledWith('0001-open')
  })
})

describe('KanbanBoard', () => {
  it('keeps long card labels discoverable without letting them define the card width', () => {
    const id = '0001-an-extremely-long-card-identifier-that-must-not-overflow'
    const title = 'An extremely long work item title that needs several lines but must remain inside its Kanban card'
    render(<KanbanBoard
      cards={[card(id, 'draft', { title })]}
      openCardDetail={vi.fn()}
      t={t}
    />)

    const item = screen.getByRole('button', { name: `查看 ${id} 详情` })
    expect(within(item).getByTitle(title).textContent).toBe(title)
    expect(within(item).getByTitle(id).textContent).toBe(id)
  })

  it('compresses globally empty stages so populated work can use the board width', () => {
    render(<KanbanBoard
      cards={[
        card('0001-draft', 'draft'),
        card('0002-draft', 'draft'),
        card('0003-developing', 'developing'),
      ]}
      openCardDetail={vi.fn()}
      t={t}
    />)

    const board = screen.getByRole('region', { name: '研发流程看板' })
    expect(board.style.getPropertyValue('--devflow-stage-grid')).toContain('minmax(80px, 0.32fr)')
    expect(board.style.getPropertyValue('--devflow-stage-grid')).toContain('minmax(148px, 1fr)')
  })

  it('renders seven real columns and places a blocked card in its interrupted stage', () => {
    const openCardDetail = vi.fn()
    const parked = card('0002-parked', 'blocked', {
      blockedFrom: 'developing',
      serviceClass: 'emergency',
      artifacts: ['artifacts/development.md', 'artifacts/review.md'],
    })
    render(<KanbanBoard cards={[card('0001-draft', 'draft'), parked]} openCardDetail={openCardDetail} t={t} />)

    const board = screen.getByRole('region', { name: '研发流程看板' })
    const headers = board.firstElementChild?.children ?? []
    expect(headers).toHaveLength(7)
    expect([...headers].map(header => header.textContent)).toEqual([
      '需求草稿1', '方案设计0', '待开发0', '开发中1', '评审0', '验证0', '已完成0',
    ])
    expect(board.querySelector('[data-stage="blocked"]')).toBeNull()

    const developing = stageCell(board, 'developing')
    expect(developing.textContent).toContain('0002-parked')
    expect(developing.textContent).toContain('受阻')
    expect(developing.textContent).toContain('紧急')
    expect(developing.textContent).toContain('产物 2')
    fireEvent.click(within(developing).getByRole('button', { name: '查看 0002-parked 详情' }))
    expect(openCardDetail).toHaveBeenCalledExactlyOnceWith('0002-parked')
  })

  it('uses a parent as a collapsible swimlane header and renders every child once', () => {
    const openCardDetail = vi.fn()
    const parent = card('0001-parent', 'blocked', { title: 'Big requirement', blockedFrom: 'designing' })
    const malformedParent = card('0004-malformed-parent', 'blocked', { title: 'Interrupted requirement' })
    render(<KanbanBoard
      cards={[
        parent,
        card('0002-active', 'testing', { parent: parent.id }),
        card('0003-done', 'done', { parent: parent.id }),
        malformedParent,
        card('0005-child', 'draft', { parent: malformedParent.id }),
      ]}
      openCardDetail={openCardDetail}
      t={t}
    />)

    const lane = screen.getByRole('region', { name: '需求泳道:Big requirement' })
    expect(lane.textContent).toContain('受阻 · 来自 方案设计')
    expect(lane.textContent).toContain('子需求 1/2')
    expect(lane.querySelectorAll('button[aria-label="查看 0002-active 详情"]')).toHaveLength(1)
    expect(lane.querySelectorAll('button[aria-label="查看 0003-done 详情"]')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: '独立任务' })).toBeNull()
    const malformedLane = screen.getByRole('region', { name: '需求泳道:Interrupted requirement' })
    expect(malformedLane.textContent).toContain('受阻')
    expect(malformedLane.textContent).not.toContain('来自 需求草稿')

    fireEvent.click(screen.getByRole('button', { name: '查看 0001-parent 详情' }))
    expect(openCardDetail).toHaveBeenCalledExactlyOnceWith('0001-parent')

    fireEvent.click(screen.getByRole('button', { name: '收起 0001-parent 的子需求' }))
    expect(screen.queryByRole('button', { name: '查看 0002-active 详情' })).toBeNull()
    expect(screen.getByRole('button', { name: '查看 0001-parent 详情' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开 0001-parent 的子需求' }))
    expect(screen.getByRole('button', { name: '查看 0002-active 详情' })).toBeTruthy()
  })

  it('keeps malformed blocked input reachable and caps completed cards until expanded', () => {
    const completed = Array.from({ length: 7 }, (_, index) => card(`00${String(index + 10)}-done`, 'done'))
    render(<KanbanBoard
      cards={[card('0001-lost', 'blocked'), card('0002-active'), ...completed]}
      openCardDetail={vi.fn()}
      t={t}
    />)

    const independent = screen.getByRole('region', { name: '独立任务' })
    expect(independent.textContent).toContain('状态数据异常，无法确定来源阶段')
    expect(independent.textContent).toContain('0001-lost')
    const done = stageCell(independent, 'done')
    expect(within(done).getAllByRole('button', { name: /查看 .* 详情/ })).toHaveLength(6)
    expect(screen.getByText('显示其余 1 张').parentElement?.getAttribute('data-selected')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '已完成7' }))
    fireEvent.click(screen.getByRole('button', { name: '显示其余 1 张' }))
    expect(within(done).getAllByRole('button', { name: /查看 .* 详情/ })).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: '收起已完成' }))
    expect(within(done).getAllByRole('button', { name: /查看 .* 详情/ })).toHaveLength(6)
  })

  it('offers a seven-stage selector for the responsive single-column layout', () => {
    render(<KanbanBoard cards={[card('0001-a')]} openCardDetail={vi.fn()} t={t} />)
    const selector = screen.getByRole('group', { name: '选择研发阶段' })
    const buttons = within(selector).getAllByRole('button')
    expect(buttons).toHaveLength(7)
    expect(within(selector).getByRole('button', { name: '开发中1' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(selector).getByRole('button', { name: '验证0' }))
    expect(within(selector).getByRole('button', { name: '验证0' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('falls back to developing when an empty board has no populated stage', () => {
    render(<KanbanBoard cards={[]} openCardDetail={vi.fn()} t={t} />)
    const selector = screen.getByRole('group', { name: '选择研发阶段' })
    expect(within(selector).getByRole('button', { name: '开发中0' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens a populated narrow stage, hides empty independent work, and keeps parent context', () => {
    const parent = card('0002-parent', 'done', { title: 'Finished requirement' })
    render(<KanbanBoard
      cards={[
        card('0001-draft', 'draft'),
        parent,
        card('0003-child', 'done', { parent: parent.id }),
        card('0004-independent-done', 'done'),
      ]}
      openCardDetail={vi.fn()}
      t={t}
    />)

    const selector = screen.getByRole('group', { name: '选择研发阶段' })
    expect(within(selector).getByRole('button', { name: '需求草稿1' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('region', { name: '独立任务' }).getAttribute('data-selected-empty')).toBeNull()
    expect(screen.getByRole('region', { name: '需求泳道:Finished requirement' }).textContent)
      .toContain('Finished requirement')

    fireEvent.click(within(selector).getByRole('button', { name: '已完成2' }))
    expect(screen.getByRole('region', { name: '独立任务' }).getAttribute('data-selected-empty')).toBeNull()
    expect(screen.getByRole('region', { name: '需求泳道:Finished requirement' }).textContent)
      .toContain('0003-child')

    fireEvent.click(within(selector).getByRole('button', { name: '方案设计0' }))
    expect(screen.getByRole('region', { name: '独立任务' }).getAttribute('data-selected-empty')).toBe('true')
    expect(screen.getByRole('region', { name: '需求泳道:Finished requirement' }).textContent)
      .toContain('Finished requirement')
  })
})
