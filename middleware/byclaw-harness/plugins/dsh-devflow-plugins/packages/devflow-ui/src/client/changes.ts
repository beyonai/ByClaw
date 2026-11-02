/**
 * The board's live edge: a downlink socket to the plugin's own push endpoint,
 * served by `@zhchxiao123/dsh-devflow-web` beside the read face. A frame says
 * only that something in this host's devflow moved; the board answers it by
 * refetching, so a frame can never become a second truth racing what the list
 * renders.
 *
 * The socket owns its own recovery. A dropped connection reopens on a fixed
 * delay, and every open — the first and every reopen — refetches, because a
 * board that went quiet has no way to know what it missed while it was down.
 */

import type { DevflowChangeFrame } from '@zhchxiao123/dsh-devflow-web/client'

/** Upgrade path of the push endpoint; the host half owns the same literal. */
const CHANGE_STREAM_PATH = '/devflow/ws'

/**
 * Delay before the first reopen of a dropped socket, and the ceiling the
 * backoff doubles toward. Not deployment choices: the client half has no
 * config plane, and these are the board's liveness floor after a reload or a
 * host restart, not resources a deployment tunes.
 */
const REOPEN_DELAY_MS = 2_000
const MAX_REOPEN_DELAY_MS = 30_000

/** The frame types the endpoint sends; anything else is ignored. */
const FRAME_TYPES: readonly DevflowChangeFrame['type'][] = [
  'devflow/card-created',
  'devflow/stage-changed',
  'devflow/card-archived',
  'devflow/card-restored',
]

/**
 * Follow the host's devflow changes until the returned disposer runs.
 * @param onChange - called on every open and every change frame; refetches the boards this surface shows.
 * @returns the disposer closing the socket and cancelling any pending reopen.
 */
export function watchChanges(onChange: () => void): () => void {
  let disposed = false
  let socket: WebSocket | undefined
  let reopen: ReturnType<typeof setTimeout> | undefined
  // A host that stays down is retried ever more slowly; one that comes back
  // resets the wait, so a single blip costs the floor and not the ceiling.
  let delay = REOPEN_DELAY_MS
  const connect = (): void => {
    const url = new URL(CHANGE_STREAM_PATH, globalThis.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const opened = new WebSocket(url)
    socket = opened
    opened.addEventListener('open', () => {
      delay = REOPEN_DELAY_MS
      onChange()
    })
    opened.addEventListener('message', (event: MessageEvent) => {
      const frame = decodeFrame(event.data)
      if (frame !== undefined) onChange()
    })
    opened.addEventListener('close', () => {
      if (disposed) return
      reopen = setTimeout(connect, delay)
      delay = Math.min(delay * 2, MAX_REOPEN_DELAY_MS)
    }, { once: true })
  }
  connect()
  return () => {
    disposed = true
    clearTimeout(reopen)
    socket?.close()
  }
}

/** One frame off the wire, or undefined when it is not one this client knows. */
function decodeFrame(data: unknown): DevflowChangeFrame | undefined {
  if (typeof data !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    // A frame this client cannot parse is dropped; the next one still arrives.
    return undefined
  }
  const type = (parsed as { type?: unknown } | null)?.type
  return FRAME_TYPES.some(known => known === type) ? { type: type as DevflowChangeFrame['type'] } : undefined
}
