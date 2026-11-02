/**
 * PoC for multi-language anchor evaluation over web-tree-sitter (wasm).
 *
 * Proves, against real sample sources read in place (never modified):
 *  (a) top-level symbol enumeration (name + kind + span) for Python and Go;
 *  (b) comment stripping by tree traversal — comment-looking bytes inside
 *      string literals must survive;
 *  (c) grammar wasm ABI compatibility with web-tree-sitter 0.27 for both the
 *      official tree-sitter-<lang> tarball wasm and the two aggregator
 *      packages, on linux-arm64 with no native compilation.
 *
 * Run: node poc.mjs   (writes out/*.json + out/*.txt, prints a summary)
 */

import { readFile, writeFile } from 'node:fs/promises'
import { Parser, Language, LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from 'web-tree-sitter'

const SAMPLES = {
  python: '/e2e-test-samples/repos/fastapi-template/backend/app/utils.py',
  go: '/e2e-test-samples/repos/miniflux/internal/model/entry.go',
  goStrings: '/e2e-test-samples/repos/miniflux/internal/urllib/url.go',
}

/** Python has no `#`-inside-string in the fastapi sample; prove the property on a minimal snippet. */
const PYTHON_HASH_IN_STRING = [
  'ANCHOR = "https://example.com/page#section"  # trailing comment',
  'def route(path: str) -> str:',
  '    # leading comment',
  '    return f"{path}#frag"  # another',
].join('\n')

await Parser.init()

async function loadLang(wasmPath) {
  return Language.load(wasmPath)
}

function parserFor(language) {
  const parser = new Parser()
  parser.setLanguage(language)
  return parser
}

/** Enumerate top-level symbols of a Python module. */
function pythonTopLevel(root) {
  const symbols = []
  for (let node of root.namedChildren) {
    let decorated = false
    if (node.type === 'decorated_definition') {
      decorated = true
      node = node.namedChildren.at(-1)
    }
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      symbols.push({
        symbol: node.childForFieldName('name').text,
        kind: node.type === 'class_definition' ? 'class' : 'function',
        decorated,
        span: [node.startPosition.row + 1, node.endPosition.row + 1],
      })
      continue
    }
    if (node.type === 'expression_statement') {
      const expr = node.namedChildren[0]
      if (expr?.type === 'assignment') {
        const target = expr.childForFieldName('left')
        if (target?.type === 'identifier') {
          symbols.push({
            symbol: target.text,
            kind: 'assignment',
            span: [node.startPosition.row + 1, node.endPosition.row + 1],
          })
        }
      }
    }
  }
  return symbols
}

/** Enumerate top-level symbols of a Go file, unrolling grouped specs. */
function goTopLevel(root) {
  const symbols = []
  const span = node => [node.startPosition.row + 1, node.endPosition.row + 1]
  for (const node of root.namedChildren) {
    switch (node.type) {
      case 'function_declaration':
        symbols.push({ symbol: node.childForFieldName('name').text, kind: 'func', span: span(node) })
        break
      case 'method_declaration': {
        const receiver = node.childForFieldName('receiver').text
        symbols.push({ symbol: node.childForFieldName('name').text, kind: 'method', receiver, span: span(node) })
        break
      }
      case 'type_declaration':
        for (const spec of node.namedChildren.filter(child => child.type === 'type_spec' || child.type === 'type_alias')) {
          symbols.push({ symbol: spec.childForFieldName('name').text, kind: 'type', span: span(node) })
        }
        break
      case 'const_declaration':
      case 'var_declaration': {
        const kind = node.type === 'const_declaration' ? 'const' : 'var'
        for (const spec of node.namedChildren.filter(child => child.type.endsWith('_spec'))) {
          for (const name of spec.namedChildren.filter(child => child.type === 'identifier')) {
            symbols.push({ symbol: name.text, kind, grouped: node.namedChildren.length > 1, span: span(node) })
          }
        }
        break
      }
    }
  }
  return symbols
}

/** Comment node types per language; everything else is kept verbatim. */
const COMMENT_TYPES = new Set(['comment', 'line_comment', 'block_comment'])

/** Strip comments by splicing out comment-node ranges, then collapse whitespace. */
function stripComments(source, root) {
  const ranges = []
  const cursor = root.walk()
  const visit = () => {
    do {
      if (COMMENT_TYPES.has(cursor.nodeType)) {
        ranges.push([cursor.startIndex, cursor.endIndex])
      } else if (cursor.gotoFirstChild()) {
        visit()
        cursor.gotoParent()
      }
    } while (cursor.gotoNextSibling())
  }
  visit()
  let out = ''
  let last = 0
  for (const [start, end] of ranges) {
    out += source.slice(last, start)
    last = end
  }
  out += source.slice(last)
  return out.replace(/\s+/g, ' ').trim()
}

/** Find one top-level symbol's node text (raw span). */
function findSymbol(symbols, root, source, name) {
  const hit = symbols.find(entry => entry.symbol === name)
  if (hit === undefined) return undefined
  const [startRow, endRow] = hit.span
  return source.split('\n').slice(startRow - 1, endRow).join('\n')
}

const report = { abi: { LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION }, arch: process.arch, node: process.version, wasmSources: {} }

// -- ABI compatibility across all three wasm distribution channels ----------
const channels = {
  'official-tarball': lang => `wasm-official/tree-sitter-${lang}.wasm`,
  'vscode': lang => `node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-${lang}.wasm`,
  'tree-sitter-wasms': lang => `node_modules/tree-sitter-wasms/out/tree-sitter-${lang}.wasm`,
}
for (const [channel, path] of Object.entries(channels)) {
  report.wasmSources[channel] = {}
  for (const lang of ['python', 'go', 'rust', 'java']) {
    try {
      const language = await loadLang(path(lang))
      report.wasmSources[channel][lang] = { ok: true, abiVersion: language.abiVersion ?? language.version }
    } catch (error) {
      report.wasmSources[channel][lang] = { ok: false, error: String(error).slice(0, 120) }
    }
  }
}

// -- Python: symbol enumeration + comment stripping -------------------------
const pyLang = await loadLang('wasm-official/tree-sitter-python.wasm')
const pyParser = parserFor(pyLang)
const pySource = await readFile(SAMPLES.python, 'utf8')
const pyTree = pyParser.parse(pySource)
const pySymbols = pythonTopLevel(pyTree.rootNode)
report.python = { file: SAMPLES.python, symbols: pySymbols }

const sendEmailText = findSymbol(pySymbols, pyTree.rootNode, pySource, 'send_email')
const sendEmailTree = pyParser.parse(sendEmailText)
report.pythonStripped = { symbol: 'send_email', stripped: stripComments(sendEmailText, sendEmailTree.rootNode) }

const pySnippetTree = pyParser.parse(PYTHON_HASH_IN_STRING)
const pySnippetStripped = stripComments(PYTHON_HASH_IN_STRING, pySnippetTree.rootNode)
report.pythonHashInString = {
  input: PYTHON_HASH_IN_STRING,
  stripped: pySnippetStripped,
  stringHashSurvives: pySnippetStripped.includes('#section') && pySnippetStripped.includes('#frag'),
  commentsGone: !pySnippetStripped.includes('trailing comment') && !pySnippetStripped.includes('leading comment'),
}

// -- Go: symbol enumeration + comment stripping -----------------------------
const goLang = await loadLang('wasm-official/tree-sitter-go.wasm')
const goParser = parserFor(goLang)
const goSource = await readFile(SAMPLES.go, 'utf8')
const goTree = goParser.parse(goSource)
const goSymbols = goTopLevel(goTree.rootNode)
report.go = { file: SAMPLES.go, symbols: goSymbols }

const newEntryText = findSymbol(goSymbols, goTree.rootNode, goSource, 'MaxEntryLimit')
const newEntryTree = goParser.parse(newEntryText)
report.goStripped = { symbol: 'MaxEntryLimit', raw: newEntryText, stripped: stripComments(newEntryText, newEntryTree.rootNode) }

const goStrSource = await readFile(SAMPLES.goStrings, 'utf8')
const goStrTree = goParser.parse(goStrSource)
const goStrSymbols = goTopLevel(goStrTree.rootNode)
const hasHTTPText = findSymbol(goStrSymbols, goStrTree.rootNode, goStrSource, 'hasHTTPPrefix')
const hasHTTPTree = goParser.parse(hasHTTPText)
const hasHTTPStripped = stripComments(hasHTTPText, hasHTTPTree.rootNode)
report.goSlashInString = {
  file: SAMPLES.goStrings,
  symbol: 'hasHTTPPrefix',
  raw: hasHTTPText,
  stripped: hasHTTPStripped,
  stringSlashesSurvive: hasHTTPStripped.includes('"https://"') && hasHTTPStripped.includes('"http://"'),
}

await writeFile('out/report.json', `${JSON.stringify(report, null, 2)}\n`)

const lines = []
lines.push(`web-tree-sitter LANGUAGE_VERSION=${LANGUAGE_VERSION} MIN_COMPATIBLE_VERSION=${MIN_COMPATIBLE_VERSION} on ${process.platform}/${process.arch} ${process.version}`)
for (const [channel, langs] of Object.entries(report.wasmSources)) {
  lines.push(`${channel}: ${Object.entries(langs).map(([lang, result]) => `${lang}=${result.ok ? `ok(abi ${result.abiVersion})` : 'FAIL'}`).join(' ')}`)
}
lines.push('', `python ${SAMPLES.python}:`)
for (const symbol of pySymbols) lines.push(`  ${symbol.kind.padEnd(10)} ${symbol.symbol}  L${symbol.span[0]}-${symbol.span[1]}${symbol.decorated ? ' (decorated)' : ''}`)
lines.push('', `go ${SAMPLES.go}:`)
for (const symbol of goSymbols) lines.push(`  ${symbol.kind.padEnd(10)} ${symbol.symbol}  L${symbol.span[0]}-${symbol.span[1]}${symbol.grouped ? ' (grouped)' : ''}${symbol.receiver ? ` recv ${symbol.receiver}` : ''}`)
lines.push('', `python '#' in string survives: ${report.pythonHashInString.stringHashSurvives}, comments gone: ${report.pythonHashInString.commentsGone}`)
lines.push(`go '//' in string survives: ${report.goSlashInString.stringSlashesSurvive}`)
lines.push('', 'go MaxEntryLimit stripped:', `  ${report.goStripped.stripped}`)
lines.push('go hasHTTPPrefix stripped:', `  ${hasHTTPStripped}`)
const summary = `${lines.join('\n')}\n`
await writeFile('out/summary.txt', summary)
console.log(summary)
