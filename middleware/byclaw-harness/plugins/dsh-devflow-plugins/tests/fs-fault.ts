/** Filesystem operations whose infrastructure failures are injected by specs. */
export type FaultableFsOperation = 'appendFile' | 'mkdir' | 'readFile' | 'readdir' | 'realpath' | 'rename'

type FaultCode = 'EACCES' | 'EBUSY' | 'EPERM'

interface PendingFsFault {
  readonly operation: FaultableFsOperation
  readonly path: string
  readonly code: FaultCode
}

const pending: PendingFsFault[] = []

/** Make the next matching filesystem operation reject on every host OS. */
export function injectFsAccessDenied(fault: Omit<PendingFsFault, 'code'>): void {
  pending.push({ ...fault, code: 'EACCES' })
}

/** Make the next matching filesystem operation reject with an exact host error. */
export function injectFsFailure(fault: PendingFsFault): void {
  pending.push(fault)
}

/** Run one real operation unless its exact operation/path fault is pending. */
export function runWithFsFault<T>(
  operation: FaultableFsOperation,
  path: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const normalizedPath = typeof path === 'string' ? path : ''
  const fault = takeFsFault(operation, normalizedPath)
  return fault === undefined ? run() : Promise.reject(fault)
}

function takeFsFault(operation: FaultableFsOperation, path: string): NodeJS.ErrnoException | undefined {
  const index = pending.findIndex(fault => fault.operation === operation && fault.path === path)
  if (index < 0) return undefined
  const fault = pending[index]
  if (fault === undefined) return undefined
  pending.splice(index, 1)
  return Object.assign(new Error(`${fault.code}: injected ${operation} failure for ${path}`), { code: fault.code })
}

/** Keep an unconsumed fault from leaking into the next spec. */
export function resetFsFaults(): void {
  pending.length = 0
}
