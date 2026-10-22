/** Bounded background Skill updates, shared with first-use requests. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { byClawSkillCacheDir, byClawSkillUrl, readCachedByClawSkill, syncByClawSkill } from './skill-sync.ts'
import type { ByClawSkillRef } from './types.ts'

interface Source { principal: string; baseUrl: string; headers: Record<string, string> }
interface Job { promise: Promise<string>; run(): Promise<void>; reject(error: unknown): void }
interface Entry {
  key: string
  ref: ByClawSkillRef
  source: Source
  root: string
  controller: AbortController
  path?: string
  checkedAt: number
  job?: Job
}
export interface SkillLoaderOptions {
  cacheRoot: string
  concurrency?: number
  refreshMs?: number
  waitTimeoutMs?: number
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
  log?: (message: string) => void
  fetchImpl?: typeof fetch
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export class ByClawSkillLoader {
  private entries = new Map<string, Entry>()
  private readonly queue: Entry[] = []
  private readonly running = new Map<Entry, Promise<void>>()
  private active = 0
  private started = false
  private closed = false
  private timer?: ReturnType<typeof setInterval>
  private readonly concurrency: number
  private readonly refreshMs: number
  private readonly waitTimeoutMs: number
  revision = 0

  constructor(private readonly options: SkillLoaderOptions) {
    this.concurrency = options.concurrency ?? 8
    this.refreshMs = options.refreshMs ?? 300_000
    this.waitTimeoutMs = options.waitTimeoutMs ?? 60_000
    for (const value of [this.concurrency, this.refreshMs, this.waitTimeoutMs]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid Skill loader limit')
    }
  }

  private emit(message: string): void {
    try { this.options.log?.(`[byclaw-skills] ${message}`) } catch { /* Diagnostics only. */ }
  }

  /** Only local I/O. Source identity excludes rotating credentials/download signatures. */
  async reconcile(source: Source, refs: readonly ByClawSkillRef[], refresh = false): Promise<void> {
    if (this.closed) throw new Error('Skill loader is closed')
    const next = new Map<string, Entry>()
    for (const ref of refs) {
      const key = hash(JSON.stringify([source.principal, source.baseUrl, ref.id, ref.code, ref.type,
        byClawSkillUrl(source.baseUrl, ref.versionUrl)]))
      if (next.has(ref.code) && next.get(ref.code)!.key !== key) throw new Error(`Conflicting Skill source: ${ref.code}`)
      const previous = next.get(ref.code) ?? this.entries.get(ref.code)
      const entry: Entry = previous?.key === key ? previous : {
        key, ref, source, root: join(this.options.cacheRoot, '.versions', key),
        controller: new AbortController(), checkedAt: 0,
      }
      entry.ref = ref
      entry.source = source
      if (refresh) entry.checkedAt = 0
      if (previous?.key !== key) {
        try {
          const pointer: unknown = JSON.parse(await readFile(join(entry.root, 'current.json'), 'utf8'))
          if (typeof pointer === 'string') {
            const path = byClawSkillCacheDir(join(entry.root, hash(pointer)), ref.code)
            const cached = await readCachedByClawSkill(path)
            if (cached?.metadata.code === ref.code && cached.metadata.version === pointer
              && cached.metadata.versionUrl === byClawSkillUrl(source.baseUrl, ref.versionUrl)) entry.path = path
          }
        } catch { /* Missing/incomplete cache is prepared in the background. */ }
      }
      next.set(ref.code, entry)
    }
    for (const [code, entry] of this.entries) {
      if (next.get(code) !== entry) entry.controller.abort(new Error('Skill authorization or source changed'))
    }
    this.entries = next
    this.emit(`cache ready=${[...next.values()].filter(entry => entry.path !== undefined).length} pending=${[...next.values()].filter(entry => entry.path === undefined).length}`)
    if (this.started) this.refresh()
  }

  cached(ref: ByClawSkillRef): string | undefined {
    const entry = this.entries.get(ref.code)
    return entry?.ref.id === ref.id && entry.ref.type === ref.type && entry.ref.versionUrl === ref.versionUrl ? entry.path : undefined
  }

  /** Called after Worker readiness; updates do not participate in the startup promise. */
  start(): void {
    if (this.closed || this.started) return
    this.started = true
    this.refresh()
    this.timer = setInterval(() => this.refresh(), Math.min(this.refreshMs, 1_000))
    this.timer.unref?.()
  }

  private refresh(): void {
    for (const entry of this.entries.values()) {
      if (Date.now() - entry.checkedAt >= this.refreshMs) void this.enqueue(entry, false).catch(() => undefined)
    }
  }

  /** A caller waits only for its own missing Skills; cancellation leaves shared jobs intact. */
  async ensure(refs: readonly ByClawSkillRef[], signal?: AbortSignal): Promise<Array<{ code: string; path: string }>> {
    if (this.closed) throw new Error('Skill loader is closed')
    const deadline = AbortSignal.timeout(this.waitTimeoutMs)
    const waitSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    waitSignal.throwIfAborted()
    const entries = refs.map(ref => {
      const entry = this.entries.get(ref.code)
      if (entry === undefined || entry.ref.id !== ref.id || entry.ref.type !== ref.type || entry.ref.versionUrl !== ref.versionUrl) {
        throw new Error(`Skill ${ref.code} is no longer authorized`)
      }
      return entry
    })
    const result = await waitFor(Promise.all(entries.map(async entry => ({
      code: entry.ref.code, path: entry.path ?? await this.enqueue(entry, true),
    }))), waitSignal)
    for (const entry of entries) {
      entry.controller.signal.throwIfAborted()
      if (this.entries.get(entry.ref.code) !== entry) throw new Error('Skill source changed during preparation')
    }
    return result
  }

  private enqueue(entry: Entry, priority: boolean): Promise<string> {
    if (entry.job !== undefined) {
      const index = this.queue.indexOf(entry)
      if (priority && index > 0) { this.queue.splice(index, 1); this.queue.unshift(entry) }
      return entry.job.promise
    }
    let resolve!: (path: string) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<string>((accept, decline) => { resolve = accept; reject = decline })
    // Background jobs are always observed, including jobs cancelled before execution.
    void promise.catch(() => undefined)
    entry.job = { promise, reject, run: async () => {
      try {
        entry.controller.signal.throwIfAborted()
        const path = await syncByClawSkill({ ...this.options, ref: entry.ref, ...entry.source,
          cacheRoot: entry.root, versioned: true, signal: entry.controller.signal })
        entry.controller.signal.throwIfAborted()
        const cached = await readCachedByClawSkill(path)
        if (cached === undefined) throw new Error('Skill cache was not complete after download')
        await mkdir(entry.root, { recursive: true })
        const pointer = join(entry.root, `current.${randomUUID()}.tmp`)
        try {
          await writeFile(pointer, JSON.stringify(cached.metadata.version), { mode: 0o600 })
          entry.controller.signal.throwIfAborted()
          await rename(pointer, join(entry.root, 'current.json'))
        } finally { await rm(pointer, { force: true }) }
        entry.controller.signal.throwIfAborted()
        if (entry.path !== path) this.revision += 1
        entry.path = path
        resolve(path)
      } catch (error) {
        this.emit(`skill=${JSON.stringify(entry.ref.code)} status=failed cached=${entry.path !== undefined}`)
        reject(error)
      } finally {
        entry.checkedAt = Date.now()
        entry.job = undefined
      }
    } }
    if (priority) this.queue.unshift(entry)
    else this.queue.push(entry)
    this.drain()
    return promise
  }

  private drain(): void {
    while (!this.closed && this.active < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!
      this.active += 1
      const work = entry.job!.run().finally(() => { this.running.delete(entry); this.active -= 1; this.drain() })
      this.running.set(entry, work)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    for (const entry of new Set([...this.entries.values(), ...this.running.keys()])) {
      entry.controller.abort(new Error('Skill loader stopped'))
    }
    for (const entry of this.queue.splice(0)) {
      entry.job?.reject(new Error('Skill loader stopped'))
      entry.job = undefined
    }
    await Promise.allSettled(this.running.values())
  }
}
