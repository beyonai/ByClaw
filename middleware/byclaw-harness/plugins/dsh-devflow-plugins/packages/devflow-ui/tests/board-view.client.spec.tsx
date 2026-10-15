// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from './harness-doubles.ts'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevCard } from '@zhchxiao123/dsh-devflow/client'
import { DevflowBoardTab, type DevflowBoardTabProps } from '../src/client/DevflowBoardTab.tsx'
// Type-only: pulls the plugin's LocaleNamespaceMap merge into this program.
import type {} from '../src/client/index.ts'
import {
  IDLE_ARCHIVE,
  LOADING_BOARD,
  createBoardSource,
  createDetailSource,
  readyBoard,
  type DevflowArchiveSnapshot,
  type DevflowBoardSnapshot,
  type DevflowDetailSnapshot,
} from '../src/client/board.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: DevflowBoardTabProps['t'] = makeTranslate(zh)

function card(over: Omit<Partial<DevCard>, 'id'> & { id: string }): DevCard {
  return {
    root: '/workspace/.devflow',
    title: `Card ${over.id}`,
    stage: 'developing',
    stageRevision: 4,
    serviceClass: 'standard',
    body: '',
    path: `tasks/${over.id}/card.md`,
    artifacts: [],
    artifactRecords: [],
    ...over,
    id: DevflowCardId(over.id),
  }
}

function renderBoard(
  cards: DevCard[] | undefined,
  detail: Partial<DevflowDetailSnapshot> = {},
  archive: DevflowArchiveSnapshot = IDLE_ARCHIVE,
  refusal?: string,
) {
  const board = createBoardSource()
  board.set(cards === undefined ? LOADING_BOARD : readyBoard(cards))
  const detailSource = createDetailSource()
  detailSource.set({
    id: undefined, card: undefined, entries: undefined, holder: undefined, openableSessions: [], ...detail,
  })
  function useDevflowBoard<T>(select: (snapshot: DevflowBoardSnapshot) => T): T {
    return select(board.getSnapshot())
  }
  function useDevflowDetail<T>(select: (snapshot: DevflowDetailSnapshot) => T): T {
    return select(detailSource.getSnapshot())
  }
  const openCardDetail = vi.fn()
  const closeCardDetail = vi.fn()
  const openSession = vi.fn()
  const setArchiveVisible = vi.fn()
  const loadMoreArchive = vi.fn()
  const archiveDone = vi.fn(() => Promise.resolve(refusal))
  const archiveCard = vi.fn(() => Promise.resolve(refusal))
  const abandonCard = vi.fn(() => Promise.resolve(refusal))
  const view = render(
    <DevflowBoardTab
      board={useDevflowBoard(snapshot => snapshot)}
      detail={useDevflowDetail(snapshot => snapshot)}
      archive={archive}
      splitView={false}
      openCardDetail={openCardDetail}
      closeCardDetail={closeCardDetail}
      openSession={openSession}
      retry={() => Promise.resolve()}
      setArchiveVisible={setArchiveVisible}
      loadMoreArchive={loadMoreArchive}
      archiveDone={archiveDone}
      archiveCard={archiveCard}
      abandonCard={abandonCard}
      t={t}
    />,
  )
  if (detail.id === undefined && cards !== undefined && cards.length > 0) {
    fireEvent.click(screen.getByRole('button', { name: '列表' }))
  }
  return {
    ...view, openCardDetail, closeCardDetail, openSession,
    setArchiveVisible, loadMoreArchive, archiveDone, archiveCard, abandonCard,
  }
}

describe('board list card structure', () => {
  it("puts a row's actions inside its own box, without nesting one button in another", () => {
    const { container } = renderBoard([
      card({ id: '0001-open', stage: 'developing', title: 'Open work' }),
      card({ id: '0002-finished', stage: 'done', title: 'Finished work' }),
    ])

    // A button inside a button is invalid markup: the browser hands the inner
    // one's click to the outer, so an action would open the card instead.
    expect(container.querySelectorAll('button button')).toHaveLength(0)

    const drop = screen.getByRole('button', { name: '放弃' })
    const box = drop.closest('[class*="rowCard"]')
    expect(box).not.toBeNull()
    // The opener is a sibling within that same box, so the action reads as
    // belonging to the row rather than sitting outside its highlight.
    expect(box?.querySelector('[class*="rowButton"]')).not.toBeNull()
  })
})

/** Move the board to the archive scope, which is what asks for its pages. */
function enterArchive(): void {
  fireEvent.click(screen.getByRole('button', { name: '档案' }))
}

describe('shared Devflow board views', () => {
  it('renders explicit loading and empty states', () => {
    const empty = renderBoard(undefined)
    expect(empty.container.textContent).toContain('正在加载研发流程')
    cleanup()

    // An empty active set keeps its chrome: the scope selector is the only way
    // to the archive, and a board that hides it strands whoever just filed
    // their last card.
    const zero = renderBoard([])
    expect(zero.container.textContent).toContain('没有进行中的研发卡片')
    expect(zero.container.textContent).not.toContain('还没有研发卡片')
    expect(screen.getByRole('group', { name: '研发卡片范围' })).toBeTruthy()
  })

  it('renders every stage in the compact list', () => {
    renderBoard([
      card({ id: '0001-active', stage: 'developing', stageRevision: 4, artifacts: ['artifacts/development.md'] }),
      card({ id: '0002-later', stage: 'done', stageRevision: 8 }),
      card({ id: '0004-queued', stage: 'ready', stageRevision: 3 }),
      card({ id: '0005-sketch', stage: 'draft', stageRevision: 1 }),
      card({ id: '0006-shaping', stage: 'designing', stageRevision: 2 }),
      card({ id: '0003-parked', stage: 'blocked', blockedFrom: 'reviewing', stageRevision: 6 }),
    ])
    const board = screen.getByRole('list', { name: '研发流程看板' })
    const rows = board.querySelectorAll('li')
    expect(rows).toHaveLength(6)
    // Active cards first in id order; done cards settle to the tail.
    expect(rows[0].textContent).toContain('0001-active')
    expect(rows[0].textContent).toContain('开发中')
    expect(rows[0].textContent).toContain('产物 1')
    expect(rows[0].textContent).toContain('rev 4')
    expect(rows[1].textContent).toContain('0003-parked')
    expect(rows[1].textContent).toContain('受阻')
    expect(rows[1].textContent).toContain('来自 评审')
    expect(rows[2].textContent).toContain('0004-queued')
    expect(rows[2].textContent).toContain('待开发')
    expect(rows[3].textContent).toContain('0005-sketch')
    expect(rows[3].textContent).toContain('需求草稿')
    expect(rows[4].textContent).toContain('0006-shaping')
    expect(rows[4].textContent).toContain('方案设计')
    expect(rows[5].textContent).toContain('0002-later')
    expect(rows[5].textContent).toContain('已完成')
    // Each row is a detail opener plus exactly one decision about the card's
    // place on the board — filing it when finished, dropping it otherwise. No
    // row edits a card, so none of them carries an input.
    expect(board.querySelectorAll('button')).toHaveLength(12)
    expect(board.querySelectorAll('input')).toHaveLength(0)
    // The finished card offers filing; the rest offer dropping.
    expect(rows[5].textContent).toContain('归档')
    expect(rows[0].textContent).toContain('放弃')
  })

  it('opens a card\'s detail from its row', () => {
    const { openCardDetail } = renderBoard([card({ id: '0001-a' })])
    const board = screen.getByRole('list', { name: '研发流程看板' })
    fireEvent.click(board.querySelector('li button')!)
    expect(openCardDetail).toHaveBeenCalledWith('0001-a')
  })

  it('renders the loaded detail as a read-only requirement sheet and returns to the list', () => {
    const opened = card({
      id: '0001-rich',
      title: 'Rich card',
      stage: 'blocked',
      blockedFrom: 'reviewing',
      stageRevision: 6,
      body: '## Goal\nShip it.\n\n- [ ] first check\n- [x] second check',
      artifacts: ['artifacts/design.md', 'artifacts/review.md'],
      path: '/ws/.devflow/tasks/0001-rich/card.md',
    })
    const { closeCardDetail } = renderBoard([opened], { id: opened.id, card: opened })

    // Detail replaces the list inside the same panel.
    expect(screen.queryByRole('list', { name: '研发流程看板' })).toBeNull()
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('Rich card')
    expect(detail.textContent).toContain('0001-rich')
    expect(detail.textContent).toContain('rev 6')
    // The Markdown body renders as a document, its checklist read-only.
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeTruthy()
    const boxes = detail.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect((box as HTMLInputElement).disabled).toBe(true)
    // The enlarged pipeline names every stage and marks the blocked origin.
    expect(detail.textContent).toContain('受阻')
    expect(detail.textContent).toContain('评审')
    // Artifacts and the card file path are listed.
    expect(detail.textContent).toContain('artifacts/design.md')
    expect(detail.textContent).toContain('artifacts/review.md')
    expect(detail.textContent).toContain('/ws/.devflow/tasks/0001-rich/card.md')
    // Read-only: the back control is the only button besides the collapse one.
    fireEvent.click(screen.getByRole('button', { name: '返回看板' }))
    expect(closeCardDetail).toHaveBeenCalled()
  })

  it('nests sub-requirements under their parent with its progress, and collapses them away', () => {
    const { openCardDetail } = renderBoard([
      card({ id: '0001-big', stage: 'designing' }),
      card({ id: '0002-slice-a', stage: 'done', parent: DevflowCardId('0001-big') }),
      card({ id: '0003-slice-b', stage: 'blocked', blockedFrom: 'developing', parent: DevflowCardId('0001-big') }),
      card({ id: '0004-standalone', stage: 'ready' }),
    ])
    const board = screen.getByRole('list', { name: '研发流程看板' })
    const rows = () => board.querySelectorAll('li')
    expect([...rows()].map(row => row.textContent)).toEqual([
      expect.stringContaining('0001-big'),
      expect.stringContaining('0003-slice-b'),
      expect.stringContaining('0002-slice-a'),
      expect.stringContaining('0004-standalone'),
    ])
    // The parent line reports the breakdown and flags the blocked child.
    expect(rows()[0].textContent).toContain('子需求 1/2')
    expect(rows()[0].textContent).toContain('有受阻')
    expect(rows()[3].textContent).not.toContain('子需求')
    // Only the children are indented.
    expect([...rows()].map(row => row.className.includes('rowNested'))).toEqual([false, true, true, false])

    fireEvent.click(screen.getByRole('button', { name: '收起 0001-big 的子需求' }))
    expect([...rows()].map(row => row.textContent)).toEqual([
      expect.stringContaining('0001-big'),
      expect.stringContaining('0004-standalone'),
    ])
    fireEvent.click(screen.getByRole('button', { name: '展开 0001-big 的子需求' }))
    expect(rows()).toHaveLength(4)
    // The toggle is not an opener: each card still has exactly one.
    fireEvent.click(screen.getByRole('button', { name: '查看 0003-slice-b 详情' }))
    expect(openCardDetail).toHaveBeenCalledExactlyOnceWith('0003-slice-b')
  })

  it('reports a breakdown without a blocked child as bare progress', () => {
    renderBoard([
      card({ id: '0001-big', stage: 'designing' }),
      card({ id: '0002-slice-a', stage: 'developing', parent: DevflowCardId('0001-big') }),
    ])
    const first = screen.getByRole('list', { name: '研发流程看板' }).querySelector('li')!
    expect(first.textContent).toContain('子需求 0/1')
    expect(first.textContent).not.toContain('有受阻')
  })

  it('promotes an orphan child whose parent left the board', () => {
    renderBoard([card({ id: '0006-orphan', parent: DevflowCardId('0099-archived') })])
    const board = screen.getByRole('list', { name: '研发流程看板' })
    expect(board.querySelectorAll('li')).toHaveLength(1)
    expect(board.querySelector('li')!.className).not.toContain('rowNested')
    // The opener plus the row's one decision.
    expect(board.querySelectorAll('button')).toHaveLength(2)
  })

  it('drills between a requirement and its slices from the detail view', () => {
    const parent = card({ id: '0001-big', stage: 'designing', title: 'Big requirement' })
    const child = card({ id: '0002-slice-a', stage: 'done', title: 'Slice A', parent: parent.id })
    const cards = [parent, child]
    const fromParent = renderBoard(cards, { id: parent.id, card: parent })
    const parentDetail = screen.getByRole('region', { name: '卡片详情' })
    expect(parentDetail.textContent).toContain('子需求 1/1')
    expect(parentDetail.textContent).toContain('Slice A')
    expect(parentDetail.textContent).not.toContain('所属需求')
    fireEvent.click(screen.getByRole('button', { name: '查看 0002-slice-a 详情' }))
    expect(fromParent.openCardDetail).toHaveBeenCalledExactlyOnceWith('0002-slice-a')
    cleanup()

    const fromChild = renderBoard(cards, { id: child.id, card: child })
    const childDetail = screen.getByRole('region', { name: '卡片详情' })
    expect(childDetail.textContent).toContain('所属需求')
    expect(childDetail.textContent).toContain('Big requirement')
    fireEvent.click(screen.getByRole('button', { name: '查看 0001-big 详情' }))
    expect(fromChild.openCardDetail).toHaveBeenCalledExactlyOnceWith('0001-big')
  })

  it('shows an archived parent as a bare backlink id', () => {
    const orphan = card({ id: '0006-orphan', parent: DevflowCardId('0099-archived') })
    renderBoard([orphan], { id: orphan.id, card: orphan })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('0099-archived')
    expect(screen.queryByRole('button', { name: '查看 0099-archived 详情' })).toBeNull()
  })

  it('shows a loading placeholder while the detail fetch is in flight', () => {
    const only = card({ id: '0001-a' })
    renderBoard([only], { id: only.id, card: undefined })
    expect(screen.getByRole('region', { name: '卡片详情' }).textContent).toContain('加载中')
  })

  it('lists no artifacts with the explicit empty label and skips an empty body', () => {
    const only = card({ id: '0001-a', body: '', artifacts: [] })
    renderBoard([only], { id: only.id, card: only })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('暂无产物')
    expect(detail.querySelectorAll('input')).toHaveLength(0)
  })

  it('keeps the compact alternate free of repeated progress rails', () => {
    renderBoard([
      card({ id: '0001-a', stage: 'developing' }),
      card({ id: '0002-b', stage: 'done' }),
    ])
    // The compact alternate stays scan-friendly instead of repeating a full
    // seven-stage progress rail beneath every row.
    const board = screen.getByRole('list', { name: '研发流程看板' })
    expect(board.querySelector('li')?.querySelectorAll('i')).toHaveLength(0)
  })

  it('renders an empty warning progress run for a blocked card whose journal lost its origin stage', () => {
    // Malformed durable input: fold guarantees blockedFrom for blocked cards,
    // but the component renders whatever one fetch delivered.
    renderBoard([card({ id: '0001-lost', stage: 'blocked' })])
    const row = screen.getByRole('list', { name: '研发流程看板' }).querySelector('li')
    expect(row?.querySelectorAll('i[data-tone]')).toHaveLength(0)
  })

  it('renders the transition timeline newest-first with actors, reasons, approvals, and takeovers', () => {
    const shown = card({ id: '0001-hist', stage: 'developing', stageRevision: 5 })
    renderBoard([shown], {
      id: shown.id,
      card: shown,
      entries: [
        { rev: 1, at: '2026-08-01T00:00:00Z', type: 'created', by: { kind: 'human', name: 'byclaw' } },
        { rev: 2, at: '2026-08-02T00:00:00Z', type: 'transition', from: 'draft', to: 'designing', by: { kind: 'agent', session: 'ses-known' } },
        { rev: 3, at: '2026-08-02T12:00:00Z', type: 'artifact', stage: 'designing', path: 'artifacts/design.md', by: { kind: 'agent', session: 'ses-gone' } },
        { rev: 4, at: '2026-08-03T00:00:00Z', type: 'claim-expired', previousOwner: { kind: 'agent', session: 'ses-gone' }, by: { kind: 'command', name: 'devflow' } },
        { rev: 5, at: '2026-08-04T00:00:00Z', type: 'transition', from: 'designing', to: 'ready', by: { kind: 'human' }, reason: 'fast-tracked', gate: { approvedBy: { kind: 'human', name: 'reviewer' } } },
      ],
      holder: { owner: { kind: 'agent', session: 'ses-known' }, heartbeatAt: new Date().toISOString() },
      openableSessions: ['ses-known'],
    })
    const timeline = screen.getByRole('list', { name: '流转时间线' })
    const items = timeline.querySelectorAll('li')
    expect(items).toHaveLength(5)
    // Newest first: the approved fast-track leads, creation closes the list.
    expect(items[0].textContent).toContain('方案设计')
    expect(items[0].textContent).toContain('待开发')
    expect(items[0].textContent).toContain('原因:fast-tracked')
    expect(items[0].textContent).toContain('人工审批 · 人工 reviewer')
    // The dwell anchors at the stage boundary (entering designing on 08-02),
    // so mid-stage artifact and takeover entries do not fragment it.
    expect(items[0].textContent).toContain('停留 2 天')
    expect(items[1].textContent).not.toContain('停留')
    expect(items[1].textContent).toContain('租约接管')
    expect(items[1].textContent).toContain('命令 devflow')
    // The path is its own element so it can become a control; the label and
    // the path are spaced by layout rather than by a character in the copy.
    expect(items[2].textContent).toContain('登记产物')
    expect(items[2].textContent).toContain('artifacts/design.md')
    expect(items[4].textContent).toContain('创建')
    expect(items[4].textContent).toContain('人工 byclaw')
    // The holder and the derived summary ride the timeline header.
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('持有者 ses-known')
    expect(detail.textContent).toContain('卡龄')
    expect(detail.textContent).toContain('打回 0 次')
  })

  it('links a timeline agent to its session only while the session is known', () => {
    const shown = card({ id: '0001-links' })
    const { openSession } = renderBoard([shown], {
      id: shown.id,
      card: shown,
      entries: [
        { rev: 1, at: 't1', type: 'created', by: { kind: 'agent', session: 'ses-known' } },
        { rev: 2, at: 't2', type: 'transition', from: 'draft', to: 'designing', by: { kind: 'agent', session: 'ses-gone' } },
      ],
      holder: undefined,
      openableSessions: ['ses-known'],
    })
    const link = screen.getByRole('button', { name: '打开会话 ses-known' })
    fireEvent.click(link)
    expect(openSession).toHaveBeenCalledWith('ses-known')
    // The vanished session renders as plain text, and unparseable timestamps
    // simply omit durations instead of failing the render.
    expect(screen.queryByRole('button', { name: '打开会话 ses-gone' })).toBeNull()
    const timeline = screen.getByRole('list', { name: '流转时间线' })
    expect(timeline.textContent).toContain('ses-gone')
    expect(timeline.textContent).not.toContain('停留')
  })

  it('labels anonymous actors, tolerates an empty timeline, and skips an unparseable heartbeat', () => {
    const shown = card({ id: '0001-anon' })
    renderBoard([shown], {
      id: shown.id,
      card: shown,
      entries: [
        { rev: 1, at: 't1', type: 'created', by: { kind: 'agent' } },
        { rev: 2, at: 't2', type: 'transition', from: 'draft', to: 'blocked', by: { kind: 'command' } },
      ],
      holder: { owner: { kind: 'human' }, heartbeatAt: 'not-a-time' },
      openableSessions: [],
    })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('智能体')
    expect(detail.textContent).toContain('命令')
    expect(detail.textContent).toContain('持有者 人工')
    expect(detail.textContent).not.toContain('前')

    cleanup()
    // An empty (but delivered) timeline renders its section without metrics.
    const bare = card({ id: '0001-bare' })
    renderBoard([bare], { id: bare.id, card: bare, entries: [], holder: undefined, openableSessions: [] })
    const empty = screen.getByRole('region', { name: '卡片详情' })
    expect(empty.textContent).toContain('打回 0 次')
    expect(empty.textContent).not.toContain('卡龄')
  })

  it('leads a blocked card with the latest blocking reason', () => {
    const parked = card({ id: '0001-parked', stage: 'blocked', blockedFrom: 'developing' })
    renderBoard([parked], {
      id: parked.id,
      card: parked,
      entries: [
        { rev: 1, at: 't1', type: 'created', by: { kind: 'human' } },
        { rev: 2, at: 't2', type: 'transition', from: 'draft', to: 'blocked', reason: 'first stall' },
        { rev: 3, at: 't3', type: 'transition', from: 'blocked', to: 'draft' },
        { rev: 4, at: 't4', type: 'transition', from: 'draft', to: 'blocked', reason: 'awaiting upstream fix' },
      ],
      holder: undefined,
      openableSessions: [],
    })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('受阻原因:awaiting upstream fix')
  })

  // Every edge `isReworkEdge` accepts, including the three that land on
  // `designing`. The mirrored predicate used to count only moves back to
  // `developing`, so design rework was invisible in this summary.
  it('counts rework moves in the derived summary', () => {
    const shown = card({ id: '0001-rework' })
    renderBoard([shown], {
      id: shown.id,
      card: shown,
      entries: [
        { rev: 1, at: 't1', type: 'created', by: { kind: 'human' } },
        { rev: 2, at: 't2', type: 'transition', from: 'reviewing', to: 'developing', reason: 'gaps' },
        { rev: 3, at: 't3', type: 'transition', from: 'testing', to: 'developing', reason: 'regression' },
        { rev: 4, at: 't4', type: 'transition', from: 'developing', to: 'designing', reason: 'the design cannot hold' },
        { rev: 5, at: 't5', type: 'transition', from: 'testing', to: 'designing', reason: 'acceptance disagrees' },
        { rev: 6, at: 't6', type: 'transition', from: 'designing', to: 'ready' },
        { rev: 7, at: 't7', type: 'abandoned', by: { kind: 'command', name: 'devflow' }, reason: 'duplicate of 0002' },
      ],
      holder: undefined,
      openableSessions: [],
    })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('打回 4 次')
    // The abandonment carries its reason on the timeline; it is not a rework.
    expect(detail.textContent).toContain('放弃:duplicate of 0002')
  })

  // Archiving and restoring are journal entries, so they belong on the
  // timeline; their reason is optional, unlike an abandonment's.
  it('renders archiving and restoring, with and without a reason', () => {
    const shown = card({ id: '0001-filed' })
    renderBoard([shown], {
      id: shown.id,
      card: shown,
      entries: [
        { rev: 1, at: 't1', type: 'created', by: { kind: 'human' } },
        { rev: 2, at: 't2', type: 'archived', by: { kind: 'human' }, reason: 'shipped in 4.2' },
        { rev: 3, at: 't3', type: 'restored', by: { kind: 'human' } },
        { rev: 4, at: 't4', type: 'archived', by: { kind: 'human' } },
        { rev: 5, at: 't5', type: 'restored', by: { kind: 'human' }, reason: 'regression found' },
      ],
      holder: undefined,
      openableSessions: [],
    })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('归档:shipped in 4.2')
    expect(detail.textContent).toContain('从归档恢复:regression found')
    expect(detail.textContent).toContain('从归档恢复')
    expect(detail.textContent).toContain('归档')
  })

  // Filing is reversible, so it commits on the click; the card carries its own
  // revision, which is what lets the store refuse a stale one.
  it('files a finished card from its row, at the revision the row was read at', () => {
    const { archiveCard } = renderBoard([card({ id: '0001-done', stage: 'done', stageRevision: 8 })])
    fireEvent.click(screen.getByRole('button', { name: '归档' }))
    expect(archiveCard).toHaveBeenCalledWith('0001-done', 8)
  })

  // Which decision a row offers follows from where the card is: a button whose
  // only outcome is a refusal is not an offer.
  it('offers filing only to a finished card, and dropping only to the rest', () => {
    renderBoard([card({ id: '0001-open', stage: 'developing' })])
    expect(screen.queryByRole('button', { name: '归档' })).toBeNull()
    expect(screen.getByRole('button', { name: '放弃' })).toBeTruthy()
    cleanup()

    renderBoard([card({ id: '0002-done', stage: 'done' })])
    expect(screen.queryByRole('button', { name: '放弃' })).toBeNull()
    expect(screen.getByRole('button', { name: '归档' })).toBeTruthy()
  })

  // Dropping is irreversible and the store refuses a blank reason, so the
  // reason is the confirmation rather than an extra step in front of one.
  it('will not drop a card until a reason is written', () => {
    const { abandonCard } = renderBoard([card({ id: '0001-open', stage: 'developing', stageRevision: 3 })])
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))

    const confirm = screen.getByRole('button', { name: '放弃卡片' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    // Whitespace is not a record of why the work stopped.
    fireEvent.change(screen.getByLabelText('为什么不做了'), { target: { value: '   ' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('为什么不做了'), { target: { value: '需求取消了' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    expect(abandonCard).toHaveBeenCalledWith('0001-open', 3, '需求取消了')
  })

  it('closes the drop confirmation without touching the card', () => {
    const { abandonCard } = renderBoard([card({ id: '0001-open', stage: 'developing' })])
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(abandonCard).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '放弃卡片' })).toBeNull()
  })

  // The sweep sits beside the number it acts on, and is absent when that
  // number is zero.
  it('offers the sweep only while something is finished', () => {
    renderBoard([card({ id: '0001-open', stage: 'developing' })])
    expect(screen.queryByRole('button', { name: '归档已完成' })).toBeNull()
    cleanup()

    const { archiveDone } = renderBoard([card({ id: '0002-done', stage: 'done' })])
    fireEvent.click(screen.getByRole('button', { name: '归档已完成' }))
    expect(archiveDone).toHaveBeenCalled()
  })

  // A refused write leaves the board the reader was reading in place, and says
  // what to do next rather than that something failed.
  it.each([
    ['revision-mismatch', '这张卡刚被别处改动'],
    ['not-done', '只有已完成的卡片可以归档'],
    ['parent-active', '它所属的需求还没完成'],
    ['children-active', '它拆出的子任务还在进行中'],
    ['already-done', '已完成的卡片用归档收走'],
    ['already-archived', '这张卡已经归档了'],
    ['transport', '操作没有生效'],
  ])('reports the %s refusal in its own words', async (code, message) => {
    renderBoard([card({ id: '0001-done', stage: 'done' })], {}, IDLE_ARCHIVE, code)
    fireEvent.click(screen.getByRole('button', { name: '归档' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(message)
    // The listing it was refused against is still there.
    expect(screen.getByRole('list', { name: '研发流程看板' })).toBeTruthy()
  })

  // The archive is a secondary, read-only group: filed cards are visible and
  // visibly not where work happens, and nothing here offers to restore one.
  it('renders the archive as a read-only group, tagging how each card left', () => {
    const filed = card({ id: '0009-shipped', stage: 'done', archived: true, archivedMonth: '2026-07' })
    const dropped = card({ id: '0010-dropped', stage: 'draft', archived: true, archivedMonth: '2026-08', abandoned: true })
    const { loadMoreArchive, openCardDetail } = renderBoard(
      [card({ id: '0001-live' })],
      {},
      { status: 'ready', cards: [filed, dropped], nextCursor: 'archived:2026-07:0009-shipped' },
    )
    enterArchive()

    const section = screen.getByRole('region', { name: '已归档' })
    expect(section.textContent).toContain('0009-shipped')
    // The month heads its run of cards; the rows carry only how each left.
    expect(within(section).getByRole('heading', { name: '2026-07' })).toBeTruthy()
    expect(within(section).getByRole('heading', { name: '2026-08' })).toBeTruthy()
    expect(section.textContent).toContain('已归档')
    expect(section.textContent).toContain('已放弃')
    expect(section.textContent).not.toContain('已归档 2026-07')

    // The scope selector above already names what is being read.
    expect(within(section).queryByRole('heading', { name: '已归档' })).toBeNull()

    // Opening a filed card is the only thing its row does.
    fireEvent.click(screen.getByRole('button', { name: '查看 0009-shipped 详情' }))
    expect(openCardDetail).toHaveBeenCalledWith('0009-shipped')

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(loadMoreArchive).toHaveBeenCalled()
  })

  it('fetches the archive on entering its scope and discards it on leaving', () => {
    const { setArchiveVisible } = renderBoard([card({ id: '0001-live' })])
    expect(screen.queryByRole('region', { name: '已归档' })).toBeNull()

    enterArchive()
    expect(setArchiveVisible).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: '档案' }).getAttribute('aria-pressed')).toBe('true')

    // Leaving drops the pages: a cursor issued against one archive does not
    // describe the archive a reader comes back to.
    fireEvent.click(screen.getByRole('button', { name: '进行中' }))
    expect(setArchiveVisible).toHaveBeenLastCalledWith(false)
  })

  it('distinguishes an archive that is loading, empty, or unreadable', () => {
    renderBoard([card({ id: '0001-live' })], {}, { status: 'ready', cards: [] })
    enterArchive()
    expect(screen.getByRole('region', { name: '已归档' }).textContent).toContain('这个工作区还没有归档卡片')
    cleanup()

    renderBoard([card({ id: '0001-live' })], {}, { status: 'loading', cards: [] })
    enterArchive()
    expect(screen.getByRole('region', { name: '已归档' }).textContent).toContain('正在读取归档')
    cleanup()

    renderBoard([card({ id: '0001-live' })], {}, { status: 'error', cards: [] })
    enterArchive()
    expect(screen.getByRole('region', { name: '已归档' }).textContent).toContain('归档暂时无法读取')
    cleanup()

    // Between the click and the first page there is nothing to show yet, and
    // silence would read as an empty archive.
    renderBoard([card({ id: '0001-live' })], {}, IDLE_ARCHIVE)
    enterArchive()
    expect(screen.getByText('正在读取归档…')).toBeTruthy()
  })

  // Filed cards in the kanban would swell its done column with work nobody is
  // doing, so the archive is a scope of its own rather than a group inside the
  // active board — and it is reachable from either view.
  it('keeps filed cards out of the active board and reaches the archive from the kanban', () => {
    renderBoard(
      [card({ id: '0001-live' })],
      {},
      { status: 'ready', cards: [card({ id: '0009-shipped', stage: 'done', archived: true, archivedMonth: '2026-07' })] },
    )
    fireEvent.click(screen.getByRole('button', { name: '看板' }))
    expect(screen.queryByRole('region', { name: '已归档' })).toBeNull()

    enterArchive()
    expect(screen.getByRole('region', { name: '已归档' }).textContent).toContain('0009-shipped')
    // The active board is gone, so no filed card can reach a stage column.
    expect(screen.queryByText('0001-live')).toBeNull()

    // Stage columns say nothing about work that stopped flowing; the switch is
    // disabled with its reason shown rather than removed.
    const view = screen.getByRole('group', { name: '研发流程视图' })
    expect(within(view).getByRole('button', { name: '看板' }).hasAttribute('disabled')).toBe(true)
    expect(within(view).getByRole('button', { name: '列表' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('档案按入档月份分组，不按阶段。')).toBeTruthy()
  })

  // Only a shortened pipeline earns a badge; an ordinary card must not spend
  // one saying it is ordinary.
  it('marks a shortened pipeline on the row and leaves a standard card unmarked', () => {
    renderBoard([
      card({ id: '0001-ordinary' }),
      card({ id: '0002-incident', serviceClass: 'emergency' }),
      card({ id: '0003-typo', serviceClass: 'express' }),
    ])
    const rows = screen.getByRole('list', { name: '研发流程看板' })
    expect(rows.textContent).toContain('紧急')
    expect(rows.textContent).toContain('快车道')
    expect(screen.getByRole('button', { name: '查看 0001-ordinary 详情' }).textContent).not.toContain('快车道')
  })
})
