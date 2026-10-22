import { describe, expect, it, vi } from 'vitest'
import { BycliRuntime } from '../src/bycli-runtime.js'

const healthy = JSON.stringify({ state: 'ready', daemon: { state: 'running' }, extension: { state: 'connected' } })
function fixture(run = vi.fn(async (_command: readonly string[]) => healthy)) {
  const ensureBrowser = vi.fn(async () => undefined)
  const runtime = new BycliRuntime({ enabled: true, ensureBrowser, restartCommand: ['restart'],
    statusCommand: ['status'], timeoutMs: 50, commandTimeoutMs: 10, healthIntervalMs: 30_000,
    log: () => undefined, run })
  return { runtime, run, ensureBrowser }
}

describe('on-demand byCLI lifecycle', () => {
  it('does no startup work, coalesces first callers and reuses a healthy daemon', async () => {
    const { runtime, run, ensureBrowser } = fixture()
    expect(run).not.toHaveBeenCalled()
    expect(ensureBrowser).not.toHaveBeenCalled()
    try {
      await Promise.all([runtime.ensure(), runtime.ensure(), runtime.ensure()])
      expect(run.mock.calls.filter(call => call[0]?.[0] === 'restart')).toHaveLength(1)
      await runtime.ensure()
      expect(run.mock.calls.filter(call => call[0]?.[0] === 'restart')).toHaveLength(1)
    } finally { await runtime.close() }
  })

  it('times out an unavailable bridge and permits an explicit retry', async () => {
    let ready = false
    const { runtime } = fixture(vi.fn(async () => ready ? healthy : '{}'))
    try {
      await expect(runtime.ensure()).rejects.toThrow('bycli-readiness-timeout')
      ready = true
      await expect(runtime.ensure()).resolves.toBeUndefined()
    } finally { await runtime.close() }
  })

  it('repairs a disconnected daemon after first use', async () => {
    let ready = false
    let restarts = 0
    const runtime = new BycliRuntime({ enabled: true, ensureBrowser: async () => undefined,
      restartCommand: ['restart'], statusCommand: ['status'], timeoutMs: 100,
      commandTimeoutMs: 10, healthIntervalMs: 5, log: () => undefined,
      run: async command => { if (command[0] === 'restart') { restarts++; ready = true }; return ready ? healthy : '{}' },
    })
    try {
      await runtime.ensure()
      ready = false
      await vi.waitFor(() => expect(restarts).toBe(2))
    } finally { await runtime.close() }
  })

  it('cancels a pending command on disposal', async () => {
    let started!: () => void
    const began = new Promise<void>(resolve => { started = resolve })
    const runtime = new BycliRuntime({ enabled: true, ensureBrowser: async () => undefined,
      restartCommand: ['restart'], statusCommand: ['status'], timeoutMs: 100,
      commandTimeoutMs: 10, healthIntervalMs: 5, log: () => undefined,
      run: async (_command, _timeout, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); started()
      }),
    })
    const pending = expect(runtime.ensure()).rejects.toThrow('cancelled')
    await began
    await runtime.close()
    await pending
    await expect(runtime.ensure()).rejects.toThrow('bycli-runtime-stopped')
  })
})
