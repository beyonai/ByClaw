# @zhchxiao123/dsh-devflow-spec-filesystem

English | [中文](README.zh.md)

**Filesystem Service Provider for the [spec seam](../devflow-spec/README.md)**: architecture documents under `<root>/<id>.md`, with anchors evaluated against the working tree on every read.

## Layout and configuration

```yaml
- name: '@zhchxiao123/dsh-devflow-spec-filesystem'
  config:
    root: .devflow/spec      # documents; relative resolves against cwd
    repoRoot: .              # what the anchors' relative file paths resolve against
```

| Field | Default | Meaning |
|---|---|---|
| `root` | `.devflow/spec` | Default spec root for operations whose caller derives none |
| `repoRoot` | `.` | Repository root the anchor file paths resolve against |
| `maxNetGrowthBytes` | `8192` | Ceiling on one write's NET growth: the new file's size minus everything it replaces. A merge is usually negative and always passes — charging a cluster merge as pure addition would refuse the one move that shrinks the set. It budgets reviewability, not context: bodies never reach a model in bulk, so a large document costs whoever must keep it true. |

The default root sits **inside `.devflow/`**, which `@zhchxiao123/dsh-devflow-fs-guard` already denies file tools by directory-name match. That is not incidental: it makes this store the only write path rather than merely the intended one, without a second guard entry.

A document is frontmatter plus a Markdown body:

```markdown
---
title: Error Handling
description: Domain rejections versus infrastructure failures
updatedAt: 2026-09-02T00:00:00.000Z
anchors:
  - id: a1
    kind: symbol
    file: packages/devflow/src/types.ts
    symbol: CreateRejectionCode
---

## Source of truth

| Anchor | Points at |
|---|---|
| `a1` | `types.ts#CreateRejectionCode` |

The rejection codes are a closed set [[a1]].
```

The frontmatter keys are `title`, an optional `description`, `updatedAt`, an optional `waives`, and `anchors`.

`updatedAt` is stamped by the store at write time and never read from filesystem mtime — a checkout, copy, or container build resets mtime, and churn anchors compare against this value.

`waives` is a list of scope ids the document declares as deliberately needing no architecture document of their own, and it reaches `list()` summaries unchanged — the frontmatter is already decoded there, so a census that must learn who waives what pays no further I/O and opens no body. Decoding checks the shape only: a file on disk is reported as it stands, the way an already-stale anchor is, and it is the write path that refuses `self-waiver`. The key is absent from a document that waives nothing, so every document written before the field existed decodes, re-encodes, and reports exactly as it did.

## Anchor evaluation

| Kind | How it is decided |
|---|---|
| `symbol` | the file is parsed and the symbol looked up |
| `content-hash` | the symbol's normalized body is re-hashed and compared |
| `churn` | `git log -1 --format=%cI` on the file, compared against `updatedAt` |

`symbol` and `content-hash` dispatch on the anchored file's extension to a per-language evaluator; a file no evaluator claims reports `unevaluable` — only a churn anchor can watch it.

| Language | Extensions | Top-level symbol | Normalization |
|---|---|---|---|
| TypeScript / JavaScript | `.ts` / `.tsx` / `.js` / `.jsx` and their `m` / `c` forms | functions, classes, interfaces, type aliases, enums, and variable statements; either name of a multi-declarator statement resolves to the whole statement | comments and statement semicolons dropped, whitespace collapsed |
| Python | `.py` / `.pyi` | module-level `def` / `class` / single-name assignment; a decorated definition matches by its inner name and hashes with its decorators | comments dropped, block boundaries marked — indentation is semantics — and inert trailing commas dropped; docstrings and quote style stay in the hash |
| Go | `.go` | `func`, `type`, `var`, `const` — any name in a grouped `const (...)` / `var (...)` / `type (...)` anchors the whole block — and methods cited as `Type.Name` | comments dropped and gofmt's trailing comma in exploded composite literals dropped; nothing else, because gofmt output carries no line-end semicolons and a `for` clause's `;` is semantics |
| Rust | `.rs` | every named item — `fn`, `struct`, `enum`, `union`, `trait`, `type`, `const`, `static`, `mod`, `macro_rules!` — plus the items inside an `impl` or `trait` body, cited `Type.name` with the impl's generics stripped (`impl<T> Foo<T>` gives `Foo.bar`) and a trait impl cited by its self type, never by the trait | comments dropped, doc comments included, and rustfmt's trailing comma in exploded containers dropped — but never a one-element tuple's; attributes hash with the item they modify, and semicolons stay because one turns a block's trailing expression into a statement |
| Java | `.java` | `class` / `interface` / `enum` / `record` / `@interface`, and their members cited `Type.name` — nested types separated by `.` at any depth, constructors as `Type.Type`, and every overload of one name resolving to a single hashed unit | comments dropped, Javadoc included, and a trailing comma in an array initializer or after the last enum constant dropped; annotations hash with the declaration, and semicolons stay because Java's are mandatory rather than a formatter's choice |

**Normalization drops what a formatter may move and keeps what a change of implementation would move**, so reformatting does not move a hash but an edited line does. TypeScript's statement semicolons are dropped deliberately: they are the formatting dimension tools most often disagree on, and a hash that moved when a formatter added them would mark every anchor in the repository stale at once — which trains everyone to ignore the signal. Comments are stripped through each language's parser rather than a regex, because a regex cannot tell `//` inside a string literal from a comment.

**The rules and the grammars are part of the hash domain.** Changing a language's normalization — or bumping its grammar — stales every content-hash anchor of that language at once, so the tree-sitter grammars (`tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, whose wasm is loaded through `web-tree-sitter`) are exact-pinned, and their npm install scripts stay blocked on purpose: only the wasm each tarball carries is ever loaded, never a native build.

**Whether a comment is in the hash follows one rule: is it observable at runtime?** A Python docstring is, through `__doc__`, and stays. A Rust doc comment reaches rustdoc and a Java one reaches javadoc, so both are dropped with the ordinary comments — prose churn is not implementation drift, and a document that watches prose has `churn` for it.

Git is probed once per store. Outside a work tree the evaluator receives no lookup at all, so churn anchors report `unevaluable` — never `fresh`.

### `ANCHORABLE_EXTENSIONS`

Every extension some evaluator claims, deduplicated in registry order. This store answers the seam's `anchorableExtensions` with it rather than restating the list, and adding a language to the registry moves the set with no edit anywhere else.

It is the registry's **denominator** face. A file with one of these extensions is one a symbolic anchor can point at, so "how much of this directory could documents anchor" is a question only this list can answer — which is why `/devflow spec`'s coverage census asks the mounted provider for it instead of keeping a copy of the language list, and why a count reported against it stays true the day a sixth language lands.

The counting rule that goes with it is deliberately coarse, and it is stated wherever the counts are read: **dot directories and `node_modules` are skipped whole** (a dot *file* is counted, because an anchor may point at it), **`.gitignore` is not parsed** — an ignore-file parser is a second, unbounded question, and a rule that fits in one sentence is one a reader can argue with — and the result is **a denominator, not a threshold**. Nothing in this line refuses a write, fails a check, or downgrades a scope because its document count looks small against that number; whether a scope has enough documents is a judgement, in the same way the structural contract declines to check whether each claim carries an anchor.

## Write path

`write` refuses before touching the filesystem, in this order: id legality, the `Source of truth` section, at least one anchor, the two-way citation relation, the waived scopes, then existence, then anchor evaluation. A `waives` entry that is not a legal id refuses as `invalid-id`, and one naming a scope the document itself sits in refuses as `self-waiver` — that scope has a document, so it is covered rather than waived. Whether a waived scope is expected at all is not decided here: this store does not hold the expected set. Every declared anchor must evaluate `fresh`; a document may not be born stale. The file is written to a temporary path and renamed, so a failed write leaves no partial document.

Domain rejections resolve with `ok: false` and a stable code. Infrastructure failures — an unreadable path that exists, an unwritable root — reject, because they are not verdicts about the document.

## Model Experience

Indirectly, through `dsh-devflow-spec-tool`: this provider registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No usage index.** Nothing records which cards reached which document, so "nobody has referenced this in months" cannot be answered. Deriving it would mean reading every card's `spec-refs` registration on every query — unbounded in board size, where every other health signal is bounded by document count. The shape it wants is an index maintained at registration time, not a scan at read time.
- **A read still costs one `stat` per anchored file.** The parse cache is keyed on those stats, so an unchanged file is parsed once per store lifetime, but the identity check itself is not cached and is not meant to be: it is what makes an edit visible on the very next read.
- **`symbol` and `content-hash` reach only languages with an evaluator** — TypeScript/JavaScript, Python, Go, Rust, and Java today. Files no evaluator claims can carry `churn` only, and are reported `unevaluable` for the symbolic kinds rather than passed.
- **A Java overload group is one hashed unit.** `Type.name` resolves to every declaration of that name, so editing any overload stales an anchor written about another. The alternative — taking the first — would let an anchor report fresh while the overload the document describes was rewritten, and a silent false fresh is the expensive failure here.
- **Shell writes bypass the guard.** The fs guard is a policy fence over the tool plane, not a kernel boundary — the same exposure the card journal already has, not one this store introduces.
- **Anchors are re-evaluated per read, cheaply.** Verdicts themselves are never cached — only the parse behind them — so a read always reports the tree as it stands rather than as it stood.
