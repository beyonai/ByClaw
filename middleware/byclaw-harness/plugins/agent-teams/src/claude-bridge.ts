/**
 * Claude Code external-process bridge for AgentTeams members.
 *
 * A member with `runtime: 'claude-code'` is not a Harness in-process
 * continuable subagent: instead the plugin shells out to the locally
 * installed `claude` CLI in non-interactive (`-p`) mode, keeps the Claude
 * session id per member for context continuity (`--resume <sid>`), and
 * persists the task transcript in the team state directory.
 *
 * The `claude` executable and its provider configuration (cc-switch) come
 * from the ambient user environment; no API key is configured here.
 *
 * @module dsh-agent-teams/claude-bridge
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { sanitizeKey } from './state.ts'

const execFileAsync = promisify(execFile)

/** Default time budget for one claude turn (ms). */
const DEFAULT_TURN_TIMEOUT_MS = 120_000

/** Per-member claude session record persisted under the team state dir. */
export interface ClaudeMemberState {
  /** Claude session id returned by the CLI, stable across resumes. */
  sessionId?: string
  /** Monotonic turn counter for this member. */
  turn: number
  /** Last task id delivered, for diagnostics. */
  lastTaskId?: string
}

export interface ClaudeTurnResult {
  /** Final assistant text. */
  result: string
  /** Claude session id (stable across resumes). */
  sessionId?: string
  /** Terminal reason from the CLI, e.g. `completed`. */
  terminalReason?: string
  /** Whether the CLI reported an error. */
  isError: boolean
}

/** Require a resolved path to remain below its owned directory. */
function requireContainedPath(root: string, target: string): void {
  const pathFromRoot = relative(root, target)
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`AgentTeams Claude state path escapes its inbox: ${JSON.stringify(target)}`)
  }
}

/** Locate the claude state file for one member below its team's inbox. */
export function claudeMemberStatePath(stateDir: string, teamId: string, memberName: string): string {
  const stateRoot = resolve(stateDir)
  const teamDir = resolve(stateRoot, sanitizeKey(teamId))
  const inboxDir = resolve(teamDir, 'inbox')
  const path = resolve(inboxDir, `claude-${sanitizeKey(memberName)}.json`)
  requireContainedPath(stateRoot, inboxDir)
  requireContainedPath(inboxDir, path)
  return path
}

const CLAUDE_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const

/** Build the Claude child environment from the runtime and authentication inputs it needs. */
export function claudeProcessEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of CLAUDE_ENV_KEYS) {
    const value = source[key]
    if (value !== undefined) environment[key] = value
  }
  return environment
}

/** Read (or initialize) the per-member claude session record. */
export function readClaudeMemberState(
  stateDir: string,
  teamId: string,
  memberName: string,
): ClaudeMemberState {
  const path = claudeMemberStatePath(stateDir, teamId, memberName)
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as ClaudeMemberState
    } catch {
      // Corrupt record: start fresh rather than failing the member.
    }
  }
  return { turn: 0 }
}

/** Persist the per-member claude session record. */
export function writeClaudeMemberState(
  stateDir: string,
  teamId: string,
  memberName: string,
  state: ClaudeMemberState,
): void {
  const path = claudeMemberStatePath(stateDir, teamId, memberName)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2))
}

/**
 * Run one non-interactive claude turn, resuming the member's session when one
 * exists. Returns structured results or throws on hard CLI failure.
 */
export async function runClaudeTurn(
  opts: {
    prompt: string
    cwd: string
    stateDir: string
    teamId: string
    memberName: string
    timeoutMs?: number
    claudeBin?: string
  },
): Promise<ClaudeTurnResult> {
  const state = readClaudeMemberState(opts.stateDir, opts.teamId, opts.memberName)
  const bin = opts.claudeBin ?? 'claude'
  const args = ['-p', opts.prompt, '--output-format', 'json']
  if (state.sessionId !== undefined) {
    args.push('--resume', state.sessionId)
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: claudeProcessEnvironment(),
    })
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>
    } catch {
      // CLI returned non-JSON (e.g. auth prompt); treat as failure.
      return {
        result: String(stdout).slice(0, 2000),
        isError: true,
        terminalReason: 'non-json-output',
      }
    }
    const sessionId = typeof parsed['session_id'] === 'string' ? parsed['session_id'] : undefined
    const result = typeof parsed['result'] === 'string' ? parsed['result'] : ''
    const isError = parsed['is_error'] === true || parsed['subtype'] === 'error'
    const terminalReason =
      typeof parsed['terminal_reason'] === 'string' ? parsed['terminal_reason'] : undefined
    if (sessionId !== undefined) state.sessionId = sessionId
    state.turn += 1
    writeClaudeMemberState(opts.stateDir, opts.teamId, opts.memberName, state)
    return { result, sessionId, terminalReason, isError }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Timeout / ENOENT / non-zero exit: surface a synthetic error result.
    return {
      result: `claude CLI 调用失败: ${message}`,
      isError: true,
      terminalReason: 'cli-error',
    }
  }
}
