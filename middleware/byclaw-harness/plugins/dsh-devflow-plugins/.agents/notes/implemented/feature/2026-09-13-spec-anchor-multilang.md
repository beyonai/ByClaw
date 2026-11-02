# Agent Note: symbol and content-hash anchors evaluate Python and Go

Status: implemented

## Problem

`symbol` and `content-hash` anchors resolved through the TypeScript parser
and nothing else, so every scope outside TS/JS — which [multi-ecosystem
discovery](2026-09-13-spec-discovery-multi-ecosystem.md) now surfaces
routinely — could carry `churn` anchors only. The consequences were
structural, not cosmetic: the turn-end sentinel reads only symbolic
verdicts and therefore never fired for those scopes, and churn freshness
lags until the changed file is committed. The [anchor model Agent
Note](../architecture/2026-09-02-devflow-spec-anchor-model.md) recorded
this as a known debt and reserved the seam: split `anchor-eval.ts` and
`normalize.ts` behind a per-language interface when a second language
arrives.

## Decision

`devflow-spec-filesystem` now dispatches symbolic anchors on the anchored
file's extension to a `LanguageEvaluator` (`src/evaluators/`). The former
TypeScript path moved verbatim behind the interface — golden
literal-digest assertions (`tests/golden-hash.spec.ts`, baselines computed
before the refactor) prove its hashes did not move — and Python
(`.py` / `.pyi`) and Go (`.go`) evaluators parse through **web-tree-sitter
(wasm)** with the official grammar packages `tree-sitter-python@0.25.0`
and `tree-sitter-go@0.25.0`, exact-pinned. A file no evaluator claims
keeps the existing `unevaluable` verdict, wording unchanged.

Per-language normalization, decided and frozen (each evaluator's module
doc carries the full record):

- **Python** — comments dropped; `block` boundaries marked, because
  indentation is semantics and the token stream alone would not move when
  a statement leaves an `if`; inert trailing commas dropped (black's magic
  trailing comma) but never a tuple's — `(1,)` is not `(1)`; docstrings
  and quote style stay in the hash. Top level is lexical: module-level
  `def` / `class` / single-name assignment, a decorated definition
  matching by its inner name and hashing with its decorators.
- **Go** — comments dropped; gofmt's trailing comma in exploded composite
  literals dropped; no semicolon dimension, because gofmt emits no
  line-end semicolons and a `for` clause's `;` is semantics. Any name in a
  grouped `const (...)` / `var (...)` / `type (...)` anchors the whole
  block — with `iota`, a single spec line is not a meaningful unit — and
  methods are cited `Type.Name`.

**The normalization rules and the grammar versions are inside the hash
domain.** Changing either stales every content-hash anchor of that
language at once, and that is the accepted posture rather than a
versioning scheme: no hash-version negotiation, because a stale wave
self-heals — the next write of each document re-records the current
digest — and a grammar bump under the exact pins is a deliberate
migration, never an incidental `pnpm install`.

**`allowBuilds` denies the tree-sitter packages on purpose** (explicit
`false` entries in `pnpm-workspace.yaml`). Their `install: node-gyp-build`
script would only wire up native prebuilds nothing loads — the evaluators
load the wasm each tarball carries — so the blocked script is a premise of
the selection: zero native compilation on any platform.

## Alternatives considered

**Per-language lightweight tokenizers** — comment stripping plus a
top-level line grammar — instead of a parser runtime. Rejected: correct
string lexing is the whole difficulty. A tokenizer that cannot lex
Python's f-strings and triple-quoted strings or Go's raw strings and
struct tags misreads `#` and `//` inside them — the same failure the
anchor model rejected regex stripping for — and a docstring containing a
column-zero `def` would be reported as a top-level symbol. Python's
indentation semantics versus formatter-rewrap invariance are also mutually
exclusive under a line grammar: keeping line structure moves the hash on a
black rewrap, folding whitespace loses the meaning of a dedent. Doing the
lexing right is writing a real lexer per language, which is what
tree-sitter already is.

**`tree-sitter-wasms`, the aggregated grammar bundle.** Rejected
empirically: all four grammars this line needs fail to load against
web-tree-sitter 0.27 — its wasm predates the runtime's dylink protocol —
and the bundle ships Unlicense without the MIT texts of the grammars its
binaries derive from.

**`@vscode/tree-sitter-wasm`.** A verified, working single-dependency
alternative, kept on record as the fallback if the official packages ever
stop shipping wasm in their tarballs. Not chosen because per-language
official packages make "support a language" one exact pin with a
language-scoped upgrade surface — the control a hash domain that includes
grammar versions wants.

## Consequences

Python and Go scopes now carry the full anchor vocabulary: the turn-end
sentinel fires for them, and the census's `churn-only` footnote — data
driven, zero code changed — recedes to languages without a parser. The
bootstrap skill's constrained branch narrowed to match.

The cost is dependency weight and two more pins inside the hash domain:
web-tree-sitter plus the two grammar packages unpack to roughly 16 MB of
mostly unused native prebuilds, while the process actually loads about
880 KB of wasm (runtime 205 KB, Python 458 KB, Go 217 KB), lazily, cached
once per language. The ~2.19 MB four-language wasm total the selection
research sized arrives only if phase two ships. TS/JS evaluation is
byte-identical to before — the golden digests pin it.

Rust and Java are phase two. Their official grammar wasm is ABI 14, which
the current runtime still loads, so each is one evaluator file and one
registry entry when a consumer arrives — and a future web-tree-sitter that
raises its compatibility floor forces the grammar bump ritual above.

**Phase two has since shipped** and came in at exactly that size: [Rust and
Java anchor evaluation](2026-09-14-spec-anchor-rust-java.md) is two
evaluator files and two registry entries under this note's rules,
unchanged. What it had to add is the record of the questions those two
languages ask and these four did not — an `impl` block's naming, a
`macro_rules!` definition, an overload group — plus one mechanism the
interface here lacked: a declaration may be a sequence of nodes rather
than one, because Rust's attributes are siblings of the item they modify.
The wasm total is now about 2.4 MB (Rust 1103 KB, Java 415 KB on top),
which is the estimate above plus the 205 KB runtime it did not count, and
the unpacked-prebuild weight roughly doubles to 37 MB.
