/** Internal terminal WebSocket attachment and worktree-target resolution. */
import { WebSocket } from 'ws'
import type { Context, SidebarHttpRequest } from './context-types.ts'
import type { ResolvedSidebarConfig } from './config.ts'
import { requireAbsolute } from './fs-tree.ts'
import { resolveGitTarget, type GitTarget } from './git-workspaces.ts'
import type { PtyManager } from './pty-manager.ts'
import { AgentPtyRegistry, clampDims, type AgentTerminalHandle } from './agent-pty.ts'
import { PTY_DEPS_MISSING } from './pty-deps.ts'
import { sessionCwdOf } from './session-cwd.ts'
import { SidebarError } from './wire.ts'

interface ResolvedTerminalWorkingDirectory {
  cwd: string
  authoritativeSessionCwd?: string
}

export interface TerminalShellOverrides {
  shell?: string
  shellArgs?: string[]
}

/**
 * Resolve a UI terminal spawn directory for host-internal tests and attachment.
 * @param ctx - live host services containing the authoritative session.
 * @param sessionId - session that owns the terminal tab.
 * @param clientCwd - legacy cwd used only by normal terminal tabs.
 * @param target - optional opaque repository/worktree IDs.
 * @returns the validated directory for PTY creation.
 */
export async function resolveTerminalWorkingDirectory(
  ctx: Context,
  sessionId: string,
  clientCwd?: string,
  target?: GitTarget,
): Promise<string> {
  return (await resolveTerminalWorkingDirectoryRequest(ctx, sessionId, clientCwd, target)).cwd
}

async function resolveTerminalWorkingDirectoryRequest(
  ctx: Context,
  sessionId: string,
  clientCwd?: string,
  target?: GitTarget,
): Promise<ResolvedTerminalWorkingDirectory> {
  if (target === undefined) return { cwd: sessionCwdOf(ctx, sessionId, clientCwd) }
  if (clientCwd !== undefined) {
    throw new SidebarError('bad-request', 'a targeted terminal must not include a client cwd')
  }
  const authoritativeCwd = ctx.sessions.get(sessionId)?.header.cwd
  if (authoritativeCwd === undefined || authoritativeCwd === '') {
    throw new SidebarError('bad-request', `session "${sessionId}" has no authoritative working directory`)
  }
  const absoluteSessionCwd = requireAbsolute(authoritativeCwd)
  const resolvedTarget = await resolveGitTarget(absoluteSessionCwd, target, { refresh: true })
  return { cwd: resolvedTarget.worktree.path, authoritativeSessionCwd: absoluteSessionCwd }
}

/**
 * Wire one terminal socket to its pty. This is an internal host route helper,
 * not part of the package-root plugin API.
 * @param ctx - live host services.
 * @param ptyManager - UI terminal registry, or null in degraded mode.
 * @param agentPtyRegistry - model-owned terminal registry, or null in degraded mode.
 * @param ws - accepted terminal WebSocket.
 * @param req - upgrade request containing one terminal address.
 * @param resolved - validated plugin configuration.
 * @param getShellOverrides - current settings-derived shell overrides.
 * @param isPluginDisposing - teardown guard sampled immediately before PTY creation.
 * @returns when the socket is attached or rejected.
 */
export async function attachTerminal(
  ctx: Context,
  ptyManager: PtyManager | null,
  agentPtyRegistry: AgentPtyRegistry | null,
  ws: WebSocket,
  req: SidebarHttpRequest,
  resolved: ResolvedSidebarConfig,
  getShellOverrides: () => TerminalShellOverrides,
  isPluginDisposing: () => boolean = () => false,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const uuid = url.searchParams.get('uuid')
    if (uuid !== null) {
      if (agentPtyRegistry === null) {
        ws.close(1011, `agent terminal "${uuid}" not found`)
        return
      }
      const handle = agentPtyRegistry.get(uuid)
      if (handle === undefined) {
        ws.close(1011, `agent terminal "${uuid}" not found`)
        return
      }
      pumpAgentTerminal(agentPtyRegistry, handle, ws)
      return
    }
    const sessionId = url.searchParams.get('sessionId')
    const tabId = url.searchParams.get('tab')
    if (sessionId === null || tabId === null) {
      ws.close(1008, 'either ?uuid or ?sessionId+?tab are required')
      return
    }
    if (ptyManager === null) {
      ws.close(1011, PTY_DEPS_MISSING)
      return
    }
    const clientCwd = url.searchParams.get('cwd') ?? undefined
    const repositoryId = url.searchParams.get('repositoryId')
    const worktreeId = url.searchParams.get('worktreeId')
    if ((repositoryId === null) !== (worktreeId === null) || repositoryId === '' || worktreeId === '') {
      ws.close(1008, 'repositoryId and worktreeId must be provided together')
      return
    }
    const target = repositoryId === null || worktreeId === null
      ? undefined
      : { repositoryId, worktreeId }
    let disconnectedWhileResolving = false
    const markPendingDisconnect = (): void => { disconnectedWhileResolving = true }
    ws.once('close', markPendingDisconnect)
    const workingDirectory = await resolveTerminalWorkingDirectoryRequest(ctx, sessionId, clientCwd, target)
    if (disconnectedWhileResolving || ws.readyState !== WebSocket.OPEN || isPluginDisposing()) return
    if (workingDirectory.authoritativeSessionCwd !== undefined) {
      const currentSessionCwd = ctx.sessions.get(sessionId)?.header.cwd
      if (currentSessionCwd === undefined
        || requireAbsolute(currentSessionCwd) !== workingDirectory.authoritativeSessionCwd) {
        throw new SidebarError(
          'bad-request',
          `session "${sessionId}" working directory changed during terminal target resolution`,
        )
      }
    }
    ws.off('close', markPendingDisconnect)
    const overrides = getShellOverrides()
    const handle = ptyManager.open(
      sessionId, tabId, workingDirectory.cwd, 80, 24, overrides.shell, overrides.shellArgs,
    )
    if (handle.transcript !== '') ws.send(handle.transcript)
    const onData = (data: string): void => {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) ws.send(data)
    }
    const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
      onData(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
    }
    const dataSub = handle.pty.onData(onData)
    const exitSub = handle.pty.onExit(onExit)
    ws.on('message', (data) => {
      const text = data.toString('utf8')
      let control: { type?: unknown; cols?: unknown; rows?: unknown } | null = null
      try {
        const parsed: unknown = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object') {
          control = parsed as { type?: unknown; cols?: unknown; rows?: unknown }
        }
      } catch {
        // Not JSON: terminal input.
      }
      if (control !== null && control.type === 'close') {
        ptyManager.scheduleClose(handle.key, 0)
        return
      }
      if (control !== null && control.type === 'park') {
        ptyManager.park(handle.key)
        return
      }
      if (handle.exited) return
      if (
        control !== null
        && control.type === 'resize'
        && typeof control.cols === 'number' && typeof control.rows === 'number'
      ) {
        const dims = clampDims(control.cols, control.rows)
        handle.pty.resize(dims.cols, dims.rows)
      } else {
        handle.pty.write(text)
      }
    })
    ws.on('close', () => {
      dataSub.dispose()
      exitSub.dispose()
      if (!ptyManager.isParked(handle.key)) {
        ptyManager.scheduleClose(handle.key, resolved.reconnectGraceMs)
      }
    })
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error))
  }
}

function pumpAgentTerminal(
  registry: AgentPtyRegistry,
  handle: AgentTerminalHandle,
  ws: WebSocket,
): void {
  if (handle.transcript !== '') ws.send(handle.transcript)
  const onData = (data: string): void => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) ws.send(data)
  }
  const onExit = ({ exitCode }: { exitCode: number; signal?: number }): void => {
    onData(`\r\n[process exited with code ${String(exitCode)}]\r\n`)
  }
  const dataSub = handle.pty.onData(onData)
  const exitSub = handle.pty.onExit(onExit)
  ws.on('message', (data) => {
    if (handle.exited) return
    const text = data.toString('utf8')
    let control: { type?: unknown; cols?: unknown; rows?: unknown } | null = null
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') {
        control = parsed as { type?: unknown; cols?: unknown; rows?: unknown }
      }
    } catch {
      // Not JSON: terminal input.
    }
    if (control !== null && control.type === 'close') {
      registry.close(handle.uuid)
      return
    }
    if (
      control !== null
      && control.type === 'resize'
      && typeof control.cols === 'number' && typeof control.rows === 'number'
    ) {
      const dims = clampDims(control.cols, control.rows)
      handle.pty.resize(dims.cols, dims.rows)
    } else if (control === null) {
      handle.pty.write(text)
    }
  })
  ws.on('close', () => {
    dataSub.dispose()
    exitSub.dispose()
  })
}
