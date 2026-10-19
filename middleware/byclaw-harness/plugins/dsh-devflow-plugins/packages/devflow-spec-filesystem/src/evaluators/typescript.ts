/**
 * TypeScript/JavaScript evaluator: symbol lookup and body normalization
 * behind `content-hash` anchors.
 *
 * The hash must distinguish an implementation change from a reformatting, so
 * normalization walks the TypeScript AST rather than stripping comments with a
 * regex — a regex cannot tell `//` inside a string literal from a comment, and
 * getting that wrong silently changes a hash when a URL is edited.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/typescript
 */

import { createHash } from 'node:crypto'
import ts from 'typescript'
import type { LanguageEvaluator } from './types.ts'

/** Prefix carried in every hash value so the algorithm travels with it. */
const ALGORITHM = 'sha1'

/**
 * Whether a top-level statement binds `symbol`, across the declaration forms a
 * spec cites: functions, classes, interfaces, type aliases, enums, and
 * variable statements. A multi-declarator statement binds each of its names,
 * so citing either resolves to the whole statement.
 * @param node - a top-level statement.
 * @param symbol - the symbol name being looked up.
 * @returns `true` when the statement binds that name.
 */
function declaresName(node: ts.Node, symbol: string): boolean {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === symbol)
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text === symbol
  }
  return false
}

/**
 * Locate a top-level symbol's declaration text.
 * @param source - the file's contents.
 * @param symbol - the symbol name.
 * @returns the declaration's source text, or `undefined` when the file
 *   declares no such symbol — never the whole file, which would make every
 *   anchor on a renamed symbol silently keep passing.
 */
export function findSymbolText(source: string, symbol: string): string | undefined {
  const file = ts.createSourceFile('anchor.ts', source, ts.ScriptTarget.Latest, true)
  for (const statement of file.statements) {
    if (declaresName(statement, symbol)) return statement.getText(file)
  }
  return undefined
}

/**
 * Reduce a declaration to what a change of implementation would move:
 * comments dropped, whitespace runs collapsed to one space, ends trimmed.
 *
 * Statement semicolons are dropped with the comments. They are the one
 * formatting dimension tools most often disagree on, and a hash that moved
 * when a formatter added them would mark every anchor in the repository stale
 * at once — which trains everyone to ignore the signal.
 * @param declaration - the declaration's source text.
 * @returns the normalized single-line form.
 */
export function normalizeSymbolBody(declaration: string): string {
  const pieces: string[] = []
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true, ts.LanguageVariant.Standard, declaration)
  let token = scanner.scan()
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token !== ts.SyntaxKind.SemicolonToken) pieces.push(scanner.getTokenText())
    token = scanner.scan()
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Hash one symbol's normalized declaration.
 * @param source - the file's contents.
 * @param symbol - the symbol name.
 * @returns `sha1:<hex>` over the normalized declaration, or `undefined` when
 *   the file declares no such symbol.
 */
export function hashSymbol(source: string, symbol: string): string | undefined {
  const declaration = findSymbolText(source, symbol)
  if (declaration === undefined) return undefined
  return `${ALGORITHM}:${createHash(ALGORITHM).update(normalizeSymbolBody(declaration)).digest('hex')}`
}

/**
 * The TypeScript/JavaScript evaluator. Its `extensions` restate exactly what
 * the former `PARSEABLE` regex `\.(?:[cm]?[jt]sx?)$` matched — including the
 * four x-suffixed `m`/`c` forms — because narrowing the set would flip an
 * anchored file from parsed to unevaluable, a behavior change rather than a
 * cleanup. The parser is synchronous; `lookup` wraps its result to satisfy
 * the seam's async face.
 */
export const typescriptEvaluator: LanguageEvaluator = {
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.cjs', '.cjsx', '.cts', '.ctsx', '.mjs', '.mjsx', '.mts', '.mtsx'],
  lookup(source: string, symbol: string) {
    return Promise.resolve({ declared: findSymbolText(source, symbol) !== undefined, hash: hashSymbol(source, symbol) })
  },
}
