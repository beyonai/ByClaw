import { performance } from 'node:perf_hooks'

/** Diagnostics never change the outcome or include request headers/URLs. */
export async function timed<T>(
  log: ((message: string) => void) | undefined,
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now()
  const emit = (status: string): void => {
    try { log?.(`[byclaw-startup] ${operation} status=${status} durationMs=${(performance.now() - started).toFixed(1)}`) } catch { /* Diagnostics only. */ }
  }
  emit('begin')
  try {
    const result = await run()
    emit('end')
    return result
  } catch (error) {
    emit('failed')
    throw error
  }
}
