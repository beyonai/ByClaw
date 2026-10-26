/** WorkerRunner lifecycle for the BYCLAW_DSH plugin. */

import { ManagedAdmission, type ManagedAdmissionLease } from './managed-admission.ts'
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
  readonly admission: ManagedAdmission | undefined
  private admissionTimer: ReturnType<typeof setInterval> | undefined
  private runner: WorkerRunner | undefined
  private run: Promise<void> | undefined
  private lifecycle: AbortController | undefined

  constructor(options: {
    redis: ReturnType<typeof createRedis>
    workerId: string
    agentTypes: string[]
    sessions: ByClawDshSessionRuntime
    admission?: ManagedAdmissionLease
  }) {
    this.admission = options.admission === undefined ? undefined : new ManagedAdmission(options.admission, () => this.stopAdmission())
    this.registry = new WorkerRegistry(options.redis)
    this.redis = options.redis
    this.worker = new ByClawDshGatewayWorker({
      workerId: options.workerId,
      agentTypes: options.agentTypes,
      sessions: options.sessions,
      redis: options.redis,
      registry: this.registry,
      admission: this.admission,
    })
  }

  async start(workerId: string, timeoutMs = 10_000): Promise<void> {
    if (this.admission && !this.admission.check()) throw new Error('Managed lease expired before worker startup')
    this.lifecycle = new AbortController()
    if (this.admission) {
      this.admissionTimer = setInterval(() => { if (!this.admission?.check()) this.runner?.stop() }, 100)
      this.admissionTimer.unref()
    }
    this.run = superviseWorker(() => {
      const runner = new WorkerRunner(this.worker, {
        redisClient: this.redis,
        // Published framework versions default to 50. Disable that legacy cap
        // so waiting requests cannot prevent their Resume messages from running.
        maxConcurrency: Number.POSITIVE_INFINITY,
      })
      this.runner = runner
      return runner
    }, this.lifecycle.signal, 1_000, error => {
      const detail = error === undefined ? 'health exit' : String(error)
      console.warn(`BYCLAW_DSH Worker runner exited (${detail}); restarting`)
    })
    void this.run.finally(() => { if (this.admissionTimer) clearInterval(this.admissionTimer) })
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

  stopAdmission(): void {
    this.lifecycle?.abort()
    this.runner?.stop()
  }

  async close(): Promise<void> {
    this.stopAdmission()
    await this.run?.catch(() => undefined)
    if (this.admissionTimer) clearInterval(this.admissionTimer)
  }
}
