import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export interface BycliRuntimeOptions {
  enabled: boolean
  ensureBrowser(): Promise<void>
  restartCommand: readonly string[]
  statusCommand: readonly string[]
  timeoutMs: number
  commandTimeoutMs: number
  healthIntervalMs: number
  log(message: string): void
  run?: (command: readonly string[], timeoutMs: number, signal: AbortSignal) => Promise<string>
}

function runCommand(command: readonly string[], timeout: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command[0]!, command.slice(1), { timeout, signal, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('bycli-command-failed'))
      else resolve(stdout)
    })
  })
}

/** A failed bridge never shuts down the browser or DSH. Health work starts only after first use. */
export class BycliRuntime {
  private pending: Promise<void> | undefined
  private timer: NodeJS.Timeout | undefined
  private readonly stopping = new AbortController()
  private ready = false
  constructor(private readonly options: BycliRuntimeOptions) {}

  ensure(): Promise<void> {
    if (this.stopping.signal.aborted) return Promise.reject(new Error('bycli-runtime-stopped'))
    if (!this.options.enabled) return Promise.reject(new Error('bycli-disabled'))
    if (this.pending) return this.pending
    this.pending = this.prepare().finally(() => {
      this.pending = undefined
      if (!this.stopping.signal.aborted && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined
          void this.ensure().catch(() => this.options.log('byCLI Browser Bridge unavailable; retrying'))
        }, this.options.healthIntervalMs)
        this.timer.unref()
      }
    })
    return this.pending
  }

  private async healthy(timeout: number): Promise<boolean> {
    try {
      const value = JSON.parse(await (this.options.run ?? runCommand)(
        this.options.statusCommand, timeout, this.stopping.signal,
      ))
      return value?.state === 'ready' && value.daemon?.state === 'running'
        && value.daemon?.stale !== true && value.extension?.state === 'connected'
    } catch { return false }
  }

  private async prepare(): Promise<void> {
    await this.options.ensureBrowser()
    const deadline = Date.now() + this.options.timeoutMs
    const remaining = () => Math.max(1, deadline - Date.now())
    if (this.ready && await this.healthy(Math.min(this.options.commandTimeoutMs, remaining()))) return
    this.ready = false
    await (this.options.run ?? runCommand)(this.options.restartCommand, remaining(), this.stopping.signal)
    while (Date.now() < deadline) {
      this.stopping.signal.throwIfAborted()
      if (await this.healthy(Math.min(this.options.commandTimeoutMs, remaining()))) {
        this.ready = true
        this.options.log('byCLI Browser Bridge connected')
        return
      }
      await delay(Math.min(100, remaining()), undefined, { signal: this.stopping.signal })
    }
    throw new Error('bycli-readiness-timeout')
  }

  async close(): Promise<void> {
    this.stopping.abort()
    if (this.timer) clearTimeout(this.timer)
    await this.pending?.catch(() => undefined)
  }
}
