/**
 * Sketch of the multi-language normalization proposed in design.md: serialize
 * the parse tree's leaf tokens, skip comment nodes, and mark block boundaries
 * explicitly so Python indentation survives whitespace collapse.
 *
 * Proves on real declarations:
 *  - a black-style rewrap (multi-line signature -> one line) does not move
 *    the normalized form;
 *  - a moved statement between indent levels DOES move it (the failure mode
 *    of naive whitespace collapse);
 *  - Go: gofmt-shaped input and a hand-mangled reformat normalize identically.
 *
 * Run: node normalize-sketch.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'
import { Parser, Language } from 'web-tree-sitter'

const COMMENT_TYPES = new Set(['comment', 'line_comment', 'block_comment'])
const BLOCK_TYPES = new Set(['block'])

/**
 * Containers whose trailing comma is formatting, not meaning. Python `tuple`
 * is deliberately absent: `(1,)` and `(1)` differ in meaning, so its comma
 * must stay in the hash.
 */
const INERT_TRAILING_COMMA = new Set([
  // python
  'parameters', 'argument_list', 'list', 'dictionary', 'set',
  // go
  'literal_value', 'parameter_list', 'argument_list', 'expression_list',
])
const CLOSERS = new Set([')', ']', '}'])

/**
 * Leaf-token serialization: comments skipped, block edges made explicit,
 * trailing commas dropped where they are formatter noise (black's magic
 * trailing comma, gofmt's mandatory multiline comma).
 */
function normalize(root) {
  const pieces = []
  const walk = node => {
    if (COMMENT_TYPES.has(node.type)) return
    const block = BLOCK_TYPES.has(node.type)
    if (block) pieces.push('«')
    if (node.childCount === 0) {
      pieces.push(node.text.replace(/\s+/g, ' '))
    } else {
      const inert = INERT_TRAILING_COMMA.has(node.type)
      for (let index = 0; index < node.childCount; index += 1) {
        const child = node.child(index)
        if (inert && child.type === ',' && CLOSERS.has(node.child(index + 1)?.type ?? '')) continue
        walk(child)
      }
    }
    if (block) pieces.push('»')
  }
  walk(root)
  return pieces.join(' ')
}

await Parser.init()
const py = new Parser()
py.setLanguage(await Language.load('wasm-official/tree-sitter-python.wasm'))
const go = new Parser()
go.setLanguage(await Language.load('wasm-official/tree-sitter-go.wasm'))

const results = {}

// Real declaration from the sample, read in place.
const utils = await readFile('/e2e-test-samples/repos/fastapi-template/backend/app/utils.py', 'utf8')
const sendEmail = utils.split('\n').slice(33, 57).join('\n')

// The same function black-rewrapped: signature on one line, comment dropped.
const sendEmailRewrapped = sendEmail
  .replace(/def send_email\(\n\s*\*,\n\s*email_to: str,\n\s*subject: str = "",\n\s*html_content: str = "",\n\) -> None:/, 'def send_email(*, email_to: str, subject: str = "", html_content: str = "") -> None:')
  .replace('  # For type checker', '')

// The same function with one statement moved out of the `if` (implementation change).
const sendEmailMoved = sendEmail.replace(
  '    if settings.SMTP_TLS:\n        smtp_options["tls"] = True',
  '    if settings.SMTP_TLS:\n        pass\n    smtp_options["tls"] = True',
)

const norm = source => normalize(py.parse(source).rootNode)
results.python = {
  rewrapInvariant: norm(sendEmail) === norm(sendEmailRewrapped),
  indentChangeMoves: norm(sendEmail) !== norm(sendEmailMoved),
  // The trailing-comma rule must not erase meaning: a 1-tuple is not its element.
  tupleCommaKept: norm('x = (1,)') !== norm('x = (1)'),
  normalized: norm(sendEmail),
}

// Go: gofmt output vs a legal non-gofmt variant — spaces for tabs, extra
// blank lines, comment dropped. Newlines stay: removing them is not a
// reformat in Go, it changes what the semicolon-insertion rules parse.
const entry = await readFile('/e2e-test-samples/repos/miniflux/internal/model/entry.go', 'utf8')
const shouldMark = entry.split('\n').slice(61, 75).join('\n')
const shouldMarkVariant = shouldMark.replace(/\t/g, '    ').replace(/\n/g, '\n\n').replace(/ != /g, '  !=  ')
const goNorm = source => normalize(go.parse(source).rootNode)

// gofmt's mandatory trailing comma: the same composite literal, single-line
// form without the comma vs exploded form with it.
const literalOneLine = 'var statuses = []string{EntryStatusUnread, EntryStatusRead}'
const literalExploded = 'var statuses = []string{\n\tEntryStatusUnread,\n\tEntryStatusRead,\n}'
results.go = {
  reformatInvariant: goNorm(shouldMark) === goNorm(shouldMarkVariant),
  trailingCommaInvariant: goNorm(literalOneLine) === goNorm(literalExploded),
  normalized: goNorm(shouldMark).slice(0, 200),
}

await writeFile('out/normalize-sketch.json', `${JSON.stringify(results, null, 2)}\n`)
console.log(JSON.stringify(results, null, 2))
