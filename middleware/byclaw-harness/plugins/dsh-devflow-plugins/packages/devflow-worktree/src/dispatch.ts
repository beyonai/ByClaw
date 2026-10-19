/**
 * The fence's pure reads, published as their own package entry: what a
 * dispatch record is, and the two dispatch preconditions git can be asked
 * about. `/devflow doctor` consumes both so that a report and a veto describe
 * one fault in one wording.
 *
 * It is an entry of its own rather than part of the index because the index
 * value-imports `@deepseek-ai/dsh-skill` to register the bundled runbook, and
 * `devflow-command` — mounted by default where this plugin is not — neither
 * declares that package nor needs it to read a dispatch record. Nothing
 * reachable from here imports anything but node builtins, so a deployment can
 * load this entry without the worktree plugin being mounted at all.
 * @module @zhchxiao123/dsh-devflow-worktree/dispatch
 */

export { parseWorktreeDispatch } from './gate.ts'
export { createDispatchPreconditionChecker } from './preconditions.ts'
export type { WorktreeDispatch } from './types.ts'
