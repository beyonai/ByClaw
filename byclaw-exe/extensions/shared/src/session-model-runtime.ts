/**
 * The enhance extension prepares model providers before the channel captures
 * the config for a run. A process-global slot survives separate plugin bundles.
 */
type SessionModelPreparer = (sessionId: string) => Promise<void>;
const SLOT = Symbol.for("byclaw.session-model-preparer");
const state = globalThis as typeof globalThis & { [SLOT]?: SessionModelPreparer };

export function setSessionModelPreparer(preparer: SessionModelPreparer | undefined): void {
  if (preparer) state[SLOT] = preparer;
  else delete state[SLOT];
}

export async function prepareSessionModelForDispatch(sessionId: string): Promise<void> {
  await state[SLOT]?.(sessionId);
}
