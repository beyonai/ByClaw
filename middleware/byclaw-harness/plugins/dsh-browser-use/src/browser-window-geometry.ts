import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import type { BrowserWindowSize } from './browser-runtime.js'

const TARGET_RETRY_DELAYS = [50, 100, 200] as const

type WindowBounds = Partial<BrowserWindowSize> & {
  readonly left?: number
  readonly top?: number
  readonly windowState?: string
}

function targetNotReady(error: unknown): boolean {
  return error instanceof Error
    && /No (?:web contents|target|window)(?: found)? (?:for|with)|Target closed/i.test(error.message)
}

/** Keeps outer Chromium windows aligned with an Xvfb desktop without changing page focus. */
export class BrowserWindowGeometry {
  readonly #pageTasks = new WeakMap<Page, Promise<void>>()
  readonly #windowTasks = new Map<number, Promise<void>>()
  readonly #pending = new Set<Promise<void>>()
  readonly #abort = new AbortController()
  readonly #onPage = (page: Page): void => {
    void this.normalize(page).catch(error => {
      if (this.#abort.signal.aborted || page.isClosed()) return
      const detail = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 512) : 'unknown error'
      console.warn(`browser-window-normalization-failed: ${detail}`)
    })
  }
  readonly #onClose = (): void => { void this.close() }

  constructor(private readonly context: BrowserContext, private readonly size: BrowserWindowSize) {}

  async install(): Promise<void> {
    this.context.on('page', this.#onPage)
    this.context.once('close', this.#onClose)
    await Promise.all(this.context.pages().map(page => this.normalize(page)))
  }

  normalize(page: Page): Promise<void> {
    const existing = this.#pageTasks.get(page)
    if (existing) return existing
    const task = this.#normalize(page)
    this.#pageTasks.set(page, task)
    this.#pending.add(task)
    void task.finally(() => this.#pending.delete(task)).catch(() => undefined)
    return task
  }

  stop(): void {
    this.context.off('page', this.#onPage)
    this.context.off('close', this.#onClose)
    this.#abort.abort()
    this.#windowTasks.clear()
  }

  async close(): Promise<void> {
    this.stop()
    await Promise.allSettled([...this.#pending])
  }

  async #normalize(page: Page): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.#abort.signal.aborted || page.isClosed()) return
      let session: CDPSession | undefined
      try {
        session = await this.context.newCDPSession(page)
        const { windowId, bounds } = await session.send('Browser.getWindowForTarget')
        if (this.#abort.signal.aborted || page.isClosed()) return
        let task = this.#windowTasks.get(windowId)
        if (!task) {
          task = this.#resize(session, windowId, bounds)
          this.#windowTasks.set(windowId, task)
          void task.finally(() => {
            if (this.#windowTasks.get(windowId) === task) this.#windowTasks.delete(windowId)
          }).catch(() => undefined)
        }
        await task
        return
      } catch (error) {
        if (this.#abort.signal.aborted || page.isClosed()) return
        const retryDelay = TARGET_RETRY_DELAYS[attempt]
        if (retryDelay === undefined || !targetNotReady(error)) throw error
      } finally {
        await session?.detach().catch(() => undefined)
      }
      await delay(TARGET_RETRY_DELAYS[attempt]!, undefined, { signal: this.#abort.signal })
        .catch(error => { if (!this.#abort.signal.aborted) throw error })
    }
  }

  #isFullyVisible(bounds: WindowBounds): boolean {
    const { left = -1, top = -1, width = 0, height = 0 } = bounds
    return bounds.windowState === 'normal' && left >= 0 && top >= 0 && width > 0 && height > 0
      && left + width <= this.size.width && top + height <= this.size.height
  }

  async #resize(session: CDPSession, windowId: number, bounds: WindowBounds): Promise<void> {
    if (this.#isFullyVisible(bounds)) return
    if (bounds.windowState && bounds.windowState !== 'normal') {
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
    }
    if (this.#abort.signal.aborted) return
    await session.send('Browser.setWindowBounds', {
      windowId, bounds: { left: 0, top: 0, width: this.size.width, height: this.size.height },
    })
    const actual = (await session.send('Browser.getWindowBounds', { windowId })).bounds
    if (!this.#isFullyVisible(actual)) {
      throw new Error(`browser-window-bounds-mismatch: ${JSON.stringify(actual)}; desktop=${this.size.width}x${this.size.height}`)
    }
  }
}
