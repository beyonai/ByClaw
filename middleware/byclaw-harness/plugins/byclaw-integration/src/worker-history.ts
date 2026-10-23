/** Opt-out of by-framework's process-wide in-memory conversation history. */
import { HistoryProvider, type BaseHistoryStorage } from '@byclaw/by-framework'

/**
 * `memory`: by-framework's default unbounded, process-wide in-memory store.
 * `none`: record nothing; the runner then injects `extraPayload.history = []`.
 */
export type ByClawWorkerHistory = 'memory' | 'none'

/** Stores nothing and returns no history. DSH sessions keep their own durable history. */
export const NO_WORKER_HISTORY: BaseHistoryStorage = Object.freeze({
  async saveMessage(): Promise<void> {},
  async getSessionHistory() { return [] },
})

/**
 * Apply the history mode. `HistoryProvider.storage` is static, so `none`
 * affects every worker in this process; it is never reverted, because another
 * context sharing the process may still rely on it. `memory` leaves the
 * current storage untouched.
 */
export function applyByClawWorkerHistory(mode: ByClawWorkerHistory | undefined): void {
  if (mode === 'none') HistoryProvider.setStorage(NO_WORKER_HISTORY)
}
