import { Socket } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { SshConnection } from '@deepseek-ai/dsh-ssh'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolEnvBackend } from '../src/backend.ts'
import { ToolEnvConnection } from '../src/connection.ts'
import type { ToolEnvIdentity } from '../src/identity.ts'

describe('tool environment idle lifecycle', () => {
  let ctx: Context
  let ssh: ToolEnvConnection
  let inner: { request: ReturnType<typeof vi.fn>; connectStream: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }
  let backend: ToolEnvBackend
  let residual: () => Promise<ReadonlyArray<{ pid: number; comm: string }>>

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = new Context()
    backend = {
      ensure: vi.fn().mockResolvedValue({ hostName: 'tool-b', port: 22 }),
      pause: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    }
    const identity = { alias: 'test-b', writeClientConfig: vi.fn().mockResolvedValue(undefined) } as unknown as ToolEnvIdentity
    residual = async () => []
    ssh = new ToolEnvConnection(ctx, {
      ssh: {} as never,
      ptcLaunch: { kind: 'node-script', executable: 'node', bootstrapPath: '/helper.mjs' },
      idleMs: 100,
      busy: { residual: () => residual() },
    }, backend, identity)
    inner = {
      request: vi.fn().mockResolvedValue('done'),
      connectStream: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    }
    // Replace the network handshake only; exercise the real facade's operations and idle timers.
    const connector = ssh as unknown as { connect(): Promise<{ connection: SshConnection; fiber: { dispose(): void } }> }
    vi.spyOn(connector, 'connect').mockImplementation(async () => ({
      connection: { ...inner, ready: Promise.resolve({}) } as unknown as SshConnection,
      fiber: { dispose() {} },
    }))
  })

  afterEach(async () => {
    await (ssh as unknown as { close(): Promise<void> }).close()
    await ctx.fiber.dispose()
    vi.useRealTimers()
  })

  it('starts only on a remote operation, releases after idle and recreates on the next operation', async () => {
    await vi.advanceTimersByTimeAsync(500)
    expect(backend.ensure).not.toHaveBeenCalled()
    expect(backend.pause).not.toHaveBeenCalled()
    expect(await ssh.request('fs.readText', { path: '/by/result' }, z.string())).toBe('done')
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
    expect(ssh.connected).toBe(false)
    await ssh.request('fs.readText', { path: '/by/result' }, z.string())
    expect(backend.ensure).toHaveBeenCalledTimes(2)
    expect(ssh.connected).toBe(true)
  })

  it('does not release B while a command is in flight', async () => {
    const command = Promise.withResolvers<string>()
    inner.request.mockReturnValueOnce(command.promise)
    const request = ssh.request('spawn', { argv: ['bash'] }, z.string())
    await vi.advanceTimersByTimeAsync(500)
    expect(backend.pause).not.toHaveBeenCalled()
    command.resolve('done')
    await request
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })

  it('keeps B while a process stream is open, then counts idle time from its closure', async () => {
    const socket = new Socket()
    inner.connectStream.mockResolvedValueOnce(socket)
    await ssh.connectStream({} as never)
    await vi.advanceTimersByTimeAsync(500)
    expect(backend.pause).not.toHaveBeenCalled()
    socket.emit('close')
    await vi.advanceTimersByTimeAsync(99)
    expect(backend.pause).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })

  it('retries a failed idle release without needing another user operation', async () => {
    vi.mocked(backend.pause).mockRejectedValueOnce(new Error('BE temporarily unavailable'))
    await ssh.request('fs.readText', { path: '/by/result' }, z.string())
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(backend.pause).toHaveBeenCalledTimes(2)
  })

  it('does not pause a connection when a command starts while the idle process probe is pending', async () => {
    await ssh.request('fs.readText', { path: '/by/result' }, z.string())
    const probe = Promise.withResolvers<ReadonlyArray<{ pid: number; comm: string }>>()
    residual = () => probe.promise
    await vi.advanceTimersByTimeAsync(100)
    const command = Promise.withResolvers<string>()
    inner.request.mockReturnValueOnce(command.promise)
    const running = ssh.request('spawn', { argv: ['bash'] }, z.string())
    await vi.advanceTimersByTimeAsync(0)
    probe.resolve([])
    await vi.advanceTimersByTimeAsync(0)
    expect(ssh.connected).toBe(true)
    expect(backend.pause).not.toHaveBeenCalled()
    command.resolve('finished')
    expect(await running).toBe('finished')
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })

  it('counts idle from newer activity even if that activity finished before an older probe', async () => {
    await ssh.request('fs.readText', { path: '/by/result' }, z.string())
    const probe = Promise.withResolvers<ReadonlyArray<{ pid: number; comm: string }>>()
    residual = () => probe.promise
    await vi.advanceTimersByTimeAsync(100)
    expect(await ssh.request('spawn', { argv: ['bash'] }, z.string())).toBe('done')
    probe.resolve([])
    await vi.advanceTimersByTimeAsync(99)
    expect(ssh.connected).toBe(true)
    expect(backend.pause).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })
})
