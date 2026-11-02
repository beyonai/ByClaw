import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'

/** flock is shared with the managed byCLI launcher and released by the OS on crash. */
export async function acquireAutomationLock(path: string, signal: AbortSignal, waitMs: number): Promise<() => Promise<void>> {
  signal.throwIfAborted()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const child = spawn('python3', ['-c', `import fcntl,sys,os
f=open(sys.argv[1], 'a')
os.chmod(sys.argv[1], 0o600)
fcntl.flock(f, fcntl.LOCK_EX)
print('locked', flush=True)
sys.stdin.buffer.read()
`, path], { stdio: ['pipe', 'pipe', 'ignore'] })
  let released = false
  const release = async () => { if (!released) { released = true; child.stdin.end(); child.kill() } }
  await new Promise<void>((resolve, reject) => {
    const stop = () => { cleanup(); void release(); reject(new Error(signal.aborted ? 'browser-goal-cancelled' : 'browser-automation-busy')) }
    const timer = setTimeout(stop, waitMs)
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop) }
    child.once('error', () => { cleanup(); reject(new Error('browser-automation-lock-unavailable')) })
    child.once('exit', () => { cleanup(); reject(new Error('browser-automation-lock-exited')) })
    child.stdout.once('data', () => { cleanup(); resolve() })
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
  })
  if (signal.aborted) { await release(); signal.throwIfAborted() }
  return release
}
