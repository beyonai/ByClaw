/**
 * Extension-keyed dispatch to the language evaluators.
 *
 * A file no evaluator claims is unevaluable for symbolic anchors, never fresh:
 * only a churn anchor can watch it, and the caller owns saying so in the
 * vocabulary its consumers already quote.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/registry
 */

import { goEvaluator } from './go.ts'
import { javaEvaluator } from './java.ts'
import { pythonEvaluator } from './python.ts'
import { rustEvaluator } from './rust.ts'
import { typescriptEvaluator } from './typescript.ts'
import type { LanguageEvaluator } from './types.ts'

/** Every registered evaluator; adding a language is one entry here. */
const EVALUATORS: readonly LanguageEvaluator[] = [typescriptEvaluator, pythonEvaluator, goEvaluator, rustEvaluator, javaEvaluator]

/**
 * Every extension some evaluator claims, deduplicated, in registry order.
 *
 * This is the registry's public denominator face: a file with one of these
 * extensions is one a symbolic anchor can point at, and a consumer asking
 * "how much of this directory could documents anchor" must ask here rather
 * than keep its own list — a second copy would answer the question for a set
 * of languages this line no longer has.
 */
export const ANCHORABLE_EXTENSIONS: readonly string[] = Object.freeze([...new Set(EVALUATORS.flatMap(evaluator => evaluator.extensions))])

/**
 * The evaluator claiming one anchored file's extension.
 * @param file - the anchor's repository-relative file path.
 * @returns the evaluator, or `undefined` when no language claims the file.
 */
export function evaluatorFor(file: string): LanguageEvaluator | undefined {
  return EVALUATORS.find(evaluator => evaluator.extensions.some(extension => file.endsWith(extension)))
}
