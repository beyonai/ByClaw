/**
 * Rust evaluator (`.rs`): top-level symbol lookup and body normalization behind
 * `symbol` / `content-hash` anchors.
 *
 * A top-level symbol is any named item — `fn`, `struct`, `enum`, `union`,
 * `trait`, `type`, `const`, `static`, `mod`, `macro_rules!` — plus the items
 * inside an `impl` or `trait` body, cited `Type.name` after Go's receiver
 * precedent. Lookup over a file that no longer parses cleanly is best-effort,
 * as in the Python and Go evaluators: what an ERROR node swallowed reports as
 * undeclared, and `stale` is the honest verdict.
 *
 * Decisions this evaluator had to make, recorded with their consequences:
 * - **`macro_rules!` is claimed.** A macro definition is a named top-level item
 *   like any other, and one that Rust codebases put real behavior in; leaving
 *   it uncitable would be a gap with nothing bought. Comments inside a macro
 *   body are ordinary comment nodes, so they normalize away like the rest.
 * - **The generic parameters of an `impl` are not part of the cited name.**
 *   `impl<T> Foo<T> { fn bar }` is `Foo.bar`, not `Foo<T>.bar` — the self type
 *   is unwrapped to its base name, so the citation does not move when a type
 *   parameter is added, renamed, or bounded.
 * - **A trait impl is cited by its self type, never by the trait.**
 *   `impl Display for Foo { fn fmt }` is `Foo.fmt`. The subject of a document
 *   is the type that behaves, and `Trait.name` would collide across every type
 *   implementing it. Two impls may therefore offer the same name — a type
 *   implementing `From<A>` and `From<B>` has two `Foo.from` — and the first in
 *   the file wins, matching the TypeScript evaluator's first-hit rule.
 * - **An `impl` for something with no base name claims nothing.** `impl [u8]`,
 *   `impl (A, B)`, `impl u32` yield no citable member names rather than a bare
 *   one, the same refusal Go makes for a receiver a broken file left typeless.
 * - **An inline `mod` anchors whole.** Items inside it are reached by citing
 *   the module, not by a `mod::item` path: `Type.name` is one level deep by
 *   construction, and a module is itself one declaration.
 * - **A struct's or enum's fields are not separately citable.** They sit inside
 *   the type's own declaration, so the type is the unit — where Go leaves them
 *   too. Java's fields are citable for the converse reason: there each one is a
 *   declaration of its own. The line is the grammar's, not a preference.
 *
 * Decisions in the hash domain, recorded here because changing any of them
 * stales every Rust content-hash anchor at once:
 * - **Doc comments are dropped with every other comment**, `///` and `//!`
 *   included. The rule separating this from the Python evaluator, which keeps
 *   docstrings, is runtime observability: a Python docstring is a value on
 *   `__doc__`, while a Rust doc comment reaches rustdoc and metadata and never
 *   a running program. The consequence is an asymmetry worth stating: `///` is
 *   sugar for `#[doc = "…"]`, and the desugared attribute IS hashed, so the
 *   two forms of the same documentation hash differently. Hand-written `#[doc]`
 *   is rare enough to accept that over putting prose in the hash domain.
 * - **Attributes are hashed with the item they modify.** `#[derive(Serialize)]`
 *   and `#[cfg(test)]` change behavior, and the Python evaluator already hashes
 *   decorators with their definition; Rust only makes them siblings rather than
 *   a wrapper node, which is why a declaration here is a node sequence.
 * - **Semicolons stay.** Unlike TypeScript's, a Rust `;` is not a formatting
 *   choice: it is what separates a statement from the block's trailing
 *   expression, which is the return value.
 * - rustfmt's dimensions: line rewrapping, indentation, and attribute
 *   placement are absorbed by the token stream — with no semicolon insertion
 *   to worry about, newline removal is a legal reformat here, which is not
 *   true of Go — and the trailing comma rustfmt adds when it explodes a
 *   container is dropped for the containers listed below. `tuple_expression`
 *   is deliberately absent from them: `(1,)` is not `(1)`, the same carve-out
 *   the Python evaluator makes.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/rust
 */

import { digestTokenStream, withTree } from './tree-sitter.ts'
import type { TokenStreamOptions } from './tree-sitter.ts'
import type { LanguageEvaluator } from './types.ts'
import type { Node } from 'web-tree-sitter'

/** The grammar wasm, resolved out of its own exact-pinned package. */
const WASM = 'tree-sitter-rust/tree-sitter-rust.wasm'

/** Both comment forms; the doc-comment spellings are these node types too. */
const COMMENT_TYPES: ReadonlySet<string> = new Set(['line_comment', 'block_comment'])

/**
 * Rust's formatting dimensions. No block markers: `{` and `}` are tokens, so
 * the structure is already in the stream.
 */
const OPTIONS: TokenStreamOptions = {
  commentTypes: COMMENT_TYPES,
  blockTypes: new Set<string>(),
  inertTrailingCommaTypes: new Set([
    'arguments',
    'parameters',
    'array_expression',
    'field_initializer_list',
    'field_declaration_list',
    'ordered_field_declaration_list',
    'enum_variant_list',
    'struct_pattern',
    'use_list',
  ]),
}

/** Item node types carrying a `name` field, at file level or inside a body. */
const NAMED_ITEMS: ReadonlySet<string> = new Set([
  'function_item',
  'function_signature_item',
  'struct_item',
  'enum_item',
  'union_item',
  'trait_item',
  'type_item',
  'associated_type',
  'const_item',
  'static_item',
  'mod_item',
  'macro_definition',
])

/**
 * The base name of an `impl` block's self type, generics and references peeled
 * away.
 * @param type - the `impl_item`'s `type` field.
 * @returns the citable type name, or `undefined` for a self type that has none.
 */
function baseTypeName(type: Node): string | undefined {
  switch (type.type) {
    case 'type_identifier':
      return type.text
    case 'generic_type':
    case 'reference_type':
      return type.childrenForFieldName('type').map(baseTypeName).at(0)
    case 'scoped_type_identifier':
      return type.childrenForFieldName('name').map(baseTypeName).at(0)
    default:
      return undefined
  }
}

/**
 * The type name whose body's items are cited `Type.name`.
 * @param item - a file-level item.
 * @returns the owning type's name, or `undefined` when the item has no body
 *   whose members are citable that way.
 */
function ownerName(item: Node): string | undefined {
  if (item.type === 'impl_item') return item.childrenForFieldName('type').map(baseTypeName).at(0)
  if (item.type === 'trait_item') return item.childrenForFieldName('name').map(name => name.text).at(0)
  return undefined
}

/**
 * Whether one item declares `symbol`.
 * @param item - the candidate item node.
 * @param owner - the enclosing type's name for an associated item, `undefined`
 *   at file level.
 * @returns `true` when the item's declared name, qualified by `owner`, matches.
 */
function declares(item: Node, symbol: string, owner: string | undefined): boolean {
  if (!NAMED_ITEMS.has(item.type)) return false
  return item.childrenForFieldName('name').some(name => (owner === undefined ? name.text : `${owner}.${name.text}`) === symbol)
}

/**
 * One item together with the attributes that modify it — its immediately
 * preceding `#[...]` siblings, comments between them ignored.
 * @param item - the declaring item node.
 * @returns the declaration's nodes in source order.
 */
function withAttributes(item: Node): Node[] {
  const attributes: Node[] = []
  let previous = item.previousNamedSibling
  while (previous !== null && (previous.type === 'attribute_item' || COMMENT_TYPES.has(previous.type))) {
    if (previous.type === 'attribute_item') attributes.unshift(previous)
    previous = previous.previousNamedSibling
  }
  return [...attributes, item]
}

/**
 * Locate the declaration of `symbol`; the first one in the file wins, matching
 * the TypeScript evaluator's first-hit rule.
 * @param file - the parsed file's root node.
 * @param symbol - the symbol name being looked up, `Type.name` for an item
 *   inside an `impl` or `trait` body.
 * @returns the declaration's nodes, or `undefined` when the file declares no
 *   such symbol.
 */
function findDeclaration(file: Node, symbol: string): Node[] | undefined {
  for (const item of file.namedChildren) {
    if (declares(item, symbol, undefined)) return withAttributes(item)
    const owner = ownerName(item)
    if (owner === undefined) continue
    for (const body of item.childrenForFieldName('body')) {
      const member = body.namedChildren.find(child => declares(child, symbol, owner))
      if (member !== undefined) return withAttributes(member)
    }
  }
  return undefined
}

/** The Rust evaluator. */
export const rustEvaluator: LanguageEvaluator = {
  extensions: ['.rs'],
  lookup(source: string, symbol: string) {
    return withTree(WASM, source, (root) => {
      const declaration = findDeclaration(root, symbol)
      if (declaration === undefined) return { declared: false, hash: undefined }
      return { declared: true, hash: digestTokenStream(declaration, OPTIONS) }
    })
  },
}
