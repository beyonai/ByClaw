import { useState, type MouseEvent, type ReactNode } from 'react'
import { IconBranchOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitStatusEntry } from './api.ts'
import type { GitChangeNode, GitSide, GitStatusKind } from './git-tree.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** Props for one staged or unstaged change-tree section. */
export interface GitChangeTreeProps {
  title: string
  side: GitSide
  nodes: readonly GitChangeNode[]
  truncated: boolean
  busy: boolean
  onOpenFile(entry: GitStatusEntry, side: GitSide): void
  onTogglePaths(paths: readonly string[], side: GitSide): Promise<void>
  onToggleAll(side: GitSide): Promise<void>
  onContextMenu(event: MouseEvent, entry: GitStatusEntry, side: GitSide): void
}

const STATUS_BADGES: Record<GitStatusKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  conflicted: 'U',
}

function statusLabel(status: GitStatusKind): string {
  switch (status) {
    case 'added': return t('gitStatusAdded')
    case 'modified': return t('gitStatusModified')
    case 'deleted': return t('gitStatusDeleted')
    case 'renamed': return t('gitStatusRenamed')
    case 'copied': return t('gitStatusCopied')
    case 'untracked': return t('gitStatusUntracked')
    case 'conflicted': return t('gitStatusConflicted')
  }
}

/** Render one initially collapsed source-control section as a folder-first tree. */
export function GitChangeTree(props: GitChangeTreeProps): ReactNode {
  const {
    title, side, nodes, truncated, busy,
    onOpenFile, onTogglePaths, onToggleAll, onContextMenu,
  } = props
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const actionLabel = side === 'staged' ? t('unstage') : t('stage')
  const allActionLabel = side === 'staged' ? t('unstageAll') : t('stageAll')

  const toggleSection = (): void => {
    setOpen(value => !value)
  }

  const toggleDirectory = (path: string): void => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNodes = (items: readonly GitChangeNode[], depth: number): ReactNode => (
    <ul className={css.gitTreeList} role={depth === 0 ? 'tree' : 'group'}>
      {items.map(node => {
        if (node.kind === 'directory') {
          const directoryOpen = expanded.has(node.path)
          return (
            <li key={node.path} role="treeitem" aria-expanded={directoryOpen}>
              <div className={css.gitRow} style={{ paddingInlineStart: `${8 + depth * 14}px` }}>
                <button
                  type="button"
                  className={css.gitTreeMain}
                  aria-expanded={directoryOpen}
                  title={node.path}
                  onClick={() => { toggleDirectory(node.path) }}
                >
                  <span className={css.gitTreeChevron} aria-hidden>{directoryOpen ? '▾' : '▸'}</span>
                  <span className={css.gitFolderName}>{node.name}</span>
                  <span className={css.gitTreeCount}>{node.count}</span>
                  {node.conflicted && (
                    <span className={css.gitConflictMarker} aria-label={`${t('gitStatusConflicted')}: ${node.path}`}>!</span>
                  )}
                </button>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={`${actionLabel} ${node.path}`}
                  title={truncated ? t('statusTruncated') : `${actionLabel} ${node.path}`}
                  disabled={busy || truncated}
                  onClick={() => { void onTogglePaths(node.actionPaths, side) }}
                >
                  {side === 'staged' ? <IconTrashOutline16 /> : <IconBranchOutline16 />}
                </button>
              </div>
              {directoryOpen && renderNodes(node.children, depth + 1)}
            </li>
          )
        }

        const label = statusLabel(node.status)
        return (
          <li key={node.path} role="treeitem">
            <div className={css.gitRow} style={{ paddingInlineStart: `${8 + depth * 14}px` }}>
              <button
                type="button"
                className={css.gitRowMain}
                title={node.path}
                onClick={() => { onOpenFile(node.entry, side) }}
                onContextMenu={(event) => { onContextMenu(event, node.entry, side) }}
              >
                <span
                  className={css.gitBadge}
                  data-git-status={node.status}
                  aria-label={`${label}: ${node.path}`}
                >
                  {STATUS_BADGES[node.status]}
                </span>
                <span className={css.gitName} data-git-status={node.status}>{node.name}</span>
              </button>
              <button
                type="button"
                className={css.iconButton}
                aria-label={`${actionLabel} ${node.path}`}
                title={`${actionLabel} ${node.path}`}
                disabled={busy}
                onClick={() => { void onTogglePaths([node.entry.path], side) }}
              >
                {side === 'staged' ? <IconTrashOutline16 /> : <IconBranchOutline16 />}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <section className={css.gitSection}>
      <div className={css.gitSectionHeader}>
        <button
          type="button"
          className={css.gitSectionToggle}
          aria-expanded={open}
          onClick={toggleSection}
        >
          <span className={css.gitTreeChevron} aria-hidden>{open ? '▾' : '▸'}</span>
          <span>{title} ({nodes.reduce((total, node) => total + node.count, 0)})</span>
        </button>
        {nodes.length > 0 && (
          <button
            type="button"
            className={css.gitLink}
            aria-label={allActionLabel}
            disabled={busy}
            onClick={() => { void onToggleAll(side) }}
          >
            {allActionLabel}
          </button>
        )}
      </div>
      {open && (nodes.length === 0 ? <div className={css.gitEmpty}>{t('noChanges')}</div> : renderNodes(nodes, 0))}
    </section>
  )
}
