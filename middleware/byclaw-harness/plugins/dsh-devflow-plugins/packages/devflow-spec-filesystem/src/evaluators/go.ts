/**
 * Go evaluator (`.go`): top-level symbol lookup and body normalization behind
 * `symbol` / `content-hash` anchors.
 *
 * A top-level symbol is a `func`, `type`, `var`, or `const` declaration, or a
 * method cited as `Type.Name` (receiver's base type, `*` stripped); a bare
 * method name is not claimed, because several receiver types may carry the
 * same one. Any name inside a grouped `const (...)` / `var (...)` /
 * `type (...)` anchors the whole declaration block — the same "either name
 * resolves to the whole statement" rule the TypeScript evaluator applies to
 * multi-declarator statements, and with `iota` a single spec line is not a
 * meaningful unit anyway. Lookup over a file that no longer parses cleanly is
 * best-effort, as in the Python evaluator: what an ERROR node swallowed
 * reports as undeclared, and `stale` is the honest verdict.
 *
 * Decisions in the hash domain, recorded here because changing any of them
 * stales every Go content-hash anchor at once:
 * - No semicolon rule. gofmt output carries no line-end semicolons and a
 *   `for` clause's `;` is semantics — this is the "Go may need no extra
 *   dimension" question from the design, answered: nothing is stripped.
 * - Newline removal is not a reformat here: Go's semicolon insertion makes
 *   line structure change what is parsed, so invariance is promised only for
 *   legal rewraps — tabs vs spaces, blank lines, intra-line spacing, and
 *   gofmt's trailing comma in exploded composite literals.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/go
 */

import { digestTokenStream, withTree } from './tree-sitter.ts'
import type { TokenStreamOptions } from './tree-sitter.ts'
import type { LanguageEvaluator } from './types.ts'
import type { Node } from 'web-tree-sitter'

/** The grammar wasm, resolved out of its own exact-pinned package. */
const WASM = 'tree-sitter-go/tree-sitter-go.wasm'

/**
 * Go's formatting dimensions. No block markers: `{` and `}` are tokens, so
 * the structure is already in the stream.
 */
const OPTIONS: TokenStreamOptions = {
  commentTypes: new Set(['comment']),
  blockTypes: new Set<string>(),
  inertTrailingCommaTypes: new Set(['literal_value', 'parameter_list', 'argument_list', 'expression_list']),
}

/**
 * Every name a method declaration is citable as: `Type.Name` per receiver
 * type, `*` stripped. A method whose receiver declares no type — parseable
 * only in a broken file — yields no name at all rather than a bare one.
 * @param method - the `method_declaration` node.
 * @returns the citable names, usually exactly one.
 */
function methodNames(method: Node): string[] {
  return method.childrenForFieldName('receiver')
    .flatMap(list => list.namedChildren)
    .flatMap(parameter => parameter.childrenForFieldName('type'))
    .flatMap(type => method.childrenForFieldName('name').map(name => `${type.text.replace(/^\*/, '')}.${name.text}`))
}

/**
 * Whether one top-level declaration declares `symbol`, unrolling grouped and
 * multi-name specs.
 * @param declaration - a direct child of the source file's root.
 * @param symbol - the symbol name being looked up.
 * @returns `true` when any name in the declaration matches.
 */
function declares(declaration: Node, symbol: string): boolean {
  switch (declaration.type) {
    case 'function_declaration':
      return declaration.childrenForFieldName('name').some(name => name.text === symbol)
    case 'method_declaration':
      return methodNames(declaration).includes(symbol)
    case 'type_declaration':
      return declaration.namedChildren.some(spec =>
        (spec.type === 'type_spec' || spec.type === 'type_alias') && spec.childrenForFieldName('name').some(name => name.text === symbol))
    case 'const_declaration':
    case 'var_declaration':
      // A spec's `name` field holds each declared identifier; an interleaved
      // comment node has no such field and falls out on its own.
      return declaration.namedChildren.some(spec => spec.childrenForFieldName('name').some(name => name.text === symbol))
    default:
      return false
  }
}

/**
 * Locate the top-level declaration of `symbol`; the first declaration wins,
 * matching the TypeScript evaluator's first-hit rule.
 * @param file - the parsed file's root node.
 * @param symbol - the symbol name being looked up.
 * @returns the whole declaration — the full group for grouped specs — or
 *   `undefined` when the file declares no such symbol.
 */
function findDeclaration(file: Node, symbol: string): Node | undefined {
  return file.namedChildren.find(declaration => declares(declaration, symbol))
}

/** The Go evaluator. */
export const goEvaluator: LanguageEvaluator = {
  extensions: ['.go'],
  lookup(source: string, symbol: string) {
    return withTree(WASM, source, (root) => {
      const declaration = findDeclaration(root, symbol)
      if (declaration === undefined) return { declared: false, hash: undefined }
      return { declared: true, hash: digestTokenStream([declaration], OPTIONS) }
    })
  },
}
