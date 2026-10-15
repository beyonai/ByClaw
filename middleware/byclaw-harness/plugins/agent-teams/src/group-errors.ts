/** Missing user inputs are an admission blocker, not a worker crash to retry. */
import type { GroupTaskBlocker } from './types.ts'
export class GroupWorkerBlockedError extends Error {
  readonly name = 'GroupWorkerBlockedError'
  constructor(readonly blockingReason: GroupTaskBlocker['reason'], message: string) { super(message) }
}
