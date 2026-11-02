/**
 * Java evaluator (`.java`): top-level symbol lookup and body normalization
 * behind `symbol` / `content-hash` anchors.
 *
 * A top-level symbol is a `class`, `interface`, `enum`, `record`, or
 * `@interface` declaration, and every member inside one is cited `Type.name`
 * after Go's receiver precedent: methods, constructors, fields, constants,
 * enum constants, annotation elements, and nested types. Lookup over a file
 * that no longer parses cleanly is best-effort, as in the other evaluators:
 * what an ERROR node swallowed reports as undeclared, and `stale` is the
 * honest verdict.
 *
 * Decisions this evaluator had to make, recorded with their consequences:
 * - **Overloads of one name are a single unit.** `Owner.getPet` resolves to
 *   every `getPet` the class declares, hashed together in source order, and
 *   `declared` is true when at least one exists. Java is the first language
 *   here where one name means several declarations, and taking the first would
 *   let an anchor keep reporting fresh while the overload the document
 *   actually describes was rewritten — a silent false fresh, which this
 *   subsystem treats as the expensive failure. The cost runs the other way and
 *   is the cheap one: editing any overload stales an anchor written about
 *   another. Go's grouped `const (...)` block already anchors by the same
 *   "one citable name, one hashed unit" rule.
 * - **Fields and methods share the citation space.** Java keeps them in
 *   separate namespaces, so `int count;` and `void count()` can coexist and
 *   both answer to `Type.count`; they then form one unit exactly as overloads
 *   do, for the same reason.
 * - **Nested types are separated by `.`** — `Owner.Pets`, `Owner.Pets.add` —
 *   because that is how Java source itself refers to a nested type, not the
 *   JVM's binary `Outer$Inner`. The consequence is that `Outer.Inner` is also
 *   the citation a field named `Inner` would take; the two then form one unit
 *   like overloads do, and the nested type's own members stay reachable at
 *   `Outer.Inner.name`. Java's naming conventions keep this theoretical.
 * - **Constructors are cited `Type.Type`**, which is what the general
 *   `Type.name` rule produces for a member whose declared name is the class
 *   name. All constructors are therefore one unit — every way to build the
 *   type, hashed together.
 *
 * Decisions in the hash domain, recorded here because changing any of them
 * stales every Java content-hash anchor at once:
 * - **Javadoc is dropped with every other comment.** The rule separating this
 *   from the Python evaluator, which keeps docstrings, is runtime
 *   observability: a Python docstring is a value on `__doc__`, while Javadoc
 *   reaches a doc tool and never a running program — it is not even in the
 *   class file.
 * - **Annotations are hashed.** They sit in the declaration's `modifiers`, so
 *   this is what the token stream does anyway, and it is the right answer:
 *   `@Transactional` and `@Column` are behavior. Excluding the inert ones
 *   would put an allowlist of annotation names inside the hash domain.
 * - **Semicolons stay**, the mirror image of the TypeScript evaluator's
 *   decision to drop them: Java's are mandatory, so no formatter can add or
 *   remove one and none is ever formatting noise.
 * - google-java-format's dimensions: line wrapping, indentation, and putting
 *   each annotation on its own line are absorbed by the token stream, and the
 *   trailing comma a formatter may leave in an array initializer or after the
 *   last enum constant is dropped. Java has no `(1,)` tuple, so unlike Python
 *   and Rust there is no container that needs carving out.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/java
 */

import { digestTokenStream, withTree } from './tree-sitter.ts'
import type { TokenStreamOptions } from './tree-sitter.ts'
import type { LanguageEvaluator } from './types.ts'
import type { Node } from 'web-tree-sitter'

/** The grammar wasm, resolved out of its own exact-pinned package. */
const WASM = 'tree-sitter-java/tree-sitter-java.wasm'

/**
 * Java's formatting dimensions. No block markers: `{` and `}` are tokens, so
 * the structure is already in the stream.
 */
const OPTIONS: TokenStreamOptions = {
  commentTypes: new Set(['line_comment', 'block_comment']),
  blockTypes: new Set<string>(),
  inertTrailingCommaTypes: new Set(['array_initializer', 'enum_body']),
}

/** Declarations that own a body whose members are cited through their name. */
const TYPE_DECLARATIONS: ReadonlySet<string> = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'annotation_type_declaration',
])

/** Members whose declared name sits directly in their `name` field. */
const NAMED_MEMBERS: ReadonlySet<string> = new Set([
  'method_declaration',
  'constructor_declaration',
  'compact_constructor_declaration',
  'enum_constant',
  'annotation_type_element_declaration',
])

/**
 * Every name one declaration declares, unqualified.
 * @param member - a file-level or body-level node.
 * @returns the declared names; several for a multi-declarator field, none for
 *   a node that declares nothing citable.
 */
function declaredNames(member: Node): string[] {
  if (TYPE_DECLARATIONS.has(member.type) || NAMED_MEMBERS.has(member.type)) {
    return member.childrenForFieldName('name').map(name => name.text)
  }
  if (member.type === 'field_declaration' || member.type === 'constant_declaration') {
    return member.childrenForFieldName('declarator').flatMap(declarator => declarator.childrenForFieldName('name').map(name => name.text))
  }
  return []
}

/**
 * The declarations one container holds. An enum's members past its `;` live in
 * a wrapper node that is flattened away, so a constant and a method of the
 * same enum are cited alike.
 * @param container - the file's root, or a type declaration.
 * @returns the member nodes, in source order.
 */
function membersOf(container: Node): readonly Node[] {
  if (container.type === 'program') return container.namedChildren
  return container.childrenForFieldName('body').flatMap(body =>
    body.namedChildren.flatMap(member => (member.type === 'enum_body_declarations' ? member.namedChildren : [member])))
}

/**
 * Locate the declaration of `symbol` within one container, descending into
 * nested types.
 * @param container - the file's root, or a type declaration.
 * @param prefix - the dotted path of enclosing type names, `''` at file level.
 * @param symbol - the symbol name being looked up.
 * @returns every node the name resolves to — more than one for overloads — or
 *   `undefined` when the container declares no such symbol.
 */
function findDeclaration(container: Node, prefix: string, symbol: string): Node[] | undefined {
  const members = membersOf(container)
  const group = members.filter(member => declaredNames(member).some(name => `${prefix}${name}` === symbol))
  if (group.length > 0) return group
  for (const member of members) {
    if (!TYPE_DECLARATIONS.has(member.type)) continue
    for (const name of declaredNames(member)) {
      const nested = findDeclaration(member, `${prefix}${name}.`, symbol)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** The Java evaluator. */
export const javaEvaluator: LanguageEvaluator = {
  extensions: ['.java'],
  lookup(source: string, symbol: string) {
    return withTree(WASM, source, (root) => {
      const declaration = findDeclaration(root, '', symbol)
      if (declaration === undefined) return { declared: false, hash: undefined }
      return { declared: true, hash: digestTokenStream(declaration, OPTIONS) }
    })
  },
}
