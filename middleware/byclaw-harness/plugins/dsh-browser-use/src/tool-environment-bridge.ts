/** Executed only inside B via the SSH subprocess provider. Stdout is broker frames only. */
import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserBrokerClient } from './broker-client.js'
import { BROWSER_BROKER_MAX_FRAME_BYTES } from './protocol.js'
import { LocalBrowserdRuntime } from './owned-runtime.js'

async function bootstrap(): Promise<{ config: Record<string, unknown>; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => fail(), 10_000)
    const cleanup = () => { clearTimeout(timer); process.stdin.off('data', data); process.stdin.off('end', fail) }
    const fail = () => { cleanup(); reject(new Error('browser-remote-invalid-bootstrap')) }
    const data = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const newline = buffer.indexOf(10)
      if (newline < 0) { if (buffer.length > 8192) fail(); return }
      if (newline > 8192) { fail(); return }
      try {
        const config = JSON.parse(buffer.subarray(0, newline).toString()) as Record<string, unknown>
        process.stdin.pause(); cleanup(); resolve({ config, rest: buffer.subarray(newline + 1) })
      } catch { fail() }
    }
    process.stdin.on('data', data)
    process.stdin.once('end', fail)
  })
}

let runtime: LocalBrowserdRuntime | undefined
let stopping = false
let monitor: BrowserBrokerClient | undefined
let idleTimer: ReturnType<typeof setInterval> | undefined
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  clearInterval(idleTimer)
  monitor?.dispose()
  await runtime?.stop()
  process.exit(0)
}
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })
process.stdin.once('end', () => { void stop() })
try {
  const { config, rest } = await bootstrap()
  if (typeof config.id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(config.id)
    || typeof config.secret !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(config.secret)
    || typeof config.goalEnabled !== 'boolean'
    || !['none', 'novnc', 'shared-novnc'].includes(String(config.viewer))
    || !Number.isSafeInteger(config.viewerPort) || Number(config.viewerPort) < 1024 || Number(config.viewerPort) > 65535
    || !Number.isSafeInteger(config.idleBrowserMs) || Number(config.idleBrowserMs) < 0
    || !Number.isSafeInteger(config.readinessTimeoutMs) || Number(config.readinessTimeoutMs) < 1) {
    throw new Error('browser-remote-invalid-bootstrap')
  }
  // Only derived private paths; no host-side DSH directory or credentials are copied to B.
  const home = join(process.env.BYCLAW_TOOL_BROWSER_ROOT || '/by/.browser', config.id)
  const runtimeDir = join(home, 'r', randomUUID().slice(0, 8))
  runtime = new LocalBrowserdRuntime({
    runtimeDir, dshHome: home, secret: config.secret,
    // The byCLI extension connects to a sandbox-wide daemon. Native sessions must
    // not register with it or inherit its automation/goal environment.
    browserdEnv: { BYCLAW_BROWSER_EXTENSIONS: '', BYCLAW_BYCLI_ENABLED: 'false', BYCLAW_BROWSER_JEV_ENABLED: config.goalEnabled ? 'true' : 'false' },
    idleBrowserMs: Number(config.idleBrowserMs), readinessTimeoutMs: Number(config.readinessTimeoutMs),
    viewer: config.viewer as 'none' | 'novnc' | 'shared-novnc',
    viewerHost: '0.0.0.0', viewerPort: Number(config.viewerPort),
    displayRange: '200-299', rfbPortRange: '6201-6300', websockifyPortRange: '6401-6500',
  })
  await runtime.ensureStarted()
  if (stopping) { await runtime.stop(); process.exit(0) }
  const socket = createConnection(runtime.socketPath)
  socket.on('error', () => { void stop() })
  socket.once('close', () => { void stop() })
  process.stdout.on('error', () => { void stop() })
  socket.once('connect', () => {
    const pending = new Set<string>()
    const frames = (callback: (frame: { type?: string; requestId?: string }) => void) => {
      let buffer = Buffer.alloc(0)
      return (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        let newline: number
        while ((newline = buffer.indexOf(10)) >= 0) {
          if (newline > BROWSER_BROKER_MAX_FRAME_BYTES) { void stop(); return }
          try { callback(JSON.parse(buffer.subarray(0, newline).toString())) }
          catch { void stop(); return }
          buffer = buffer.subarray(newline + 1)
        }
        if (buffer.length > BROWSER_BROKER_MAX_FRAME_BYTES) void stop()
      }
    }
    const incoming = frames(frame => { if (frame.requestId && frame.type !== 'cancel') pending.add(frame.requestId) })
    process.stdin.on('data', incoming)
    socket.on('data', frames(frame => { if (frame.requestId) pending.delete(frame.requestId) }))
    if (rest.length) { incoming(rest); socket.write(rest) }
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
    process.stdin.resume()
    // An open SSH stream prevents the tool environment's idle pause. Release it
    // after the final native lease is gone; the next request creates a new daemon.
    // Live leases (including paused goals/manual takeover) are never idled out here.
    const idleMs = Number(config.idleBrowserMs)
    if (idleMs > 0) {
      monitor = new BrowserBrokerClient({ socketPath: runtime!.socketPath, secret: runtime!.secret })
      let lastActive = performance.now()
      let checking = false
      idleTimer = setInterval(() => {
        if (checking || stopping) return
        checking = true
        void monitor!.status().then(status => {
          if (status.contexts > 0 || pending.size > 0) lastActive = performance.now()
          else if (performance.now() - lastActive >= idleMs) void stop()
        }).catch(() => { void stop() }).finally(() => { checking = false })
      }, Math.min(idleMs, 1000))
      idleTimer.unref()
    }
  })
} catch {
  // No payload, command arguments or secret in the diagnostic channel.
  console.error('browser-remote-bridge-failed')
  await runtime?.stop()
  process.exit(1)
}
