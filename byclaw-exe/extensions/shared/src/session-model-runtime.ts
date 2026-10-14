/**
 * The enhance extension prepares model providers before the channel captures
 * the config for a run. A process-global slot survives separate plugin bundles.
 */
export type RunModelSnapshot = {
  schemaVersion: 1;
  runId: string;
  selectionMode: "auto";
  modelId: string;
  modelConfigVersion: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive" | "max";
  policyVersion: string;
};
type SessionModelPreparer = (sessionId: string, snapshot?: RunModelSnapshot, sessionKey?: string) => Promise<void>;
const SLOT = Symbol.for("byclaw.session-model-preparer");
const state = globalThis as typeof globalThis & { [SLOT]?: SessionModelPreparer };
const RUN_SLOT = Symbol.for("byclaw.run-model-snapshots");
const runState = globalThis as typeof globalThis & { [RUN_SLOT]?: Map<string, RunModelSnapshot> };
const snapshots = runState[RUN_SLOT] ??= new Map<string, RunModelSnapshot>();

export function parseRunModelSnapshot(raw: unknown): RunModelSnapshot | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid run_model");
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.selectionMode !== "auto" || typeof value.runId !== "string" || !value.runId ||
      typeof value.modelId !== "string" || !/^[1-9]\d*$/.test(value.modelId) ||
      typeof value.modelConfigVersion !== "string" || !value.modelConfigVersion ||
      typeof value.policyVersion !== "string" || !value.policyVersion ||
      typeof value.thinkingLevel !== "string" || !["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max"].includes(value.thinkingLevel)) {
    throw new Error("Invalid Auto run_model snapshot");
  }
  return value as RunModelSnapshot;
}

export function bindRunModelSnapshot(sessionKey: string, snapshot?: RunModelSnapshot): void {
  if (snapshot) snapshots.set(sessionKey, snapshot);
  else snapshots.delete(sessionKey);
}

export function getRunModelSnapshot(sessionKey?: string): RunModelSnapshot | undefined {
  return sessionKey ? snapshots.get(sessionKey) : undefined;
}

export function setSessionModelPreparer(preparer: SessionModelPreparer | undefined): void {
  if (preparer) state[SLOT] = preparer;
  else delete state[SLOT];
}
export async function prepareSessionModelForDispatch(sessionId: string, snapshot?: RunModelSnapshot, sessionKey?: string): Promise<void> {
  if (snapshot && !state[SLOT]) throw new Error("Auto model preparer unavailable");
  await state[SLOT]?.(sessionId, snapshot, sessionKey);
}
