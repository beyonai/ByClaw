/**
 * Shared web-tree-sitter runtime behind the wasm-parsed language evaluators.
 *
 * One parser per language, loaded lazily and cached for the process: the
 * grammar wasm is resolved out of its own npm package rather than a hardcoded
 * node_modules path, so the exact-pinned dependency that carries the bytes is
 * also the only thing that locates them. The pin matters because the grammar
 * version is part of the hash domain — bumping it is a deliberate migration
 * that stales every content-hash anchor of that language once (see types.ts).
 *
 * The token-stream serializer here is the language evaluators' normalization
 * core: leaf tokens kept verbatim (string contents included), comments
 * dropped, block boundaries marked where a language asks for them, and a
 * container's trailing comma dropped where it is formatter noise.
 *
 * A declaration is a sequence of nodes rather than one, because two languages
 * need it: Rust attaches `#[derive(...)]` as a sibling of the item it
 * modifies, and Java's overloads of one name are hashed as a single unit. One
 * node is the sequence of length one, serialized identically.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/tree-sitter
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Language, Parser } from 'web-tree-sitter'
import type { Node, Tree } from 'web-tree-sitter'

/** Prefix carried in every hash value so the algorithm travels with it. */
const ALGORITHM = 'sha1'

const require = createRequire(import.meta.url)

/** Loaded parsers, one per grammar wasm; a language is paid for once. */
const parsers = new Map<string, Promise<Parser>>()

/**
 * Initialize the runtime and load one grammar.
 * @param wasmResource - the grammar wasm as a module specifier, e.g.
 *   `tree-sitter-python/tree-sitter-python.wasm`.
 * @returns a parser speaking that language.
 */
async function loadParser(wasmResource: string): Promise<Parser> {
  await Parser.init()
  const language = await Language.load(require.resolve(wasmResource))
  const parser = new Parser()
  parser.setLanguage(language)
  return parser
}

/**
 * The cached parser for one grammar wasm, loading it on first use.
 * @param wasmResource - the grammar wasm as a module specifier.
 * @returns the shared parser; callers must not dispose it.
 */
function parserFor(wasmResource: string): Promise<Parser> {
  let loading = parsers.get(wasmResource)
  if (loading === undefined) {
    loading = loadParser(wasmResource)
    parsers.set(wasmResource, loading)
  }
  return loading
}

/**
 * Parse one source text and hand its root to `use`, releasing the tree's wasm
 * memory afterwards — the parser is long-lived, its trees are not.
 * @param wasmResource - the grammar wasm as a module specifier.
 * @param source - the text to parse.
 * @param use - synchronous consumer of the root node; nothing derived from a
 *   node may escape it, the tree is gone when it returns.
 * @returns whatever `use` returned.
 */
export async function withTree<T>(wasmResource: string, source: string, use: (root: Node) => T): Promise<T> {
  const parser = await parserFor(wasmResource)
  // parse() is typed nullable for the cancellation options this call never
  // passes; a plain string parse always yields a tree.
  const tree = parser.parse(source) as Tree
  try {
    return use(tree.rootNode)
  } finally {
    tree.delete()
  }
}

/** What one language declares to be formatting rather than meaning. */
export interface TokenStreamOptions {
  /** Node types dropped whole; comments in every language served here. */
  readonly commentTypes: ReadonlySet<string>
  /**
   * Node types whose boundaries are marked explicitly in the stream. A
   * language whose blocks are delimited by tokens (Go's `{` `}`) passes an
   * empty set; one whose blocks are indentation (Python) needs the markers,
   * because a statement moved out of an `if` must move the hash even though
   * the token sequence alone would not change.
   */
  readonly blockTypes: ReadonlySet<string>
  /**
   * Container node types whose trailing comma is formatter noise (black's
   * magic trailing comma, gofmt's mandatory comma in exploded composite
   * literals). Only a comma immediately before the container's closing
   * delimiter is dropped; every other comma is meaning.
   */
  readonly inertTrailingCommaTypes: ReadonlySet<string>
}

/** The delimiters a dropped trailing comma must sit directly in front of. */
const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}'])

/**
 * One node's children with an inert trailing comma removed.
 * @param node - a non-leaf node being serialized.
 * @param options - the language's formatting dimensions.
 * @returns the children to serialize, in order.
 */
function childrenToSerialize(node: Node, options: TokenStreamOptions): readonly Node[] {
  const children = node.children
  if (!options.inertTrailingCommaTypes.has(node.type) || children.length < 2) return children
  // A non-leaf node always has at least the two children indexed here.
  const closer = children[children.length - 1] as Node
  const comma = children[children.length - 2] as Node
  if (comma.type !== ',' || !CLOSERS.has(closer.type)) return children
  return [...children.slice(0, -2), closer]
}

/**
 * Serialize one declaration to the leaf-token stream its hash is taken over:
 * comments skipped, block edges marked, inert trailing commas dropped, leaf
 * text kept verbatim, tokens joined by single spaces. Whitespace BETWEEN
 * tokens never reaches the stream, which is what makes a formatter's
 * rewrapping invisible; whitespace INSIDE a leaf (a multi-line string) is
 * content and stays.
 * @param root - the declaration's node.
 * @param options - the language's formatting dimensions.
 * @returns the normalized single-line form.
 */
export function serializeTokens(root: Node, options: TokenStreamOptions): string {
  const pieces: string[] = []
  const walk = (node: Node): void => {
    if (options.commentTypes.has(node.type)) return
    const block = options.blockTypes.has(node.type)
    if (block) pieces.push('«')
    if (node.childCount === 0) pieces.push(node.text)
    else for (const child of childrenToSerialize(node, options)) walk(child)
    if (block) pieces.push('»')
  }
  walk(root)
  return pieces.join(' ')
}

/**
 * Hash one declaration's normalized token stream.
 * @param nodes - the nodes making up the declaration, in source order.
 * @param options - the language's formatting dimensions.
 * @returns `sha1:<hex>` over the serialized form.
 */
export function digestTokenStream(nodes: readonly Node[], options: TokenStreamOptions): string {
  const stream = nodes.map(node => serializeTokens(node, options)).join(' ')
  return `${ALGORITHM}:${createHash(ALGORITHM).update(stream).digest('hex')}`
}
