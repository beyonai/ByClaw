// Narrow runtime-setter sidecar: lets the bundled entry inject the active
// PluginRuntime without importing the full channel implementation eagerly.
export { setByaiRuntime } from "./src/runtime.js";
