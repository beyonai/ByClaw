import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activateBrowser, attachTarget, swapSecret } from '../src/tool-environment-attach.js'

const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function supervisorSocket(onConnect: (socketPath: string) => void = () => {}): Promise<string> {
  const root = await mkdtemp('/tmp/bta-')
  roots.push(root)
  const socketPath = join(root, 'browserd.sock')
  const server = createServer(connection => { connection.destroy(); onConnect(socketPath) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
  return socketPath
}

describe('attachTarget', () => {
  it('attaches to the supervisor\'s browser when its socket and secret file are there', async () => {
    const socketPath = await supervisorSocket()
    await writeFile(join(socketPath, '..', 'broker.secret'), 'supervisor-secret')
    expect(await attachTarget({ BYCLAW_BROWSER_SOCKET: socketPath })).toEqual({ socketPath, secret: 'supervisor-secret' })
  })

  it('starts its own browser when no supervisor serves this sandbox', async () => {
    expect(await attachTarget({})).toBeUndefined()
    // The image names the socket even where no supervisor runs (an older tool sandbox).
    expect(await attachTarget({ BYCLAW_BROWSER_SOCKET: '/nonexistent/browserd.sock' })).toBeUndefined()
  })

  it('refuses a supervisor whose secret it cannot read rather than starting a second browser', async () => {
    const socketPath = await supervisorSocket()
    await expect(attachTarget({ BYCLAW_BROWSER_SOCKET: socketPath })).rejects.toThrow('browser-attach-secret-unavailable')
  })
})

describe('activateBrowser', () => {
  it('triggers on-demand startup and waits until the supervisor reports it active', async () => {
    const socketPath = await supervisorSocket(path => { setTimeout(() => { void writeFile(`${path}.activated`, '') }, 50) })
    await activateBrowser(socketPath, 5_000)
    expect(existsSync(`${socketPath}.activated`)).toBe(true)
  })

  it('does not connect when the browser is already active', async () => {
    let connections = 0
    const socketPath = await supervisorSocket(() => { connections++ })
    await writeFile(`${socketPath}.activated`, '')
    await activateBrowser(socketPath, 5_000)
    expect(connections).toBe(0)
  })

  it('fails when the browser does not come up in time', async () => {
    const socketPath = await supervisorSocket()
    await expect(activateBrowser(socketPath, 200)).rejects.toThrow('browser-activation-failed')
  })
})

describe('swapSecret', () => {
  it('replaces the runtime\'s secret with the supervisor\'s and rejects any other', () => {
    const swap = swapSecret('from-runtime', 'from-supervisor')
    expect(swap({ type: 'open', requestId: 'r1', secret: 'from-runtime', leaseId: 'l' }))
      .toEqual({ type: 'open', requestId: 'r1', secret: 'from-supervisor', leaseId: 'l' })
    expect(() => swap({ type: 'open', requestId: 'r2', secret: 'guess' })).toThrow('browser-remote-invalid-secret')
    expect(() => swap({ type: 'open', requestId: 'r3' })).toThrow('browser-remote-invalid-secret')
  })
})

describe('the bridge on a tool sandbox with a supervised browser', () => {
  it('forwards A\'s frames to the supervisor\'s browserd with its secret and returns the replies', async () => {
    const received: Array<Record<string, unknown>> = []
    // Stands in for the supervisor's browserd: answers each request on the same socket.
    const socketPath = await supervisorSocket()
    servers.pop()!.close()
    await rm(socketPath, { force: true })
    const broker = createServer(connection => {
      let buffer = ''
      connection.on('data', chunk => {
        buffer += chunk.toString()
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const frame = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>
          buffer = buffer.slice(newline + 1)
          received.push(frame)
          connection.write(`${JSON.stringify({ type: 'result', requestId: frame.requestId, ok: true })}\n`)
        }
      })
    })
    servers.push(broker)
    await new Promise<void>(resolve => broker.listen(socketPath, resolve))
    await writeFile(join(socketPath, '..', 'broker.secret'), 'supervisor-secret-0123456789')
    await writeFile(`${socketPath}.activated`, '')
    const bridge = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/tool-environment-bridge.ts', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BYCLAW_BROWSER_SOCKET: socketPath },
    })
    try {
      const aSecret = 'a'.repeat(43)
      bridge.stdin.write(`${JSON.stringify({ id: 'bridge-test-0000001', secret: aSecret, goalEnabled: false, viewer: 'none', viewerPort: 8082, idleBrowserMs: 0, readinessTimeoutMs: 5000 })}\n`)
      bridge.stdin.write(`${JSON.stringify({ type: 'status', requestId: 'r1', secret: aSecret })}\n`)
      const reply = await new Promise<string>((resolve, reject) => {
        let out = ''
        let err = ''
        bridge.stdout.on('data', chunk => { out += chunk.toString(); if (out.includes('\n')) resolve(out) })
        bridge.stderr.on('data', chunk => { err += chunk.toString() })
        bridge.once('close', code => { reject(new Error(`bridge exited ${String(code)}: ${err}`)) })
      })
      expect(JSON.parse(reply)).toEqual({ type: 'result', requestId: 'r1', ok: true })
      expect(received).toEqual([{ type: 'status', requestId: 'r1', secret: 'supervisor-secret-0123456789' }])
      // A frame without A's secret ends the bridge instead of reaching browserd.
      bridge.stdin.write(`${JSON.stringify({ type: 'status', requestId: 'r2', secret: 'guess' })}\n`)
      expect(await new Promise(resolve => bridge.once('close', resolve))).toBe(0)
      expect(received).toHaveLength(1)
    } finally {
      bridge.kill('SIGKILL')
    }
  }, 20_000)
})
