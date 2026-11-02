/**
 * Per-agent collection of the file paths tool calls touched: a turn-scoped
 * write set for the turn-end sentinel, and session-cumulative write and read
 * sets for the pre-step spec index.
 *
 * The tool names and the `file_path` argument shape are a stated coupling to
 * the harness's first-party fs tools, the same coupling
 * `@zhchxiao123/dsh-devflow-iron-rules` accepts for its dirty gate; the whole
 * name list lives in this module so a harness bump has one place to check.
 * Reads through `bash` (`cat`, pipes) carry no extractable path and are
 * explicitly outside the promise.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/src/collect
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { TurnTouches } from './types.ts'

/** First-party tools whose success means the turn landed a file change. */
const WRITE_TOOLS = new Set(['write', 'edit'])

/**
 * First-party tools whose success returns a file's own contents. `read_image`
 * is deliberately absent: it registers only when attachments are mounted, and
 * an image is almost never an anchored source — add it when a consumer shows
 * a real need. `glob`/`grep` are discovery tools; the read intent they serve
 * lands in a later `read`, and counting them would flood the touch set.
 */
const READ_TOOLS = new Set(['read'])

/**
 * Touch state per agent, keyed weakly so a departed agent frees its sets.
 * In-memory on purpose: what a session touched is a session-scoped fact, and
 * a restarted process correctly starts empty.
 */
export type TouchState = WeakMap<Agent, TurnTouches>

/**
 * Recency window of the session-cumulative sets, per set. A fixed constant
 * rather than a Config field because the sets feed a prompt aid, not an
 * audit: the spec index only needs "what has this session been working on
 * lately", its visible size is governed by the byte cap already, and 64
 * files is far beyond any focused session's working set while bounding the
 * memory of a long one.
 */
export const SESSION_TOUCH_LIMIT = 64

/**
 * Record one path into a session-cumulative set, most-recent-last.
 * Re-touching moves the path to the newest end; over the window the oldest
 * path is evicted — insertion order is the recency order a `Set` keeps.
 */
function touchCumulative(set: Set<string>, path: string): void {
  set.delete(path)
  set.add(path)
  if (set.size <= SESSION_TOUCH_LIMIT) return
  const oldest = set.values().next().value
  /* v8 ignore next -- a set larger than the limit always has a first value */
  if (oldest !== undefined) set.delete(oldest)
}

/**
 * Extract the `file_path` argument the first-party fs tools carry.
 * `arguments` is `unknown` at this boundary, so every step is checked rather
 * than trusted; the tools themselves only require a non-blank string.
 * @param exec - the finished tool execution.
 * @returns the raw path, or `undefined` when the shape does not hold.
 */
export function touchedFilePath(exec: Readonly<ToolExecution>): string | undefined {
  const args: unknown = exec.arguments
  if (typeof args !== 'object' || args === null) return undefined
  const filePath = (args as { file_path?: unknown }).file_path
  if (typeof filePath !== 'string' || filePath.trim().length === 0) return undefined
  return filePath
}

/**
 * Record one finished tool call into its agent's touch sets.
 *
 * An agent whose session carries no working directory is skipped entirely: a
 * relative path has no base to resolve against there, and the turn-end
 * evaluation would have no workspace to compare anchors in either, so a
 * partial collection would only feed a comparison that cannot happen.
 * @param state - the per-agent touch state.
 * @param exec - the finished execution.
 * @param result - its outcome; an errored call touched nothing.
 */
export function recordTouch(state: TouchState, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
  if (result.isError || exec.agent === undefined) return
  const isWrite = WRITE_TOOLS.has(exec.name)
  if (!isWrite && !READ_TOOLS.has(exec.name)) return
  const cwd = exec.agent.session.header.cwd
  if (cwd === undefined) return
  const filePath = touchedFilePath(exec)
  if (filePath === undefined) return
  let touches = state.get(exec.agent)
  if (touches === undefined) {
    touches = { written: new Set(), read: new Set(), sessionWritten: new Set() }
    state.set(exec.agent, touches)
  }
  // resolve() normalizes an absolute path and resolves a relative one against
  // the session cwd — the same base the fs tools' own backend resolves with.
  const path = resolve(cwd, filePath)
  if (isWrite) {
    // Both write sets: the turn-scoped one the sentinel clears, and the
    // session-cumulative one the spec index reads across turns.
    touches.written.add(path)
    touchCumulative(touches.sessionWritten, path)
  } else {
    touchCumulative(touches.read, path)
  }
}

/**
 * Mount the collection listener.
 * @param ctx - the context the sentinel is mounted on.
 * @param state - the touch state the turn-end half reads.
 */
export function applyCollect(ctx: Context, state: TouchState): void {
  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    recordTouch(state, exec, result)
  })
}
