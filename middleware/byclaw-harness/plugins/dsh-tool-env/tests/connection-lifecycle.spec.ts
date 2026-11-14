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
  let invalidate: () => void
  let residual: () => Promise<ReadonlyArray<{ pid: number; comm: string }>>

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = new Context()
    backend = {
      onInvalidated: listener => { invalidate = listener; return () => {} },
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

  it('creates a directory when B is next used, once, and answers its probes here meanwhile', async () => {
    const order: string[] = []
    const mkdir = vi.fn(async () => { order.push('mkdir') })
    await ssh.request('spawn', {}, z.string())
    expect(ssh.connected).toBe(true)
    inner.request.mockClear()
    inner.request.mockImplementation(async (method: string) => { order.push(method); return 'done' })
    await ssh.whenConnected('mkdir:/by/.sessions/7', mkdir)
    await ssh.whenConnected('mkdir:/by/.sessions/7', mkdir)
    // A model-only turn: the working-directory checks are answered here and nothing reaches B.
    const target = await ssh.request('fs.resolve', { path: '/by/.sessions/7' }, z.object({ targetKey: z.string(), displayPath: z.string() }))
    const info = await ssh.request('fs.stat', { target }, z.object({ type: z.string() }).passthrough())
    expect(info.type).toBe('directory')
    expect(mkdir).not.toHaveBeenCalled()
    expect(inner.request).not.toHaveBeenCalled()
    // The next operation that reaches B creates the directory first, once.
    await ssh.request('process.start', { cwd: '/by/.sessions/7' }, z.string())
    expect(order).toEqual(['mkdir', 'process.start'])
    await ssh.whenConnected('mkdir:/by/.sessions/7', mkdir)
    await ssh.request('fs.stat', { target: { targetKey: '/by/.sessions/7/a.md', displayPath: 'a.md' } }, z.string())
    expect(mkdir).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['mkdir', 'process.start', 'fs.stat'])
  })

  it('creates its directories again when a process fails for a missing path, at most every few seconds', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined)
    await ssh.request('spawn', {}, z.string())
    await ssh.whenConnected('mkdir:/by/.shared/project_-1', mkdir)
    await ssh.request('process.start', {}, z.string())
    expect(mkdir).toHaveBeenCalledTimes(1)
    const missing = Object.assign(new Error('spawn bash ENOENT'), { code: 'ENOENT' })
    inner.request.mockImplementation(async (method: string) => { if (method === 'process.done') throw missing; return 'done' })
    await expect(ssh.request('process.done', {}, z.string())).rejects.toThrow()
    expect(mkdir).toHaveBeenCalledTimes(2)
    await expect(ssh.request('process.done', {}, z.string())).rejects.toThrow()
    expect(mkdir).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(ssh.request('process.done', {}, z.string())).rejects.toThrow()
    expect(mkdir).toHaveBeenCalledTimes(3)
    // Other failures, and missing paths outside processes, leave the directories alone.
    await vi.advanceTimersByTimeAsync(5000)
    inner.request.mockImplementation(async (method: string) => { throw method === 'process.done' ? new Error('exit 1') : missing })
    await expect(ssh.request('process.done', {}, z.string())).rejects.toThrow()
    await expect(ssh.request('fs.stat', { target: { targetKey: '/by/a', displayPath: 'a' } }, z.string())).rejects.toThrow()
    expect(mkdir).toHaveBeenCalledTimes(3)
  })

  it('lets deferred work reach B itself while it runs, and shares one run between concurrent operations', async () => {
    await ssh.request('spawn', {}, z.string())
    inner.request.mockClear()
    let release: () => void = () => {}
    const blocked = new Promise<void>(resolve => { release = resolve })
    const mkdir = vi.fn(async () => { await ssh.request('process.prepare', { argv: ['/bin/mkdir', '-p', '--', '/by/x'] }, z.string()); await blocked })
    await ssh.whenConnected('mkdir:/by/x', mkdir)
    const first = ssh.request('process.start', {}, z.string())
    const second = ssh.request('process.start', {}, z.string())
    await vi.advanceTimersByTimeAsync(10)
    // Only the deferred mkdir has reached B (after the once-per-connection workload-wrapper probe).
    expect(inner.request.mock.calls.map(call => call[0])).toEqual(['fs.stat', 'process.prepare'])
    release()
    await Promise.all([first, second])
    expect(mkdir).toHaveBeenCalledTimes(1)
    expect(inner.request.mock.calls.map(call => call[0])).toEqual(['fs.stat', 'process.prepare', 'process.start', 'process.start'])
  })

  it('does not queue a directory this host already created while B is down', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined)
    await ssh.request('spawn', {}, z.string())
    await ssh.whenConnected('mkdir:/by/.sessions/8', mkdir)
    await ssh.request('process.start', {}, z.string())
    await (ssh as unknown as { drop(): Promise<void> }).drop()
    expect(ssh.connected).toBe(false)
    const deferred = ssh as unknown as { deferred: { size: number } }
    await ssh.whenConnected('mkdir:/by/.sessions/8', mkdir)
    expect(deferred.deferred.size).toBe(0)
    expect(mkdir).toHaveBeenCalledTimes(1)
  })

  it('fences a pending SSH handshake when its Platform lease is invalidated', async () => {
    const ready = Promise.withResolvers<unknown>()
    const connector = ssh as unknown as { connect(): Promise<unknown> }
    vi.mocked(connector.connect).mockResolvedValueOnce({
      connection: { ...inner, ready: ready.promise }, fiber: { dispose() {} },
    })
    const request = ssh.request('spawn', {}, z.string())
    const rejected = expect(request).rejects.toThrow('TOOL_LEASE_INVALIDATED')
    await vi.advanceTimersByTimeAsync(0)
    invalidate()
    ready.resolve({})
    await rejected
    expect(inner.request).not.toHaveBeenCalled()
    expect(ssh.connected).toBe(false)
    expect(inner.dispose).toHaveBeenCalled()
  })

  it('holds coordinated IO through the full request and stream lifetime', async () => {
    const finish = vi.fn(async () => {})
    backend.beginUse = vi.fn(async () => finish)
    const result = Promise.withResolvers<string>()
    inner.request.mockReturnValueOnce(result.promise)
    const request = ssh.request('spawn', {}, z.string())
    await vi.advanceTimersByTimeAsync(0)
    expect(finish).not.toHaveBeenCalled()
    result.resolve('done'); await request
    expect(finish).toHaveBeenCalledTimes(1)
    const socket = new Socket()
    inner.connectStream.mockResolvedValueOnce(socket)
    await ssh.connectStream({} as never)
    expect(finish).toHaveBeenCalledTimes(1)
    socket.destroy(); await vi.advanceTimersByTimeAsync(0)
    expect(finish).toHaveBeenCalledTimes(2)
  })

  it('keeps both failures and the dispatched outcome when lease release also fails', async () => {
    const finish = vi.fn().mockRejectedValue(new Error('lease release ETIMEDOUT'))
    backend.beginUse = vi.fn().mockResolvedValue(finish)
    inner.request.mockRejectedValueOnce(new Error('SSH helper disconnected'))
    const error = await ssh.request('spawn', {}, z.string()).catch(error => error)
    expect(error.message).toContain('TOOL_ENV_OUTCOME_UNKNOWN')
    expect(error.message).toContain('SSH helper disconnected')
    expect(error.message).toContain('租约归还失败：lease release ETIMEDOUT')
    expect(error.message).not.toContain('TOOL_ENV_UNAVAILABLE')
    expect(error.cause).toBeInstanceOf(AggregateError)
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('preserves the successful value when lease release fails', async () => {
    backend.beginUse = vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error('lease release failed')))
    expect(await ssh.request('spawn', {}, z.string())).toBe('done')
  })

  it('keeps cancellation authoritative when lease release also fails', async () => {
    const controller = new AbortController()
    const reason = new Error('user cancelled')
    backend.beginUse = vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error('lease release failed')))
    inner.request.mockImplementationOnce(async () => { controller.abort(reason); throw new Error('SSH helper disconnected') })
    await expect(ssh.request('spawn', {}, z.string(), controller.signal)).rejects.toBe(reason)
  })

  it('keeps stream cancellation authoritative when its lease release fails', async () => {
    const controller = new AbortController()
    const reason = new Error('user cancelled')
    const finish = vi.fn().mockRejectedValue(new Error('stream release failed'))
    backend.beginUse = vi.fn().mockResolvedValue(finish)
    inner.connectStream.mockImplementationOnce(async () => {
      controller.abort(reason)
      throw new Error('SSH helper disconnected')
    })
    await expect(ssh.connectStream({} as never, controller.signal)).rejects.toBe(reason)
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('releases an ensured environment after its first SSH handshake fails', async () => {
    const connector = ssh as unknown as { connect(): Promise<unknown> }
    vi.mocked(connector.connect).mockResolvedValueOnce({
      connection: { ...inner, ready: Promise.reject(new Error('SSH helper disconnected')) },
      fiber: { dispose() {} },
    })
    await expect(ssh.request('spawn', { argv: ['bash'] }, z.string())).rejects.toThrow('TOOL_ENV_UNAVAILABLE')
    expect(inner.request).not.toHaveBeenCalled()
    expect(connector.connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })

  it('retries cleanup after first connect fails and pause also fails', async () => {
    const connector = ssh as unknown as { connect(): Promise<unknown> }
    vi.mocked(connector.connect).mockRejectedValueOnce(new Error('connect failed'))
    vi.mocked(backend.pause).mockRejectedValueOnce(new Error('pause failed'))
    await expect(ssh.request('spawn', {}, z.string())).rejects.toThrow('connect failed')
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(2)
  })

  it('keeps an unconnected environment while DSH still has an active turn', async () => {
    let busy = true
    ;(ssh as unknown as { options: { busy: { dsh(): boolean } } }).options.busy.dsh = () => busy
    const connector = ssh as unknown as { connect(): Promise<unknown> }
    vi.mocked(connector.connect).mockRejectedValueOnce(new Error('connect failed'))
    await expect(ssh.request('spawn', {}, z.string())).rejects.toThrow('connect failed')
    await vi.advanceTimersByTimeAsync(300)
    expect(backend.pause).not.toHaveBeenCalled()
    busy = false
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })

  it('waits for failed-open cleanup before a new operation ensures B again', async () => {
    const connector = ssh as unknown as { connect(): Promise<unknown> }
    vi.mocked(connector.connect).mockRejectedValueOnce(new Error('connect failed'))
    await expect(ssh.request('spawn', {}, z.string())).rejects.toThrow('connect failed')
    const pause = Promise.withResolvers<void>()
    vi.mocked(backend.pause).mockReturnValueOnce(pause.promise)
    await vi.advanceTimersByTimeAsync(100)
    const next = ssh.request('spawn', {}, z.string())
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.ensure).toHaveBeenCalledTimes(1)
    pause.resolve()
    expect(await next).toBe('done')
    expect(backend.ensure).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(2)
  })

  it('also cleans up when ensure reports an error after allocating the environment', async () => {
    vi.mocked(backend.ensure).mockRejectedValueOnce(new Error('readiness timed out'))
    await expect(ssh.request('spawn', {}, z.string())).rejects.toThrow('readiness timed out')
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })

  it('closing after first open fails still pauses the owned environment', async () => {
    const connector = ssh as unknown as { connect(): Promise<unknown> }
    vi.mocked(connector.connect).mockRejectedValueOnce(new Error('connect failed'))
    await expect(ssh.request('spawn', {}, z.string())).rejects.toThrow('connect failed')
    await (ssh as unknown as { close(): Promise<void> }).close()
    expect(backend.pause).toHaveBeenCalledTimes(1)
  })

  it('cancels failed-open idle cleanup when a new command is using the environment', async () => {
    const connector = ssh as unknown as { connect(): Promise<unknown> }
    vi.mocked(connector.connect).mockRejectedValueOnce(new Error('connect failed'))
    await expect(ssh.request('spawn', {}, z.string())).rejects.toThrow('connect failed')
    await vi.advanceTimersByTimeAsync(99)
    const command = Promise.withResolvers<string>()
    inner.request.mockReturnValueOnce(command.promise)
    const request = ssh.request('spawn', {}, z.string())
    await vi.advanceTimersByTimeAsync(300)
    expect(backend.pause).not.toHaveBeenCalled()
    command.resolve('finished')
    expect(await request).toBe('finished')
    await vi.advanceTimersByTimeAsync(100)
    expect(backend.pause).toHaveBeenCalledTimes(1)
    expect(inner.request).toHaveBeenCalledTimes(1)
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

  describe('processes left on B after a session', () => {
    let hold: ReturnType<typeof vi.fn>
    beforeEach(() => {
      hold = vi.fn().mockResolvedValue(undefined)
      backend.holdResidual = hold
    })

    it('holds a lease when a session ends with processes still on B and returns it once they exit', async () => {
      await ssh.request('spawn', { argv: ['bash'] }, z.string())
      residual = async () => [{ pid: 42, comm: 'node' }]
      await ssh.finishSession('session-a')
      await vi.advanceTimersByTimeAsync(0)
      expect(hold.mock.calls).toEqual([[true]])
      await vi.advanceTimersByTimeAsync(100)
      expect(hold.mock.calls).toEqual([[true], [true]])
      expect(backend.pause).not.toHaveBeenCalled()
      residual = async () => []
      await vi.advanceTimersByTimeAsync(100)
      expect(hold.mock.calls.at(-1)).toEqual([false])
      expect(backend.pause).toHaveBeenCalledTimes(1)
    })

    it('holds nothing when a session ends without processes left on B', async () => {
      await ssh.request('spawn', { argv: ['bash'] }, z.string())
      await ssh.finishSession('session-a')
      await vi.advanceTimersByTimeAsync(0)
      expect(hold).not.toHaveBeenCalled()
    })

    it('does not probe B for a session that ends while B is not connected, or is destroyed', async () => {
      const probe = vi.fn(async () => [{ pid: 42, comm: 'node' }])
      residual = probe
      await ssh.finishSession('session-a')
      await ssh.request('spawn', { argv: ['bash'] }, z.string())
      await ssh.finishSession('session-b', true)
      await vi.advanceTimersByTimeAsync(0)
      expect(probe).not.toHaveBeenCalled()
      expect(hold).not.toHaveBeenCalled()
    })

    it('returns the lease once remaining processes pass the limit', async () => {
      ;(ssh as unknown as { options: { busy: { residualMaxMs: number } } }).options.busy.residualMaxMs = 250
      await ssh.request('spawn', { argv: ['bash'] }, z.string())
      residual = async () => [{ pid: 42, comm: 'sleep' }]
      await ssh.finishSession('session-a')
      await vi.advanceTimersByTimeAsync(200)
      expect(backend.pause).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      expect(hold.mock.calls.at(-1)).toEqual([false])
      expect(backend.pause).toHaveBeenCalledTimes(1)
    })

    it('returns a lease taken while a pause started', async () => {
      await ssh.request('spawn', { argv: ['bash'] }, z.string())
      const answer = Promise.withResolvers<void>()
      hold.mockReturnValueOnce(answer.promise)
      residual = async () => [{ pid: 42, comm: 'node' }]
      await ssh.finishSession('session-a')
      await vi.advanceTimersByTimeAsync(0)
      await ssh.dispose()
      answer.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(hold.mock.calls).toEqual([[true], [false]])
    })
  })
})
