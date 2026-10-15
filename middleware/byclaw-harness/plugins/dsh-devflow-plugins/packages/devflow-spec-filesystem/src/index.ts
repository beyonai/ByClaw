/**
 * Service Provider for `ctx.devflowSpec`: architecture documents under
 * `.devflow/spec/`, with anchors evaluated against the working tree.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem
 */

export { evaluateAnchor, evaluateAnchors } from './anchor-eval.ts'
export type { AnchorEvaluationContext, AnchorSourceCache } from './anchor-eval.ts'
export { decodeSpecFile, encodeSpecFile } from './document.ts'
export type { SpecFile } from './document.ts'
export { ANCHORABLE_EXTENSIONS } from './evaluators/registry.ts'
export { findSymbolText, hashSymbol, normalizeSymbolBody } from './evaluators/typescript.ts'
export { createLastCommitAt, isGitRepository } from './git.ts'
export { Config, FilesystemDevflowSpecStore } from './store.ts'
export { default } from './store.ts'
