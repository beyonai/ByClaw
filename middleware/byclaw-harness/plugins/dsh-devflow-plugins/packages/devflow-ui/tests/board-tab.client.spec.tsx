// @vitest-environment jsdom
// The official right-Sidebar page: board and detail views without host chrome.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from './harness-doubles.ts'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevCard } from '@zhchxiao123/dsh-devflow/client'
import { ERROR_BOARD, IDLE_ARCHIVE, LOADING_BOARD, createArchiveSource, createBoardSource, createDetailSource, CLOSED_DETAIL, readyBoard } from '../src/client/board.ts'
import type { BoardBinding } from '../src/client/binding.ts'
import { createDevflowBoardPage } from '../src/client/DevflowBoardTab.tsx'
import type { DevflowBoardPageDeps } from '../src/client/DevflowBoardTab.tsx'
// Type-only: pulls the plugin's LocaleNamespaceMap merge into this program.
import type {} from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: DevflowBoardPageDeps['t'] = makeTranslate(zh)

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

function renderPage(
  cards: DevCard[] | undefined,
  detail: Partial<typeof CLOSED_DETAIL> = {},
  options: {
    visible?: boolean
    sessionId?: string
    splitView?: boolean
    status?: 'ready' | 'loading' | 'error'
    archived?: readonly DevCard[]
  } = {},
) {
  const board = createBoardSource()
  const status = options.status ?? (cards === undefined ? 'error' : 'ready')
  if (status === 'ready') board.set(readyBoard(cards ?? []))
  else if (status === 'error') board.set(ERROR_BOARD)
  else board.set(LOADING_BOARD)
  const detailSource = createDetailSource()
  detailSource.set({ ...CLOSED_DETAIL, ...detail })
  const openCardDetail = vi.fn()
  const closeCardDetail = vi.fn()
  const openSession = vi.fn()
  const refresh = vi.fn(() => Promise.resolve())
  const archive = createArchiveSource()
  const setArchiveVisible = vi.fn((visible: boolean) => {
    archive.set(visible ? { status: 'ready', cards: options.archived ?? [] } : IDLE_ARCHIVE)
  })
  const loadMoreArchive = vi.fn()
  const binding: BoardBinding = {
    board, detail: detailSource, archive, openCardDetail, closeCardDetail, refresh, setArchiveVisible, loadMoreArchive,
  }
  const unwatch = vi.fn()
  const watch = vi.fn(() => unwatch)
  const scopes: string[] = []
  const Page = createDevflowBoardPage({
    bindingFor: (sessionId) => { scopes.push(sessionId); return binding },
    watch,
    openSession,
    t,
  })
  const openResource = vi.fn()
  const tabProps = (visible = options.visible ?? true) => ({
    sessionId: options.sessionId ?? 'ses-one',
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: options.splitView === true },
      tab: { visible, actions: { openResource } },
    }),
  } as never)
  const view = render(<Page {...tabProps()} />)
  return {
    ...view, Page, tabProps, board, detailSource, openCardDetail, closeCardDetail,
    openSession, refresh, watch, unwatch, scopes, openResource,
  }
}

describe('devflow artifacts open their file', () => {
  const open = card({
    id: '0001-live',
    path: '/ws/.devflow/tasks/0001-live/card.md',
    artifacts: ['artifacts/design.md'],
    artifactRecords: [{ path: 'artifacts/design.md', kind: 'design-document', rev: 3, stage: 'designing' }],
  })

  it('opens an artifact beside the board rather than in its place', () => {
    const { openResource } = renderPage([open], { id: open.id, card: open, entries: [] })

    fireEvent.click(screen.getByRole('button', { name: '打开 artifacts/design.md' }))

    // The Host resolves the path against the workspace it holds for this
    // session, so the board needs no workspace root of its own.
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/ses-one//ws/.devflow/tasks/0001-live/artifacts/design.md',
    )
    // No placement argument: the board is the reader's context and must not be
    // the tab that gets replaced.
    expect(openResource.mock.calls[0]?.length).toBe(1)
  })

  it('opens the same file from the timeline registration', () => {
    const { openResource } = renderPage([open], {
      id: open.id,
      card: open,
      entries: [{ rev: 3, at: '2026-09-10T10:00:00.000Z', type: 'artifact', path: 'artifacts/design.md' }],
    })

    const timeline = screen.getByRole('list', { name: '流转时间线' })
    fireEvent.click(within(timeline).getByRole('button', { name: '打开 artifacts/design.md' }))

    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/ses-one//ws/.devflow/tasks/0001-live/artifacts/design.md',
    )
  })
})

// The board used to offer a control whose only outcome was a refusal: the
// store's two family rules were enforced there and mirrored nowhere here.
// The store files a requirement and its slices in one bucket so they stay
// together; the flat archive list threw that away.
describe('devflow archive keeps a family together', () => {
  const filed = (id: string, over: Partial<DevCard> = {}) =>
    card({ id, stage: 'done', archived: true, archivedMonth: '2026-09', ...over })

  it('puts a slice under the requirement it cuts, whatever order they arrive in', () => {
    // Ids descend within a bucket, so a slice reaches the page before its head.
    renderPage([card({ id: '0001-live' })], {}, {
      archived: [
        filed('0007-slice', { parent: DevflowCardId('0005-requirement') }),
        filed('0006-unrelated'),
        filed('0005-requirement'),
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: '档案' }))

    const head = screen.getByText('Card 0005-requirement').closest('li')
    expect(head).not.toBeNull()
    expect(head?.textContent).toContain('0007-slice')
    // The unrelated card is nobody's slice and keeps its own place.
    expect(head?.textContent).not.toContain('0006-unrelated')
  })

  it('leaves the top level in the order it arrived', () => {
    renderPage([card({ id: '0001-live' })], {}, {
      archived: [filed('0007-slice', { parent: DevflowCardId('0005-requirement') }), filed('0006-unrelated'), filed('0005-requirement')],
    })
    fireEvent.click(screen.getByRole('button', { name: '档案' }))

    // Re-sorting a paged set would lift a later page's card above an earlier
    // one, so only the slice moves — `0006` stays ahead of `0005`.
    const section = screen.getByRole('region', { name: '已归档' })
    const tops = [...section.querySelectorAll('[class*="archiveFamily"]')]
    expect(tops.map(li => li.textContent?.includes('0006-unrelated'))).toEqual([true, false])
  })

  it('says whose slice it is when the requirement is not on the loaded pages', () => {
    renderPage([card({ id: '0001-live' })], {}, {
      archived: [filed('0007-slice', { parent: DevflowCardId('0005-requirement') })],
    })
    fireEvent.click(screen.getByRole('button', { name: '档案' }))

    // The archive is paged: a family can straddle a page boundary, and position
    // alone cannot say what the relation is.
    expect(screen.getByText('属于 0005-requirement')).toBeTruthy()
  })
})

describe('devflow board offers only what the store would allow', () => {
  const requirement = card({ id: '0001-requirement', stage: 'draft' })
  const slice = (over: Partial<DevCard> = {}) =>
    card({ id: '0002-slice', stage: 'done', parent: requirement.id, ...over })

  it('offers nothing on a delivered slice while its requirement is on the board', () => {
    renderPage([requirement, slice()])

    // `archive` would answer `parent-active`; filing a slice first leaves its
    // requirement counting progress against a card nobody can see.
    expect(screen.queryByRole('group', { name: '0002-slice 的操作' })).toBeNull()
  })

  it('offers filing on a delivered slice once its requirement has left the board', () => {
    renderPage([slice()])

    expect(screen.getByRole('button', { name: '归档' })).toBeTruthy()
  })

  it('offers nothing on a requirement while a slice is unfinished', () => {
    renderPage([requirement, slice({ stage: 'developing' })])

    // `abandon` on the requirement would answer `children-active`.
    expect(screen.queryByRole('group', { name: '0001-requirement 的操作' })).toBeNull()
    // The slice itself is unfinished and has no children, so it keeps its own
    // decision: dropping one slice is not dropping the requirement.
    expect(within(screen.getByRole('group', { name: '0002-slice 的操作' }))
      .getByRole('button', { name: '放弃' })).toBeTruthy()
  })

  it('offers dropping on a requirement once every slice is delivered', () => {
    renderPage([requirement, slice()])

    expect(within(screen.getByRole('group', { name: '0001-requirement 的操作' }))
      .getByRole('button', { name: '放弃' })).toBeTruthy()
  })

  // A requirement with children is drawn as a lane rather than a card, so the
  // kanban was the one view where it carried no decision at all.
  it('carries the requirement\'s decision on its kanban lane header', () => {
    renderPage([requirement, slice()])

    // The lane header is where a decomposed requirement's own controls live.
    const lane = screen.getByRole('region', { name: `需求泳道:${requirement.title}` })
    expect(within(lane).getByRole('group', { name: '0001-requirement 的操作' })).toBeTruthy()
  })
})

describe('devflow board scope', () => {
  // The defect this covers: filing the workspace's last card used to drop the
  // whole toolbar, and with it the only route to the archive.
  it('keeps a route to the archive after the last active card is filed', () => {
    const filed = card({ id: '0009-shipped', stage: 'done', archived: true, archivedMonth: '2026-09' })
    renderPage([], {}, { archived: [filed] })

    expect(screen.getByText('没有进行中的研发卡片。归档和已放弃的卡片在「档案」里。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '档案' }))
    expect(screen.getByRole('region', { name: '已归档' }).textContent).toContain('0009-shipped')
  })

  it('reaches the archive from the kanban without passing through the list', () => {
    const dropped = card({ id: '0010-dropped', stage: 'draft', archived: true, archivedMonth: '2026-09', abandoned: true })
    renderPage([card({ id: '0001-live' })], {}, { archived: [dropped] })

    // The page opens on the kanban; no list visit in between.
    expect(screen.getByRole('button', { name: '看板' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '档案' }))

    expect(screen.getByRole('region', { name: '已归档' }).textContent).toContain('0010-dropped')
    expect(screen.getByRole('region', { name: '已归档' }).textContent).toContain('已放弃')
  })

  // The regression this covers: the toolbar was promoted to chrome without the
  // counts following the scope, so the archive page reported the active set.
  it('counts what the archive loaded, never the active board and never a total', () => {
    renderPage(
      [card({ id: '0001-live' }), card({ id: '0002-live' })],
      {},
      {
        archived: [
          card({ id: '0009-shipped', stage: 'done', archived: true, archivedMonth: '2026-09' }),
          card({ id: '0010-dropped', stage: 'draft', archived: true, archivedMonth: '2026-09', abandoned: true, abandonedReason: '需求撤销' }),
          card({ id: '0011-dropped', stage: 'draft', archived: true, archivedMonth: '2026-08', abandoned: true, abandonedReason: '并入 0009' }),
        ],
      },
    )
    expect(screen.getByText('共 2 张')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '档案' }))
    expect(screen.getByText('已加载 3 张')).toBeTruthy()
    expect(screen.getByText('已归档 1')).toBeTruthy()
    expect(screen.getByText('已放弃 2')).toBeTruthy()
    // The read face reports no archive total, so the page must not imply one,
    // and must not still be reporting the board it left.
    expect(screen.queryByText('共 2 张')).toBeNull()
    expect(screen.queryByText('共 3 张')).toBeNull()
  })

  it('groups the archive by the month each card was filed under', () => {
    renderPage([card({ id: '0001-live' })], {}, {
      archived: [
        card({ id: '0009-shipped', stage: 'done', archived: true, archivedMonth: '2026-09' }),
        card({ id: '0011-dropped', stage: 'draft', archived: true, archivedMonth: '2026-08', abandoned: true, abandonedReason: '并入 0009' }),
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: '档案' }))

    const section = screen.getByRole('region', { name: '已归档' })
    expect(within(section).getByRole('heading', { name: '2026-09' })).toBeTruthy()
    expect(within(section).getByRole('heading', { name: '2026-08' })).toBeTruthy()

    // A dropped card's reason is the only account of the decision, and the
    // journal refuses a blank one, so it can be read without opening the card.
    expect(section.textContent).toContain('并入 0009')
    // A filed card was not dropped, so it has no reason to show.
    const filedRow = within(section).getByText('Card 0009-shipped').closest('li')
    expect(filedRow?.textContent).not.toContain('并入')

    // Only a filed card can come back, and that is a `/devflow` decision.
    expect(section.textContent).toContain('入档的卡片可以经 /devflow 恢复；已放弃的不可逆。')
    expect(within(section).queryByRole('button', { name: '恢复' })).toBeNull()
  })

  // A reason sharing one line with the title, the id and the badge is a reason
  // clipped to a few words, which is one nobody can act on.
  it('gives a dropped card its reason on a line of its own', () => {
    const reason = '需求方撤回，这条线的价值已经由 0009 的方案覆盖，继续做只会产生两套要维护的实现'
    renderPage([card({ id: '0001-live' })], {}, {
      archived: [card({ id: '0011-dropped', stage: 'draft', archived: true, archivedMonth: '2026-08', abandoned: true, abandonedReason: reason })],
    })
    fireEvent.click(screen.getByRole('button', { name: '档案' }))

    const shown = screen.getByTitle(reason)
    expect(shown.textContent).toBe(reason)
    // The title heads its own line; the reason is not a sibling competing with
    // it for width.
    expect(shown.parentElement).not.toBe(screen.getByTitle('Card 0011-dropped').parentElement)
  })

  it('shows no archive counts before the first page lands', () => {
    renderPage([card({ id: '0001-live' })], {}, { archived: [] })
    fireEvent.click(screen.getByRole('button', { name: '档案' }))

    // "0 loaded" would contradict itself a moment later.
    expect(screen.queryByText('已加载 0 张')).toBeNull()
  })

  it('returns to the active board and drops the archive it was showing', () => {
    renderPage([card({ id: '0001-live' })], {}, { archived: [card({ id: '0009-shipped', stage: 'done', archived: true, archivedMonth: '2026-09' })] })

    fireEvent.click(screen.getByRole('button', { name: '档案' }))
    expect(screen.getByRole('region', { name: '已归档' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '进行中' }))
    expect(screen.queryByRole('region', { name: '已归档' })).toBeNull()
    expect(screen.getByRole('button', { name: '进行中' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('devflow sidebar page', () => {
  it('renders the stage-centric board with no pill, portal, or dismiss control', () => {
    const { openCardDetail, container } = renderPage([
      card({ id: '0001-big', stage: 'designing' }),
      card({ id: '0002-slice', stage: 'blocked', blockedFrom: 'developing', parent: DevflowCardId('0001-big') }),
    ])
    // The page fills the official pane in place and owns no host tab chrome.
    expect(container.querySelector('[class*="page"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /研发卡进行中/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '收起看板' })).toBeNull()

    const board = screen.getByRole('region', { name: '研发流程看板' })
    expect(board.textContent).toContain('需求草稿')
    expect(board.textContent).toContain('已完成')
    const lane = screen.getByRole('region', { name: /需求泳道/ })
    expect(lane.textContent).toContain('0001-big')
    expect(lane.textContent).toContain('0002-slice')
    expect(lane.textContent).toContain('子需求 0/1')
    expect(lane.textContent).toContain('受阻')
    fireEvent.click(screen.getByRole('button', { name: '查看 0002-slice 详情' }))
    expect(openCardDetail).toHaveBeenCalledExactlyOnceWith('0002-slice')
  })

  it('follows the store instead of a slot-synthesized snapshot', () => {
    const { board } = renderPage([card({ id: '0001-a' })])
    expect(screen.getAllByRole('button', { name: /查看 000\d/ })).toHaveLength(1)
    act(() => { board.set(readyBoard([card({ id: '0001-a' }), card({ id: '0002-b' })])) })
    expect(screen.getAllByRole('button', { name: /查看 000\d/ })).toHaveLength(2)
  })

  it('watches its own scope while visible, and lets go when it is not', () => {
    const visible = renderPage([card({ id: '0001-a' })], {}, { sessionId: 'ses-page', visible: true })
    // The page reads the binding of ITS session, not of whichever session the
    // app has in front.
    expect(visible.scopes).toEqual(['ses-page'])
    expect(visible.watch).toHaveBeenCalledExactlyOnceWith('ses-page')
    visible.unmount()
    expect(visible.unwatch).toHaveBeenCalledOnce()
    cleanup()

    const hidden = renderPage([card({ id: '0001-a' })], {}, { visible: false })
    expect(hidden.watch).not.toHaveBeenCalled()
    // Becoming visible picks the watch up exactly once.
    hidden.rerender(<hidden.Page {...hidden.tabProps(true)} />)
    expect(hidden.watch).toHaveBeenCalledExactlyOnceWith('ses-one')
    hidden.rerender(<hidden.Page {...hidden.tabProps(true)} />)
    expect(hidden.watch).toHaveBeenCalledOnce()
  })

  it('heads the page with the workspace total and distribution', () => {
    renderPage([
      card({ id: '0001-a', stage: 'developing' }),
      card({ id: '0002-b', stage: 'draft' }),
      card({ id: '0003-c', stage: 'blocked', blockedFrom: 'developing' }),
      card({ id: '0004-d', stage: 'done' }),
    ])
    expect(screen.getByText('共 4 张')).toBeTruthy()
    // Blocked is its own bucket, so the three counts partition the total.
    expect(screen.getByText('进行中 2')).toBeTruthy()
    expect(screen.getByText('受阻 1')).toBeTruthy()
    expect(screen.getByText('已完成 1')).toBeTruthy()
  })

  it('stays read-only: nothing but folding, filtering, and navigating', () => {
    const opened = card({ id: '0001-rich', title: 'Rich card', body: '## Goal\n- [ ] check' })
    renderPage([opened, card({ id: '0002-b' })], { id: opened.id, card: opened })
    const page = screen.getByRole('region', { name: '卡片详情' })
    // The requirement checklist remains read-only.
    const boxes = page.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(1)
    for (const box of boxes) expect((box as HTMLInputElement).disabled).toBe(true)
    expect(page.querySelectorAll('input:not([type="checkbox"]), textarea, select')).toHaveLength(0)
    // Every control on the detail is a fold or the way back.
    const controls = [...page.querySelectorAll('button, summary')]
      .map(control => control.getAttribute('aria-label') ?? control.textContent)
    expect(controls).toEqual(['需求书', '阶段产物'])
    expect(screen.getByRole('button', { name: '返回看板' })).toBeTruthy()
  })

  it('switches between Kanban and the compact list, with a narrow-stage selector available', () => {
    renderPage([
      card({ id: '0001-big', stage: 'designing' }),
      card({ id: '0002-slice-a', stage: 'blocked', blockedFrom: 'developing', parent: DevflowCardId('0001-big') }),
      card({ id: '0003-slice-b', stage: 'developing', parent: DevflowCardId('0001-big') }),
      card({ id: '0004-standalone', stage: 'done' }),
    ])
    expect(screen.getByRole('button', { name: '看板' }).getAttribute('aria-pressed')).toBe('true')
    const stageSelector = screen.getByRole('group', { name: '选择研发阶段' })
    const stageButtons = [...stageSelector.querySelectorAll('button')]
    expect(stageButtons).toHaveLength(7)
    const reviewing = stageButtons.find(button => button.textContent?.includes('评审'))!
    fireEvent.click(reviewing)
    expect(reviewing.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '列表' }))
    const rows = screen.getByRole('list', { name: '研发流程看板' }).querySelectorAll('li')
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('子需求 0/2')
    expect(rows[1].textContent).toContain('0002-slice-a')
    expect(rows[2].textContent).toContain('0003-slice-b')
    expect(rows[3].textContent).toContain('0004-standalone')
    fireEvent.click(screen.getByRole('button', { name: '看板' }))
    expect(screen.getByRole('region', { name: '研发流程看板' })).toBeTruthy()
  })

  it('renders the detail as foldable sections, timeline included', () => {
    const opened = card({
      id: '0001-rich',
      title: 'Rich card',
      body: '## Goal\nShip it.',
      artifacts: ['artifacts/design.md'],
      parent: DevflowCardId('0009-parent'),
    })
    renderPage([opened], {
      id: opened.id,
      card: opened,
      entries: [{ rev: 1, at: '2026-08-01T00:00:00Z', type: 'created', by: { kind: 'human' } }],
    })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    const sections = [...detail.querySelectorAll('details')]
    expect(sections.map(section => section.querySelector('summary')?.textContent))
      .toEqual(['需求书', '拆分关系', '阶段产物', '流转时间线'])
    // Every section arrives open; the timeline in particular.
    for (const section of sections) expect(section.open).toBe(true)
    expect(detail.textContent).toContain('创建')
  })

  it('puts the list beside an open detail only in the Sidebar fullscreen presentation', () => {
    const opened = card({ id: '0001-rich', title: 'Rich card' })
    const stacked = renderPage([opened], { id: opened.id, card: opened })
    expect(screen.queryByRole('region', { name: '研发流程看板' })).toBeNull()
    expect(screen.getByRole('button', { name: '返回看板' })).toBeTruthy()
    stacked.unmount()
    cleanup()

    const split = renderPage([opened], { id: opened.id, card: opened }, { splitView: true })
    // Both halves are on screen, and the back control gives way to a close one.
    expect(screen.getByRole('region', { name: '研发流程看板' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '卡片详情' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '返回看板' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    expect(split.closeCardDetail).toHaveBeenCalledOnce()
  })

  it('stays stacked in the normal Sidebar presentation', () => {
    const board = createBoardSource()
    const opened = card({ id: '0001-a' })
    board.set(readyBoard([opened]))
    const detailSource = createDetailSource()
    detailSource.set({ ...CLOSED_DETAIL, id: opened.id, card: opened })
    const binding: BoardBinding = {
      board,
      detail: detailSource,
      archive: createArchiveSource(),
      openCardDetail: vi.fn(),
      closeCardDetail: vi.fn(),
      refresh: vi.fn(() => Promise.resolve()),
      setArchiveVisible: vi.fn(),
      loadMoreArchive: vi.fn(),
    }
    const Page = createDevflowBoardPage({
      bindingFor: () => binding, watch: () => () => {}, openSession: vi.fn(), t,
    })
    render(<Page {...({
      sessionId: 'ses-one',
      useTabInfo: () => ({ sidebar: { expanded: true, fullscreen: false }, tab: { visible: true } }),
    } as never)} />)
    expect(screen.getByRole('region', { name: '卡片详情' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '研发流程看板' })).toBeNull()
  })

  it('distinguishes loading, empty, and failed reads and retries the failure', () => {
    renderPage([])
    expect(screen.getByText('没有进行中的研发卡片。归档和已放弃的卡片在「档案」里。')).toBeTruthy()
    cleanup()
    renderPage(undefined, {}, { status: 'loading' })
    expect(screen.getByText('正在加载研发流程…')).toBeTruthy()
    cleanup()
    const failed = renderPage(undefined, {}, { status: 'error' })
    expect(screen.getByRole('alert').textContent).toContain('研发流程暂时无法读取。')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(failed.refresh).toHaveBeenCalledOnce()
  })

  it('shows one card\'s detail with a back control, and the loading placeholder before it lands', () => {
    const opened = card({ id: '0001-rich', title: 'Rich card', body: '## Goal\nShip it.' })
    const { closeCardDetail } = renderPage([opened], { id: opened.id, card: opened })
    const detail = screen.getByRole('region', { name: '卡片详情' })
    expect(detail.textContent).toContain('Rich card')
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '研发流程看板' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回看板' }))
    expect(closeCardDetail).toHaveBeenCalled()
    cleanup()

    renderPage([opened], { id: opened.id })
    expect(screen.getByRole('region', { name: '卡片详情' }).textContent).toContain('加载中')
    cleanup()

    // A detail can outlive its listing (a failed board fetch): the sheet still
    // renders, with no breakdown relations to resolve against.
    renderPage(undefined, { id: opened.id, card: opened })
    expect(screen.getByRole('region', { name: '卡片详情' }).textContent).toContain('Rich card')
  })
})

it('embeds the optional read-only Midscene summary in the existing detail sheet', () => {
  const opened = card({ id: '0001-midscene', title: 'Browser task' })
  renderPage([opened], { id: opened.id, card: opened, midscene: { available: true, profiles: [], jobs: [], gateEngineAvailable: false } })
  expect(screen.getByText('Midscene 浏览器验收')).toBeTruthy()
  expect(screen.getByText('此工作区尚未完成配置。')).toBeTruthy()
})
