/** Bounded ordered I/O. Drain all work before surfacing failure so staging cleanup is safe. */
export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, operation: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer')
  const output = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await operation(items[index]!, index)
    }
  })
  const settled = await Promise.allSettled(workers)
  const failure = settled.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return output
}
