/**
 * dsh-better-sidebar host half: the /sidebar JSON API (explorer listing, file
 * read/write, git), the /sidebar/file media route (images), the /sidebar/html
 * preview route, the /sidebar/bundle lazy-chunk route (client code splits),
 * and the terminal WebSocket upgrade. Every route passes the same
 * browser-trust fence as the /api gateway — Host-header loopback or the
 * listener's bind IP literal or the `webStartup` service's `trustedHosts`
 * (`--trusted-host` authorities), read per request from the live service
 * values so the fence tracks the same trust source the /api gateway derives
 * its list from.
 *
 * All operations are conversation-scoped: requests carry a sessionId, the
 * session's authoritative cwd comes from the session store, and terminal
 * processes are keyed by session.
 */
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { Context, SidebarHttpRequest } from './context-types.ts'
import {
  Config,
  readSidebarPrefs,
  resolveSidebarConfig,
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  type ResolvedSidebarConfig,
  type SidebarConfig,
  type SidebarPrefs,
  type SidebarPrefsConfig,
} from './config.ts'
import { parentOf, requireAbsolute, listDirectory, rootLabel } from './fs-tree.ts'
import { writeWorkspaceUpload } from './fs-operations.ts'
import { ensureWorkspacePath, ensureWorkspaceWritePath } from './path-security.ts'
import { searchFiles } from './fs-search.ts'
import { decodeHtmlUrl } from './html-route.ts'
import { extractFrameAncestors } from './browser-probe.ts'
import { isTrustedApiRequest, isLoopbackHostname } from './trust-fence.ts'
import { registerBundleRoute } from './bundle-route.ts'
import { launchExternal } from './open-external.ts'
import * as git from './git.ts'
import {
  discoverGitWorkspace,
  resolveGitTarget,
  type GitTarget,
  type ResolvedGitTarget,
} from './git-workspaces.ts'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { defaultShell, ensureSpawnHelper, PtyManager, shellDisplayName } from './pty-manager.ts'
import { AgentPtyRegistry } from './agent-pty.ts'
import {
  DSH_NODE_PTY_RANGE,
  depsStatus,
  loadNodePty,
} from './pty-deps.ts'
import { attachTerminal } from './terminal-host.ts'
import { sessionCwdOf } from './session-cwd.ts'
import { registerTools } from './tools.ts'
import { AgentOpenRegistry, registerOpenTool, type AgentOpenRequest } from './agent-opens.ts'
import { buildJobsApi, type SidebarJobsRoutes } from './jobs-routes.ts'
import { buildSubagentLiveApi, type SidebarSubagentLiveRoutes } from './subagent-live-route.ts'
import { buildSidechatApi } from './sidechat-routes.ts'
import { readJsonBody, requireString, SidebarError, writeError, writeJson, writeOk } from './wire.ts'

export { Config }
export type { SidebarConfig, ResolvedSidebarConfig }
// Re-export the Context augmentation (`declare module '@deepseek-ai/cordis'`)
// so consumers `import type {} from 'dsh-better-sidebar'` and gain
// `ctx.betterSidebar`; the Context re-export below is the vendored cordis
// Context intersected with the structural service faces.
// Also re-export the service descriptor types so consumers can type their
// registerTab / registerFileViewer arguments without reaching into /client.
export type { Context } from './context-types.ts'
export type {
  BetterSidebarService,
  TabDescriptor,
  TabComponentProps,
  FileViewerDescriptor,
  FileViewerProps,
  FileFetchStrategy,
} from './client/service.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-better-sidebar'

/** Services required before mounting: the webserver routes, the session store, the web startup's trusted hosts, and the tool registry. */
export const inject = ['webServer', 'sessions', 'webStartup', 'tools']

/** Content types for the media route, by extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
}

/** Content type served by /sidebar/file (binary-safe fallback for unknowns). */
export function mediaTypeForPath(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Optional repository selected by the Git panel when cwd is a container. */
function selectedRepoOf(payload: unknown): string | undefined {
  const record = payload as { repoRoot?: unknown }
  if (record.repoRoot === undefined) return undefined
  return requireAbsolute(requireString(payload, 'repoRoot'))
}

/** Parse one opaque Git repository/worktree pair from a request payload. */
function gitTargetOf(payload: unknown): GitTarget {
  const record = payload as { target?: unknown } | null
  const target = record?.target as { repositoryId?: unknown; worktreeId?: unknown } | null
  if (
    target === null
    || typeof target !== 'object'
    || typeof target.repositoryId !== 'string'
    || target.repositoryId === ''
    || typeof target.worktreeId !== 'string'
    || target.worktreeId === ''
  ) {
    throw new SidebarError('bad-request', 'missing or invalid "target"')
  }
  return { repositoryId: target.repositoryId, worktreeId: target.worktreeId }
}

/** Parse a path consumed by Git as a repository-relative pathspec. */
function requireGitRelativePath(payload: unknown, key: string): string {
  const value = requireString(payload, key)
  const slashPath = value.replaceAll('\\', '/')
  if (
    value.includes('\0')
    || isAbsolute(value)
    || /^[A-Za-z]:\//.test(slashPath)
    || slashPath.startsWith('//')
    || slashPath.split('/').includes('..')
  ) {
    throw new SidebarError('bad-request', `invalid Git-relative path "${value}"`)
  }
  return value
}

/** Parse a non-empty batch of exact repository-relative Git paths. */
function requireGitRelativePaths(payload: unknown, key: string): string[] {
  const values = (payload as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(values) || values.length === 0) {
    throw new SidebarError('bad-request', `missing or invalid "${key}"`)
  }
  return values.map((value, index) => {
    try {
      const path = requireGitRelativePath({ path: value }, 'path')
      const segments = path.replaceAll('\\', '/').split('/')
      if (segments.some(segment => segment === '' || segment === '.')) {
        throw new SidebarError('bad-request', `invalid Git-relative path "${path}"`)
      }
      return path
    } catch (error) {
      if (error instanceof SidebarError) {
        throw new SidebarError('bad-request', `invalid Git-relative path at "${key}[${index}]"`)
      }
      throw error
    }
  })
}

/** Parse one optional trimmed history-filter string with a wire-size cap. */
function optionalGitLogString(record: Record<string, unknown>, key: string, limit: number): string | undefined {
  const value = record[key]
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > limit) {
    throw new SidebarError('bad-request', `invalid Git log "${key}"`)
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Parse the nested, non-shell Git history query. */
function gitLogQueryOf(payload: unknown): git.GitLogQuery {
  const value = (payload as { query?: unknown } | null)?.query
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SidebarError('bad-request', 'missing or invalid "query"')
  }
  const record = value as Record<string, unknown>
  const scope = record.scope
  if (scope !== 'current' && scope !== 'all' && scope !== 'ref') {
    throw new SidebarError('bad-request', 'invalid Git log "scope"')
  }
  const count = typeof record.count === 'number' && Number.isInteger(record.count) && record.count > 0
    ? Math.min(record.count, 100)
    : 50
  const skip = typeof record.skip === 'number' && Number.isInteger(record.skip) && record.skip >= 0
    ? record.skip
    : 0
  const ref = optionalGitLogString(record, 'ref', 512)
  if (scope === 'ref' && ref === undefined) throw new SidebarError('bad-request', 'missing Git log "ref"')
  const since = optionalGitLogString(record, 'since', 10)
  const until = optionalGitLogString(record, 'until', 10)
  const validDate = (date: string | undefined): boolean => date === undefined || /^\d{4}-\d{2}-\d{2}$/.test(date)
  if (!validDate(since) || !validDate(until) || (since !== undefined && until !== undefined && since > until)) {
    throw new SidebarError('bad-request', 'invalid Git log date range')
  }
  const rawPath = optionalGitLogString(record, 'path', 4096)
  const path = rawPath === undefined ? undefined : requireGitRelativePath({ path: rawPath }, 'path')
  const search = optionalGitLogString(record, 'search', 256)
  const author = optionalGitLogString(record, 'author', 128)
  return {
    scope,
    ...(ref !== undefined ? { ref } : {}),
    ...(search !== undefined ? { search } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(path !== undefined ? { path } : {}),
    count,
    skip,
  }
}

/**
 * Resolve a path that a git command reported — `git status`/`git diff`
 * print paths RELATIVE TO THE REPO TOP LEVEL, which may sit above the
 * session cwd (a session inside a subdirectory of a repository). Absolute
 * paths pass through; relative ones join the repo root (falling back to the
 * cwd when the root cannot be resolved, e.g. a bare directory).
 */
async function resolveGitPath(cwd: string, raw: string, selected?: string): Promise<string> {
  if (isAbsolute(raw)) return requireAbsolute(raw)
  // Prefer the session-relative interpretation when it names an existing
  // path. Git status reports repository-root-relative names, but the sidebar
  // security boundary is the session workspace; this preference keeps files
  // inside a nested session readable without reopening the repository root.
  const sessionPath = requireAbsolute(join(cwd, raw))
  if (await stat(sessionPath).then(() => true).catch(() => false)) return sessionPath
  const root = await git.repoRoot(cwd, selected).catch(() => cwd)
  const repoPath = requireAbsolute(join(root, raw))
  if (await stat(repoPath).then(() => true).catch(() => false)) return repoPath

  // A published plugin can be mounted inside a larger host checkout. In
  // that layout Git reports the host repository root, while an untracked
  // file shown by this plugin is relative to the plugin package root. Walk
  // package boundaries only as an existing-path fallback; the workspace
  // fence below still decides whether the resolved file is readable.
  for (let ancestor = dirname(cwd); ancestor !== dirname(ancestor); ancestor = dirname(ancestor)) {
    const packagePath = join(ancestor, 'package.json')
    if (!await stat(packagePath).then(() => true).catch(() => false)) continue
    const packageRelativePath = requireAbsolute(join(ancestor, raw))
    if (await stat(packageRelativePath).then(() => true).catch(() => false)) return packageRelativePath
  }
  return repoPath
}

/** How many leading bytes a binary read returns for client-side detect sniffing. */
const READ_HEAD_LIMIT = 4096

/** Text read of a file with the size cap; binary detection via NUL probe.
 *  Binary reads also return the first {@link READ_HEAD_LIMIT} bytes (base64)
 *  so the client can re-match viewers by content (`detect`). */
async function readText(path: string, readLimit: number): Promise<{
  content: string
  truncated: boolean
  binary: boolean
  size: number
  head?: string
}> {
  const info = await stat(path).catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  if (info.isDirectory()) {
    throw new SidebarError('fs-error', `"${path}" is a directory`, 400)
  }
  const size = info.size
  const truncated = size > readLimit
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  try {
    const buffer = Buffer.alloc(Math.min(size, readLimit))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const slice = buffer.subarray(0, bytesRead)
    const binary = slice.includes(0)
    const head = binary
      ? slice.subarray(0, Math.min(slice.length, READ_HEAD_LIMIT)).toString('base64')
      : undefined
    return {
      content: binary ? '' : slice.toString('utf8'),
      truncated,
      binary,
      size,
      head,
    }
  } finally {
    await handle.close()
  }
}

/** One API method dispatch table entry. */
type ApiMethod = (payload: unknown) => Promise<unknown> | unknown

/**
 * The live face of the side card settings namespace, bound to the settings
 * service when it is mounted. The DSH settings RPC domain only serves
 * allowlisted namespaces (api-proxy exposedNamespaces), so the client reads
 * and writes THIS namespace through the plugin's own fenced /sidebar routes,
 * which call the seam in-process — no configuration-client gate involved.
 */
export interface SidebarSettingsFace {
  /** The current resolved value + revision (undefined while the settings service is absent). */
  get(): { value?: unknown; revision?: number }
  /**
   * Whether the dsh-web-ui family's aionui-panel has been selected as the
   * right-panel provider (the `aionui-panel` settings namespace resolves
   * `rightPanel: 'aionui-panel'`). While true the sidebar must not mount —
   * the two right panels are mutually exclusive. False when the namespace is
   * absent (no aionui installed) or the provider is anything else.
   */
  externalDisable(): boolean
  /** Merge a patch (revision-guarded) and return the fresh resolved view. */
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
}

/** Build the API method table bound to the plugin context, pty manager, agent pty registry, resolved config, and effective terminal shell. */
/**
 * Resolve the settings-page terminal shell overrides (the terminal card's
 * gear rows). Empty fields mean "unset": keep the yaml `config.shell` /
 * `shellArgs` (or the platform auto-resolution). The settings page is the
 * runtime complement to the boot-time yaml — same contract, later binding:
 * the values here win for terminals opened afterwards.
 */
function shellOverridesOf(getSettings: () => SidebarSettingsFace | undefined): { shell?: string; shellArgs?: string[] } {
  const settings = getSettings()
  const value = settings?.get().value
  if (value === null || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const shell = typeof record.terminalShell === 'string' ? record.terminalShell.trim() : ''
  const args = typeof record.terminalShellArgs === 'string' ? record.terminalShellArgs.trim() : ''
  return {
    shell: shell === '' ? undefined : shell,
    shellArgs: args === '' ? undefined : args.split(/\s+/).filter(Boolean),
  }
}

/**
 * Parse the browser tab's `browserAllowedLoopback` allowlist into a matcher
 * over host:port (same contract as the client-side helper in
 * src/client/browser.ts — kept in sync). Bare hosts (`localhost`,
 * `127.0.0.1`) match every port; `host:port` entries match exactly.
 */
function parseLoopbackAllowlist(allowlist: string): (host: string, port: string) => boolean {
  const entries = allowlist.split(',').map(entry => entry.trim().toLowerCase()).filter(entry => entry !== '')
  const exact = new Set(entries)
  const hosts = new Set<string>()
  for (const entry of entries) {
    if (!entry.includes(':')) hosts.add(entry.replace(/^\[|\]$/g, ''))
  }
  return (host, port) => {
    const key = `${host}:${port}`
    if (exact.has(key) || exact.has(host)) return true
    return port !== '' && hosts.has(host)
  }
}

function buildApi(
  ctx: Context,
  ptyManager: PtyManager | null,
  agentPtyRegistry: AgentPtyRegistry | null,
  resolved: ResolvedSidebarConfig,
  terminalShell: string,
  getSettings: () => SidebarSettingsFace | undefined,
): Record<string, ApiMethod> {
  const cwdOf = (payload: unknown): { sessionId: string; cwd: string } => {
    const sessionId = requireString(payload, 'sessionId')
    const record = payload as { cwd?: unknown } | null
    const clientCwd = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
    return { sessionId, cwd: sessionCwdOf(ctx, sessionId, clientCwd) }
  }
  /** Resolve one request target against the session's authoritative inventory. */
  const gitOperationOf = async (payload: unknown): Promise<{ cwd: string; resolved: ResolvedGitTarget }> => {
    const { cwd } = cwdOf(payload)
    try {
      return { cwd, resolved: await resolveGitTarget(cwd, gitTargetOf(payload)) }
    } catch (error) {
      if (error instanceof git.GitCommandError && error.code === 'git-target') {
        throw new SidebarError('bad-request', error.message)
      }
      throw error
    }
  }
  // Background jobs: the LIST rides the harness's `session/jobs` push
  // mirror, so these routes only replay output the model has read (from the
  // session's own event log — no DSH source is touched, the model's
  // job_output cursor is never consumed) and kill (the registry's stock
  // API). A deployment without the jobs registry downgrades kill to a 503.
  const jobsApi: SidebarJobsRoutes = buildJobsApi(ctx, resolved.readLimit)
  // Subagent live previews: one batch request instead of N per-child
  // `subagents.history` calls. The route degrades to a 503 when the host
  // subagent runtime is absent (the page has no topology to show anyway).
  const subagentLiveApi: SidebarSubagentLiveRoutes = buildSubagentLiveApi(ctx)
  return {
    'session.cwd': (payload) => {
      const { sessionId, cwd } = cwdOf(payload)
      return { sessionId, cwd, root: rootLabel(cwd), parent: parentOf(cwd) ?? null }
    },
    'fs.tree': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { path?: unknown }
      const target = record.path === undefined ? cwd : await ensureWorkspacePath(cwd, requireString(payload, 'path'))
      return listDirectory(target, resolved.listLimit)
    },
    'fs.search': async (payload) => {
      // The editor side panel's global name search: rooted at the session
      // cwd (not caller-targetable — the walk is unbounded by design and
      // must never escape the workspace), budgeted inside searchFiles.
      const { cwd } = cwdOf(payload)
      const query = requireString(payload, 'query')
      return searchFiles(cwd, query)
    },
    'fs.read': async (payload) => {
      const { cwd } = cwdOf(payload)
      // Relative paths are git-derived (status/diff report repo-root-relative
      // names; the untracked diff view reads the file through this route). A
      // child-repo path is relative to the selected repoRoot, not the session
      // cwd; thread it so the path resolves inside the authorized workspace.
      const selected = selectedRepoOf(payload)
      const path = await ensureWorkspacePath(cwd, await resolveGitPath(cwd, requireString(payload, 'path'), selected))
      const { content, truncated, binary, size, head } = await readText(path, resolved.readLimit)
      if (binary) return { kind: 'binary', size, truncated, head }
      return { kind: 'text', content, truncated }
    },
    'fs.write': async (payload) => {
      const { cwd } = cwdOf(payload)
      const path = await ensureWorkspaceWritePath(cwd, requireString(payload, 'path'))
      const content = requireString(payload, 'content')
      const tmp = `${path}.dsh-sidebar-tmp-${process.pid}`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {})
        throw new SidebarError('fs-error', `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
      }
      return { ok: true }
    },
    'git.inventory': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { refresh?: unknown } | null
      if (record?.refresh !== undefined && typeof record.refresh !== 'boolean') {
        throw new SidebarError('bad-request', 'invalid "refresh"')
      }
      return discoverGitWorkspace(cwd, { refresh: record?.refresh === true })
    },
    'git.status': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      return git.status(resolved.worktree.path)
    },
    'git.diff': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      const record = payload as { path?: unknown; staged?: unknown }
      const path = record.path === undefined ? undefined : requireGitRelativePath(payload, 'path')
      return { diff: await git.diff(resolved.worktree.path, path, record.staged === true) }
    },
    'git.stage': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      const record = payload as { path?: unknown }
      const path = record.path === undefined ? undefined : requireGitRelativePath(payload, 'path')
      await git.stage(resolved.worktree.path, path)
      return { ok: true }
    },
    'git.unstage': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      const record = payload as { path?: unknown }
      const path = record.path === undefined ? undefined : requireGitRelativePath(payload, 'path')
      await git.unstage(resolved.worktree.path, path)
      return { ok: true }
    },
    'git.stage-paths': async (payload) => {
      // Parse the complete array before target discovery or mutation so one
      // invalid member cannot partially apply the preceding valid paths.
      const paths = requireGitRelativePaths(payload, 'paths')
      const { resolved } = await gitOperationOf(payload)
      await git.stagePaths(resolved.worktree.path, paths)
      return { ok: true }
    },
    'git.unstage-paths': async (payload) => {
      const paths = requireGitRelativePaths(payload, 'paths')
      const { resolved } = await gitOperationOf(payload)
      await git.unstagePaths(resolved.worktree.path, paths)
      return { ok: true }
    },
    'git.commit': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      const message = requireString(payload, 'message')
      await git.commit(resolved.worktree.path, message)
      return { ok: true }
    },
    'git.branch': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      return git.branches(resolved.worktree.path)
    },
    'git.checkout': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      await git.checkout(resolved.worktree.path, requireString(payload, 'branch'))
      return { ok: true }
    },
    'git.log': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      return git.logPage(resolved.worktree.path, gitLogQueryOf(payload))
    },
    'git.commit-diff': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      return { diff: await git.commitDiff(resolved.worktree.path, requireString(payload, 'hash')) }
    },
    'git.discard': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      await git.discard(resolved.worktree.path, requireGitRelativePath(payload, 'path'))
      return { ok: true }
    },
    'git.revert': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      await git.revert(resolved.worktree.path, requireString(payload, 'hash'))
      return { ok: true }
    },
    'git.cherry-pick': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      await git.cherryPick(resolved.worktree.path, requireString(payload, 'hash'))
      return { ok: true }
    },
    'git.show': async (payload) => {
      const { resolved } = await gitOperationOf(payload)
      const path = requireGitRelativePath(payload, 'path')
      const rev = requireString(payload, 'rev')
      return { content: await git.show(resolved.worktree.path, rev, path) }
    },
    // Release a terminal immediately. The WebSocket close frame already does
    // this while the socket is open; this route covers the tab-close that
    // happens while the socket is down (reconnect loop), so a closed tab can
    // never hold the per-session quota until the reconnect grace expires.
    'pty.close': (payload) => {
      const sessionId = requireString(payload, 'sessionId')
      const tab = requireString(payload, 'tab')
      // Degraded mode (node-pty unavailable): no live pty can exist, so a
      // no-op ok is the honest answer — never an error the client must show.
      ptyManager?.close(`${sessionId}:${tab}`)
      return { ok: true }
    },
    // Release an agent terminal by uuid. The WS close frame already does
    // this while the socket is open; this route covers the tab-close that
    // happens while the socket is down (reconnect loop) so a closed agent
    // tab never leaves a zombie pty behind. Idempotent.
    'agent-pty.close': (payload) => {
      const uuid = requireString(payload, 'uuid')
      agentPtyRegistry?.close(uuid)
      return { ok: true }
    },
    // Terminal dependency status (issue #140): after a WS close 1011 with
    // reason `pty-deps-missing` the client fetches the full repair details
    // here — the close reason itself is capped at 123 bytes, too small for
    // the pasteable command.
    'terminal.deps': () => depsStatus(),
    // Background jobs: read one job's output (a REPLAY of what the model
    // has read so far, from the owner session's event log — the model's
    // job_output cursor is never touched, so the human pane can never steal
    // the agent's bytes), and kill one job. The job LIST itself arrives
    // through the harness's session/jobs push mirror, so no list route
    // exists. Kill is fenced to the owning session by the jobs registry.
    'jobs.output': (payload) => jobsApi.output(payload),
    'jobs.kill': (payload) => jobsApi.kill(payload),
    // Subagent live previews: one batch request per refresh; the route folds
    // the newest text/tool activity of every running child in the tree.
    'subagents.live': (payload) => subagentLiveApi.live(payload),
    // The effective terminal shell and its display name. The client uses
    // this to title terminal tabs with the shell name instead of a numbered
    // "Terminal N" label; the shell itself is configured through
    // `cordis.patch.yml` (`config.shell`) or resolved by the host default.
    'shell.get': () => ({ shell: terminalShell, name: shellDisplayName(terminalShell) }),
    // The side card preferences. The settings service is optional in the
    // composition; while absent the routes report undefined and the client
    // keeps the schema defaults. Writes are revision-guarded: a stale editor
    // is refused with settings-conflict so a concurrent change is never
    // silently overwritten (mirror of the settings seam's own guard).
    'settings.get': () => {
      const settings = getSettings()
      return settings === undefined
        ? { value: undefined, revision: undefined, externalDisable: false }
        : { ...settings.get(), externalDisable: settings.externalDisable() }
    },
    'settings.update': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new SidebarError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new SidebarError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.update(patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new SidebarError('settings-conflict', error.message, 409)
        }
        throw new SidebarError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    // Probe a URL's RESPONSE HEADERS so the sidebar browser can explain an
    // iframe refusal: X-Frame-Options / CSP frame-ancestors are exactly the
    // signals the browser enforces when it refuses to embed a site. The
    // probe is display-only (headers back to the caller), restricted to
    // http(s) non-loopback URLs with a hard timeout, and gated by the same
    // trust fence as every other route — a cross-site page cannot reach it.
    'browser.probe': async (payload) => {
      const raw = requireString(payload, 'url')
      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        throw new SidebarError('bad-request', 'invalid url', 400)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new SidebarError('bad-request', 'only http/https urls can be probed', 400)
      }
      // Mirror the browser tab's address-bar policy: loopback stays unreachable
      // from the sidebar (unless the user allowlisted it), so probing it would
      // leak nothing the tab could use.
      if (isLoopbackHostname(parsed.hostname)) {
        const prefs = getSettings()?.get()?.value as SidebarPrefs | undefined
        const allowlist = typeof prefs?.browserAllowedLoopback === 'string' ? prefs.browserAllowedLoopback : ''
        const allowed = allowlist.trim() !== ''
          && parseLoopbackAllowlist(allowlist)(parsed.hostname, parsed.port)
        if (!allowed) {
          throw new SidebarError('bad-request', 'local addresses are not probed', 400)
        }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        let response = await fetch(parsed, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
        // Some servers answer HEAD with 405/501; retry once as GET (the
        // body is discarded — only the headers matter).
        let retriedFromHeadRejection = false
        if (response.status === 405 || response.status === 501) {
          response = await fetch(parsed, { method: 'GET', redirect: 'follow', signal: controller.signal })
          retriedFromHeadRejection = true
        }
        // Some servers (e.g. aliyun consoles) answer HEAD without the
        // X-Frame-Options / CSP headers that only their GET response
        // carries. Without those signals the embeddability check below
        // would wrongly report the site as embeddable and the plain iframe
        // would surface the browser's misleading "refused to connect".
        // Retry once as GET when both signals are absent (body discarded).
        // A 405/501 retry already fetched the GET response, so the signals
        // are either there or genuinely absent — another GET adds nothing.
        const hasEmbedSignals = response.headers.get('content-security-policy') !== null
          || response.headers.get('x-frame-options') !== null
        if (!hasEmbedSignals && !retriedFromHeadRejection && response.status !== 405 && response.status !== 501) {
          response = await fetch(parsed, { method: 'GET', redirect: 'follow', signal: controller.signal })
        }
        const csp = response.headers.get('content-security-policy')
        const frameAncestors = extractFrameAncestors(csp)
        const xFrameOptions = response.headers.get('x-frame-options')
        // The GET fallbacks stream a real body that nothing reads; "body
        // discarded" is not automatic with fetch, so cancel it explicitly to
        // release the socket (a large/streaming response would otherwise stay
        // pinned after the timer clears).
        void response.body?.cancel()
        return {
          reachable: true,
          url: response.url,
          status: response.status,
          ...(xFrameOptions !== null ? { xFrameOptions } : {}),
          ...(frameAncestors !== undefined ? { frameAncestors } : {}),
        }
      } catch {
        // DNS / TLS / connection / timeout: nothing to judge — the client
        // keeps the plain iframe.
        return { reachable: false }
      } finally {
        clearTimeout(timer)
      }
    },
    // External open for the file tree's "open with" menu: reveal a path in
    // the OS file manager, or hand a custom-scheme URL (vscode://,
    // cursor://, zed://, custom editors) to its registered handler. The
    // client is a browser renderer where raw scheme navigation is
    // unreliable, so the launch always goes through the host — the same
    // fence as every other route, argv-only (no shell interpolation).
    'open.external': (payload) => {
      const record = payload as { action?: unknown } | null
      const action = record?.action
      if (action === 'reveal') return launchExternal('reveal', requireString(payload, 'path'))
      if (action === 'url') return launchExternal('url', requireString(payload, 'url'))
      throw new SidebarError('bad-request', 'action must be "reveal" or "url"')
    },
    // Side Chat: create a side-thread child seeded with the parent's full
    // log up to now, deliver follow-ups (cold-resuming when the thread's
    // agent is gone), abort a running thread, and release a thread's agent.
    // Every operation runs through these routes because subagent-origin
    // identities are fenced from the generic session RPCs (agent-lookup
    // ownership), and the thread is created with a CUSTOM seed the stock
    // fork APIs cannot express.
    ...buildSidechatApi(ctx),
  }
}

/**
 * Plugin body: mount the fenced routes and the pty lifecycle.
 * @param ctx - host plugin context (webServer, sessions, webStartup).
 * @param config - deployment-provided limits; the Loader validates against
 * {@link Config} and fills defaults, direct callers get them from
 * {@link resolveSidebarConfig}.
 */
export function apply(ctx: Context, config?: SidebarConfig & SidebarPrefsConfig): void {
  // pnpm strips the executable bit from node-pty's prebuilt spawn-helper;
  // restore it before any terminal can spawn (idempotent).
  ensureSpawnHelper()
  const resolved = resolveSidebarConfig(config)
  // One shell resolution feeds BOTH terminal surfaces: the UI tabs and the
  // model-facing terminal_* tools. They must stay in lockstep, otherwise a
  // configured shell fixes one surface and silently leaves the other on the
  // platform default.
  const terminalShell = defaultShell({ explicit: resolved.shell })
  // The invocation's --trusted-host authorities (webStartup) plus the
  // listener's own bind IP literal — the same sources the DSH 0.2.1 /api
  // gateway fence accepts (0.2.1 replaced the webRuntime service and its
  // bind-derived LAN list with these). Read per request from the live
  // service values; a replaced list takes effect without a plugin restart.
  const fence = (req: SidebarHttpRequest): boolean =>
    isTrustedApiRequest(req, ctx.webStartup.trustedHosts, ctx.webServer.host)
  // node-pty is loaded lazily, never at module top level (issue #140): a
  // missing or broken install must degrade THIS plugin — terminal tab shows
  // a repair command, agent terminal tools stay unregistered — instead of
  // failing the plugin load and taking the whole `dsh web` server down.
  const nodePty = loadNodePty()
  if (nodePty === null) {
    const status = depsStatus()
    const detail = status.ok
      ? 'unknown cause'
      : `${status.cause}. Repair: ${status.command}`
    ctx.logger?.warn(`[dsh-better-sidebar] node-pty (${DSH_NODE_PTY_RANGE}) failed to load: ${detail}`)
  }
  const ptyManager = nodePty !== null
    ? new PtyManager(terminalShell, resolved.terminalsPerSession, resolved.shellArgs, nodePty)
    : null
  // The agent-owned terminal registry: parallel to the UI-tab ptyManager,
  // keyed by uuid (the model's opaque handle) instead of `${sessionId}:${tabId}`,
  // uncapped, and torn down with the plugin. The model creates terminals here
  // through the terminal_create tool; the sidebar view attaches through the
  // same /sidebar/ws/terminal upgrade with ?uuid=... instead of ?tab=...
  const agentPtyRegistry = nodePty !== null
    ? new AgentPtyRegistry(terminalShell, resolved.shellArgs, nodePty)
    : null
  // The model-facing open-request registry: queues `sidebar_open` requests
  // per session and pushes them to connected sidebar views over the
  // `/sidebar/ws/agent-opens` socket. Unlike the pty registry it has no
  // native dependencies — the tool works even in node-pty degraded mode.
  const agentOpenRegistry = new AgentOpenRegistry()

  // ── User-facing "Side card" preferences ──────────────────────────────────
  // The preferences are volatile fields of this row's Config (DSH 0.2.1
  // replaced settings.register with volatile row config): the settings
  // service describes and writes them under this plugin's profile entry id,
  // the Loader commits writes into the running references and emits
  // `loader/volatile-update`. The client reaches the namespace through the
  // plugin's own fenced routes below ('settings.get'/'settings.update'),
  // which call the seam in-process. Deployments without a settings service
  // simply never fill the face and the client falls back to the defaults.
  let settingsFace: SidebarSettingsFace | undefined
  // The model-facing terminal tools are gated on the side-card setting
  // `agentTerminalTools` (default off): nothing is injected until the user
  // turns the feature on, and turning it off mid-session unregisters the
  // tools and releases the agent terminals they created.
  let toolsDisposers: (() => void) | null = null
  // The model-facing `sidebar_open` tool is gated the same way (see
  // syncOpenToolsGate below); separate disposer (no native deps, and turning
  // the feature off must not release user terminals).
  let openToolsDisposers: (() => void) | null = null
  const syncToolsGate = (scope: { get(): SidebarPrefs }): void => {
    if (scope.get().agentTerminalTools) {
      if (toolsDisposers === null) {
        // Degraded mode (node-pty unavailable): never register the terminal
        // tools — every one of them would fail at spawn time.
        if (agentPtyRegistry === null) return
        toolsDisposers = registerTools(ctx, agentPtyRegistry, (sessionId) => sessionCwdOf(ctx, sessionId), () => shellOverridesOf(() => settingsFace))
      }
    } else if (toolsDisposers !== null) {
      toolsDisposers()
      toolsDisposers = null
      // The feature is off: release every agent terminal the model created
      // while it was on (they are only reachable through the tools). The
      // registry change fires the push, so the sidebar reconciles them away.
      agentPtyRegistry?.disposeAll()
    }
  }
  ctx.inject(['settings'], (sctx) => {
    // The settings namespace is this plugin's profile entry id (the bundle
    // row's `better-sidebar`, or an aggregate's own id); direct callers
    // without a Loader entry keep the historical namespace name.
    const entry = (ctx.fiber as { entry?: { options?: { id?: unknown } } } | undefined)?.entry
    const ns = typeof entry?.options?.id === 'string' ? entry.options.id : SIDEBAR_PREFS_NS
    // The live preferences: the row config's volatile references.
    const scope = { get: (): SidebarPrefs => readSidebarPrefs(config) }
    const viewOf = (): { value?: unknown; revision?: number } => {
      const descriptor = sctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === ns)
      return descriptor === undefined
        ? { value: undefined, revision: undefined }
        : { value: descriptor.value, revision: descriptor.revision }
    }
    // Mutual exclusion with the dsh-web-ui family right panel: the aionui
    // panel's provider choice (`aionui-panel.rightPanel`) is the authority.
    // While it resolves to 'aionui-panel', this sidebar must not mount. The
    // namespace is read through the settings seam like any other registered
    // section; absent namespace (no aionui installed) = not disabled.
    const externalDisable = (): boolean => {
      const descriptor = sctx.settings.describe({ redactSecrets: true })
        .find(candidate => candidate.ns === 'aionui-panel')
      const value = descriptor?.value as { rightPanel?: unknown } | undefined
      return value?.rightPanel === 'aionui-panel'
    }
    settingsFace = {
      get: viewOf,
      externalDisable,
      update: async (patch, expectedRevision) => {
        await sctx.settings.update(ns, patch, expectedRevision)
        return viewOf()
      },
    }
    // Register (or unregister) the terminal tools from the current setting,
    // and keep them in sync with every settings commit.
    syncToolsGate(scope)
    // The model-facing open tool is gated the same way on `agentOpenTools`
    // (default off): nothing is injected until the user turns the feature
    // on, and turning it off mid-session unregisters the tool and drops the
    // queued (undelivered) open requests. Already-delivered opens keep their
    // tabs — the tools' only lever is the queue, not the rendered state.
    const syncOpenToolsGate = (): void => {
      if (scope.get().agentOpenTools) {
        if (openToolsDisposers === null) {
          openToolsDisposers = registerOpenTool(
            ctx,
            agentOpenRegistry,
            (sessionId) => sessionCwdOf(ctx, sessionId),
            () => {
              const view = settingsFace?.get()
              const value = view?.value
              return value !== null && typeof value === 'object'
                ? value as SidebarPrefs
                : SIDEBAR_PREFS_DEFAULTS
            },
          )
        }
      } else if (openToolsDisposers !== null) {
        openToolsDisposers()
        openToolsDisposers = null
        agentOpenRegistry.drainAll()
      }
    }
    syncOpenToolsGate()
    // ONE watch subscription drives both gates: settings commits re-evaluate
    // the terminal tools AND the open tool together (each gate is idempotent
    // and owns its own disposer). The Loader delivers `loader/volatile-update`
    // only to listeners of the owning fiber, so the listener sits on the
    // plugin context; the effect ties it to this settings child's lifetime.
    sctx.effect(() => ctx.on('loader/volatile-update', () => { syncToolsGate(scope); syncOpenToolsGate() }),
      'dsh-better-sidebar: side card preference watch')
  })

  // ── JSON API ────────────────────────────────────────────────────────────
  const api = buildApi(ctx, ptyManager, agentPtyRegistry, resolved, terminalShell, () => settingsFace)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/sidebar/api/') ? pathname.slice('/sidebar/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new SidebarError('not-found', 'unknown sidebar API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = api[method]
        if (handler === undefined) {
          throw new SidebarError('not-found', `unknown sidebar API method "${method}"`, 404)
        }
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-better-sidebar: /sidebar/api routes')

  // ── Raw upload route ───────────────────────────────────────────────────
  // One request writes one file without JSON/base64 inflation. Folder uploads
  // send each file with a relativePath, preserving the selected directory
  // tree. Bytes stream to a temp sibling and are renamed into place, so a
  // failed or oversized upload never leaves a partial file (see
  // fs-operations.ts for the containment and shape rules).
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/sidebar/upload',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sessionId = url.searchParams.get('sessionId')
        const dir = url.searchParams.get('dir')
        const relativePath = url.searchParams.get('relativePath')
        if (sessionId === null || dir === null || relativePath === null || relativePath.trim() === '') {
          throw new SidebarError('bad-request', 'sessionId, dir, and relativePath are required')
        }
        const cwd = sessionCwdOf(ctx, sessionId, url.searchParams.get('cwd') ?? undefined)
        const { path, size } = await writeWorkspaceUpload({
          cwd,
          dir,
          relativePath,
          chunks: req,
          limit: resolved.uploadLimit,
        })
        writeOk(res, { path, size })
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-better-sidebar: /sidebar/upload route')

  // ── Lazy chunk route (client bundle splits) ─────────────────────────────
  // Serves the client half's split bundles (lib/client-<name>.js) so the
  // heavy preview/terminal libraries load on first use, not at page start
  // (see bundle-route.ts / src/client/chunk-loader.ts).
  ctx.effect(() => registerBundleRoute(ctx, fence), 'dsh-better-sidebar: /sidebar/bundle chunk route')

  // ── Media route (images for the editor) ─────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/file',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sessionId = url.searchParams.get('sessionId')
        const raw = url.searchParams.get('path')
        if (sessionId === null || raw === null) throw new SidebarError('bad-request', 'sessionId and path are required')
        const cwd = sessionCwdOf(ctx, sessionId, url.searchParams.get('cwd') ?? undefined)
        const path = await ensureWorkspacePath(cwd, raw)
        const info = await stat(path)
        if (!info.isFile() || info.size > resolved.mediaLimit) {
          throw new SidebarError('fs-error', 'not a file or too large', 400)
        }
        const type = mediaTypeForPath(path)
        const body = await readFile(path)
        // Raw bytes either way (binary-safe); ?download=1 switches the
        // disposition so the browser saves the file instead of showing it.
        const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache' }
        if (url.searchParams.get('download') === '1') {
          headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`
        }
        res.writeHead(200, headers)
        res.end(body)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-better-sidebar: /sidebar/file media route')

  // ── HTML preview route (sandboxed HTML + its relative assets) ───────────
  // Serves files under the session cwd for the built-in HTML previewer. The
  // URL is path-encoded (see html-route.ts) so the previewed page's relative
  // assets (./style.css, img/x.png) resolve back into this route with the
  // session scope intact — a query-encoded URL would drop the scope when the
  // browser resolves relatives. Every response carries the CSP `sandbox`
  // directive: inside the editor's iframe the sandbox ATTRIBUTE is the
  // boundary, this header is defense-in-depth so even a top-level load of
  // the URL (e.g. a popup opened by a previewed page) stays in an opaque
  // origin with no same-origin access to the GUI.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidebar/html',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const decoded = decodeHtmlUrl(url.pathname)
        if (!decoded.ok) {
          writeError(res, new SidebarError('bad-request', decoded.message, decoded.status))
          return
        }
        const { sessionId, path } = decoded.ref
        // The session's authoritative cwd (client cwd cannot ride in the URL
        // — the path encoding has no query; a detached first request falls
        // back to the process cwd and is normally refused by the workspace
        // real-path guard, with the same semantics as the media route's
        // fallback.
        const cwd = sessionCwdOf(ctx, sessionId)
        const absolute = await ensureWorkspacePath(cwd, path)
        const info = await stat(absolute)
        if (!info.isFile() || info.size > resolved.mediaLimit) {
          throw new SidebarError('fs-error', 'not a file or too large', 400)
        }
        const type = mediaTypeForPath(absolute)
        const body = await readFile(absolute)
        res.writeHead(200, {
          'content-type': type === 'text/html' ? 'text/html; charset=utf-8' : type,
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          // The sandbox directive (no allow-same-origin → opaque origin) is
          // the previewer's security boundary even for top-level loads;
          // object-src 'none' blocks plugin embeds.
          'content-security-policy': "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'",
        })
        res.end(body)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-better-sidebar: /sidebar/html preview route')

  // ── Terminal WebSocket ──────────────────────────────────────────────────
  // One upgrade endpoint serves both UI-tab terminals (?tab=...) and
  // agent-owned terminals (?uuid=...). The two paths attach to different
  // registries but share the wire protocol: input frames are raw text,
  // resize frames are JSON `{type:'resize',cols,rows}`, and a close frame
  // `{type:'close'}` releases the underlying pty (immediate for agent
  // terminals, scheduled-0 for UI tabs which keep the same reconnect grace
  // contract the host has always had).
  const wss = new WebSocketServer({ noServer: true })
  let pluginDisposing = false
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/sidebar/ws/terminal',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      // The structural request/socket/head faces satisfy the shared fence;
      // the `ws` package wants the real Node types — cast at this boundary.
      wss.handleUpgrade(req as unknown as IncomingMessage, socket as unknown as Duplex, head as Buffer, (ws) => {
        void attachTerminal(
          ctx, ptyManager, agentPtyRegistry, ws, req, resolved,
          () => shellOverridesOf(() => settingsFace),
          () => pluginDisposing,
        )
      })
    },
  }), 'dsh-better-sidebar: terminal WebSocket')

  // ── Agent terminals push WebSocket ──────────────────────────────────────
  // Pushes the live list of agent terminals for one session to the sidebar
  // view: the client mirrors the list into tabs (id `agent:<uuid>`,
  // title from the agent's `terminal_create` call). The host fires on every
  // create / close / exit; the client reconciles by adding tabs for new
  // uuids and dropping tabs whose uuids disappeared (the user closing a tab
  // sends `{type:'close'}` on the terminal WS, which kills the pty, which
  // fires a change here, which converges the view).
  const agentListWss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/sidebar/ws/agent-terminals',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      agentListWss.handleUpgrade(req as unknown as IncomingMessage, socket as unknown as Duplex, head as Buffer, (ws) => {
        void attachAgentList(agentPtyRegistry, ws, req)
      })
    },
  }), 'dsh-better-sidebar: agent-terminals push WebSocket')

  // ── Agent opens push WebSocket ─────────────────────────────────────────
  // Pushes `sidebar_open` requests for one session to the sidebar view: the
  // host queues each request in the registry (consume-on-send), so a
  // connected view applies it immediately and a disconnected one gets the
  // replay when it attaches. The client mirrors each request into an
  // editor / folder-window / browser tab open.
  const agentOpenWss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/sidebar/ws/agent-opens',
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.destroy()
        return
      }
      agentOpenWss.handleUpgrade(req as unknown as IncomingMessage, socket as unknown as Duplex, head as Buffer, (ws) => {
        void attachAgentOpen(agentOpenRegistry, ws, req)
      })
    },
  }), 'dsh-better-sidebar: agent-opens push WebSocket')

  ctx.effect(() => () => {
    pluginDisposing = true
    toolsDisposers?.()
    openToolsDisposers?.()
    ptyManager?.disposeAll()
    agentPtyRegistry?.disposeAll()
    agentOpenRegistry.dispose()
    wss.close()
    agentListWss.close()
    agentOpenWss.close()
  }, 'dsh-better-sidebar: teardown')
}

/** Push queued `sidebar_open` requests for one session to a connected view. */
async function attachAgentOpen(
  registry: AgentOpenRegistry,
  ws: WebSocket,
  req: SidebarHttpRequest,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null) {
      ws.close(1008, 'sessionId is required')
      return
    }
    const send = (request: AgentOpenRequest): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(request))
      }
    }
    // Attach replays the queued (undelivered) requests for this session; the
    // disposer detaches the view on socket close/error so later opens queue
    // instead of accumulating on a dead socket.
    const unsubscribe = registry.attach(sessionId, send)
    ws.on('close', () => { unsubscribe() })
    ws.on('error', () => { unsubscribe() })
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error))
  }
}

/** Push the live agent-terminal list for one session to a connected sidebar view. */
async function attachAgentList(
  registry: AgentPtyRegistry | null,
  ws: WebSocket,
  req: SidebarHttpRequest,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null) {
      ws.close(1008, 'sessionId is required')
      return
    }
    const send = (): void => {
      if (ws.readyState === WebSocket.OPEN) {
        // Degraded mode (node-pty unavailable): no agent terminal can exist,
        // so the honest push is the empty list.
        ws.send(JSON.stringify(registry?.list(sessionId) ?? []))
      }
    }
    send()
    const unsubscribe = registry?.subscribe(send)
    ws.on('close', () => { unsubscribe?.() })
    ws.on('error', () => { unsubscribe?.() })
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error))
  }
}
