/** Reader/writer admission for one complete ByClaw authorization generation. */

import type {} from '@deepseek-ai/cordis'
import { resolve } from 'node:path'

interface Waiter {
  readonly mode: 'read' | 'write'
  readonly resolve: (release: () => void) => void
}

interface GenerationState {
  readers: number
  writer: boolean
  readonly waiters: Waiter[]
}

/** Shared operations used by generation publishers and catalog consumers. */
export interface GenerationLease {
  /**
   * Run one consumer against a generation that cannot be replaced until the operation settles.
   * @param catalogDir - AgentTeams catalog directory identifying the related generation.
   * @param operation - complete template or team instantiation.
   * @returns the operation result.
   */
  read<T>(catalogDir: string, operation: () => Promise<T>): Promise<T>

  /**
   * Run one catalog mutation or generation publication while excluding its consumers and other writers.
   * @param catalogDir - AgentTeams catalog directory identifying the related generation.
   * @param operation - complete exclusive catalog operation.
   * @returns the operation result.
   */
  write<T>(catalogDir: string, operation: () => Promise<T>): Promise<T>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    byclawGenerationLease: ByClawGenerationLease
  }
}

/**
 * Process-local generation admission registered for the ByClaw integration lifecycle.
 * Waiting operations retain FIFO writer order, adjacent readers share one
 * generation, and idle catalog entries are removed immediately.
 */
export class ByClawGenerationLease implements GenerationLease {
  private readonly generations = new Map<string, GenerationState>()
  private closing = false
  private closeTask: Promise<void> | undefined
  private resolveClose: (() => void) | undefined

  /** @inheritdoc */
  async read<T>(catalogDir: string, operation: () => Promise<T>): Promise<T> {
    return this.run(resolve(catalogDir), 'read', operation)
  }

  /** @inheritdoc */
  async write<T>(catalogDir: string, operation: () => Promise<T>): Promise<T> {
    return this.run(resolve(catalogDir), 'write', operation)
  }

  /**
   * Reject later acquisitions and settle after admitted readers and writers release.
   * @returns fulfillment when no generation operation remains.
   */
  close(): Promise<void> {
    if (this.closeTask !== undefined) return this.closeTask
    this.closing = true
    if (this.generations.size === 0) return this.closeTask = Promise.resolve()
    this.closeTask = new Promise<void>((resolveClose) => { this.resolveClose = resolveClose })
    return this.closeTask
  }

  private async run<T>(key: string, mode: Waiter['mode'], operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key, mode)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private acquire(key: string, mode: Waiter['mode']): Promise<() => void> {
    if (this.closing) return Promise.reject(new Error('ByClaw generation lease is closing'))
    let state = this.generations.get(key)
    if (state === undefined) {
      state = { readers: 0, writer: false, waiters: [] }
      this.generations.set(key, state)
    }
    return new Promise((resolveRelease) => {
      state.waiters.push({ mode, resolve: resolveRelease })
      this.drain(key, state)
    })
  }

  private drain(key: string, state: GenerationState): void {
    if (state.writer) return
    const next = state.waiters[0]
    if (next === undefined) {
      if (state.readers === 0) this.retire(key, state)
      return
    }
    if (next.mode === 'write') {
      if (state.readers !== 0) return
      state.waiters.shift()
      state.writer = true
      next.resolve(this.releaseWriter(key, state))
      return
    }
    while (state.waiters[0]?.mode === 'read' && !state.writer) {
      const reader = state.waiters.shift()
      if (reader === undefined) break
      state.readers += 1
      reader.resolve(this.releaseReader(key, state))
    }
  }

  private releaseReader(key: string, state: GenerationState): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      state.readers -= 1
      this.drain(key, state)
    }
  }

  private releaseWriter(key: string, state: GenerationState): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      state.writer = false
      this.drain(key, state)
    }
  }

  private retire(key: string, state: GenerationState): void {
    if (this.generations.get(key) !== state) return
    this.generations.delete(key)
    if (this.closing && this.generations.size === 0) {
      this.resolveClose?.()
      this.resolveClose = undefined
    }
  }
}
