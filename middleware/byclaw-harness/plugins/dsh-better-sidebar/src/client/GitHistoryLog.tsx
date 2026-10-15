import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { GitBranchResult, GitLogEntry } from './api.ts'
import { buildGitGraph } from './git-graph.ts'
import { relativeTime, t } from './locales.ts'
import css from './sidebar.module.css'

/** Filters controlled by Source Control independently from checkout state. */
export interface GitHistoryFilters {
  scope: 'current' | 'all' | 'ref'
  ref?: string
  search: string
  author: string
  since: string
  until: string
  path: string
}

/** Presentation and interaction inputs for the IDEA-style history table. */
export interface GitHistoryLogProps {
  entries: GitLogEntry[]
  branches: GitBranchResult
  filters: GitHistoryFilters
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  pageError: string | null
  busy: boolean
  onFiltersChange: (filters: GitHistoryFilters) => void
  onLoadMore: () => void
  onOpenCommit: (entry: GitLogEntry) => void
  onContextMenu: (event: MouseEvent, entry: GitLogEntry) => void
}

/** Decoration names with Git's `HEAD ->` and `tag:` prefixes removed. */
function refNames(refs: string): string[] {
  return [...new Set(
    refs.split(',')
      .map(ref => ref.trim())
      .filter(ref => ref !== '')
      .map(ref => (ref.includes(' -> ') ? ref.slice(ref.indexOf(' -> ') + 4) : ref))
      .map(ref => (ref.startsWith('tag: ') ? ref.slice(5) : ref)),
  )]
}

/** Dense, responsive Git history with graph lanes and server-side filters. */
export function GitHistoryLog(props: GitHistoryLogProps) {
  const {
    entries, branches, filters, hasMore, loading, loadingMore, pageError, busy,
    onFiltersChange, onLoadMore, onOpenCommit, onContextMenu,
  } = props
  const [searchDraft, setSearchDraft] = useState(filters.search)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const graph = useMemo(() => buildGitGraph(entries), [entries])

  useEffect(() => { setSearchDraft(filters.search) }, [filters.search])
  useEffect(() => {
    if (searchDraft === filters.search) return
    const timer = window.setTimeout(() => {
      onFiltersChange({ ...filters, search: searchDraft })
    }, 250)
    return () => { window.clearTimeout(timer) }
  }, [searchDraft, filters, onFiltersChange])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === null || !hasMore || loading || loadingMore || busy || pageError !== null
      || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((records) => {
      if (records.some(record => record.isIntersecting)) onLoadMore()
    }, { rootMargin: '120px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [hasMore, loading, loadingMore, busy, pageError, onLoadMore])

  const branchValue = filters.scope === 'ref' ? `ref:${filters.ref ?? ''}` : filters.scope
  const patch = (next: Partial<GitHistoryFilters>): void => {
    onFiltersChange({ ...filters, ...next })
  }

  return (
    <section className={css.gitHistory} aria-label={t('history')}>
      <div className={css.gitHistoryToolbar}>
        <input
          className={`${css.gitHistoryInput} ${css.gitHistorySearch}`}
          type="search"
          placeholder={t('historySearchPlaceholder')}
          aria-label={t('historySearchPlaceholder')}
          value={searchDraft}
          onChange={event => { setSearchDraft(event.target.value) }}
        />
        <select
          className={css.gitHistorySelect}
          aria-label={t('historyBranchFilter')}
          value={branchValue}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'current' || value === 'all') patch({ scope: value, ref: undefined })
            else patch({ scope: 'ref', ref: value.slice(4) })
          }}
        >
          <optgroup label={t('historyCurrent')}>
            <option value="current">{branches.current}</option>
            <option value="all">{t('historyAllBranches')}</option>
          </optgroup>
          <optgroup label={t('historyLocalBranches')}>
            {branches.local.map(branch => <option key={`local:${branch}`} value={`ref:${branch}`}>{branch}</option>)}
          </optgroup>
          <optgroup label={t('historyRemoteBranches')}>
            {branches.remote.map(branch => <option key={`remote:${branch}`} value={`ref:${branch}`}>{branch}</option>)}
          </optgroup>
        </select>
        <input
          className={css.gitHistoryInput}
          placeholder={t('historyAuthorFilter')}
          aria-label={t('historyAuthorFilter')}
          value={filters.author}
          onChange={event => { patch({ author: event.target.value }) }}
        />
        <label className={css.gitHistoryDate}>
          <span>{t('historySince')}</span>
          <input type="date" value={filters.since} onChange={event => { patch({ since: event.target.value }) }} />
        </label>
        <label className={css.gitHistoryDate}>
          <span>{t('historyUntil')}</span>
          <input type="date" value={filters.until} onChange={event => { patch({ until: event.target.value }) }} />
        </label>
        <input
          className={css.gitHistoryInput}
          placeholder={t('historyPathFilter')}
          aria-label={t('historyPathFilter')}
          value={filters.path}
          onChange={event => { patch({ path: event.target.value }) }}
        />
      </div>

      <div className={css.gitHistoryRows} aria-busy={loading || loadingMore || undefined}>
        {entries.map((entry, index) => {
          const row = graph[index]!
          const width = Math.max(24, row.maxLane * 12 + 12)
          return (
            <div
              key={entry.hashFull}
              role="button"
              tabIndex={0}
              data-commit={entry.hashFull}
              className={css.gitHistoryRow}
              title={`${entry.author} · ${entry.date}\n${entry.hashFull}`}
              onClick={() => { onOpenCommit(entry) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpenCommit(entry)
                }
              }}
              onContextMenu={event => { onContextMenu(event, entry) }}
            >
              <svg
                data-git-graph
                className={css.gitHistoryGraph}
                width={width}
                height="30"
                viewBox={`0 0 ${width} 30`}
                aria-hidden="true"
              >
                {row.segments.map((segment, segmentIndex) => (
                  <line
                    key={`${segment.from}:${segment.to}:${segmentIndex}`}
                    className={`${css.gitGraphLine} ${css[`gitGraphColor${segment.color}`]}`}
                    x1={8 + segment.from * 12}
                    y1="0"
                    x2={8 + segment.to * 12}
                    y2="30"
                  />
                ))}
                <circle
                  className={`${css.gitGraphNode} ${css[`gitGraphColor${row.nodeColor}`]}`}
                  cx={8 + row.nodeLane * 12}
                  cy="15"
                  r="4"
                />
              </svg>
              <span className={css.gitHistorySubjectCell}>
                <span className={css.gitHistorySubjectLine}>
                  <span className={css.gitHistorySubject}>{entry.subject}</span>
                  {refNames(entry.refs).map((ref) => (
                    <span
                      key={ref}
                      className={branches.remote.includes(ref) ? css.gitHistoryRefRemote : css.gitHistoryRef}
                    >
                      {ref}
                    </span>
                  ))}
                </span>
                <span className={css.gitHistoryNarrowMeta}>{entry.hash} · {entry.author} · {relativeTime(entry.date)}</span>
              </span>
              <span className={css.gitHistoryAuthor}>{entry.author}</span>
              <span className={css.gitHistoryTime}>{relativeTime(entry.date)}</span>
            </div>
          )
        })}
        {loading && entries.length === 0 && <div className={css.gitHistoryState}>{t('loading')}</div>}
        {!loading && entries.length === 0 && <div className={css.gitHistoryState}>{t('historyEmpty')}</div>}
        {pageError !== null && (
          <div className={`${css.gitHistoryState} ${css.gitHistoryError}`}>
            <span>{pageError}</span>
            <button type="button" onClick={onLoadMore}>{t('retry')}</button>
          </div>
        )}
        {hasMore && pageError === null && (
          <button
            type="button"
            className={css.gitHistoryMore}
            disabled={loadingMore || busy}
            onClick={onLoadMore}
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        )}
        <div ref={sentinelRef} data-git-history-sentinel className={css.gitHistorySentinel} aria-hidden="true" />
      </div>
    </section>
  )
}
