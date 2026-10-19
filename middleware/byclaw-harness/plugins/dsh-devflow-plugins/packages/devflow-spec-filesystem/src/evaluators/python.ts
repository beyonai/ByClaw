/**
 * Python evaluator (`.py` / `.pyi`): top-level symbol lookup and body
 * normalization behind `symbol` / `content-hash` anchors.
 *
 * A top-level symbol is a module-level `def`, `class`, or single-name
 * assignment; a decorated definition matches by its inner name but hashes the
 * whole decorated statement, because changing a decorator changes behavior.
 * Lookup over a file that no longer parses cleanly is best-effort: statements
 * the parser still recognizes at the top level are found, and a declaration
 * swallowed by an ERROR node reports as undeclared — a symbol lost to a
 * half-written file has genuinely stopped being checkable, and `stale` is the
 * honest verdict.
 *
 * Decisions in the hash domain, recorded here because changing any of them
 * stales every Python content-hash anchor at once:
 * - Docstrings stay in the hash. They are runtime-observable through
 *   `__doc__`, and stripping them would put a "first statement of a block"
 *   position rule into the hash domain for less than it costs.
 * - Quote style is not normalized: `'x'` and `"x"` hash differently. The
 *   TypeScript evaluator does not normalize quotes either; a formatter's
 *   one-time quote unification stales each touched file once, accepted.
 * - black's formatting dimensions: line rewrapping and indent width are
 *   absorbed by the token stream, the magic trailing comma by the inert
 *   trailing-comma rule, and quote unification is the accepted hash move.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/python
 */

import { digestTokenStream, withTree } from './tree-sitter.ts'
import type { TokenStreamOptions } from './tree-sitter.ts'
import type { LanguageEvaluator } from './types.ts'
import type { Node } from 'web-tree-sitter'

/** The grammar wasm, resolved out of its own exact-pinned package. */
const WASM = 'tree-sitter-python/tree-sitter-python.wasm'

/**
 * Python's formatting dimensions. Indentation is semantics here, so `block`
 * boundaries are marked: without them, a statement moved out of an `if` would
 * serialize to the same token sequence. `tuple` is deliberately absent from
 * the trailing-comma containers — `(1,)` and `(1)` differ in meaning, so a
 * tuple's comma stays in the hash.
 */
const OPTIONS: TokenStreamOptions = {
  commentTypes: new Set(['comment']),
  blockTypes: new Set(['block']),
  inertTrailingCommaTypes: new Set(['parameters', 'argument_list', 'list', 'dictionary', 'set']),
}

/**
 * Whether a definition node declares `symbol` by name.
 * @param definition - a candidate `def` / `class` node.
 * @param symbol - the symbol name being looked up.
 * @returns `true` for a function or class definition of that name.
 */
function definesName(definition: Node, symbol: string): boolean {
  if (definition.type !== 'function_definition' && definition.type !== 'class_definition') return false
  return definition.childrenForFieldName('name').some(name => name.text === symbol)
}

/**
 * Whether an expression is a `symbol = value` binding, with or without a type
 * annotation. Only the plain single-identifier form declares a citable name:
 * unpacking and chained assignments spread one statement over several names
 * whose "declaration" is not the statement, and augmented assignment mutates
 * rather than declares — none of them are claimed.
 * @param expression - a child of a module-level expression statement.
 * @param symbol - the symbol name being looked up.
 * @returns `true` when the expression binds exactly that name.
 */
function bindsAssignment(expression: Node, symbol: string): boolean {
  if (expression.type !== 'assignment') return false
  if (expression.childrenForFieldName('right').some(right => right.type === 'assignment')) return false
  return expression.childrenForFieldName('left').some(left => left.type === 'identifier' && left.text === symbol)
}

/**
 * Locate the top-level statement declaring `symbol`. "Top level" is lexical —
 * a definition inside an `if` or another `def` is not citable, matching the
 * TypeScript evaluator's direct-child rule — and the first declaration of a
 * re-bound name wins, matching its first-hit rule.
 * @param module - the parsed module's root node.
 * @param symbol - the symbol name being looked up.
 * @returns the whole declaring statement, or `undefined` when the module
 *   declares no such symbol.
 */
function findDeclaration(module: Node, symbol: string): Node | undefined {
  for (const statement of module.namedChildren) {
    if (definesName(statement, symbol)) return statement
    if (statement.type === 'decorated_definition' && statement.namedChildren.some(inner => definesName(inner, symbol))) return statement
    if (statement.type === 'expression_statement' && statement.namedChildren.some(child => bindsAssignment(child, symbol))) return statement
  }
  return undefined
}

/** The Python evaluator. */
export const pythonEvaluator: LanguageEvaluator = {
  extensions: ['.py', '.pyi'],
  lookup(source: string, symbol: string) {
    return withTree(WASM, source, (root) => {
      const declaration = findDeclaration(root, symbol)
      if (declaration === undefined) return { declared: false, hash: undefined }
      return { declared: true, hash: digestTokenStream([declaration], OPTIONS) }
    })
  },
}
