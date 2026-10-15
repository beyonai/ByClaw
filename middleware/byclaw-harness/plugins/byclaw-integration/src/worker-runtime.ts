/** WorkerRunner lifecycle for the BYCLAW_DSH plugin. */

import { WorkerRegistry, WorkerRunner, createRedis } from '@byclaw/by-framework'
import { ByClawDshGatewayWorker } from './worker.ts'
import type { ByClawDshSessionRuntime } from './session-runtime.ts'

interface RestartableRunner {
  start(options: { handleSignals: boolean }): Promise<void>
  stop(): void
}

function restartDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs === 0 || signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(done, delayMs)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/** Keep replacing a by-framework runner after an unexpected health exit. */
export async function superviseWorker(
  createRunner: () => RestartableRunner,
  signal: AbortSignal,
  restartDelayMs = 1_000,
  onUnexpectedExit: (error?: unknown) => void = () => undefined,
): Promise<void> {
  while (!signal.aborted) {
    const runner = createRunner()
    try {
      await runner.start({ handleSignals: false })
      if (!signal.aborted) onUnexpectedExit()
    } catch (error: unknown) {
      if (!signal.aborted) onUnexpectedExit(error)
    }
    await restartDelay(restartDelayMs, signal)
  }
}

export class ByClawDshWorkerRuntime {
  private readonly registry: WorkerRegistry
  private readonly worker: ByClawDshGatewayWorker
  private readonly redis: ReturnType<typeof createRedis>
  private readonly maxConcurrency: number
  private runner: WorkerRunner | undefined
  private run: Promise<void> | undefined
  private lifecycle: AbortController | undefined

  constructor(options: {
    redis: ReturnType<typeof createRedis>
    workerId: string
    agentTypes: string[]
    sessions: ByClawDshSessionRuntime
    maxConcurrency: number
  }) {
    this.registry = new WorkerRegistry(options.redis)
    this.redis = options.redis
    this.maxConcurrency = options.maxConcurrency
    this.worker = new ByClawDshGatewayWorker({
      workerId: options.workerId,
      agentTypes: options.agentTypes,
      sessions: options.sessions,
      redis: options.redis,
      registry: this.registry,
    })
  }

  async start(workerId: string, timeoutMs = 10_000): Promise<void> {
    this.lifecycle = new AbortController()
    this.run = superviseWorker(() => {
      const runner = new WorkerRunner(this.worker, {
        redisClient: this.redis,
        maxConcurrency: this.maxConcurrency,
      })
      this.runner = runner
      return runner
    }, this.lifecycle.signal, 1_000, error => {
      const detail = error === undefined ? 'health exit' : String(error)
      console.warn(`BYCLAW_DSH Worker runner exited (${detail}); restarting`)
    })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.registry.isWorkerOnline(workerId)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    this.lifecycle.abort()
    this.runner?.stop()
    await this.run.catch(() => undefined)
    throw new Error(`BYCLAW_DSH Worker did not become online within ${timeoutMs}ms`)
  }

  async close(): Promise<void> {
    this.lifecycle?.abort()
    this.runner?.stop()
    await this.run?.catch(() => undefined)
  }
}
