import type { ReporterScheduler, StreamClient } from '../src/reporter.ts'

interface Timer {
  at: number
  callback: () => void
  every?: number
}

/** Manual clock: timers fire only from `advance()`. */
export class FakeClock implements ReporterScheduler {
  time = 0
  private nextId = 1
  private readonly timers = new Map<number, Timer>()

  now = (): number => this.time

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { at: this.time + delayMs, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  setInterval(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { at: this.time + delayMs, callback, every: delayMs })
    return id
  }

  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  get pendingTimers(): number {
    return this.timers.size
  }

  /** Move time forward, firing due timers in order and letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms
    for (;;) {
      let dueId: number | undefined
      let due: Timer | undefined
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (due === undefined || timer.at < due.at)) {
          dueId = id
          due = timer
        }
      }
      if (dueId === undefined || due === undefined) break
      this.time = due.at
      if (due.every === undefined) this.timers.delete(dueId)
      else due.at += due.every
      due.callback()
      await settle()
    }
    this.time = target
    await settle()
  }
}

/** Let queued promise callbacks run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>(resolve => { setImmediate(resolve) })
}

export type Entry = Record<string, string>

/** Records XADD calls; can fail or hold appends. */
export class FakeRedis implements StreamClient {
  readonly calls: Array<Array<string | number>> = []
  readonly entries: Entry[] = []
  failing = false
  private held: Array<() => void> | undefined

  async xadd(key: string, ...args: Array<string | number>): Promise<unknown> {
    this.calls.push([key, ...args])
    if (this.held !== undefined) await new Promise<void>(resolve => { this.held?.push(resolve) })
    if (this.failing) throw new Error('connect ECONNREFUSED')
    const fields = args.slice(args.indexOf('*') + 1)
    const entry: Entry = {}
    for (let i = 0; i < fields.length; i += 2) entry[String(fields[i])] = String(fields[i + 1])
    this.entries.push(entry)
    return `${this.entries.length}-0`
  }

  hold(): void {
    this.held = []
  }

  release(): void {
    const held = this.held ?? []
    this.held = undefined
    for (const resolve of held) resolve()
  }
}

export class FakeLogger {
  readonly infos: string[] = []
  readonly warns: string[] = []
  info(message: string): void { this.infos.push(message) }
  warn(message: string): void { this.warns.push(message) }
}
