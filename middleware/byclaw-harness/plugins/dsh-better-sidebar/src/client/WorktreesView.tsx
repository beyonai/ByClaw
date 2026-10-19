/** Read-only repository-grouped worktree inventory and navigation actions. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCopyOutline16, IconRefreshOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type GitTarget, type GitWorkspaceInventory, type SessionScope } from './api.ts'
import { IconTerminalOutline16 } from './icons.tsx'
import { t } from './locales.ts'
import css from './sidebar.module.css'

export interface WorktreesViewProps {
  scope: SessionScope
  onOpenTerminal: (target: GitTarget) => void
}

/** Render all authoritative repository groups without exposing Git mutations. */
export function WorktreesView({ scope, onOpenTerminal }: WorktreesViewProps) {
  const { sessionId, cwd } = scope
  const [inventory, setInventory] = useState<GitWorkspaceInventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const activeController = useRef<AbortController | null>(null)

  const load = useCallback((refresh: boolean): AbortController => {
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    const requestGeneration = ++generation.current
    setLoading(true)
    setError(null)
    const requestScope: SessionScope = { sessionId, ...(cwd === undefined ? {} : { cwd }) }
    void api.gitInventory(requestScope, refresh, controller.signal).then(
      (next) => {
        if (requestGeneration !== generation.current || controller.signal.aborted) return
        setInventory(next)
        setLoading(false)
      },
      (reason: unknown) => {
        if (requestGeneration !== generation.current || controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      },
    )
    return controller
  }, [sessionId, cwd])

  useEffect(() => {
    load(false)
    return () => {
      generation.current += 1
      activeController.current?.abort()
    }
  }, [load])

  return (
    <section className={css.worktreesView} aria-label={t('worktrees')}>
      <header className={css.worktreesHeader}>
        <strong>{t('worktrees')}</strong>
        <button
          type="button"
          className={css.worktreeIconButton}
          aria-label={t('refreshWorktrees')}
          title={t('refreshWorktrees')}
          disabled={loading}
          onClick={() => { load(true) }}
        >
          <IconRefreshOutline16 size={14} />
        </button>
      </header>
      {loading && inventory === null && <div className={css.worktreesMessage}>{t('loading')}</div>}
      {error !== null && <div className={css.worktreesError}>{t('error')}: {error}</div>}
      {inventory?.truncated === true && (
        <div className={css.worktreesUnavailable}>{t('editorSearchTruncated')}</div>
      )}
      {inventory !== null && inventory.repositories.length === 0 && (
        <div className={css.worktreesMessage}>{t('worktreesEmpty')}</div>
      )}
      {inventory?.repositories.map(repository => (
        <section key={repository.id} className={css.worktreeRepository} data-worktree-repository={repository.id}>
          <header className={css.worktreeRepositoryHeader}>
            <strong>{repository.name}</strong>
            <span className={css.worktreeRepositoryPath}>{repository.relativePath}</span>
          </header>
          {(repository.state !== 'ready' || repository.error !== undefined) && (
            <div className={css.worktreesUnavailable}>
              {repository.state !== 'ready' && (
                <span>{repository.state === 'missing' ? t('repositoryMissing') : t('repositoryUninitialized')}</span>
              )}
              {repository.error !== undefined && <span>{repository.error}</span>}
            </div>
          )}
          {repository.worktrees.map(worktree => {
            const target: GitTarget = { repositoryId: repository.id, worktreeId: worktree.id }
            return (
              <article key={worktree.id} className={css.worktreeCard} data-worktree-id={worktree.id}>
                <div className={css.worktreeCardHeader}>
                  <strong>{worktree.branch === 'HEAD' ? t('detachedHead') : worktree.branch}</strong>
                  <div className={css.worktreeActions}>
                    <button
                      type="button"
                      className={css.worktreeIconButton}
                      aria-label={t('copyWorktreePath')}
                      title={t('copyWorktreePath')}
                      onClick={() => { void writeClipboard(worktree.path) }}
                    >
                      <IconCopyOutline16 size={14} />
                    </button>
                    <button
                      type="button"
                      className={css.worktreeIconButton}
                      aria-label={t('openTerminalInWorktree')}
                      title={t('openTerminalInWorktree')}
                      onClick={() => { onOpenTerminal(target) }}
                    >
                      <IconTerminalOutline16 size={14} />
                    </button>
                  </div>
                </div>
                <div className={css.worktreePath}>{worktree.path}</div>
                <div className={css.worktreeMarkers}>
                  {worktree.current && <span>{t('currentWorktree')}</span>}
                  {worktree.locked && <span>{t('lockedWorktree')}</span>}
                  <span>
                    {worktree.statusError !== undefined
                      ? `${t('error')}: ${worktree.statusError}`
                      : worktree.changes === undefined
                        ? t('error')
                      : worktree.changes === 0
                        ? t('worktreeNoChanges')
                        : t('worktreeChangeCount', { count: worktree.changes })}
                  </span>
                </div>
              </article>
            )
          })}
        </section>
      ))}
    </section>
  )
}
