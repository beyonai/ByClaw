import { AsyncLocalStorage } from "node:async_hooks";

export interface DeliveryScope {
  signal: AbortSignal;
  recovered: boolean;
  sessionId: string;
  leaseKey: string;
  token: string;
  failure?: Error;
  assertOwned(): Promise<void>;
}
const storage = new AsyncLocalStorage<DeliveryScope>();
export function currentDelivery(): DeliveryScope | undefined { return storage.getStore(); }
export function withDeliveryScope<T>(scope: DeliveryScope, action: () => T): T { return storage.run(scope, action); }
export class WorkerDeliveryRetryError extends Error {
  constructor(cause: unknown) {
    super("Worker delivery interrupted; pending message remains recoverable", { cause });
  }
}
export class DeliveryOwnershipLostError extends WorkerDeliveryRetryError {
  constructor() { super(undefined); this.message = "Worker delivery lease lost; pending message remains recoverable"; }
}
export function retryWorkerDelivery(error: unknown): WorkerDeliveryRetryError {
  const retry = error instanceof WorkerDeliveryRetryError ? error : new WorkerDeliveryRetryError(error);
  const scope = currentDelivery();
  if (scope) scope.failure = retry;
  return retry;
}
