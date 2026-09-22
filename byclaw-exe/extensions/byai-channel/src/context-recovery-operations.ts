import { ByaiContextError } from "./context-errors.js";
import { buildContextFailureText } from "./i18n.js";

const SLOT = Symbol.for("byclaw.contextRecoveryOperations");
const MAX_TRACKED_OPERATIONS = 256;
type Operation = { uncertain: boolean };
const shared = globalThis as typeof globalThis & { [SLOT]?: Map<string, Operation> };
function operations(): Map<string, Operation> {
  return shared[SLOT] ??= new Map();
}

/** Normal requests only do this map lookup; never poll or read transcripts. */
export function assertContextRecoveryIdle(sessionKey: string, language?: string): void {
  if (operations().has(sessionKey)) {
    throw new ByaiContextError("operation_pending", buildContextFailureText(language, "operation_pending"));
  }
}

function reserve(sessionKey: string, alreadyRunning = false, language?: string): Operation {
  assertContextRecoveryIdle(sessionKey, language);
  if (!alreadyRunning && operations().size >= MAX_TRACKED_OPERATIONS) {
    throw new ByaiContextError("recovery_failed", buildContextFailureText(language, "recovery_failed"));
  }
  const operation = { uncertain: false };
  operations().set(sessionKey, operation);
  return operation;
}

function release(sessionKey: string, operation: Operation): void {
  if (operations().get(sessionKey) === operation) operations().delete(sessionKey);
}

/** A local abort only stops waiting. Retain protection until the original dispatch settles. */
export function retainUnsettledContextDispatch(sessionKey: string, promise: Promise<void>, language?: string): void {
  const operation = reserve(sessionKey, true, language);
  void promise.then(() => release(sessionKey, operation), () => release(sessionKey, operation));
}

/**
 * An RPC rejection does not prove the server stopped. Keep an uncertain operation
 * quarantined; no TTL silently releases it. Resolved RPC results release it normally.
 * Records hold no history/credentials and admission is capped to bound memory.
 */
export async function withTrackedContextCompaction<T>(sessionKey: string, run: () => Promise<T>, language?: string): Promise<T> {
  const operation = reserve(sessionKey, false, language);
  try {
    const result = await run();
    release(sessionKey, operation);
    return result;
  } catch (error) {
    // These explicit pre-execution rejections cannot have started a compaction.
    if (error instanceof Error && /^(?:Unauthorized|Forbidden|Gateway requests are only available to bundled or trusted official plugins\.)$/i.test(error.message)) {
      release(sessionKey, operation);
    } else {
      operation.uncertain = true;
    }
    throw error;
  }
}

export function resetContextRecoveryOperationsForTest(): void {
  operations().clear();
}
