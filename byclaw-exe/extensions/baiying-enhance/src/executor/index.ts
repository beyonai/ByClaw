/**
 * In-process TypeScript port of `byclaw-exe/skills/baiying/executor.py`.
 *
 * Resource-type dispatch is split into small modules under `src/executor/`:
 * - `resource-types/toolkit.ts` — `_execute_toolkit`
 * - `resource-types/tool.ts`    — `_execute_tool`
 * - `resource-types/agent.ts`   — `_execute_agent` (SSE streaming)
 * - `resource-types/mcp.ts`     — `_execute_mcp` (MCP/OBJECT/VIEW)
 * - `resource-types/doc.ts`     — `_execute_doc` (KG_DOC/KG_DB/KG_QA, Redis polling)
 *
 * Shared utilities live in `auth.ts`, `http.ts`, `schema.ts`, `doc-redis.ts`,
 * `capability-builder.ts`, `capability-resolver.ts`, `mcp-client.ts`, etc.
 */

import type { Dict, ExecutorResponse } from "./types.js";
import { BaiyingExecutor } from "./executor.js";
import type { DocDeltaCallback } from "./doc-shared.js";
import type { BaiyingEnhanceLogger } from "./debug-channel.js";

export { BaiyingExecutor } from "./executor.js";
export type { BaiyingExecutorOptions } from "./executor.js";
export type { ExecutorResponse } from "./types.js";
export type { DocDeltaCallback } from "./doc-shared.js";

/**
 * Shared in-process executor cache keyed by `resourcesDir`.
 * Each distinct resources directory gets its own instance so local snapshot
 * caches are reused across calls (mirrors Python's on-demand JSON reads).
 */
const executorCache = new Map<string, BaiyingExecutor>();

function getExecutor(resourcesDir: string): BaiyingExecutor {
  const key = resourcesDir;
  let instance = executorCache.get(key);
  if (!instance) {
    instance = new BaiyingExecutor({ resourcesDir });
    executorCache.set(key, instance);
  }
  return instance;
}

/** Clear the internal executor cache — primarily for tests. */
export function resetExecutorCache(): void {
  executorCache.clear();
}

/**
 * Drop-in replacement for the legacy Python-subprocess based runner.
 *
 * Accepts the same argument shape previously used in `resource-metadata.ts`
 * when spawning `executor.py`. Returns the parsed executor response (mirrors
 * what the Python CLI printed as JSON).
 */
export async function runBaiyingExecutor(params: {
  /** Path to `skills/baiying/resources` directory. */
  resourcesDir: string;
  resourceId: string;
  resourceType: string;
  payload: Dict;
  metadataOnly?: boolean;
  action?: string;
  /**
   * Streaming callback for DOC sync calls. Ignored for `metadataOnly` calls
   * and for non-DOC resources.
   */
  onDelta?: DocDeltaCallback;
  /** Cancellation signal, propagated to DOC polling. */
  signal?: AbortSignal;
  /** Host logger; used for request logs emitted by resource executors. */
  logger?: BaiyingEnhanceLogger;
}): Promise<ExecutorResponse> {
  const executor = getExecutor(params.resourcesDir);
  if (params.metadataOnly) {
    return await executor.describe({
      capabilityId: params.resourceId,
      resourceType: params.resourceType,
      payload: params.payload ?? {},
      logger: params.logger,
    });
  }
  return await executor.execute({
    capabilityId: params.resourceId,
    resourceType: params.resourceType,
    action: params.action,
    payload: params.payload ?? {},
    onDelta: params.onDelta,
    signal: params.signal,
    logger: params.logger,
  });
}
