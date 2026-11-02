/** One identity per plugin activation, including concurrent contexts in a shared host. */
import { randomUUID } from 'node:crypto'

export class ByClawStartupLog {
  readonly startupId = randomUUID()
  private readonly started = process.hrtime.bigint()
  private previous = this.started
  constructor(private readonly userCode: string) {}

  point(step: string, fields: Record<string, string | number | boolean> = {}): void {
    const now = process.hrtime.bigint()
    this.write(step, 'point', 'ok', { intervalMs: Number((now - this.previous) / 1_000_000n), ...fields })
    this.previous = now
  }

  async measure<T>(step: string, operation: () => Promise<T>): Promise<T> {
    const started = process.hrtime.bigint()
    this.write(step, 'start', 'running')
    try {
      const result = await operation()
      this.write(step, 'end', 'ok', { durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n) })
      return result
    } catch (error: unknown) {
      this.failed(step, error, started)
      throw error
    }
  }

  failed(step: string, error: unknown, started = this.started): void {
    this.write(step, 'end', 'failed', {
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      errorType: error instanceof Error ? error.name.slice(0, 100) : 'UnknownError',
    })
  }

  private write(step: string, phase: string, result: string, fields = {}): void {
    try {
      const line = `chat_chain ${JSON.stringify({ time: Date.now(), service: 'harness',
        instance: `${process.pid}@${process.env['HOSTNAME'] || 'local'}`, startupId: this.startupId,
        userCode: this.userCode.slice(0, 160), stage: 'harness.startup', step, phase, result,
        elapsedMs: Number((process.hrtime.bigint() - this.started) / 1_000_000n),
        processUptimeMs: Math.round(process.uptime() * 1000), ...fields })}`
      if (result === 'failed') console.warn(line)
      else console.info(line)
    } catch { /* Startup diagnostics never affect activation. */ }
  }
}
