/**
 * The source-control panel: collapsed staged/unstaged change trees, stage/unstage,
 * commit with a message box, branch switch, and a VSCode-like history — rows
 * carry branch decorations, author and relative time. Clicking a changed
 * file or a history row opens a dedicated diff TAB (see {@link DiffTab}),
 * placed below the git pane on first use. File rows and history rows open a
 * right-click context menu with advanced operations (open in editor, discard,
 * revert, cherry-pick, copy paths/hashes). Refresh is manual + on mount/
 * focus. While visible it polls lightweight porcelain state so model-authored
 * file changes appear without a manual refresh.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Button, IconBranchOutline16, IconCodeOutline16, IconCopyOutline16, IconRefreshOutline16,
  IconTrashOutline16, Input, Menu, Modal, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitBranchResult,
  GitLogEntry,
  GitLogQuery,
  GitRepository,
  GitStatusEntry,
  GitStatusResult,
  GitTarget,
  GitWorkspaceInventory,
  SessionScope,
} from './api.ts'
import { api, SidebarApiError } from './api.ts'
import { isWithinWorkspace, relativeTo } from './paths.ts'
import { resolveSidebarPath } from './produced-files.ts'
import { t } from './locales.ts'
import type { SidebarTab } from './state.ts'
import { buildGitChangeTree, type GitSide } from './git-tree.ts'
import { GitChangeTree } from './GitChangeTree.tsx'
import { GitHistoryLog, type GitHistoryFilters } from './GitHistoryLog.tsx'
import css from './sidebar.module.css'

/** Whether the entry is untracked (`??`): git diff never includes it. */
function isUntracked(entry: GitStatusEntry): boolean {
  return entry.xy === '??'
}

/** The last path segment (tab title for a file's diff). */
function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** The pending destructive action (discard / revert / cherry-pick), gated by a confirm modal. */
interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  target: GitTarget
  onConfirm: () => Promise<unknown>
}

/** History batch size: the log loads lazily in pages so a long history never
 *  floods the panel at once (the end of the log is reached by paging). */
const LOG_BATCH = 50

const EMPTY_BRANCHES: GitBranchResult = { current: '', names: [], local: [], remote: [] }

/** Fresh history filters follow the selected checkout. */
function defaultHistoryFilters(): GitHistoryFilters {
  return { scope: 'current', search: '', author: '', since: '', until: '', path: '' }
}

/** Convert controlled toolbar state into one host history page query. */
function historyQuery(filters: GitHistoryFilters, skip: number): GitLogQuery {
  return {
    scope: filters.scope,
    ...(filters.ref !== undefined ? { ref: filters.ref } : {}),
    ...(filters.search.trim() !== '' ? { search: filters.search.trim() } : {}),
    ...(filters.author.trim() !== '' ? { author: filters.author.trim() } : {}),
    ...(filters.since !== '' ? { since: filters.since } : {}),
    ...(filters.until !== '' ? { until: filters.until } : {}),
    ...(filters.path.trim() !== '' ? { path: filters.path.trim() } : {}),
    count: LOG_BATCH,
    skip,
  }
}

/** Git target equality is by opaque ids, never by object identity. */
function sameTarget(left: GitTarget | null | undefined, right: GitTarget | null | undefined): boolean {
  return left?.repositoryId === right?.repositoryId && left?.worktreeId === right?.worktreeId
}

/** The only checkout Source Control may use for a repository. */
function currentRepositoryTarget(repository: GitRepository | undefined): { target: GitTarget; path: string } | null {
  if (repository?.state !== 'ready') return null
  const worktree = repository.worktrees.find(candidate => candidate.current)
  return worktree === undefined
    ? null
    : { target: { repositoryId: repository.id, worktreeId: worktree.id }, path: worktree.path }
}

/** Preserve the repository choice when possible, otherwise prefer root/current. */
function inventoryTarget(
  inventory: GitWorkspaceInventory,
  preferredRepositoryId: string | undefined,
): { target: GitTarget; path: string } | null {
  const preferred = currentRepositoryTarget(
    inventory.repositories.find(repository => repository.id === preferredRepositoryId),
  )
  if (preferred !== null) return preferred
  const root = currentRepositoryTarget(inventory.repositories.find(repository => repository.kind === 'root'))
  if (root !== null) return root
  for (const repository of inventory.repositories) {
    const candidate = currentRepositoryTarget(repository)
    if (candidate !== null) return candidate
  }
  return null
}

/** Optional companion reads degrade to a fallback, except target loss which
 *  must rebuild inventory and select a currently authoritative checkout. */
async function fallbackUnlessTargetMissing<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch (reason) {
    if (reason instanceof SidebarApiError && reason.code === 'git-target') throw reason
    return fallback
  }
}

export function GitView(props: {
  scope: SessionScope
  /** Persisted repository choice; its worktree id is re-authorized by inventory. */
  initialTarget?: GitTarget
  /** Persist the authoritative current-checkout target for this tab only. */
  onTargetChange?: (target: GitTarget) => void
  onOpenFile: (path: string) => void
  /** Open a diff tab (the shell places it below the git pane on first use). */
  onOpenDiff: (tab: SidebarTab) => void
  /** Poll only while the tab is actually visible. */
  visible: boolean
}) {
  const { scope, initialTarget, onTargetChange, onOpenFile, onOpenDiff, visible } = props
  const [inventory, setInventory] = useState<GitWorkspaceInventory | null>(null)
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [target, setTarget] = useState<GitTarget | null>(initialTarget ?? null)
  const [worktreePath, setWorktreePath] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [branchResult, setBranchResult] = useState<GitBranchResult>(EMPTY_BRANCHES)
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([])
  const [historyFilters, setHistoryFilters] = useState<GitHistoryFilters>(defaultHistoryFilters)
  const historyFiltersRef = useRef<GitHistoryFilters>(historyFilters)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyPageError, setHistoryPageError] = useState<string | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [logHasMore, setLogHasMore] = useState(false)
  const [logLoadingMore, setLogLoadingMore] = useState(false)

  /** The open file-row context menu (cursor position for the portaled Menu). */
  const [fileMenu, setFileMenu] = useState<{ entry: GitStatusEntry; staged: boolean; x: number; y: number } | null>(null)
  /** The open history-row context menu. */
  const [historyMenu, setHistoryMenu] = useState<{ entry: GitLogEntry; x: number; y: number } | null>(null)
  /** The pending destructive action awaiting confirmation. */
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  /** Monotonic request id for target-derived status/history responses. */
  const refreshGeneration = useRef(0)
  /** Query-only generation: filters and pages never overwrite a newer log. */
  const historyGeneration = useRef(0)
  const targetRef = useRef<GitTarget | null>(initialTarget ?? null)
  const initialTargetRef = useRef<GitTarget | undefined>(initialTarget)
  const persistedTargetRef = useRef<GitTarget | undefined>(initialTarget)
  const onTargetChangeRef = useRef(onTargetChange)
  const refreshInventoryRef = useRef<(force?: boolean) => Promise<void>>(() => Promise.resolve())
  const targetRecoveryRef = useRef<string | null>(null)
  const pollPublication = useRef(0)
  const busyRef = useRef(false)
  const mutationOwner = useRef(0)
  const fullLoadPendingRef = useRef(false)
  useEffect(() => { initialTargetRef.current = initialTarget }, [initialTarget])
  useEffect(() => { onTargetChangeRef.current = onTargetChange }, [onTargetChange])
  useEffect(() => { historyFiltersRef.current = historyFilters }, [historyFilters])

  /** Clear every value and interaction owned by the previous target before
   *  starting a complete target load. */
  const clearTargetView = useCallback((): void => {
    historyGeneration.current += 1
    setStatus(null)
    setBranchResult(EMPTY_BRANCHES)
    setLogEntries([])
    setLogHasMore(false)
    setHistoryLoading(false)
    setHistoryPageError(null)
    setLogLoadingMore(false)
    setFileMenu(null)
    setHistoryMenu(null)
    setConfirm(null)
    setError(null)
    setCommitError(null)
    setCommitMsg('')
  }, [])

  const persistTarget = useCallback((nextTarget: GitTarget): void => {
    if (sameTarget(persistedTargetRef.current, nextTarget)) return
    persistedTargetRef.current = nextTarget
    onTargetChangeRef.current?.(nextTarget)
  }, [])

  const resetHistoryFilters = useCallback((): void => {
    const next = defaultHistoryFilters()
    historyFiltersRef.current = next
    setHistoryFilters(next)
  }, [])

  /** Publish a complete checkout-derived view. Status, branch choices and
   *  history are one consistency unit: never mix rows from two worktrees. */
  const refreshTarget = useCallback(async (
    nextTarget: GitTarget,
    options: { loading: boolean; generation: number },
  ): Promise<void> => {
    const historyOwner = historyGeneration.current += 1
    fullLoadPendingRef.current = true
    if (options.loading) setLoading(true)
    setHistoryLoading(true)
    setError(null)
    try {
      const [statusResult, branchResult, logResult] = await Promise.all([
        api.gitStatus(scope, nextTarget),
        fallbackUnlessTargetMissing(
          api.gitBranch(scope, nextTarget),
          EMPTY_BRANCHES,
        ),
        fallbackUnlessTargetMissing(
          api.gitLog(scope, nextTarget, historyQuery(historyFiltersRef.current, 0)),
          { entries: [] as GitLogEntry[], hasMore: false },
        ),
      ])
      if (options.generation !== refreshGeneration.current || !sameTarget(nextTarget, targetRef.current)) return
      setStatus(statusResult)
      setBranchResult(branchResult)
      if (historyOwner === historyGeneration.current) {
        setLogEntries(logResult.entries)
        setLogHasMore(logResult.hasMore)
      }
      targetRecoveryRef.current = null
    } catch (reason) {
      if (options.generation === refreshGeneration.current && sameTarget(nextTarget, targetRef.current)) {
        if (reason instanceof SidebarApiError && reason.code === 'git-target') {
          const recoveryKey = `${nextTarget.repositoryId}:${nextTarget.worktreeId}`
          if (targetRecoveryRef.current !== recoveryKey) {
            targetRecoveryRef.current = recoveryKey
            await refreshInventoryRef.current(true)
            return
          }
        }
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (options.loading && options.generation === refreshGeneration.current && sameTarget(nextTarget, targetRef.current)) {
        setLoading(false)
      }
      if (options.generation === refreshGeneration.current && sameTarget(nextTarget, targetRef.current)) {
        fullLoadPendingRef.current = false
      }
      if (historyOwner === historyGeneration.current) setHistoryLoading(false)
    }
  }, [scope.sessionId, scope.cwd])

  /** Select a repository's current checkout and replace its view as one
   *  generation. Linked worktrees are deliberately not accepted here. */
  const selectRepository = useCallback(async (repositoryId: string): Promise<void> => {
    const selection = currentRepositoryTarget(
      inventory?.repositories.find(repository => repository.id === repositoryId),
    )
    if (selection === null) return
    const generation = refreshGeneration.current += 1
    targetRecoveryRef.current = null
    targetRef.current = selection.target
    setTarget(selection.target)
    setWorktreePath(selection.path)
    resetHistoryFilters()
    clearTargetView()
    setLoading(true)
    persistTarget(selection.target)
    await refreshTarget(selection.target, { loading: true, generation })
  }, [clearTargetView, inventory, persistTarget, refreshTarget, resetHistoryFilters])

  /** Load/rebuild the repository inventory, reconcile the persisted
   *  repository to its authoritative current checkout, then load the full
   *  target view. */
  const refreshInventory = useCallback(async (force = false): Promise<void> => {
    let generation = refreshGeneration.current += 1
    fullLoadPendingRef.current = true
    pollPublication.current += 1
    clearTargetView()
    setLoading(true)
    try {
      const nextInventory = await api.gitInventory(scope, force)
      if (generation !== refreshGeneration.current) return
      // Inventory publication begins a new full-load epoch. This invalidates
      // polls started while discovery was pending and clears any old rows
      // they managed to publish before a repository remap.
      generation = refreshGeneration.current += 1
      pollPublication.current += 1
      clearTargetView()
      setInventory(nextInventory)
      const selection = inventoryTarget(
        nextInventory,
        targetRef.current?.repositoryId ?? initialTargetRef.current?.repositoryId,
      )
      if (selection === null) {
        targetRef.current = null
        setTarget(null)
        setWorktreePath(undefined)
        setStatus({ isRepo: false, entries: [] })
        setLoading(false)
        fullLoadPendingRef.current = false
        return
      }
      if (!sameTarget(targetRef.current, selection.target)) resetHistoryFilters()
      targetRef.current = selection.target
      setTarget(selection.target)
      setWorktreePath(selection.path)
      persistTarget(selection.target)
      await refreshTarget(selection.target, { loading: true, generation })
    } catch (reason) {
      if (generation === refreshGeneration.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
        fullLoadPendingRef.current = false
      }
    }
  }, [clearTargetView, persistTarget, refreshTarget, resetHistoryFilters, scope.sessionId, scope.cwd])
  useEffect(() => { refreshInventoryRef.current = refreshInventory }, [refreshInventory])

  const manualRefresh = useCallback(async (): Promise<void> => {
    if (busyRef.current) return
    targetRecoveryRef.current = null
    await refreshInventory(true)
  }, [refreshInventory])

  /** Visibility polling is intentionally status-only: inventory refresh is a
   *  manual operation, and no poll may change repository selection. */
  const pollStatus = useCallback(async (): Promise<void> => {
    if (fullLoadPendingRef.current) return
    const currentTarget = targetRef.current
    if (currentTarget === null) return
    const generation = refreshGeneration.current
    const publication = pollPublication.current += 1
    try {
      const nextStatus = await api.gitStatus(scope, currentTarget)
      if (
        generation === refreshGeneration.current
        && publication === pollPublication.current
        && !fullLoadPendingRef.current
        && sameTarget(currentTarget, targetRef.current)
      ) {
        setStatus(nextStatus)
      }
    } catch (reason) {
      if (
        reason instanceof SidebarApiError
        && reason.code === 'git-target'
        && generation === refreshGeneration.current
        && publication === pollPublication.current
        && !fullLoadPendingRef.current
        && sameTarget(currentTarget, targetRef.current)
      ) {
        const recoveryKey = `${currentTarget.repositoryId}:${currentTarget.worktreeId}`
        if (targetRecoveryRef.current !== recoveryKey) {
          targetRecoveryRef.current = recoveryKey
          void refreshInventoryRef.current(true)
        }
      }
      // A transient poll failure leaves the last complete view intact.
    }
  }, [scope.sessionId, scope.cwd])

  useEffect(() => {
    refreshGeneration.current += 1
    const seed = initialTargetRef.current ?? null
    targetRef.current = seed
    persistedTargetRef.current = initialTargetRef.current
    targetRecoveryRef.current = null
    pollPublication.current += 1
    mutationOwner.current += 1
    busyRef.current = false
    fullLoadPendingRef.current = false
    setBusy(false)
    setTarget(seed)
    setWorktreePath(undefined)
    setInventory(null)
    resetHistoryFilters()
    void refreshInventory(false)
    return () => { refreshGeneration.current += 1 }
  }, [scope.sessionId, scope.cwd, refreshInventory, resetHistoryFilters])
  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => { void pollStatus() }, 2_000)
    return () => { window.clearInterval(timer) }
  }, [visible, pollStatus])

  /** Replace history for a new toolbar query without reloading worktree state. */
  const changeHistoryFilters = useCallback(async (nextFilters: GitHistoryFilters): Promise<void> => {
    historyFiltersRef.current = nextFilters
    setHistoryFilters(nextFilters)
    const currentTarget = targetRef.current
    const owner = historyGeneration.current += 1
    setLogEntries([])
    setLogHasMore(false)
    setHistoryPageError(null)
    if (currentTarget === null) return
    setHistoryLoading(true)
    try {
      const page = await api.gitLog(scope, currentTarget, historyQuery(nextFilters, 0))
      if (owner !== historyGeneration.current || !sameTarget(currentTarget, targetRef.current)) return
      setLogEntries(page.entries)
      setLogHasMore(page.hasMore)
    } catch (reason) {
      if (owner === historyGeneration.current && sameTarget(currentTarget, targetRef.current)) {
        if (reason instanceof SidebarApiError && reason.code === 'git-target') {
          const recoveryKey = `${currentTarget.repositoryId}:${currentTarget.worktreeId}`
          if (targetRecoveryRef.current !== recoveryKey) {
            targetRecoveryRef.current = recoveryKey
            await refreshInventoryRef.current(true)
            return
          }
        }
        setHistoryPageError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (owner === historyGeneration.current) setHistoryLoading(false)
    }
  }, [scope.sessionId, scope.cwd])

  /** Append the next history page on sentinel intersection or fallback click. */
  const loadMoreLog = async (): Promise<void> => {
    if (logLoadingMore || !logHasMore) return
    const generation = refreshGeneration.current
    const historyOwner = historyGeneration.current
    const currentTarget = targetRef.current
    if (currentTarget === null) return
    setLogLoadingMore(true)
    setHistoryPageError(null)
    try {
      const next = await api.gitLog(
        scope,
        currentTarget,
        historyQuery(historyFiltersRef.current, logEntries.length),
      )
      // A repository switch clears the old history and increments generation.
      // Never append a late page from that checkout into the new one.
      if (
        generation !== refreshGeneration.current
        || historyOwner !== historyGeneration.current
        || !sameTarget(currentTarget, targetRef.current)
      ) return
      setLogEntries(entries => [...entries, ...next.entries])
      setLogHasMore(next.hasMore)
    } catch (reason) {
      if (generation === refreshGeneration.current && sameTarget(currentTarget, targetRef.current)) {
        if (reason instanceof SidebarApiError && reason.code === 'git-target') {
          const recoveryKey = `${currentTarget.repositoryId}:${currentTarget.worktreeId}`
          if (targetRecoveryRef.current !== recoveryKey) {
            targetRecoveryRef.current = recoveryKey
            await refreshInventoryRef.current(true)
            return
          }
        }
        setHistoryPageError(`${t('historyLoadError')}: ${reason instanceof Error ? reason.message : String(reason)}`)
      }
    } finally {
      if (
        generation === refreshGeneration.current
        && historyOwner === historyGeneration.current
        && sameTarget(currentTarget, targetRef.current)
      ) setLogLoadingMore(false)
    }
  }

  /** The diff tab for one changed file (one tab per path+side; same id = focused). */
  const openWorktreeDiff = (entry: GitStatusEntry, staged: boolean): void => {
    const actionTarget = targetRef.current
    if (actionTarget === null) return
    onOpenDiff({
      id: `diff:w:${actionTarget.repositoryId}:${actionTarget.worktreeId}:${staged ? 's' : 'u'}:${entry.path}`,
      type: 'diff',
      title: baseName(entry.path),
      diff: { kind: 'worktree', path: entry.path, staged, untracked: isUntracked(entry), target: actionTarget },
    })
  }

  /** The diff tab for one commit (one tab per commit). */
  const openCommitDiff = (entry: GitLogEntry): void => {
    const actionTarget = targetRef.current
    if (actionTarget === null) return
    onOpenDiff({
      id: `diff:c:${actionTarget.repositoryId}:${actionTarget.worktreeId}:${entry.hashFull}`,
      type: 'diff',
      title: `${entry.hash} ${entry.subject}`,
      diff: { kind: 'commit', hash: entry.hash, hashFull: entry.hashFull, subject: entry.subject, target: actionTarget },
    })
  }

  /** Execute against the copied target and publish outcome only if that exact
   *  target generation is still active. */
  const runTargetAction = async (
    actionTarget: GitTarget,
    action: () => Promise<unknown>,
    errorPrefix?: string,
  ): Promise<boolean> => {
    if (busyRef.current || !sameTarget(actionTarget, targetRef.current)) return false
    const owner = mutationOwner.current += 1
    busyRef.current = true
    let generation = refreshGeneration.current += 1
    setBusy(true)
    setCommitError(null)
    try {
      await action()
      if (generation !== refreshGeneration.current || !sameTarget(actionTarget, targetRef.current)) return false
      // Invalidate polls and paged history that started while the write was
      // running before publishing its authoritative post-write view.
      generation = refreshGeneration.current += 1
      await refreshTarget(actionTarget, { loading: false, generation })
      return generation === refreshGeneration.current && sameTarget(actionTarget, targetRef.current)
    } catch (reason) {
      if (generation === refreshGeneration.current && sameTarget(actionTarget, targetRef.current)) {
        if (reason instanceof SidebarApiError && reason.code === 'git-target') {
          await refreshInventory(true)
          return false
        }
        const message = reason instanceof Error ? reason.message : String(reason)
        setCommitError(errorPrefix === undefined ? message : `${errorPrefix}: ${message}`)
      }
      return false
    } finally {
      if (owner === mutationOwner.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  const stageEntry = async (entry: GitStatusEntry, staged: boolean): Promise<void> => {
    const actionTarget = targetRef.current
    if (actionTarget === null) return
    await runTargetAction(actionTarget, () => staged
      ? api.gitUnstage(scope, actionTarget, entry.path)
      : api.gitStage(scope, actionTarget, entry.path))
  }

  const stageAll = async (staged: boolean): Promise<void> => {
    const actionTarget = targetRef.current
    if (actionTarget === null) return
    await runTargetAction(actionTarget, () => staged
      ? api.gitUnstage(scope, actionTarget)
      : api.gitStage(scope, actionTarget))
  }

  const togglePaths = async (paths: readonly string[], side: GitSide): Promise<void> => {
    const actionTarget = targetRef.current
    if (actionTarget === null) return
    await runTargetAction(actionTarget, () => side === 'staged'
      ? api.gitUnstagePaths(scope, actionTarget, paths)
      : api.gitStagePaths(scope, actionTarget, paths))
  }

  const commit = async (): Promise<void> => {
    const message = commitMsg.trim()
    const actionTarget = targetRef.current
    if (message === '' || busy || actionTarget === null) return
    const completed = await runTargetAction(
      actionTarget,
      () => api.gitCommit(scope, actionTarget, message),
    )
    if (completed) setCommitMsg('')
  }

  const checkout = async (branch: string): Promise<void> => {
    const actionTarget = targetRef.current
    if (branch === status?.branch || busy || actionTarget === null) return
    await runTargetAction(
      actionTarget,
      () => api.gitCheckout(scope, actionTarget, branch),
      t('checkoutError'),
    )
  }

  /** Run one destructive operation against the target captured by its modal. */
  const runConfirmed = (confirmState: ConfirmState): void => {
    setConfirm({ ...confirmState, onConfirm: async () => {
      await runTargetAction(confirmState.target, confirmState.onConfirm)
    } })
  }

  /** Copy `text` to the clipboard (best-effort; no visual feedback needed — the menu closes). */
  const copy = (text: string): void => {
    void writeClipboard(text)
  }

  const openFileMenu = (event: MouseEvent, entry: GitStatusEntry, staged: boolean): void => {
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({ entry, staged, x: event.clientX, y: event.clientY })
  }

  const openHistoryMenu = (event: MouseEvent, entry: GitLogEntry): void => {
    event.preventDefault()
    event.stopPropagation()
    setHistoryMenu({ entry, x: event.clientX, y: event.clientY })
  }

  const [stagedNodes, unstagedNodes] = useMemo(() => {
    const entries = status?.entries ?? []
    return [buildGitChangeTree(entries, 'staged'), buildGitChangeTree(entries, 'unstaged')]
  }, [status?.entries])
  const stagedCount = stagedNodes.reduce((total, node) => total + node.count, 0)

  return (
    <div className={css.git}>
      {inventory !== null && (
        <div className={css.gitWorktreeRow}>
          <span className={css.gitWorktreeLabel}>{t('git')}</span>
          <select
            data-git-repository-selector
            aria-label={t('git')}
            className={css.gitBranchSelect}
            value={target?.repositoryId ?? ''}
            onChange={(event) => { void selectRepository(event.target.value) }}
          >
            {inventory.repositories.map((repository) => {
              const available = currentRepositoryTarget(repository) !== null
              const suffix = repository.state === 'uninitialized'
                ? ` — ${t('repositoryUninitialized')}`
                : repository.state === 'missing' || !available
                  ? ` — ${t('repositoryMissing')}`
                  : ''
              return (
                <option key={repository.id} value={repository.id} disabled={!available}>
                  {repository.name} ({repository.relativePath}){suffix}
                </option>
              )
            })}
          </select>
        </div>
      )}
      <div className={css.gitHeader}>
        <select
          className={css.gitBranchSelect}
          value={status?.branch ?? ''}
          onChange={(event) => { void checkout(event.target.value) }}
          disabled={busy || loading || target === null || (status !== null && !status.isRepo)}
        >
          {(status?.branch ?? '') !== '' && <option value={status!.branch}>{status!.branch}</option>}
          {branchResult.names.filter(name => name !== status?.branch).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          disabled={busy}
          onClick={() => { void manualRefresh() }}
        >
          <IconRefreshOutline16 size={14} />
        </button>
      </div>

      {loading && <div className={css.gitPlaceholder}>{t('loading')}</div>}
      {!loading && error !== null && <div className={css.gitError}>{error}</div>}
      {!loading && status !== null && !status.isRepo && (
        <div className={css.gitPlaceholder}>{t('notRepo')}</div>
      )}

      {status !== null && status.isRepo && (
        <>
          {status.truncated === true && (
            <div className={css.gitEmpty}>{t('statusTruncated')}</div>
          )}
          <GitChangeTree
            title={t('staged')}
            side="staged"
            nodes={stagedNodes}
            truncated={status.truncated === true}
            busy={busy}
            onOpenFile={(entry) => { openWorktreeDiff(entry, true) }}
            onTogglePaths={togglePaths}
            onToggleAll={() => stageAll(true)}
            onContextMenu={(event, entry) => { openFileMenu(event, entry, true) }}
          />
          <GitChangeTree
            title={t('unstaged')}
            side="unstaged"
            nodes={unstagedNodes}
            truncated={status.truncated === true}
            busy={busy}
            onOpenFile={(entry) => { openWorktreeDiff(entry, false) }}
            onTogglePaths={togglePaths}
            onToggleAll={() => stageAll(false)}
            onContextMenu={(event, entry) => { openFileMenu(event, entry, false) }}
          />

          <div className={css.gitCommit}>
            <Input
              className={css.gitCommitInput}
              placeholder={t('commitPlaceholder')}
              value={commitMsg}
              disabled={busy}
              onChange={(event) => { setCommitMsg(event.target.value); setCommitError(null) }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void commit()
              }}
            />
            <button
              type="button"
              className={css.gitCommitButton}
              disabled={busy || commitMsg.trim() === '' || stagedCount === 0}
              onClick={() => { void commit() }}
            >
              {t('commit')}
            </button>
          </div>
          {commitError !== null && <div className={css.gitError}>{commitError}</div>}

          <div className={css.gitSection}>
            <div className={css.gitSectionHeader}><span>{t('history')}</span></div>
            <GitHistoryLog
              entries={logEntries}
              branches={branchResult}
              filters={historyFilters}
              hasMore={logHasMore}
              loading={historyLoading}
              loadingMore={logLoadingMore}
              pageError={historyPageError}
              busy={busy}
              onFiltersChange={(next) => { void changeHistoryFilters(next) }}
              onLoadMore={() => {
                if (historyPageError !== null && logEntries.length === 0) {
                  void changeHistoryFilters(historyFiltersRef.current)
                } else {
                  void loadMoreLog()
                }
              }}
              onOpenCommit={openCommitDiff}
              onContextMenu={openHistoryMenu}
            />
          </div>

          {/*
            The one shared file-row context menu, positioned at the right-click
            cursor (portal so the panel's overflow clip cannot crop it).
          */}
          <Menu
            open={fileMenu !== null}
            onClose={() => { setFileMenu(null) }}
            items={[
              // A linked worktree outside the session workspace cannot be
              // opened in the editor: the host's workspace fence rejects
              // every path under it. Hide the action for that checkout so
              // the menu does not offer a no-op that confuses the user.
              ...(fileMenu !== null && isWithinWorkspace(scope.cwd ?? '', resolveSidebarPath(worktreePath ?? scope.cwd, fileMenu.entry.path))
                ? [{ id: 'open', label: t('openEditor'), icon: <IconCodeOutline16 size={14} /> }]
                : []),
              fileMenu?.staged === true
                ? { id: 'stage', label: t('unstage'), icon: <IconTrashOutline16 size={14} /> }
                : { id: 'stage', label: t('stage'), icon: <IconBranchOutline16 size={14} /> },
              ...(fileMenu !== null && !isUntracked(fileMenu.entry)
                ? [{ id: 'discard', label: t('discard'), icon: <IconTrashOutline16 size={14} />, danger: true }]
                : []),
              { type: 'separator', id: 'sep1' },
              { id: 'relative', label: t('copyRelative'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'absolute', label: t('copyAbsolute'), icon: <IconCopyOutline16 size={14} /> },
            ]}
            onSelect={(id) => {
              const menuEntry = fileMenu
              if (menuEntry === null) return
              setFileMenu(null)
              if (id === 'open') {
                const resolved = resolveSidebarPath(worktreePath ?? scope.cwd, menuEntry.entry.path)
                // Defense-in-depth: the menu hides this action when the
                // resolved path escapes the session workspace, but a
                // racing repo switch could still reach here with a path
                // the host would reject. No-op in that case.
                if (!isWithinWorkspace(scope.cwd ?? '', resolved)) return
                onOpenFile(resolved)
                return
              }
              if (id === 'stage') {
                void stageEntry(menuEntry.entry, menuEntry.staged)
                return
              }
              if (id === 'discard') {
                const actionTarget = targetRef.current
                if (actionTarget === null) return
                runConfirmed({
                  title: t('discardTitle'),
                  description: t('discardDesc', { path: menuEntry.entry.path }),
                  confirmLabel: t('discard'),
                  target: actionTarget,
                  onConfirm: () => api.gitDiscard(scope, actionTarget, menuEntry.entry.path),
                })
                return
              }
              if (id === 'relative') {
                copy(relativeTo(worktreePath ?? scope.cwd ?? '', menuEntry.entry.path))
                return
              }
              if (id === 'absolute') copy(resolveSidebarPath(worktreePath ?? scope.cwd, menuEntry.entry.path))
            }}
            portal
            align="start"
            getAnchorRect={() => (fileMenu === null ? null : new DOMRect(fileMenu.x, fileMenu.y, 0, 0))}
            anchor={<span />}
          />

          {/* The shared history-row context menu. */}
          <Menu
            open={historyMenu !== null}
            onClose={() => { setHistoryMenu(null) }}
            items={[
              { id: 'view', label: t('viewCommitDiff') },
              { id: 'copyShort', label: t('copyShortHash'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'copyFull', label: t('copyFullHash'), icon: <IconCopyOutline16 size={14} /> },
              { id: 'copySubject', label: t('copySubject'), icon: <IconCopyOutline16 size={14} /> },
              { type: 'separator', id: 'sep2' },
              { id: 'revert', label: t('revertCommit'), danger: true },
              { id: 'cherryPick', label: t('cherryPickCommit'), danger: true },
            ]}
            onSelect={(id) => {
              const menuEntry = historyMenu
              if (menuEntry === null) return
              setHistoryMenu(null)
              if (id === 'view') {
                openCommitDiff(menuEntry.entry)
                return
              }
              if (id === 'copyShort') {
                copy(menuEntry.entry.hash)
                return
              }
              if (id === 'copyFull') {
                copy(menuEntry.entry.hashFull)
                return
              }
              if (id === 'copySubject') {
                copy(menuEntry.entry.subject)
                return
              }
              if (id === 'revert') {
                const actionTarget = targetRef.current
                if (actionTarget === null) return
                runConfirmed({
                  title: t('revertTitle'),
                  description: t('revertDesc', { subject: menuEntry.entry.subject }),
                  confirmLabel: t('revertCommit'),
                  target: actionTarget,
                  onConfirm: () => api.gitRevert(scope, actionTarget, menuEntry.entry.hashFull),
                })
                return
              }
              if (id === 'cherryPick') {
                const actionTarget = targetRef.current
                if (actionTarget === null) return
                runConfirmed({
                  title: t('cherryPickTitle'),
                  description: t('cherryPickDesc', { subject: menuEntry.entry.subject }),
                  confirmLabel: t('cherryPickCommit'),
                  target: actionTarget,
                  onConfirm: () => api.gitCherryPick(scope, actionTarget, menuEntry.entry.hashFull),
                })
              }
            }}
            portal
            align="start"
            getAnchorRect={() => (historyMenu === null ? null : new DOMRect(historyMenu.x, historyMenu.y, 0, 0))}
            anchor={<span />}
          />

          {/* Destructive actions land here first: Cancel / Confirm. */}
          <Modal
            open={confirm !== null}
            onClose={() => { setConfirm(null) }}
            title={confirm?.title ?? ''}
            closeLabel={t('cancel')}
            footer={(
              <>
                <Button variant="outline" onClick={() => { setConfirm(null) }}>{t('cancel')}</Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    const pending = confirm
                    if (pending === null) return
                    setConfirm(null)
                    void pending.onConfirm()
                  }}
                >
                  {confirm?.confirmLabel ?? ''}
                </Button>
              </>
            )}
          >
            <p className={css.gitConfirmDesc}>{confirm?.description}</p>
          </Modal>
        </>
      )}
    </div>
  )
}
