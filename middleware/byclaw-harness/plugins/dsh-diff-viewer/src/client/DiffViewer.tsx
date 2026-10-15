// DiffViewer: the visual diff surface for a file mutation (write/edit) —
// adapted from PiUI's DiffViewer onto the dsh design system, shipped as an
// independent DSH client plugin that replaces the stock DiffBlock through the
// ui-tool diff-card chain slots. A file's change renders as unified rows by
// default (one column; the gutter carries the old and new line numbers side by
// side, so a line never sits between two differently-numbered columns) and
// side-by-side only on request (`viewMode: 'split'`). Each row is a
// fixed-height line with a fixed line-number gutter (left of it a 3px change
// bar: solid success for additions, striped error for deletions) and a
// horizontally scrolling content column. Changed lines carry tinted
// backgrounds plus intra-line word marks merged over shiki token colors; long
// runs of unchanged context collapse into an expandable separator (up/down/
// both, 100 lines per chunk). Rows window on scrollTop at the fixed line
// height, so a large diff never mounts all its rows. Source lines never wrap —
// a diff is read by its indentation, so long lines scroll horizontally inside
// the content column. Colors resolve through --dsw-* tokens; the component is
// cordis-free, so localized copy arrives via the labels prop.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type UIEvent } from 'react'
import clsx from 'clsx'
import { diffLines, diffWordsWithSpace } from 'diff'
// Syntax coloring is self-contained: the dsh shell keeps its shiki machinery
// private (the pinned build harness never exported the per-line highlight API,
// and rc.6 retracted it), so this plugin ships its own highlighter and its own
// clipboard helper — no ui-primitives value import survives in the bundle.
import {
  grammarLoadCount, highlightLines, subscribeGrammarLoaded, type HighlightSpan,
} from './highlight.ts'
import { writeClipboard } from './clipboard.ts'
import css from './DiffViewer.module.css'

/** Fixed row height (px): the windowing arithmetic and the CSS line-height share this value. */
export const DIFF_LINE_HEIGHT = 22

/** Rows rendered above and below the viewport so fast scrolling does not flash blank space. */
const OVERSCAN = 5

/** Unchanged context lines kept around each change before the rest collapses. */
const CONTEXT_LINES = 3

/** A collapsed context separator expands in chunks of this many lines. */
const EXPANSION_LINE_COUNT = 100

/** How long the `copied` flag stays true after a successful write, in ms. */
const COPIED_FEEDBACK_MS = 1000

/**
 * Copy text with one-second success feedback, reimplemented on `writeClipboard`
 * — the only clipboard export ui-primitives keeps across rc.5 and rc.6 (the
 * rc.5 `useCopyFeedback` hook was retracted alongside the shiki path).
 */
function useCopyFeedback(text: string): { copied: boolean; onCopy: () => void } {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
    })
  }, [copied, text])
  return { copied, onCopy }
}

/** One file's change, in the shape the wire's `card:'diff'` view carries. Redeclared
 *  here so this primitive stays free of the tool contract, like the block it replaces. */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header. */
  path: string
  /** Prior content, or `null` for a new file / an overwrite (nothing on the removed side). */
  oldText: string | null
  /** Content after the change (the added side). */
  newText: string
}

/** Which row layout a diff renders with. */
export type DiffViewMode = 'split' | 'unified'

/**
 * Resolve the row layout from the container width (PiUI's responsive rule,
 * adapted to dsh's column widths): the stock 748px message column stays
 * unified, a wide-mode 1080px column flips to split. Pure so it can be
 * tested directly and shared by the observer and initial render.
 * @param width - the diff container's client width in px.
 * @returns the layout for that width.
 */
export function resolveDiffViewMode(width: number): DiffViewMode {
  return width < 800 ? 'unified' : 'split'
}

/** Localized copy for the diff surface; every field defaults to the built-in
 *  Chinese value, so existing consumers render unchanged. */
export interface DiffViewerLabels {
  /** Empty-state text when the diff has no renderable lines. */
  noChanges: string
  /** Collapsed-separator label for a run of unchanged lines. */
  unchangedLines: (count: number) => string
  /** Title of the separator's upward-expansion button. */
  expandUp: string
  /** Title of the separator's downward-expansion button. */
  expandDown: string
  /** Title of the separator's expand-both-ways button. */
  expandBoth: string
}

const DEFAULT_LABELS: DiffViewerLabels = {
  noChanges: '无变更',
  unchangedLines: count => `${count} 行未变更`,
  expandUp: '向上展开',
  expandDown: '向下展开',
  expandBoth: '展开隐藏行',
}

export interface DiffViewerProps {
  /** One entry per changed file, in file order; an empty array renders nothing. */
  diffs: DiffHunk[]
  /** Row layout; the default unified keeps a line's old and new numbers in one gutter. */
  viewMode?: DiffViewMode | undefined
  /** Grammar hint for syntax highlighting (a file-extension language id); absent = from the hunk path. */
  lang?: string | undefined
  /** Height cap in body rows before the body scrolls internally (details panels pass none). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Localized copy, merged over the built-in Chinese labels; pass only the fields you override. */
  labels?: Partial<DiffViewerLabels> | undefined
}

// ============================================
// Line model
// ============================================

type LineType = 'add' | 'delete' | 'context' | 'empty'

interface DiffLine {
  type: LineType
  content: string
  lineNo?: number
  /** Intra-line diff runs for a changed line; absent = no word marks. */
  wordDiffSegments?: WordDiffSegment[]
}

interface PairedLine {
  left: DiffLine
  right: DiffLine
}

interface UnifiedLine extends DiffLine {
  oldLineNo?: number
  newLineNo?: number
}

/** One intra-line diff run; `diffType` marks an added/deleted run for its background tint. */
interface WordDiffSegment {
  text: string
  diffType?: 'add' | 'delete'
}

// ============================================
// Diff computation (ported from PiUI's DiffViewer)
// ============================================

/**
 * Pair the two sides line by line: equal runs become context pairs, an added
 * run pairs each new line against an empty left slot, and a removed run
 * preceded by an added run pairs the two sides positionally so their
 * intra-line differences can be marked. The `diff` package's `diffLines`
 * output drives the walk; line numbers are the sides' own 1-based numbers.
 * @param before - the prior content.
 * @param after - the content after the change.
 * @returns one pair per rendered row, in file order.
 */
export function computePairedLines(before: string, after: string): PairedLine[] {
  const changes = diffLines(before, after)
  const result: PairedLine[] = []
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let oldIdx = 0
  let newIdx = 0
  let i = 0

  while (i < changes.length) {
    // The loop bound guarantees the element; TS needs the assertion for index access.
    const change = changes[i]!
    /* v8 ignore next -- diff@8 always sets `count` on emitted changes; the
       fallback only satisfies the package's optional type. */
    const count = change.count || 0

    if (change.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        /* v8 ignore next -- same contract: `count` is always set on emitted changes. */
        const addCount = next.count || 0
        const maxCount = Math.max(count, addCount)

        for (let j = 0; j < maxCount; j++) {
          const oldLine = j < count ? beforeLines[oldIdx + j] : undefined
          const newLine = j < addCount ? afterLines[newIdx + j] : undefined

          let leftSegments: WordDiffSegment[] | undefined
          let rightSegments: WordDiffSegment[] | undefined

          if (oldLine !== undefined && newLine !== undefined) {
            const wordDiff = computeWordDiff(oldLine, newLine)
            if (!isTooFragmented(wordDiff.changes)) {
              leftSegments = wordDiff.left
              rightSegments = wordDiff.right
            }
          }

          result.push({
            left: oldLine !== undefined
              ? { type: 'delete', content: oldLine, lineNo: oldIdx + j + 1, ...(leftSegments && { wordDiffSegments: leftSegments }) }
              : { type: 'empty', content: '' },
            right: newLine !== undefined
              ? { type: 'add', content: newLine, lineNo: newIdx + j + 1, ...(rightSegments && { wordDiffSegments: rightSegments }) }
              : { type: 'empty', content: '' },
          })
        }

        oldIdx += count
        newIdx += addCount
        i += 2
        continue
      }

      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'delete', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'empty', content: '' },
        })
      }
      oldIdx += count
    } else if (change.added) {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'empty', content: '' },
          right: { type: 'add', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      newIdx += count
    } else {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'context', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'context', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      oldIdx += count
      newIdx += count
    }
    i++
  }

  return result
}

/**
 * Flatten the two sides into one vertical stream (unified mode): removed
 * lines carry only their old number, added lines only their new number, and
 * context lines carry both. A removed run followed by an added run pairs the
 * two sides positionally and marks the intra-line difference on both, so the
 * unified column shows the same word-level detail the side-by-side view does.
 * The `diff` package's `diffLines` output drives the walk exactly as
 * {@link computePairedLines} does.
 * @param before - the prior content.
 * @param after - the content after the change.
 * @returns one line per rendered row, in file order.
 */
export function computeUnifiedLines(before: string, after: string): UnifiedLine[] {
  const changes = diffLines(before, after)
  const result: UnifiedLine[] = []
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let oldIdx = 0
  let newIdx = 0

  for (let i = 0; i < changes.length; i++) {
    // The loop bound guarantees the element; TS needs the assertion for index access.
    const change = changes[i]!
    /* v8 ignore next -- diff@8 always sets `count` on emitted changes; the
       fallback only satisfies the package's optional type. */
    const count = change.count || 0

    if (change.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        /* v8 ignore next -- same contract: `count` is always set on emitted changes. */
        const addCount = next.count || 0
        for (let j = 0; j < count; j++) {
          const oldLine = beforeLines[oldIdx + j] || ''
          const newLine = j < addCount ? afterLines[newIdx + j] : undefined
          let segments: WordDiffSegment[] | undefined
          if (newLine !== undefined) {
            const wordDiff = computeWordDiff(oldLine, newLine)
            if (!isTooFragmented(wordDiff.changes)) segments = wordDiff.left
          }
          result.push({
            type: 'delete', content: oldLine, oldLineNo: oldIdx + j + 1,
            ...(segments !== undefined && { wordDiffSegments: segments }),
          })
        }
        for (let j = 0; j < addCount; j++) {
          const newLine = afterLines[newIdx + j] || ''
          const oldLine = j < count ? beforeLines[oldIdx + j] : undefined
          let segments: WordDiffSegment[] | undefined
          if (oldLine !== undefined) {
            const wordDiff = computeWordDiff(oldLine, newLine)
            if (!isTooFragmented(wordDiff.changes)) segments = wordDiff.right
          }
          result.push({
            type: 'add', content: newLine, newLineNo: newIdx + j + 1,
            ...(segments !== undefined && { wordDiffSegments: segments }),
          })
        }
        oldIdx += count
        newIdx += addCount
        i += 1
      } else {
        for (let j = 0; j < count; j++) {
          result.push({ type: 'delete', content: beforeLines[oldIdx + j] || '', oldLineNo: oldIdx + j + 1 })
        }
        oldIdx += count
      }
    } else if (change.added) {
      for (let j = 0; j < count; j++) {
        result.push({ type: 'add', content: afterLines[newIdx + j] || '', newLineNo: newIdx + j + 1 })
      }
      newIdx += count
    } else {
      for (let j = 0; j < count; j++) {
        result.push({
          type: 'context',
          content: afterLines[newIdx + j] || '',
          oldLineNo: oldIdx + j + 1,
          newLineNo: newIdx + j + 1,
        })
      }
      oldIdx += count
      newIdx += count
    }
  }

  return result
}

/**
 * The intra-line difference of one changed pair, aligned into left/right
 * segment lists (a shared run appears in both). `diff@8`'s `diffWordsWithSpace`
 * already merges adjacent same-direction runs (and the whitespace between
 * them), so the alignment is a straight walk over its change stream.
 * @param oldLine - the removed side's text.
 * @param newLine - the added side's text.
 * @returns the aligned segments plus the raw merged changes (for the fragmentation guard).
 */
export function computeWordDiff(
  oldLine: string,
  newLine: string,
): { left: WordDiffSegment[]; right: WordDiffSegment[]; changes: ReturnType<typeof diffWordsWithSpace> } {
  const changes = diffWordsWithSpace(oldLine, newLine)

  const left: WordDiffSegment[] = []
  const right: WordDiffSegment[] = []
  for (const change of changes) {
    if (change.removed) left.push({ text: change.value, diffType: 'delete' })
    else if (change.added) right.push({ text: change.value, diffType: 'add' })
    else {
      left.push({ text: change.value })
      right.push({ text: change.value })
    }
  }

  return { left, right, changes }
}

/**
 * Whether an intra-line diff is too fragmented to mark: fewer than 40% of the
 * characters are shared between the sides. Such a line reads as a rewrite, and
 * marking its fragments would paint the whole line; the tinted row background
 * already carries the change.
 * @param changes - the merged word-diff runs.
 * @returns whether the line's word marks should be dropped.
 */
export function isTooFragmented(changes: ReturnType<typeof diffWordsWithSpace>): boolean {
  let commonLength = 0
  let totalLength = 0
  for (const change of changes) {
    totalLength += change.value.length
    if (!change.added && !change.removed) commonLength += change.value.length
  }
  return totalLength > 10 && commonLength / totalLength < 0.4
}

// ============================================
// Context collapsing
// ============================================

type ExpandDirection = 'up' | 'down' | 'both'

interface ExpansionRegion {
  fromStart: number
  fromEnd: number
}

interface CollapsedRegion {
  collapsed: true
  count: number
  id: number
  isFirst: boolean
  isLast: boolean
  chunked: boolean
}

type PairedRow = PairedLine | CollapsedRegion
type UnifiedRow = UnifiedLine | CollapsedRegion

function isCollapsed(row: PairedRow | UnifiedRow): row is CollapsedRegion {
  return 'collapsed' in row
}

/**
 * Grow one collapsed region's expansion budget: expanding upward adds to
 * `fromStart`, downward to `fromEnd` (one {@link EXPANSION_LINE_COUNT} chunk
 * per click, or all of it for a single 'both' click on an unchunked region).
 * @param prev - the current expansion map.
 * @param id - the region's start index in the raw line array.
 * @param direction - which side(s) to expand.
 * @returns the next expansion map.
 */
export function expandRegion(prev: ReadonlyMap<number, ExpansionRegion>, id: number, direction: ExpandDirection): Map<number, ExpansionRegion> {
  const next = new Map(prev)
  const current = next.get(id) ?? { fromStart: 0, fromEnd: 0 }
  if (direction === 'up' || direction === 'both') current.fromStart += EXPANSION_LINE_COUNT
  if (direction === 'down' || direction === 'both') current.fromEnd += EXPANSION_LINE_COUNT
  next.set(id, current)
  return next
}

/**
 * Fold long runs of unchanged context into single separator rows, keeping
 * {@link CONTEXT_LINES} of context around each change. An expanded region
 * un-folds from its separator by the budget recorded in the expansion map.
 * @param lines - the raw paired lines.
 * @param expanded - the expansion budgets per region start index.
 * @returns the display rows (context lines, separators, and change lines).
 */
export function collapseContextPaired(lines: PairedLine[], expanded?: ReadonlyMap<number, ExpansionRegion>): PairedRow[] {
  if (lines.length === 0) return []

  const result: PairedRow[] = []
  let contextStart = -1

  for (let i = 0; i <= lines.length; i++) {
    // The bound guard keeps the index in range; TS needs the assertion.
    const isCtx = i < lines.length && lines[i]!.left.type === 'context' && lines[i]!.right.type === 'context'

    if (isCtx) {
      if (contextStart === -1) contextStart = i
    } else {
      if (contextStart !== -1) {
        const ctxLen = i - contextStart
        const minToCollapse = CONTEXT_LINES * 2 + 2
        if (ctxLen > minToCollapse) {
          const isFirst = contextStart === 0
          const isLast = i === lines.length
          const keepBefore = isFirst ? 0 : CONTEXT_LINES
          const keepAfter = isLast ? 0 : CONTEXT_LINES
          const region = expanded?.get(contextStart) ?? { fromStart: 0, fromEnd: 0 }
          const prefixCount = Math.min(ctxLen, keepBefore + region.fromStart)
          const suffixStart = Math.max(prefixCount, ctxLen - keepAfter - region.fromEnd)

          for (let j = contextStart; j < contextStart + prefixCount; j++) result.push(lines[j]!)
          if (suffixStart > prefixCount) {
            const count = suffixStart - prefixCount
            result.push({
              collapsed: true,
              count,
              id: contextStart,
              isFirst,
              isLast,
              chunked: count > EXPANSION_LINE_COUNT,
            })
          }
          for (let j = contextStart + suffixStart; j < i; j++) result.push(lines[j]!)
        } else {
          for (let j = contextStart; j < i; j++) result.push(lines[j]!)
        }
        contextStart = -1
      }
      if (i < lines.length) result.push(lines[i]!)
    }
  }

  return result
}

/** {@link collapseContextPaired} for the unified line stream. */
export function collapseContextUnified(lines: UnifiedLine[], expanded?: ReadonlyMap<number, ExpansionRegion>): UnifiedRow[] {
  if (lines.length === 0) return []

  const result: UnifiedRow[] = []
  let contextStart = -1

  for (let i = 0; i <= lines.length; i++) {
    // The bound guard keeps the index in range; TS needs the assertion.
    const isCtx = i < lines.length && lines[i]!.type === 'context'

    if (isCtx) {
      if (contextStart === -1) contextStart = i
    } else {
      if (contextStart !== -1) {
        const ctxLen = i - contextStart
        const minToCollapse = CONTEXT_LINES * 2 + 2
        if (ctxLen > minToCollapse) {
          const isFirst = contextStart === 0
          const isLast = i === lines.length
          const keepBefore = isFirst ? 0 : CONTEXT_LINES
          const keepAfter = isLast ? 0 : CONTEXT_LINES
          const region = expanded?.get(contextStart) ?? { fromStart: 0, fromEnd: 0 }
          const prefixCount = Math.min(ctxLen, keepBefore + region.fromStart)
          const suffixStart = Math.max(prefixCount, ctxLen - keepAfter - region.fromEnd)

          for (let j = contextStart; j < contextStart + prefixCount; j++) result.push(lines[j]!)
          if (suffixStart > prefixCount) {
            const count = suffixStart - prefixCount
            result.push({
              collapsed: true,
              count,
              id: contextStart,
              isFirst,
              isLast,
              chunked: count > EXPANSION_LINE_COUNT,
            })
          }
          for (let j = contextStart + suffixStart; j < i; j++) result.push(lines[j]!)
        } else {
          for (let j = contextStart; j < i; j++) result.push(lines[j]!)
        }
        contextStart = -1
      }
      if (i < lines.length) result.push(lines[i]!)
    }
  }

  return result
}

// ============================================
// Geometry and language helpers
// ============================================

/**
 * The widest rendered line's character count across a display-row list
 * (collapsed separators carry no content). The rows container's `min-width`
 * uses it in `ch` units so every row's background spans the whole column —
 * short changed lines keep their tint to the same edge as the longest line,
 * even when the widest line is outside the windowed viewport.
 * @param rows - the display rows (paired or unified).
 * @returns the longest content length, or 0 for an all-separator list.
 */
export function displayMaxChars(rows: readonly (PairedRow | UnifiedRow)[]): number {
  let max = 0
  for (const row of rows) {
    if (isCollapsed(row)) continue
    if ('left' in row) {
      if (row.left.content.length > max) max = row.left.content.length
      if (row.right.content.length > max) max = row.right.content.length
    } else if (row.content.length > max) {
      max = row.content.length
    }
  }
  return max
}

/** The line-number gutter width for the largest line number, with a readable floor. */
export function lineNumberColumnWidth(maxLineNo: number): number {
  const digits = String(Math.max(1, maxLineNo)).length
  return Math.max(44, digits * 8 + 28)
}

/**
 * File-extension → language-hint map for syntax highlighting, mirroring the
 * read tool's `langFromPath` (packages/fs/tool-fs) so a diff path and a read
 * path of the same file highlight with the same grammar. Values are the short
 * ids `highlight.ts`' `LANG_ALIASES` resolves; intentionally small, not an
 * exhaustive registry.
 */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'md', markdown: 'md', mdx: 'mdx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

/**
 * Derive a syntax-highlighting language hint from a diff path's extension.
 * Pure and case-insensitive; a dotfile with no extension and an unknown
 * extension both yield `undefined` (plain monospace).
 * @param path - the hunk's model-facing path.
 * @returns the language hint, or `undefined` when the extension maps to none.
 */
export function langFromPath(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  return Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}

// ============================================
// Windowed scrolling
// ============================================

/**
 * Fixed-row-height windowing: render only the rows the viewport can show
 * (plus overscan), positioned inside a spacer of the full row count's height.
 * @param rowCount - the display row count.
 * @returns the container ref, the visible row slice, the vertical offset, and the scroll handler.
 */
function useWindowedRows(rowCount: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    /* v8 ignore next 2 -- React populates the ref before effects run, so a
       mount effect never sees a null container. */
    if (!container) return
    const update = () => setViewportHeight(container.clientHeight)
    update()
    // jsdom implements no ResizeObserver (the repo-wide guard pattern); the
    // initial `update()` still runs, so a test renders the first window.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  const startIndex = Math.max(0, Math.floor(scrollTop / DIFF_LINE_HEIGHT) - OVERSCAN)
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / DIFF_LINE_HEIGHT))
  const endIndex = Math.min(rowCount, startIndex + visibleCount + OVERSCAN * 2)
  const offsetY = startIndex * DIFF_LINE_HEIGHT

  return { containerRef, startIndex, endIndex, offsetY, onScroll }
}

// ============================================
// Row rendering
// ============================================

/** The right-aligned line number cell; `undefined` draws an empty slot. */
function LineNumberCell({ lineNo, width, tone }: { lineNo: number | undefined; width: number; tone: 'changed' | 'context' }) {
  return (
    <div className={clsx(css.lineNumber, tone === 'changed' ? css.lineNumberChanged : css.lineNumberContext)} style={{ width }}>
      {lineNo}
    </div>
  )
}

/** The 3px change bar: solid success for additions, striped error for deletions. */
function ChangeBar({ type, rowTop }: { type: LineType; rowTop: number }) {
  if (type === 'add') return <div className={css.barAdd} />
  if (type === 'delete') return <div className={css.barDelete} style={{ backgroundPositionY: `${-rowTop}px` }} />
  return <div className={css.barNone} />
}

/** One rendered line's content: syntax-colored runs, with word marks layered over them. */
function LineContent({ line, tokens }: { line: DiffLine; tokens: readonly HighlightSpan[] | undefined }) {
  if (line.wordDiffSegments !== undefined) {
    return <MergedWordDiffLine segments={line.wordDiffSegments} tokens={tokens} />
  }
  if (tokens !== undefined && tokens.length > 0) {
    return (
      <>
        {tokens.map((span, index) => (
          <span key={index} style={span.style}>{span.text}</span>
        ))}
      </>
    )
  }
  return <>{line.content}</>
}

/**
 * Render a word-diff segment list with syntax colors: the token runs provide
 * the color, the segment boundary provides the add/delete background. The two
 * boundaries differ, so the walk slices tokens to segment lengths.
 * @param segments - the line's word-diff segments (aligned to the token stream).
 * @param tokens - the line's syntax runs, or undefined for a plain-text line.
 * @returns the merged children.
 */
function MergedWordDiffLine({ segments, tokens }: { segments: WordDiffSegment[]; tokens: readonly HighlightSpan[] | undefined }) {
  if (tokens === undefined || tokens.length === 0) {
    return (
      <>
        {segments.map((segment, index) => (
          segment.diffType !== undefined
            ? <span key={index} className={segment.diffType === 'delete' ? css.wordDelete : css.wordAdd}>{segment.text}</span>
            : <span key={index}>{segment.text}</span>
        ))}
      </>
    )
  }

  const children: ReactNode[] = []
  let tokenIndex = 0
  let tokenOffset = 0
  for (let si = 0; si < segments.length; si++) {
    // The loop bound guarantees both elements; TS needs the assertions.
    const segment = segments[si]!
    let remaining = segment.text.length
    const runs: ReactNode[] = []

    while (remaining > 0 && tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]!
      const available = token.text.length - tokenOffset
      const take = Math.min(remaining, available)
      runs.push(
        <span key={`${si}-${tokenIndex}-${tokenOffset}`} style={token.style}>
          {token.text.slice(tokenOffset, tokenOffset + take)}
        </span>,
      )
      remaining -= take
      tokenOffset += take
      if (tokenOffset >= token.text.length) {
        tokenIndex++
        tokenOffset = 0
      }
    }

    // Token stream exhausted before the segment (a length skew between the
    // two boundaries): the remainder renders without color rather than dropping.
    /* v8 ignore next 3 -- the word segments and the line's token runs both
       cover the same line text, so the stream cannot exhaust mid-segment. */
    if (remaining > 0) {
      const extraStart = segment.text.length - remaining
      runs.push(<span key={`${si}-extra`}>{segment.text.slice(extraStart)}</span>)
    }

    if (segment.diffType !== undefined) {
      children.push(
        <span key={si} className={segment.diffType === 'delete' ? css.wordDelete : css.wordAdd}>{runs}</span>,
      )
    } else {
      children.push(...runs)
    }
  }
  return <>{children}</>
}

// ============================================
// Collapsed separators
// ============================================

/** The expand directions a separator offers: both when unchunked, up/down when chunked. */
export function separatorDirections({ isFirst, isLast, chunked }: { isFirst?: boolean; isLast?: boolean; chunked?: boolean }): ExpandDirection[] {
  if (!chunked) return [!isFirst && !isLast ? 'both' : isFirst ? 'down' : 'up']
  const directions: ExpandDirection[] = []
  if (!isFirst) directions.push('up')
  if (!isLast) directions.push('down')
  return directions
}

/** The chevron glyph for one expand direction (up flips the down glyph). */
function ExpandIcon({ direction }: { direction: ExpandDirection }) {
  if (direction === 'both') {
    return (
      <svg aria-hidden="true" className={css.expandIcon} viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.47 9.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06L8 12.94zM7.526 1.418a.75.75 0 0 1 1.004.052l4 4a.75.75 0 1 1-1.06 1.06L8 3.06 4.53 6.53a.75.75 0 1 1-1.06-1.06l4-4z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" className={clsx(css.expandIcon, direction === 'up' && css.expandIconUp)} viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
    </svg>
  )
}

/** The expand buttons a separator shows in the gutter column. */
function CollapsedExpandButton({ directions, onExpand, width, labels }: {
  directions: ExpandDirection[]
  onExpand?: (direction: ExpandDirection) => void
  width?: number
  labels: DiffViewerLabels
}) {
  /* v8 ignore next -- every call site passes a width, and separatorDirections
     always returns at least one direction, so the divider is always computed. */
  const buttonWidth = width !== undefined && directions.length > 0 ? width / directions.length : undefined
  return (
    /* v8 ignore next 3 -- every call site passes a width, and
       separatorDirections always returns at least one direction. */
    <div className={css.separatorButtonGroup} style={width !== undefined ? { width, flexBasis: width } : undefined}>
      {directions.map(direction => (
        <button
          key={direction}
          type="button"
          className={css.separatorButton}
          /* v8 ignore next -- every call site passes a width, so buttonWidth is always a number. */
          style={buttonWidth !== undefined ? { width: buttonWidth, minWidth: 0, flexBasis: buttonWidth } : undefined}
          title={direction === 'up' ? labels.expandUp : direction === 'down' ? labels.expandDown : labels.expandBoth}
          onClick={() => onExpand?.(direction)}
        >
          <ExpandIcon direction={direction} />
        </button>
      ))}
    </div>
  )
}

/** The separator's label row, spanning from the gutter over the content column. */
function CollapsedLabel({ count, labels, onExpand }: { count: number; labels: DiffViewerLabels; onExpand?: (direction: ExpandDirection) => void }) {
  return (
    <div className={css.separatorLabel}>
      <button
        type="button"
        className={css.separatorTextButton}
        onClick={() => onExpand?.('both')}
      >
        {labels.unchangedLines(count)}
      </button>
    </div>
  )
}

// ============================================
// Main component
// ============================================

/** Per-file diff body shared by the split and unified views. */
interface DiffBodyProps {
  before: string
  after: string
  lang?: string | undefined
  viewMode: DiffViewMode
  maxLines?: number | undefined
  labels: DiffViewerLabels
  className?: string | undefined
}

/**
 * Render one file's change body. Highlights both sides once (whole-text
 * tokenization keeps grammar context across lines), picks the effective view
 * mode (add-only/delete-only always render unified), collapses long context
 * runs, and windows the display rows.
 * @param props - the two sides, language hint, mode request, and render site's cap.
 * @returns the diff body element.
 */
function DiffBody({ before, after, lang, viewMode, maxLines, labels, className }: DiffBodyProps) {
  // Re-render when a lazy grammar finishes loading, so a diff that showed
  // plain text while its language's grammar imported picks up highlighting.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const tokens = useMemo(
    () => ({ before: highlightLines(before, lang), after: highlightLines(after, lang) }),
    [before, after, lang, loaded],
  )
  const pairedLines = useMemo(() => computePairedLines(before, after), [before, after])
  const unifiedLines = useMemo(() => computeUnifiedLines(before, after), [before, after])

  // Pure addition or pure deletion: the split mode's other side is empty
  // noise, so it degrades to unified the way PiUI's DiffViewer does.
  const isAddOnly = before.trim() === ''
  const isDeleteOnly = after.trim() === ''
  const mode = isAddOnly || isDeleteOnly ? 'unified' : viewMode

  if (pairedLines.length === 0) {
    return <div className={css.noChanges}>{labels.noChanges}</div>
  }

  return mode === 'split'
    ? (
      <SplitDiffBody
        pairs={pairedLines}
        tokens={tokens}
        maxLines={maxLines}
        labels={labels}
        className={className}
      />
    )
    : (
      <UnifiedDiffBody
        lines={unifiedLines}
        tokens={tokens}
        maxLines={maxLines}
        labels={labels}
        className={className}
      />
    )
}

interface TokenPair {
  before: readonly HighlightSpan[][] | undefined
  after: readonly HighlightSpan[][] | undefined
}

/** The shared viewport chrome: vertical window, horizontal scroll, cap. */
function Viewport({ rows, maxLines, children }: {
  rows: number
  maxLines: number | undefined
  children: (
    start: number,
    end: number,
    registerContent: (el: HTMLDivElement | null) => void,
    onContentScroll: (event: UIEvent<HTMLDivElement>) => void,
  ) => ReactNode
}) {
  const { containerRef, startIndex, endIndex, offsetY, onScroll } = useWindowedRows(rows)
  // The content column(s) the sticky horizontal bar mirrors. Each column owns
  // its own overflow-x; the bar at the viewport's bottom edge stays visible
  // while a tall diff's column-native scrollbar scrolls out of view, and
  // scrolling either the bar or any column syncs the others.
  const contents = useRef(new Set<HTMLDivElement>())
  const barRef = useRef<HTMLDivElement>(null)
  // Programmatic scrollLeft assignments fire scroll events asynchronously;
  // this guard swallows the echo so bar<->column sync does not ping-pong.
  const syncing = useRef(false)
  const [contentWidth, setContentWidth] = useState(0)
  const [clientWidth, setClientWidth] = useState(0)

  const measure = useCallback(() => {
    let maxScroll = 0
    let client = 0
    for (const column of contents.current) {
      if (column.scrollWidth > maxScroll) maxScroll = column.scrollWidth
      client = column.clientWidth
    }
    setContentWidth(maxScroll)
    setClientWidth(client)
  }, [])

  const registerContent = useCallback((el: HTMLDivElement | null) => {
    if (el === null) return
    contents.current.add(el)
    measure()
  }, [measure])

  // Re-measure when the windowed rows change (the columns' nodes survive, so
  // the refs do not re-fire) and on container resize; jsdom has no
  // ResizeObserver (the repo-wide guard pattern).
  useEffect(() => {
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    for (const column of contents.current) observer.observe(column)
    return () => observer.disconnect()
  }, [startIndex, endIndex, measure])

  const onContentScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (syncing.current) return
    syncing.current = true
    const left = event.currentTarget.scrollLeft
    for (const column of contents.current) {
      if (column !== event.currentTarget) column.scrollLeft = left
    }
    if (barRef.current !== null) barRef.current.scrollLeft = left
    requestAnimationFrame(() => { syncing.current = false })
  }, [])

  const onBarScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (syncing.current) return
    syncing.current = true
    const left = event.currentTarget.scrollLeft
    for (const column of contents.current) column.scrollLeft = left
    requestAnimationFrame(() => { syncing.current = false })
  }, [])

  return (
    <div
      ref={containerRef}
      className={css.viewport}
      onScroll={onScroll}
      // Capped mode: a max-height scroll container. Uncapped (the plugin's
      // takeover rows, the details panel): the content grows to its full
      // height and the viewport never scrolls — no residual sub-pixel
      // overflow scrollbar. The windowed renderer still mounts only the
      // visible rows either way.
      style={maxLines !== undefined
        ? { maxHeight: maxLines * DIFF_LINE_HEIGHT }
        : { overflow: 'visible' }}
    >
      <div className={css.spacer} style={{ height: rows * DIFF_LINE_HEIGHT }}>
        <div className={css.window} style={{ transform: `translateY(${offsetY}px)` }}>
          {children(startIndex, endIndex, registerContent, onContentScroll)}
        </div>
      </div>
      {contentWidth > clientWidth && (
        <div ref={barRef} className={css.hbar} onScroll={onBarScroll}>
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      )}
    </div>
  )
}

/**
 * Side-by-side body: each row is a pair drawn in two panels — left gutter
 * (change bar + old line number) and left content over the removed/context
 * text, then the same for the added side. A collapsed separator renders its
 * buttons in the left gutter and overlays its label across both panels.
 */
function SplitDiffBody({ pairs, tokens, maxLines, labels, className }: {
  pairs: PairedLine[]
  tokens: TokenPair
  maxLines: number | undefined
  labels: DiffViewerLabels
  className?: string | undefined
}) {
  const [expanded, setExpanded] = useState<Map<number, ExpansionRegion>>(new Map())
  const displayRows = useMemo(() => collapseContextPaired(pairs, expanded), [pairs, expanded])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpanded(prev => expandRegion(prev, id, direction))
  }, [])
  // The widest rendered line in `ch` units: the rows container stretches to it
  // so every row's background spans the whole column (a short changed line
  // keeps its tint to the same edge as the longest line).
  const maxChars = useMemo(() => displayMaxChars(displayRows), [displayRows])

  // The widest line number across both sides; a reduce (not a spread) so a
  // very large diff cannot overflow the argument stack.
  const lineNumberWidth = useMemo(() => lineNumberColumnWidth(
    pairs.reduce((max, pair) => Math.max(max, pair.left.lineNo ?? 0, pair.right.lineNo ?? 0), 0),
  ), [pairs])
  const gutterWidth = lineNumberWidth + 4

  return (
    <div className={clsx(css.body, className)}>
      <Viewport rows={displayRows.length} maxLines={maxLines}>
        {(start, end, registerContent, onContentScroll) => {
          const leftGutter: ReactNode[] = []
          const leftContent: ReactNode[] = []
          const rightGutter: ReactNode[] = []
          const rightContent: ReactNode[] = []

          for (let i = start; i < end; i++) {
            // The loop bound keeps the index in range; TS needs the assertion.
            const row = displayRows[i]!
            const rowTop = i * DIFF_LINE_HEIGHT

            if (isCollapsed(row)) {
              const directions = separatorDirections(row)
              leftGutter.push(
                <div key={i} className={clsx(css.separatorSurface, css.separatorRelative)} style={{ height: DIFF_LINE_HEIGHT }}>
                  <CollapsedExpandButton directions={directions} onExpand={direction => handleExpand(row.id, direction)} width={lineNumberWidth} labels={labels} />
                  <div className={css.separatorLabelOverlay} style={{ left: lineNumberWidth }}>
                    <CollapsedLabel count={row.count} labels={labels} onExpand={direction => handleExpand(row.id, direction)} />
                  </div>
                </div>,
              )
              leftContent.push(<div key={i} className={css.separatorSurface} style={{ height: DIFF_LINE_HEIGHT }} />)
              rightGutter.push(<div key={i} className={css.separatorSurface} style={{ height: DIFF_LINE_HEIGHT }} />)
              rightContent.push(<div key={i} className={css.separatorSurface} style={{ height: DIFF_LINE_HEIGHT }} />)
              continue
            }

            const pair = row
            const left = pair.left
            const right = pair.right
            // computePairedLines never yields a left-side 'add' row (additions
            // always land on the right), so the left class chains' first arm is
            // unreachable; the chains stay total for the right side.
            /* v8 ignore next 3 -- left rows are delete/context/empty only */
            leftGutter.push(
              <div key={i} className={clsx(css.gutterRow, left.type === 'add' ? css.rowAdd : left.type === 'delete' ? css.rowDelete : left.type === 'empty' ? css.rowEmpty : css.rowContext)} style={left.type === 'empty' ? { height: DIFF_LINE_HEIGHT, backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <ChangeBar type={left.type} rowTop={rowTop} />
                <LineNumberCell lineNo={left.lineNo} width={lineNumberWidth} tone={left.type === 'add' || left.type === 'delete' ? 'changed' : 'context'} />
              </div>,
            )
            /* v8 ignore next 2 -- left rows are delete/context/empty only */
            leftContent.push(
              <div key={i} className={clsx(css.contentRow, left.type === 'empty' ? css.rowEmpty : left.type === 'add' ? css.rowAdd : left.type === 'delete' ? css.rowDelete : css.rowContext)} style={left.type === 'empty' ? { backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <LineContent line={left} tokens={left.lineNo !== undefined ? tokens.before?.[left.lineNo - 1] : undefined} />
              </div>,
            )
            /* v8 ignore next -- right rows are add/context/empty only (deletions always land on the left). */
            rightGutter.push(
              <div key={i} className={clsx(css.gutterRow, right.type === 'add' ? css.rowAdd : right.type === 'delete' ? css.rowDelete : right.type === 'empty' ? css.rowEmpty : css.rowContext)} style={right.type === 'empty' ? { height: DIFF_LINE_HEIGHT, backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <ChangeBar type={right.type} rowTop={rowTop} />
                <LineNumberCell lineNo={right.lineNo} width={lineNumberWidth} tone={right.type === 'add' || right.type === 'delete' ? 'changed' : 'context'} />
              </div>,
            )
            /* v8 ignore next -- right rows are add/context/empty only (deletions always land on the left). */
            rightContent.push(
              <div key={i} className={clsx(css.contentRow, right.type === 'empty' ? css.rowEmpty : right.type === 'add' ? css.rowAdd : right.type === 'delete' ? css.rowDelete : css.rowContext)} style={right.type === 'empty' ? { backgroundPosition: `5px ${-rowTop}px` } : undefined}>
                <LineContent line={right} tokens={right.lineNo !== undefined ? tokens.after?.[right.lineNo - 1] : undefined} />
              </div>,
            )
          }

          return (
            <div className={css.splitRow}>
              <div className={css.panel}>
                <div className={css.gutter} style={{ width: gutterWidth }}>{leftGutter}</div>
                <div className={css.content} ref={registerContent} onScroll={onContentScroll}>
                  <div className={css.rows} style={{ minWidth: `max(100%, ${maxChars}ch)` }}>{leftContent}</div>
                </div>
              </div>
              <div className={css.panel}>
                <div className={css.gutter} style={{ width: gutterWidth }}>{rightGutter}</div>
                <div className={css.content} ref={registerContent} onScroll={onContentScroll}>
                  <div className={css.rows} style={{ minWidth: `max(100%, ${maxChars}ch)` }}>{rightContent}</div>
                </div>
              </div>
            </div>
          )
        }}
      </Viewport>
    </div>
  )
}

/**
 * Unified body: one column per row — gutter with the old and new line numbers
 * (a changed line shows the number of the side it belongs to), then the
 * content. Collapsed separators render their buttons over both number cells.
 */
function UnifiedDiffBody({ lines, tokens, maxLines, labels, className }: {
  lines: UnifiedLine[]
  tokens: TokenPair
  maxLines: number | undefined
  labels: DiffViewerLabels
  className?: string | undefined
}) {
  const [expanded, setExpanded] = useState<Map<number, ExpansionRegion>>(new Map())
  const displayRows = useMemo(() => collapseContextUnified(lines, expanded), [lines, expanded])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpanded(prev => expandRegion(prev, id, direction))
  }, [])
  // The widest rendered line in `ch` units; see SplitDiffBody's maxChars.
  const maxChars = useMemo(() => displayMaxChars(displayRows), [displayRows])

  // The widest line number across the stream; a reduce (not a spread) so a
  // very large diff cannot overflow the argument stack.
  const lineNumberWidth = useMemo(() => lineNumberColumnWidth(
    lines.reduce((max, line) => Math.max(max, line.oldLineNo ?? 0, line.newLineNo ?? 0), 0),
  ), [lines])
  const gutterWidth = lineNumberWidth * 2 + 4

  return (
    <div className={clsx(css.body, className)}>
      <Viewport rows={displayRows.length} maxLines={maxLines}>
        {(start, end, registerContent, onContentScroll) => {
          const gutters: ReactNode[] = []
          const contents: ReactNode[] = []

          for (let i = start; i < end; i++) {
            // The loop bound keeps the index in range; TS needs the assertion.
            const row = displayRows[i]!
            const rowTop = i * DIFF_LINE_HEIGHT

            if (isCollapsed(row)) {
              const directions = separatorDirections(row)
              gutters.push(
                <div key={i} className={clsx(css.separatorSurface, css.separatorRelative)} style={{ height: DIFF_LINE_HEIGHT }}>
                  <CollapsedExpandButton directions={directions} onExpand={direction => handleExpand(row.id, direction)} width={lineNumberWidth * 2} labels={labels} />
                  <div className={css.separatorLabelOverlay} style={{ left: lineNumberWidth * 2 }}>
                    <CollapsedLabel count={row.count} labels={labels} onExpand={direction => handleExpand(row.id, direction)} />
                  </div>
                </div>,
              )
              contents.push(<div key={i} className={css.separatorSurface} style={{ height: DIFF_LINE_HEIGHT }} />)
              continue
            }

            const line = row
            // A deleted line reads from the removed side, an added or context
            // line from the added side — the side whose text the row shows.
            const sideTokens = line.type === 'delete' ? tokens.before : tokens.after
            const lineNo = line.type === 'delete' ? line.oldLineNo : line.newLineNo
            const tone = line.type === 'add' || line.type === 'delete' ? 'changed' : 'context'
            gutters.push(
              <div key={i} className={clsx(css.gutterRow, line.type === 'add' ? css.rowAdd : line.type === 'delete' ? css.rowDelete : css.rowContext)} style={{ height: DIFF_LINE_HEIGHT }}>
                <ChangeBar type={line.type} rowTop={rowTop} />
                <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} tone={tone} />
                <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} tone={tone} />
              </div>,
            )
            /* v8 ignore next -- every unified line carries its side's number
               (delete → old, add/context → new), so the fallback never fires. */
            contents.push(
              <div key={i} className={clsx(css.contentRow, line.type === 'add' ? css.rowAdd : line.type === 'delete' ? css.rowDelete : css.rowContext)}>
                <LineContent line={line} tokens={lineNo !== undefined ? sideTokens?.[lineNo - 1] : undefined} />
              </div>,
            )
          }

          return (
            <div className={css.unifiedRow}>
              <div className={css.gutter} style={{ width: gutterWidth }}>{gutters}</div>
              <div className={css.content} ref={registerContent} onScroll={onContentScroll}>
                <div className={css.rows} style={{ minWidth: `max(100%, ${maxChars}ch)` }}>{contents}</div>
              </div>
            </div>
          )
        }}
      </Viewport>
    </div>
  )
}

/**
 * The diff text a reader copies: each file's path header followed by its
 * `- `/`+ ` prefixed lines, exactly what the card shows. The headers keep a
 * multi-file copy attributable.
 * @param diffs - the hunks to serialize.
 * @returns the diff as plain text.
 */
export function copyText(diffs: DiffHunk[]): string {
  const parts: string[] = []
  for (const hunk of diffs) {
    parts.push(hunk.path)
    for (const line of contentLines(hunk.oldText ?? '')) parts.push(`- ${line}`)
    for (const line of contentLines(hunk.newText)) parts.push(`+ ${line}`)
  }
  return parts.join('\n')
}

/**
 * Split a side's text into its content lines. Empty text is zero lines (a full
 * deletion's `newText` or a create's absent `oldText` side draws nothing), and
 * a single trailing newline is a line terminator rather than an extra empty
 * line — the same terminator rule the other block primitives apply.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * The footer counts across all hunks: added/removed line totals and the number
 * of DISTINCT paths (two hunks in one file read as `1 file`), matching the TUI
 * diff card's footer.
 * @param diffs - the hunks to count.
 * @returns the totals.
 */
export function diffStats(diffs: DiffHunk[]): { added: number; removed: number; files: number } {
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  for (const hunk of diffs) {
    paths.add(hunk.path)
    removed += contentLines(hunk.oldText ?? '').length
    added += contentLines(hunk.newText).length
  }
  return { added, removed, files: paths.size }
}

/**
 * Render a file mutation as the visual diff surface. The row layout is
 * chosen by CONTAINER WIDTH, not by a caller flag: PiUI's responsive rule —
 * split side-by-side when the diff has room (>= 720px), unified otherwise —
 * is recreated here with a ResizeObserver on this component's own box, so a
 * widened feed (e.g. home-ui wide mode) automatically shows split diffs and
 * a narrow panel falls back to unified, with no special-casing of any
 * host mode. The `viewMode` prop seeds the first render (default unified);
 * the observer then owns the decision.
 * @param props - see {@link DiffViewerProps}.
 * @returns the diff viewer element.
 */
export function DiffViewer({ diffs, viewMode = 'unified', lang, maxLines, className, labels }: DiffViewerProps) {
  const resolvedLabels = { ...DEFAULT_LABELS, ...labels }
  const stats = useMemo(() => diffStats(diffs), [diffs])
  const { copied, onCopy } = useCopyFeedback(useMemo(() => copyText(diffs), [diffs]))
  // Responsive split/unified rule (PiUI's DiffViewer observes its container
  // and flips by width): the stock 748px message column stays unified, a
  // wide-mode 1080px column flips to split — see resolveDiffViewMode. The
  // observer owns the decision once mounted; in environments without layout
  // (jsdom) the container reports 0 width and there may be no ResizeObserver
  // at all — both keep the caller's viewMode seed.
  const containerRef = useRef<HTMLDivElement>(null)
  const [responsiveMode, setResponsiveMode] = useState<DiffViewMode>(viewMode)
  useEffect(() => {
    const container = containerRef.current
    if (container === null || typeof ResizeObserver === 'undefined') return
    const update = (): void => {
      if (container.clientWidth === 0) return
      setResponsiveMode(resolveDiffViewMode(container.clientWidth))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  if (diffs.length === 0) return null
  return (
    <div ref={containerRef} className={clsx(css.block, className)} data-diff="" data-diff-viewer="">
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? '复制成功' : '复制'}
      </button>
      {diffs.map((hunk, index) => (
        <section key={index} className={css.file}>
          <header className={css.fileHeader}>{hunk.path}</header>
          <DiffBody
            before={hunk.oldText ?? ''}
            after={hunk.newText}
            lang={lang ?? langFromPath(hunk.path)}
            viewMode={responsiveMode}
            maxLines={maxLines}
            labels={resolvedLabels}
          />
        </section>
      ))}
      <div className={css.footer}>└ +{stats.added} -{stats.removed} · {stats.files} file{stats.files === 1 ? '' : 's'}</div>
    </div>
  )
}
