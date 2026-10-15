/**
 * The plugin's OWN per-line syntax highlighter (synchronous shiki core).
 *
 * The dsh shell keeps its shiki machinery private: the pinned build harness
 * never exported the per-line highlight API from ui-primitives, and rc.6
 * retracted it entirely. This plugin therefore ships its own copy so diff
 * syntax coloring works on every dsh version, bundled into lib/client.js via
 * tsdown (shiki is a plugin dependency, not a platform module).
 *
 * Only the three grammars a file diff actually hits (TypeScript family, shell,
 * JSON) load into the singleton. The css-variables theme colors every run
 * through `--shiki-*` custom properties, which the host theme sheets already
 * define for the stock MarkdownText code blocks — so highlighted runs pick up
 * the active theme without shipping any palette here.
 */
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import type { HighlighterCore } from 'shiki/core'
import type { CSSProperties } from 'react'

/** A shiki grammar module's default export (a `LanguageRegistration[]`). */
type LangModule = { default: typeof langTs }

/** The grammars the singleton loads at boot, each keyed by its `name` id. */
const LANGS = [langTs, langBash, langJson]

/**
 * Language ids (and aliases) the highlighter accepts; everything else renders
 * plain. A Map, not an object: fence info strings are assistant-authored, so
 * a label like `constructor` or `__proto__` must miss instead of resolving an
 * inherited property and crashing the renderer inside shiki. The JS family
 * maps to the TypeScript grammar (it tokenizes plain TS/JS exactly, JSX/TSX
 * approximately — one JS-family grammar keeps the boot set small).
 */
const LANG_ALIASES = new Map<string, string>([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['jsx', 'typescript'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'json'],
])

/** All token colors resolve through `--shiki-*` custom properties (host theme sheets). */
const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

/**
 * The client regex engine compiles each TextMate pattern when its scanner is
 * created. Shiki otherwise defers patterns longer than 3,000 characters until
 * their first match; that compilation counts against Shiki's 500 ms per-line
 * budget and can return a partial token stream under host contention. Eager
 * compilation leaves the same budget in place for scanning user content.
 */
const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, {
    lazyCompileLength: Number.POSITIVE_INFINITY,
  }),
})

let singleton: HighlighterCore | undefined

/** Representative paths through every boot grammar, compiled before user content is timed. */
const BOOT_GRAMMAR_WARMUPS = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
] as const

/** Construct and pre-tokenize the boot grammars outside the user-content scan budget. */
function createHighlighter(): HighlighterCore {
  const instance = createHighlighterCoreSync({
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  })
  for (const sample of BOOT_GRAMMAR_WARMUPS) {
    instance.codeToTokens(sample.code, {
      lang: sample.lang,
      theme: 'css-variables',
      tokenizeTimeLimit: 0,
    })
  }
  return instance
}

/** The synchronous highlighter (one instance per document); pre-warmed below, lazy as the fallback. */
function highlighter(): HighlighterCore {
  singleton ??= createHighlighter()
  return singleton
}

/** Subscribers re-rendered after a grammar registers (kept for API parity; no lazy grammars). */
const listeners = new Set<() => void>()
/** Bumped on each grammar load (kept for API parity; no lazy grammars). */
let loadCount = 0

/**
 * Subscribe to lazy-grammar load completions; kept for useSyncExternalStore
 * parity with the harness API, though this plugin has no lazy grammars.
 * @param listener - change callback.
 * @returns an unsubscribe function.
 */
export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The lazy-grammar load counter (useSyncExternalStore snapshot).
 * @returns the current load count.
 */
export function grammarLoadCount(): number {
  return loadCount
}

/** Engine + grammar construction costs a long task; warm the singleton in a
 *  deferred task at module load instead of on the first diff's render. */
const warmupTimer = setTimeout(() => { highlighter() }, 0)
;(warmupTimer as { unref?: () => void }).unref?.()

/**
 * One highlighted run of a line: the text and the inline style shiki assigned
 * it. The css-variables theme colors every run through a `--shiki-*` custom
 * property, so `style.color` is always present; held as a style object rather
 * than a bare color so a run spreads onto a `<span style>` uniformly.
 */
export interface HighlightSpan {
  text: string
  style: CSSProperties
}

/**
 * Tokenize `code` into per-line highlighted runs when `lang` maps to a
 * registered grammar; `undefined` means the caller renders its plain fallback.
 * The trailing newline shiki appends as a final empty line is dropped so the
 * run count matches the caller's own line array.
 * @param code - the source text.
 * @param lang - the language hint (a file-extension-derived language id).
 * @returns one entry per source line (each an array of runs), or `undefined` for unknown languages.
 */
export function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  const { tokens } = highlighter().codeToTokens(code, { lang: resolved, theme: 'css-variables' })
  // shiki tokenizes `a\nb` into two lines; a trailing newline (`a\n`) adds a
  // third, empty line the caller's own line array does not carry. Drop that
  // one terminator line so the two structures stay in step.
  const last = tokens[tokens.length - 1]
  const lines = tokens.length > 1 && last !== undefined && last.length === 0
    ? tokens.slice(0, -1)
    : tokens
  return lines.map(line => line.map(token => ({ text: token.content, style: { color: token.color } })))
}
