import type { BaiyingEnhanceLogger } from "./executor/debug-channel.js";

export type DocDeltaCallback = (
  chunk: string,
  accumulated: string,
  eventType: string,
) => void | Promise<void>;

/**
 * Runs the in-process TypeScript port of `skills/baiying/executor.py`.
 *
 * Executor modules are loaded on first call so plugin import/register stays light.
 */
export async function runBaiyingExecutor(params: {
  executorPath: string;
  resourceId: string;
  resourceType: string;
  payload: Record<string, unknown>;
  metadataOnly?: boolean;
  onDelta?: DocDeltaCallback;
  signal?: AbortSignal;
  logger?: BaiyingEnhanceLogger;
}): Promise<unknown> {
  const resourcesDir = resolveResourcesDir(params.executorPath);
  const { runBaiyingExecutor: runInProcessExecutor } = await import("./executor/index.js");
  return await runInProcessExecutor({
    resourcesDir,
    resourceId: params.resourceId,
    resourceType: params.resourceType,
    payload: (params.payload ?? {}) as Record<string, unknown>,
    metadataOnly: params.metadataOnly,
    onDelta: params.onDelta,
    signal: params.signal,
    logger: params.logger,
  });
}

function resolveResourcesDir(input: string): string {
  if (!input) return input;
  if (input.toLowerCase().endsWith(".py")) {
    const lastSlash = Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"));
    const dir = lastSlash >= 0 ? input.slice(0, lastSlash) : ".";
    return `${dir}/resources`;
  }
  return input;
}

export { buildExecutorResourceContext, compactText } from "./resource-metadata-context.js";
