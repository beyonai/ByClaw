/**
 * `@byclaw/shared` — the remote-agent delegation closure shared between
 * `baiying-enhance` and `byclaw-acp-adapter`.
 *
 * Consumers import from the specific module files (e.g.
 * `../../shared/src/call-agent.js`) so esbuild `--bundle` can tree-shake; this
 * barrel exists for discoverability and type checking.
 */

export * from "./executor-types.js";
export * from "./errors.js";
export * from "./debug-channel.js";
export * from "./call-agent-doc.js";
export * from "./call-agent.js";
export * from "./channel-session-resolve.js";
export * from "./remote-task-log.js";
export * from "./delegated-tool-details.js";
export * from "./langfuse-observation.js";
export * from "./langfuse-session-backfill.js";
export * from "./langfuse-tool-observation.js";
