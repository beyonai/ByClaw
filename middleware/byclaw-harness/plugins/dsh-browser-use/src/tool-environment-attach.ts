/**
 * The tool sandbox (B) runs the same supervised browser as the user's own
 * sandbox did: one Chromium with the byCLI extension, one profile, one desktop.
 * The bridge A's `browser` tool runs on B attaches to that browser instead of
 * starting a second one; these are the pieces it needs for that.
 */
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'

/** The supervisor's broker socket and the secret its browserd accepts. */
export interface AttachTarget {
  socketPath: string
  secret: string
}

/**
 * Where to attach, or `undefined` when no supervisor serves this sandbox (the
 * bridge then starts a browser of its own). The supervisor leaves its secret in
 * a file only the browser user can read, next to the socket by default.
 */
export async function attachTarget(env: NodeJS.ProcessEnv): Promise<AttachTarget | undefined> {
  const socketPath = env.BYCLAW_BROWSER_SOCKET
  if (!socketPath) return undefined
  try {
    if (!(await stat(socketPath)).isSocket()) return undefined
  } catch {
    return undefined
  }
  const secretFile = env.BYCLAW_BROWSER_SECRET_FILE || join(dirname(socketPath), 'broker.secret')
  let secret: string
  try {
    secret = (await readFile(secretFile, 'utf8')).trim()
  } catch {
    secret = ''
  }
  if (!secret || /[\r\n\0]/.test(secret)) throw new Error('browser-attach-secret-unavailable')
  return { socketPath, secret }
}

/**
 * Start the supervisor's browser if it is not running yet: a connection to its
 * listener triggers on-demand startup (as the byCLI wrapper does), and
 * `<socket>.activated` appears once Chromium, byCLI and the desktop are up.
 */
export async function activateBrowser(socketPath: string, timeoutMs: number): Promise<void> {
  const activated = `${socketPath}.activated`
  if (existsSync(activated)) return
  await new Promise<void>(resolve => {
    const trigger = createConnection(socketPath)
    trigger.once('connect', () => { trigger.end(); resolve() })
    trigger.once('error', () => { resolve() })
  })
  const deadline = performance.now() + timeoutMs
  while (!existsSync(activated)) {
    if (performance.now() >= deadline || !existsSync(socketPath)) throw new Error('browser-activation-failed')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * A's broker frames carry the secret A generated for this bridge; the
 * supervisor's browserd accepts its own. Check the first, send the second.
 */
export function swapSecret(from: string, to: string): (frame: Record<string, unknown>) => Record<string, unknown> {
  return frame => {
    if (frame.secret !== from) throw new Error('browser-remote-invalid-secret')
    return { ...frame, secret: to }
  }
}
