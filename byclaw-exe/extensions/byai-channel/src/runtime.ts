/**
 * Plugin runtime singleton shared across bundled entry chunks (index,
 * channel-plugin-api, runtime-setter-api). Uses globalThis so esbuild splits
 * do not create duplicate module-level state.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const {
  setRuntime: setByaiRuntime,
  tryGetRuntime: getOptionalByaiRuntime,
  getRuntime: getByaiRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "byai-channel",
  errorMessage: "ByAI Channel runtime not initialized - plugin not registered",
});

export { getByaiRuntime, getOptionalByaiRuntime, setByaiRuntime };
