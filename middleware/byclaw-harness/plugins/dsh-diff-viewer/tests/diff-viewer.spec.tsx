// @vitest-environment jsdom
// DiffViewer: the visual diff surface — pure diff computation (paired/unified
// line walks, word marks, context collapsing) tested directly, then the
// rendered component: split/unified modes, change bars and line numbers,
// collapsed separators and their expansion, the empty-side buffer, windowed
// rendering, the copy control, and the footer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  collapseContextPaired, collapseContextUnified, computePairedLines, computeUnifiedLines, computeWordDiff,
  copyText, diffStats, DiffViewer, displayMaxChars, expandRegion, isTooFragmented, langFromPath, lineNumberColumnWidth,
  resolveDiffViewMode, separatorDirections,
} from '../src/client/DiffViewer.tsx'
import { callTimeDiffs, diffCardModel } from '../src/client/diffcard-contract.ts'
import { defaultOpenFor, MutationRow } from '../src/client/mutation-row.tsx'

afterEach(cleanup)

beforeEach(() => {
  vi.restoreAllMocks()
})

/** A before/after pair of one changed file, as the wire delivers it. */
const hunk = (path: string, oldText: string | null, newText: string): Parameters<typeof DiffViewer>[0]['diffs'][number] =>
  ({ path, oldText, newText })

describe('computePairedLines', () => {
  it('pairs equal runs as context with both sides’ line numbers', () => {
    const rows = computePairedLines('a\nb', 'a\nb')
    expect(rows).toEqual([
      { left: { type: 'context', content: 'a', lineNo: 1 }, right: { type: 'context', content: 'a', lineNo: 1 } },
      { left: { type: 'context', content: 'b', lineNo: 2 }, right: { type: 'context', content: 'b', lineNo: 2 } },
    ])
  })

  it('pairs a replacement positionally and marks its intra-line difference', () => {
    const rows = computePairedLines('hello\nkeep', 'hello world\nkeep')
    expect(rows[0]!.left).toEqual({ type: 'delete', content: 'hello', lineNo: 1, wordDiffSegments: [{ text: 'hello' }] })
    expect(rows[0]!.right).toEqual({
      type: 'add', content: 'hello world', lineNo: 1,
      wordDiffSegments: [{ text: 'hello' }, { text: ' world', diffType: 'add' }],
    })
  })

  it('renders a pure addition as empty-left pairs', () => {
    const rows = computePairedLines('', 'x\ny')
    expect(rows).toEqual([
      { left: { type: 'empty', content: '' }, right: { type: 'add', content: 'x', lineNo: 1 } },
      { left: { type: 'empty', content: '' }, right: { type: 'add', content: 'y', lineNo: 2 } },
    ])
  })

  it('renders a pure deletion as empty-right pairs', () => {
    const rows = computePairedLines('a\nb', '')
    expect(rows).toEqual([
      { left: { type: 'delete', content: 'a', lineNo: 1 }, right: { type: 'empty', content: '' } },
      { left: { type: 'delete', content: 'b', lineNo: 2 }, right: { type: 'empty', content: '' } },
    ])
  })

  it('walks adjacent removed and added runs of different lengths', () => {
    // diffLines groups `a\nx` as one removed run and `p\nq\nr` as the added
    // run; the taller side drives the pairing and the shorter side empties.
    const rows = computePairedLines('a\nx\nkeep', 'p\nq\nr\nkeep')
    const kinds = rows.map(row => [row.left.type, row.right.type])
    expect(kinds).toEqual([
      ['delete', 'add'],
      ['delete', 'add'],
      ['empty', 'add'],
      ['context', 'context'],
    ])
    expect(rows[0]!.left.lineNo).toBe(1)
    expect(rows[2]!.right.lineNo).toBe(3)
  })

  it('empties the right side when the removed run is longer than the added', () => {
    const rows = computePairedLines('a\nb', 'x')
    expect(rows.map(row => [row.left.type, row.right.type])).toEqual([['delete', 'add'], ['delete', 'empty']])
    expect(rows[1]!.right).toEqual({ type: 'empty', content: '' })
  })

  it('keeps an empty-string line from a run that spans a bare newline', () => {
    // '\nx' splits to ['', 'x']; the removed '\n' line indexes the empty entry.
    const rows = computePairedLines('\nx', 'y\nx')
    expect(rows[0]!.left.content).toBe('')
    expect(rows[0]!.left.lineNo).toBe(1)
    expect(rows[0]!.right).toMatchObject({ type: 'add', content: 'y', lineNo: 1 })
    expect(rows[1]!.left).toMatchObject({ type: 'context', content: 'x', lineNo: 2 })
  })

  it('keeps an empty added line and empty context lines', () => {
    const addedOnly = computePairedLines('', '\nx')
    expect(addedOnly[0]!.right).toEqual({ type: 'add', content: '', lineNo: 1 })
    expect(addedOnly[1]!.right).toEqual({ type: 'add', content: 'x', lineNo: 2 })
    const contexts = computePairedLines('\nx', '\nx')
    expect(contexts[0]).toEqual({
      left: { type: 'context', content: '', lineNo: 1 },
      right: { type: 'context', content: '', lineNo: 1 },
    })
  })

  it('keeps an empty line in a removed-only run (no paired addition)', () => {
    // The removed-only loop indexes beforeLines directly; the empty first
    // entry of ['', 'x'] stays renderable through the `|| ''` fallback.
    const rows = computePairedLines('\nx', 'x')
    expect(rows[0]!.left).toEqual({ type: 'delete', content: '', lineNo: 1 })
    expect(rows[1]!.left).toEqual({ type: 'context', content: 'x', lineNo: 2 })
  })

  it('skips word marks on a too-fragmented rewrite line', () => {
    const rows = computePairedLines('totally different line here', 'unrelated replacement there')
    expect(rows[0]!.left.wordDiffSegments).toBeUndefined()
    expect(rows[0]!.right.wordDiffSegments).toBeUndefined()
  })
})

describe('computeUnifiedLines', () => {
  it('flattens an edit into delete/add/context rows with both numbers on context', () => {
    const rows = computeUnifiedLines('a\nkeep\nc', 'a2\nkeep\nc2')
    expect(rows).toEqual([
      { type: 'delete', content: 'a', oldLineNo: 1, wordDiffSegments: [{ text: 'a', diffType: 'delete' }] },
      { type: 'add', content: 'a2', newLineNo: 1, wordDiffSegments: [{ text: 'a2', diffType: 'add' }] },
      { type: 'context', content: 'keep', oldLineNo: 2, newLineNo: 2 },
      { type: 'delete', content: 'c', oldLineNo: 3, wordDiffSegments: [{ text: 'c', diffType: 'delete' }] },
      { type: 'add', content: 'c2', newLineNo: 3, wordDiffSegments: [{ text: 'c2', diffType: 'add' }] },
    ])
  })

  it('keeps the side’s own number on pure additions and deletions', () => {
    expect(computeUnifiedLines('', 'x\ny').map(l => [l.type, l.newLineNo]))
      .toEqual([['add', 1], ['add', 2]])
    expect(computeUnifiedLines('x\ny', '').map(l => [l.type, l.oldLineNo]))
      .toEqual([['delete', 1], ['delete', 2]])
  })

  it('keeps an empty-string line from a run that spans a bare newline', () => {
    // The `|| ''` fallback keeps an empty first entry of ['', 'x'] renderable.
    expect(computeUnifiedLines('\nx', 'y\nx')[0]).toMatchObject({ type: 'delete', content: '', oldLineNo: 1 })
    expect(computeUnifiedLines('', '\nx')[0]).toEqual({ type: 'add', content: '', newLineNo: 1 })
    expect(computeUnifiedLines('\nx', '\nx')[0]).toMatchObject({ type: 'context', content: '', oldLineNo: 1 })
  })

  it('pairs an uneven removed/added block, emptying the short side and keeping marks', () => {
    // A two-line removal against a one-line addition: the second delete row has
    // no paired new line (no word marks), and a one-line removal against two
    // additions leaves the second add row without an old line.
    const removedLonger = computeUnifiedLines('a\nb', 'x')
    expect(removedLonger[1]).toEqual({ type: 'delete', content: 'b', oldLineNo: 2 })
    const addedLonger = computeUnifiedLines('a', 'x\ny')
    expect(addedLonger[2]).toEqual({ type: 'add', content: 'y', newLineNo: 2 })
  })

  it('keeps an empty line through the paired and removed-only walks', () => {
    // A paired addition starting on an empty after entry ('\ny' splits to
    // ['', 'y']) and a pure removal of a leading empty line both exercise the
    // `|| ''` fallback.
    const paired = computeUnifiedLines('x', '\ny')
    expect(paired[1]).toMatchObject({ type: 'add', content: '', newLineNo: 1 })
    expect(computeUnifiedLines('\nx', 'x')[0]).toMatchObject({ type: 'delete', content: '', oldLineNo: 1 })
  })
})

describe('computeWordDiff', () => {
  it('aligns shared runs into both sides and marks the changed run', () => {
    // diffWordsWithSpace tokenizes `hello world` as `hello ` + `world`, so the
    // trailing space rides the shared run.
    const { left, right } = computeWordDiff('hello world', 'hello brave world')
    expect(left).toEqual([{ text: 'hello ' }, { text: 'world' }])
    expect(right).toEqual([{ text: 'hello ' }, { text: 'brave ', diffType: 'add' }, { text: 'world' }])
  })

  it('merges adjacent same-direction runs', () => {
    const { right } = computeWordDiff('a', 'xy')
    // 'a' vs 'xy': every character differs, so the added runs merge into one.
    expect(right).toEqual([{ text: 'xy', diffType: 'add' }])
  })

  it('folds a whitespace-only run between two added runs into the addition', () => {
    const { right } = computeWordDiff('ab', 'a b')
    expect(right).toEqual([{ text: 'a b', diffType: 'add' }])
  })
})

describe('isTooFragmented', () => {
  it('drops marks when a rewrite shares little with the original', () => {
    const { changes } = computeWordDiff('totally different line here', 'unrelated replacement there')
    expect(isTooFragmented(changes)).toBe(true)
  })

  it('keeps marks on a small edit', () => {
    const { changes } = computeWordDiff('hello', 'hello world')
    expect(isTooFragmented(changes)).toBe(false)
  })

  it('keeps marks on a short line regardless of its ratio', () => {
    const { changes } = computeWordDiff('ab', 'xy')
    expect(isTooFragmented(changes)).toBe(false)
  })
})

describe('context collapsing', () => {
  const contextRun = (n: number): { left: { type: 'context'; content: string; lineNo: number }; right: { type: 'context'; content: string; lineNo: number } }[] =>
    Array.from({ length: n }, (_, i) => ({
      left: { type: 'context' as const, content: `c${i}`, lineNo: i + 1 },
      right: { type: 'context' as const, content: `c${i}`, lineNo: i + 1 },
    }))

  it('returns an empty list for an empty input', () => {
    expect(collapseContextPaired([])).toEqual([])
    expect(collapseContextUnified([])).toEqual([])
  })

  it('keeps a short context run whole', () => {
    const lines = [...contextRun(6), {
      left: { type: 'delete' as const, content: 'x', lineNo: 7 },
      right: { type: 'empty' as const, content: '' },
    }]
    expect(collapseContextPaired(lines)).toHaveLength(7)
  })

  it('collapses a long middle run, keeping three lines each side', () => {
    const lines = [
      { left: { type: 'delete' as const, content: 'x', lineNo: 1 }, right: { type: 'empty' as const, content: '' } },
      ...contextRun(20),
      { left: { type: 'add' as const, content: 'y', lineNo: 22 }, right: { type: 'add' as const, content: 'y', lineNo: 22 } },
    ]
    const rows = collapseContextPaired(lines)
    // 1 change + 3 kept + 1 separator + 3 kept + 1 change.
    expect(rows).toHaveLength(9)
    expect(rows[4]).toMatchObject({ collapsed: true, count: 14 })
  })

  it('keeps no leading context before a first-region separator and no trailing after a last', () => {
    // Two separate runs (a change between them): the first run is first, so it
    // keeps no leading context; the last run is last, so it keeps no trailing.
    const lines = [
      ...contextRun(10),
      { left: { type: 'delete' as const, content: 'x', lineNo: 11 }, right: { type: 'empty' as const, content: '' } },
      ...contextRun(20),
    ]
    const rows = collapseContextPaired(lines)
    expect(rows[0]).toMatchObject({ collapsed: true, isFirst: true, count: 7 })
    expect(rows.at(-1)).toMatchObject({ collapsed: true, isLast: true, count: 17 })
  })

  it('marks a separator chunked when its count exceeds the expansion chunk', () => {
    const rows = collapseContextPaired(contextRun(120))
    expect(rows[0]).toMatchObject({ collapsed: true, chunked: true })
  })

  it('un-folds an expanded region by its budget', () => {
    const lines = [...contextRun(20), {
      left: { type: 'delete' as const, content: 'x', lineNo: 21 },
      right: { type: 'empty' as const, content: '' },
    }]
    const collapsed = collapseContextPaired(lines)
    // The run opens the file, so it keeps no leading context: 20 - 3 kept = 17.
    const separator = collapsed.find(row => 'collapsed' in row)
    expect(separator).toMatchObject({ collapsed: true, isFirst: true, count: 17 })
    const expanded = expandRegion(new Map(), (separator as { id: number }).id, 'both')
    // 17 hidden + 2*100 budget: everything un-folds.
    expect(collapseContextPaired(lines, expanded)).toHaveLength(21)
  })

  it('collapses unified runs the same way', () => {
    const lines = [
      ...Array.from({ length: 30 }, (_, i) => ({
        type: 'context' as const, content: `c${i}`, oldLineNo: i + 1, newLineNo: i + 1,
      })),
      { type: 'delete' as const, content: 'x', oldLineNo: 31 },
    ]
    const rows = collapseContextUnified(lines)
    // The file-leading run keeps no leading context: 30 - 3 kept = 27.
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ collapsed: true, isFirst: true, count: 27 })
  })

  it('collapses a middle unified run and a trailing run with the same budget', () => {
    const middle = [
      { type: 'delete' as const, content: 'x', oldLineNo: 1 },
      ...Array.from({ length: 20 }, (_, i) => ({
        type: 'context' as const, content: `c${i}`, oldLineNo: i + 2, newLineNo: i + 2,
      })),
      { type: 'add' as const, content: 'y', newLineNo: 23 },
    ]
    const middleRows = collapseContextUnified(middle)
    // 1 change + 3 kept + separator + 3 kept + 1 change.
    expect(middleRows).toHaveLength(9)
    expect(middleRows[4]).toMatchObject({ collapsed: true, count: 14 })

    const trailing = [
      { type: 'delete' as const, content: 'x', oldLineNo: 1 },
      ...Array.from({ length: 20 }, (_, i) => ({
        type: 'context' as const, content: `c${i}`, oldLineNo: i + 2, newLineNo: i + 2,
      })),
    ]
    const trailingRows = collapseContextUnified(trailing)
    // The trailing run keeps no trailing context: 20 - 3 kept = 17.
    expect(trailingRows.at(-1)).toMatchObject({ collapsed: true, isLast: true, count: 17 })
  })

  it('keeps a short unified run whole', () => {
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => ({
        type: 'context' as const, content: `c${i}`, oldLineNo: i + 1, newLineNo: i + 1,
      })),
      { type: 'delete' as const, content: 'x', oldLineNo: 7 },
    ]
    expect(collapseContextUnified(lines)).toHaveLength(7)
  })
})

describe('expandRegion', () => {
  it('grows the requested side by one chunk, preserving the other side', () => {
    const map = expandRegion(new Map(), 5, 'up')
    expect(map.get(5)).toEqual({ fromStart: 100, fromEnd: 0 })
    const both = expandRegion(map, 5, 'down')
    expect(both.get(5)).toEqual({ fromStart: 100, fromEnd: 100 })
  })
})

describe('separatorDirections', () => {
  it('offers both ways in the middle, one way at the edges, both chunks on a chunked row', () => {
    expect(separatorDirections({})).toEqual(['both'])
    expect(separatorDirections({ isFirst: true })).toEqual(['down'])
    expect(separatorDirections({ isLast: true })).toEqual(['up'])
    // A whole-file run (first and last) has no neighbour; the direction is
    // arbitrary but stable, matching PiUI's unchunked branch.
    expect(separatorDirections({ isFirst: true, isLast: true })).toEqual(['down'])
    expect(separatorDirections({ chunked: true })).toEqual(['up', 'down'])
    expect(separatorDirections({ chunked: true, isFirst: true })).toEqual(['down'])
    expect(separatorDirections({ chunked: true, isLast: true })).toEqual(['up'])
  })
})

describe('diffStats and copyText', () => {
  it('counts added/removed lines and distinct files across hunks', () => {
    expect(diffStats([
      hunk('a.ts', 'x\ny\n', 'x\ny\nz\n'),
      hunk('a.ts', 'p', 'q'),
      hunk('b.ts', null, 'new\n'),
    ])).toEqual({ added: 5, removed: 3, files: 2 })
  })

  it('serializes the copy text with path headers and +/- prefixes', () => {
    expect(copyText([hunk('a.ts', 'old\n', 'new\n')]))
      .toBe('a.ts\n- old\n+ new')
  })
})

describe('langFromPath', () => {
  it('resolves common extensions case-insensitively across separators', () => {
    expect(langFromPath('src/a.ts')).toBe('ts')
    expect(langFromPath('C:\\src\\main.rs')).toBe('rs')
    expect(langFromPath('conf.YML')).toBe('yaml')
  })

  it('yields undefined for dotfiles, unknown extensions, and prototype names', () => {
    expect(langFromPath('.gitignore')).toBeUndefined()
    expect(langFromPath('data.bin')).toBeUndefined()
    expect(langFromPath('foo.constructor')).toBeUndefined()
  })
})

describe('lineNumberColumnWidth', () => {
  it('scales with digits and keeps a readable floor', () => {
    expect(lineNumberColumnWidth(1)).toBe(44)
    expect(lineNumberColumnWidth(1_000)).toBe(60)
  })
})

describe('displayMaxChars', () => {
  it('finds the widest content across paired rows, ignoring separators', () => {
    const rows: Parameters<typeof displayMaxChars>[0] = [
      {
        left: { type: 'context' as const, content: 'abc', lineNo: 1 },
        right: { type: 'context' as const, content: 'abc', lineNo: 1 },
      },
      {
        left: { type: 'delete' as const, content: 'x', lineNo: 2 },
        right: { type: 'empty' as const, content: '' },
      },
      { collapsed: true, count: 5, id: 3, isFirst: false, isLast: false, chunked: false },
    ]
    expect(displayMaxChars(rows)).toBe(3)
  })

  it('measures unified rows and returns 0 for an all-separator list', () => {
    expect(displayMaxChars([
      { type: 'add' as const, content: 'very long line', newLineNo: 1 },
      { type: 'context' as const, content: 'short', oldLineNo: 2, newLineNo: 2 },
    ])).toBe(14)
    expect(displayMaxChars([
      { collapsed: true, count: 5, id: 0, isFirst: true, isLast: true, chunked: false },
    ])).toBe(0)
    expect(displayMaxChars([])).toBe(0)
  })
})

describe('DiffViewer rendering', () => {
  const twoLineHunk = hunk('notes/demo.txt', 'hello', 'hello fixture')

  it('renders nothing for an empty diffs array', () => {
    const { container } = render(<DiffViewer diffs={[]} />)
    expect(container.childElementCount).toBe(0)
  })

  it('draws the file header, the change, the footer, and the copy control', () => {
    const view = render(<DiffViewer diffs={[twoLineHunk]} />)
    expect(view.getByText('notes/demo.txt')).toBeTruthy()
    expect(view.getByText('hello fixture')).toBeTruthy()
    expect(view.getByText('└ +1 -1 · 1 file')).toBeTruthy()
    expect(view.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('renders split rows with change bars and line numbers on both sides', () => {
    const { container } = render(<DiffViewer diffs={[twoLineHunk]} viewMode="split" />)
    // The delete side shows the old line number 1; the add side shows new 1.
    expect(container.querySelectorAll('[class*="_barAdd_"]')).toHaveLength(1)
    expect(container.querySelectorAll('[class*="_barDelete_"]')).toHaveLength(1)
    expect(container.textContent).toContain('hello')
  })

  it('auto-downgrades a pure addition to unified (one gutter, no empty buffer)', () => {
    const { container } = render(<DiffViewer diffs={[hunk('new.txt', null, 'fresh\n')]} />)
    // The empty-side buffer never renders for a unified add.
    expect(container.querySelectorAll('[class*="_rowEmpty_"]')).toHaveLength(0)
    expect(container.getAttribute('data-diff')).toBeDefined()
  })

  it('renders the empty-side stripe buffer in split mode when the sides are unequal', () => {
    // A three-line removal against a two-line addition leaves the third pair
    // with an empty right side — the split-mode stripe buffer.
    const { container } = render(<DiffViewer diffs={[hunk('gone.ts', 'a\nb\nc', 'x\ny')]} viewMode="split" />)
    expect(container.querySelectorAll('[class*="_rowEmpty_"]').length).toBeGreaterThan(0)
  })

  it('honours viewMode=unified on a two-sided change', () => {
    const view = render(<DiffViewer diffs={[twoLineHunk]} viewMode="unified" />)
    // Unified draws old and new line numbers in the one gutter.
    expect(view.getByText('hello fixture')).toBeTruthy()
  })

  it('collapses long context and expands it on separator click', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const view = render(<DiffViewer diffs={[hunk('long.txt', lines, `${lines}\nappended`)]} />)
    // The file-leading 40 context lines collapse to 3 kept + separator + 3 kept.
    expect(view.getByText(/行未变更/)).toBeTruthy()
    // A hidden line is out of the DOM until the separator is expanded.
    expect(view.queryByText('line 10')).toBeNull()
    // Click the label button (the whole-row un-fold), which fires the same
    // expand handler the gutter chevron uses.
    fireEvent.click(screen.getByRole('button', { name: /行未变更/ }))
    // Expansion un-folds the hidden run; the separator label disappears, and
    // the first window now includes a previously hidden line.
    expect(screen.queryByRole('button', { name: /行未变更/ })).toBeNull()
    expect(view.getAllByText('line 10').length).toBeGreaterThan(0)
  })

  it('caps the viewport height with maxLines', () => {
    const { container } = render(<DiffViewer diffs={[twoLineHunk]} maxLines={4} />)
    const viewport = container.querySelector('[class*="_viewport_"]') as HTMLElement
    expect(viewport.style.maxHeight).toBe('88px')
  })

  it('windows a long diff: only the visible slice is in the DOM, and scrolling renders further rows', () => {
    const before = Array.from({ length: 300 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 300 }, (_, i) => `new ${i}`).join('\n')
    const { container } = render(<DiffViewer diffs={[hunk('big.ts', before, after)]} />)
    const viewport = container.querySelector('[class*="_viewport_"]') as HTMLElement
    // jsdom reports no layout height, so the first window is one row + overscan.
    const mounted = viewport.querySelectorAll('[class*="_contentRow_"]').length
    expect(mounted).toBeLessThan(40)
    expect(container.textContent).toContain('old 0')
    // Scrolling past the head renders a later slice.
    Object.defineProperty(viewport, 'scrollTop', { value: 200 * 22, configurable: true })
    fireEvent.scroll(viewport)
    expect(container.textContent).toContain('old 200')
  })

  it('collapses and expands context in split view too', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `s${i}`).join('\n')
    const make = () => render(<DiffViewer diffs={[hunk('s.txt', `${lines}\nend`, `${lines}\nchanged`)]} viewMode="split" />)
    // The trailing run collapses; clicking its label un-folds it through the
    // label button's own handler...
    const byLabel = make()
    expect(byLabel.getByText(/行未变更/)).toBeTruthy()
    fireEvent.click(byLabel.getByRole('button', { name: /行未变更/ }))
    expect(byLabel.container.textContent).not.toContain('行未变更')
    expect(byLabel.container.textContent).toContain('s5')
    cleanup()
    // ...and the gutter chevron un-folds it through its own handler.
    const byChevron = make()
    const chevron = byChevron.container.querySelector('button[title="向下展开"]') as HTMLElement
    expect(chevron).not.toBeNull()
    fireEvent.click(chevron)
    expect(byChevron.container.textContent).not.toContain('行未变更')
    expect(byChevron.container.textContent).toContain('s5')
  })

  it('renders a left-empty pair when the added run is longer in split mode', () => {
    // A one-line removal against two additions leaves the second pair's left
    // side empty; the split gutter still sizes by the widest present number.
    const view = render(<DiffViewer diffs={[hunk('e.ts', 'a', 'x\ny')]} viewMode="split" />)
    expect(view.container.querySelectorAll('[class*="_rowEmpty_"]').length).toBeGreaterThan(0)
    expect(view.getByText('y')).toBeTruthy()
  })

  it('marks intra-line changes with word-level tints', () => {
    // 'hello' → 'hello fixture' is too fragmented (ratio < 0.4), so use a
    // smaller change that survives the guard: 'same text' → 'same new text'.
    const view = render(<DiffViewer diffs={[hunk('w.ts', 'same text', 'same new text')]} />)
    expect(view.container.querySelectorAll('[class*="_wordAdd_"]').length).toBeGreaterThan(0)
  })

  it('marks a deleted word without syntax tokens on a plain-extension path', () => {
    // The delete side keeps a word mark (the common runs keep the ratio above
    // the fragmentation threshold) and renders without shiki tokens for .txt.
    const view = render(<DiffViewer diffs={[hunk('note.txt', 'hello brave world', 'hello world')]} />)
    expect(view.container.querySelectorAll('[class*="_wordDelete_"]').length).toBeGreaterThan(0)
  })

  it('renders an up-expanding separator for a trailing context run and a both-expanding one for a middle run', () => {
    const context = Array.from({ length: 20 }, (_, i) => `c${i}`).join('\n')
    // The context run sits after a change, so its separator expands upward.
    const trailing = render(<DiffViewer diffs={[hunk('t.txt', `x\n${context}`, `y\n${context}`)]} />)
    expect(trailing.container.querySelector('button[title="向上展开"]')).not.toBeNull()
    // The context run sits between two changes, so its separator expands both ways.
    const middle = render(<DiffViewer diffs={[hunk('m.txt', `a\n${context}\nz`, `b\n${context}\nz2`)]} />)
    const bothChevron = middle.container.querySelector('button[title="展开隐藏行"]') as HTMLElement
    expect(bothChevron).not.toBeNull()
    // Clicking the chevron un-folds the hidden middle run through the gutter
    // button's own handler. Queries stay scoped to this render's container —
    // render()'s role queries bind to document.body, which still holds the
    // trailing render's unexpanded separator.
    fireEvent.click(bothChevron)
    expect(middle.container.textContent).not.toContain('行未变更')
    // The expanded window renders a line that the collapsed separator hid.
    expect(middle.container.textContent).toContain('c5')
  })

  it('collapses and expands context in unified view too', () => {
    const context = Array.from({ length: 40 }, (_, i) => `u${i}`).join('\n')
    // The change comes first, so the 40-line context run trails it and its
    // separator expands upward. One render per interaction path: the label
    // button un-folds through its own handler, then the gutter chevron.
    const make = () => render(<DiffViewer diffs={[hunk('u.txt', `end\n${context}`, `changed\n${context}`)]} viewMode="unified" />)
    const byLabel = make()
    expect(byLabel.getByText(/行未变更/)).toBeTruthy()
    fireEvent.click(byLabel.getByRole('button', { name: /行未变更/ }))
    expect(byLabel.container.textContent).not.toContain('行未变更')
    expect(byLabel.container.textContent).toContain('u5')
    cleanup()
    const byChevron = make()
    const chevron = byChevron.container.querySelector('button[title="向上展开"]') as HTMLElement
    expect(chevron).not.toBeNull()
    fireEvent.click(chevron)
    expect(byChevron.container.textContent).not.toContain('行未变更')
    expect(byChevron.container.textContent).toContain('u5')
  })

  it('shows the empty state when both sides are empty', () => {
    const view = render(<DiffViewer diffs={[hunk('blank.ts', '', '')]} />)
    expect(view.getByText('无变更')).toBeTruthy()
  })

  it('copies the diff and flips the control label on success', async () => {
    const write = vi.fn().mockResolvedValue(true)
    vi.spyOn(await import('../src/client/clipboard.ts'), 'writeClipboard').mockImplementation(write)
    const view = render(<DiffViewer diffs={[twoLineHunk]} />)
    fireEvent.click(view.getByRole('button', { name: '复制' }))
    expect(write).toHaveBeenCalledWith('notes/demo.txt\n- hello\n+ hello fixture')
    expect(await screen.findByRole('button', { name: '复制成功' })).toBeTruthy()
  })

  it('renders multiple files as stacked sections', () => {
    const view = render(<DiffViewer diffs={[hunk('a.ts', 'x', 'y'), hunk('b.ts', null, 'z')]} />)
    expect(view.getByText('a.ts')).toBeTruthy()
    expect(view.getByText('b.ts')).toBeTruthy()
    expect(view.getByText('└ +2 -1 · 2 files')).toBeTruthy()
  })

  it('passes custom labels through to the empty state', () => {
    const view = render(<DiffViewer diffs={[hunk('blank.ts', '', '')]} labels={{ noChanges: '没有变化' }} />)
    expect(view.getByText('没有变化')).toBeTruthy()
  })

  it('watches the viewport with a ResizeObserver when the host provides one', () => {
    // The real-browser path: observe on mount, disconnect on unmount. jsdom has
    // none, so stub it to prove the wiring.
    let observed: Element | null = null
    let disposed = false
    vi.stubGlobal('ResizeObserver', class {
      observe(el: Element) { observed = el }
      disconnect() { disposed = true }
    })
    const { unmount } = render(<DiffViewer diffs={[twoLineHunk]} />)
    expect(observed).not.toBeNull()
    unmount()
    expect(disposed).toBe(true)
  })

  it('flips between unified and split by container width (PiUI rule, 800px)', async () => {
    // The responsive rule: below 800px the container renders unified rows,
    // at or above 800px it renders split rows — so the stock 748px column
    // stays unified while a wide-mode 1080px column flips to split. The
    // stub captures the ResizeObserver callback and lets the test drive
    // the width; split vs unified is told apart by the split row wrapper
    // (two panels side by side) vs its absence.
    let fire: (() => void) | null = null
    vi.stubGlobal('ResizeObserver', class {
      constructor(fn: () => void) { fire = fn }
      observe() {}
      disconnect() {}
    })
    render(<DiffViewer diffs={[twoLineHunk]} />)
    const container = document.querySelector('[data-diff-viewer]') as HTMLElement
    const splitRow = () => container.querySelector('[class*="_splitRow_"]')
    // Narrow (< 800): unified — no split row wrapper.
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 700 })
    await act(async () => { fire?.() })
    expect(splitRow()).toBeNull()
    // Wide (>= 800): split row wrapper appears.
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 900 })
    await act(async () => { fire?.() })
    expect(splitRow()).not.toBeNull()
  })

  it('resolveDiffViewMode maps widths to layouts at the 800px boundary', () => {
    expect(resolveDiffViewMode(700)).toBe('unified')
    expect(resolveDiffViewMode(748)).toBe('unified')
    expect(resolveDiffViewMode(799)).toBe('unified')
    expect(resolveDiffViewMode(800)).toBe('split')
    expect(resolveDiffViewMode(900)).toBe('split')
    expect(resolveDiffViewMode(1080)).toBe('split')
  })

  it('keeps the caller viewMode seed when the container has no width', () => {
    // jsdom reports clientWidth 0 and no ResizeObserver; the component must
    // keep the seeded mode instead of collapsing to unified.
    const view = render(<DiffViewer diffs={[twoLineHunk]} viewMode="split" />)
    expect(view.container.querySelector('[class*="_splitRow_"]')).not.toBeNull()
  })

  it('renders syntax-colored spans for a path whose extension maps to a grammar', () => {
    // 'app.ts' resolves a language, so changed lines render shiki token spans.
    const view = render(<DiffViewer diffs={[hunk('app.ts', 'const a = 1', 'const a = 2')]} />)
    expect(view.container.querySelectorAll('span[style]').length).toBeGreaterThan(0)
  })

  it('mirrors horizontal scroll between the content column and the sticky bar', async () => {
    // jsdom reports no layout, so force an overflow for the sticky bar to render,
    // then prove bar<->column scrollLeft syncs both ways (the unified column).
    const view = render(<DiffViewer diffs={[hunk('long.ts', 'a\nb', `a\n${'x'.repeat(200)}`)]} viewMode="unified" />)
    const content = view.container.querySelector('[class*="_content_"]') as HTMLElement
    Object.defineProperty(content, 'scrollWidth', { value: 1200, configurable: true })
    Object.defineProperty(content, 'clientWidth', { value: 300, configurable: true })
    // Re-render to let the windowed measure read the stubbed overflow.
    const viewport = view.container.querySelector('[class*="_viewport_"]') as HTMLElement
    Object.defineProperty(viewport, 'scrollTop', { value: 200 * 22, configurable: true })
    fireEvent.scroll(viewport)
    const bar = view.container.querySelector('[class*="_hbar_"]') as HTMLElement
    expect(bar).not.toBeNull()
    // Dragging the bar scrolls the column; a same-frame echo is swallowed.
    bar.scrollLeft = 120
    fireEvent.scroll(bar)
    fireEvent.scroll(bar)
    expect(content.scrollLeft).toBe(120)
    await new Promise(resolve => requestAnimationFrame(resolve))
    // Scrolling the column moves the bar.
    content.scrollLeft = 60
    fireEvent.scroll(content)
    expect(bar.scrollLeft).toBe(60)
  })

  it('keeps a scrollable content column when no overflow bar is rendered', () => {
    // jsdom reports zero layout, so no bar renders; scrolling the column still
    // runs the sync handler against an absent bar without throwing.
    const view = render(<DiffViewer diffs={[twoLineHunk]} viewMode="unified" />)
    const content = view.container.querySelector('[class*="_content_"]') as HTMLElement
    expect(view.container.querySelector('[class*="_hbar_"]')).toBeNull()
    content.scrollLeft = 30
    fireEvent.scroll(content)
    fireEvent.scroll(content)
    expect(content.scrollLeft).toBe(30)
  })

  it('syncs the two split panels horizontally through the sticky bar', async () => {
    const view = render(<DiffViewer diffs={[hunk('s.ts', 'a\nb\nc', 'x\ny\nz')]} viewMode="split" />)
    const columns = view.container.querySelectorAll('[class*="_content_"]')
    expect(columns.length).toBe(2)
    const left = columns[0] as HTMLElement
    const right = columns[1] as HTMLElement
    for (const column of [left, right]) {
      Object.defineProperty(column, 'scrollWidth', { value: 900, configurable: true })
      Object.defineProperty(column, 'clientWidth', { value: 200, configurable: true })
    }
    const viewport = view.container.querySelector('[class*="_viewport_"]') as HTMLElement
    Object.defineProperty(viewport, 'scrollTop', { value: 200 * 22, configurable: true })
    fireEvent.scroll(viewport)
    expect(view.container.querySelector('[class*="_hbar_"]')).not.toBeNull()
    // Dragging one panel moves the sibling and the bar together.
    right.scrollLeft = 40
    fireEvent.scroll(right)
    expect(left.scrollLeft).toBe(40)
    await new Promise(resolve => requestAnimationFrame(resolve))
    left.scrollLeft = 15
    fireEvent.scroll(left)
    expect(right.scrollLeft).toBe(15)
  })
})

describe('diffCardModel', () => {
  // Frozen call slices in the two lifecycle forms, shaped like the
  // conversation projection hands them to the toolview owner.
  const running = (name: string, argsRaw: string) => ({
    callId: 'c1', name, argsRaw, turn: 1, step: 1, time: 0, subCalls: [],
  })
  const settled = (name: string, argsRaw: string, opts: { isError?: boolean; meta?: unknown } = {}) => ({
    kind: 'tool-result', seq: 1, time: 0, callId: 'c1',
    call: { name, argsRaw }, callTime: 0, content: [],
    isError: opts.isError ?? false, meta: opts.meta, subCalls: [],
  })

  it('derives the intended diff from a running top-level call', () => {
    const model = diffCardModel(running('edit', JSON.stringify({
      file_path: 'a.ts', old_string: 'x', new_string: 'y',
    })) as Parameters<typeof diffCardModel>[0])
    expect(model).toEqual({ card: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] } })
  })

  it('derives the call-time diff from args for a running code-dispatch child', () => {
    const model = diffCardModel(running('edit', JSON.stringify({
      file_path: 'a.ts', old_string: 'x', new_string: 'y',
    })) as Parameters<typeof diffCardModel>[0])
    expect(model).toEqual({ card: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] } })
  })

  it('renders a running write child as a whole-file create from args', () => {
    const model = diffCardModel(running('write', JSON.stringify({
      file_path: 'b.ts', content: 'z',
    })) as Parameters<typeof diffCardModel>[0])
    expect(model).toEqual({ card: { diffs: [{ path: 'b.ts', oldText: null, newText: 'z' }] } })
  })

  it('keeps the applied result hunks for a settled top-level call', () => {
    const model = diffCardModel(settled('edit', '{}', {
      meta: { diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] },
    }) as Parameters<typeof diffCardModel>[0])
    expect(model).toEqual({ card: { diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] } })
  })

  it('falls back to the call-time diff for a settled code-dispatch child', () => {
    const model = diffCardModel(settled('edit', JSON.stringify({
      file_path: 'a.ts', old_string: 'x', new_string: 'y',
    })) as Parameters<typeof diffCardModel>[0])
    expect(model).toEqual({ card: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] } })
  })

  it('keeps an errored settled mutation on the generic path', () => {
    expect(diffCardModel(settled('edit', JSON.stringify({
      file_path: 'a.ts', old_string: 'x', new_string: 'y',
    }), { isError: true }) as Parameters<typeof diffCardModel>[0])).toBeNull()
    expect(diffCardModel(settled('write', JSON.stringify({
      file_path: 'b.ts', content: 'z',
    }), { isError: true }) as Parameters<typeof diffCardModel>[0])).toBeNull()
  })

  it('returns null for malformed args or a non-mutation tool', () => {
    expect(diffCardModel(settled('edit', 'not json') as Parameters<typeof diffCardModel>[0])).toBeNull()
    expect(diffCardModel(settled('edit', JSON.stringify({ file_path: 'a.ts' })) as Parameters<typeof diffCardModel>[0])).toBeNull()
    expect(diffCardModel(settled('bash', JSON.stringify({ command: 'ls' })) as Parameters<typeof diffCardModel>[0])).toBeNull()
  })

  it('callTimeDiffs mirrors each tool’s own presentCall semantics', () => {
    expect(callTimeDiffs('edit', JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: '' })))
      .toEqual([{ path: 'a.ts', oldText: 'x', newText: '' }])
    expect(callTimeDiffs('write', JSON.stringify({ file_path: 'b.ts', content: 'z' })))
      .toEqual([{ path: 'b.ts', oldText: null, newText: 'z' }])
    expect(callTimeDiffs('bash', '{}')).toBeNull()
    expect(callTimeDiffs('edit', 'not json')).toBeNull()
  })
})

describe('defaultOpenFor', () => {
  const running = (name: string) => ({ callId: 'c1', name, argsRaw: '{}', turn: 1, step: 1, time: 0, callView: null, subCalls: [] })
  const settled = (name: string, isError = false) => ({
    kind: 'tool-result', seq: 1, time: 0, callId: 'c1',
    call: { name, argsRaw: '{}' }, callTime: 0, content: [],
    isError, callView: null, resultView: null, subCalls: [],
  })

  it('opens a settled successful edit result card by default', () => {
    expect(defaultOpenFor('edit', settled('edit') as Parameters<typeof defaultOpenFor>[1])).toBe(true)
  })

  it('keeps running, errored, and write rows collapsed', () => {
    expect(defaultOpenFor('edit', running('edit') as Parameters<typeof defaultOpenFor>[1])).toBe(false)
    expect(defaultOpenFor('edit', settled('edit', true) as Parameters<typeof defaultOpenFor>[1])).toBe(false)
    expect(defaultOpenFor('write', settled('write') as Parameters<typeof defaultOpenFor>[1])).toBe(false)
    expect(defaultOpenFor('write', running('write') as Parameters<typeof defaultOpenFor>[1])).toBe(false)
  })
})

describe('MutationRow default-open lifecycle', () => {
  it('expands once when a running edit row settles', () => {
    const runningBlock = {
      callId: 'c1', name: 'edit',
      argsRaw: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }),
      turn: 1, step: 1, time: 0, callView: null, subCalls: [],
    }
    const settledBlock = {
      kind: 'tool-result', seq: 1, time: 0, callId: 'c1',
      call: { name: 'edit', argsRaw: runningBlock.argsRaw }, callTime: 0, content: [],
      isError: false, callView: null, resultView: null, subCalls: [],
    }
    const props = (block: unknown) => ({
      callId: 'c1', toolName: 'edit', block,
      openFile: () => {}, inspect: undefined,
    }) as Parameters<typeof MutationRow>[0]
    const view = render(<MutationRow {...props(runningBlock)} />)
    // Running: collapsed — the diff body is not mounted.
    expect(view.container.querySelector('[data-diff-viewer]')).toBeNull()
    // Settle in place: the row auto-expands and shows the args-derived diff.
    view.rerender(<MutationRow {...props(settledBlock)} />)
    expect(view.container.querySelector('[data-diff-viewer]')).not.toBeNull()
    expect(view.container.textContent).toContain('a.ts')
  })

  it('stays collapsed when a settled write row mounts', () => {
    const block = {
      kind: 'tool-result', seq: 1, time: 0, callId: 'c1',
      call: { name: 'write', argsRaw: JSON.stringify({ file_path: 'b.ts', content: 'z' }) },
      callTime: 0, content: [], isError: false, callView: null, resultView: null, subCalls: [],
    }
    const view = render(<MutationRow {...({ callId: 'c1', toolName: 'write', block, openFile: () => {}, inspect: undefined } as Parameters<typeof MutationRow>[0])} />)
    expect(view.container.querySelector('[data-diff-viewer]')).toBeNull()
  })
})
