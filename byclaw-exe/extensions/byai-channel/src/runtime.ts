/**
 * Plugin runtime singleton.
 * Stores the PluginRuntime from api.runtime (set during register()).
 * Used by message-processor.ts to access dispatch functions.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setByaiRuntime(r: PluginRuntime): void {
  runtime = r;
}

export function getByaiRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("ByAI Channel runtime not initialized - plugin not registered");
  }
  return runtime;
}
