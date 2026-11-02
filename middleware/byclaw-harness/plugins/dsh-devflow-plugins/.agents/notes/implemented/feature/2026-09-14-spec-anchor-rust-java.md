# Agent Note: the Rust and Java anchor evaluators, and the naming they had to decide

Status: implemented

## Problem

[Phase one](2026-09-13-spec-anchor-multilang.md) built the
`LanguageEvaluator` seam and filled it with TypeScript/JavaScript, Python,
and Go, leaving Rust and Java named as phase two. The shape was settled;
what was not settled is that both languages ask questions the first four
never did. Rust puts methods inside `impl` blocks that may be generic,
may be for a trait, and may be for a type with no name at all; Java lets
one name mean several declarations. Go's own generic receivers had
already produced a loose record — `Foo[T].Bar` was left half-decided —
and repeating that would leave the citation grammar undecided in the two
largest remaining ecosystems.

## Decision

`devflow-spec-filesystem` registers `.rs` and `.java` evaluators against
the official grammars `tree-sitter-rust@0.24.0` and
`tree-sitter-java@0.23.5`, exact-pinned, wasm-only, install scripts
denied — phase one's rules verbatim, extended by two `allowBuilds: false`
entries. Each evaluator's module doc carries the full record; what
follows is the decision and its consequence, one line each.

**Rust citation.** A method is `Type.name` after Go's receiver
precedent, and the self type is peeled to its base name: `impl<T> Foo<T>`
gives `Foo.bar`, so adding, renaming, or bounding a type parameter does
not move the citation. A trait impl is cited by the type that behaves,
never by the trait — `impl Display for Foo` gives `Foo.fmt` — because the
subject of a document is the type, and `Trait.name` would collide across
every implementor; two impls may therefore offer one name, and the first
in the file wins, as everywhere else in this seam. An `impl` for
something with no base name (`impl [u8]`, `impl (A, B)`) claims nothing
rather than claiming a bare name. Associated consts and types are cited
like methods, and a trait's own required items sit under the trait's
name. `macro_rules!` is claimed: it is a named top-level item that Rust
codebases put real behavior in. An inline `mod` anchors whole — no
`mod::item` path — because `Type.name` is one level deep by construction.
A struct's fields are not separately citable, because they are inside the
struct's own declaration; Java's fields are, because there they are
separate declarations. The rule is the grammar's, not a preference.

**Java citation.** Nested types are separated by `.` at any depth, the
separator Java source itself uses, not the JVM's `Outer$Inner`.
Constructors fall out of the general rule as `Type.Type`.

**Java overloads are one hashed unit**, and this is the decision the
language forced. `Owner.getPet` resolves to every `getPet` the class
declares, hashed together in source order. Taking the first would let an
anchor keep reporting fresh while the overload the document actually
describes was rewritten — a silent false fresh, which this subsystem
treats as the expensive failure, against a cheap one: editing any
overload stales an anchor written about another. Go's grouped
`const (...)` block already anchors by the same "one citable name, one
hashed unit" rule. A field and a method of one name, which Java's
separate namespaces permit, fold into that unit for the same reason, as
does a nested type sharing a member's name.

**Doc comments are dropped, in both languages.** The rule separating
this from Python, which keeps docstrings, is runtime observability: a
Python docstring is a value on `__doc__`, while a Rust doc comment
reaches rustdoc and a Java one reaches javadoc, and neither reaches a
running program — Javadoc is not even in the class file. One asymmetry
follows and is accepted: `///` is sugar for `#[doc = "…"]`, and the
desugared attribute is hashed like any other attribute, so the two forms
of the same documentation hash differently. Hand-written `#[doc]` is rare
enough to pay that rather than put prose in the hash domain.

**Attributes and annotations are hashed with their declaration.**
`#[derive(Serialize)]` and `@Column` are behavior, and the Python
evaluator already hashes decorators with their definition. Java's
annotations sit in the declaration's `modifiers` and come along for free;
Rust's attributes are *siblings* of the item they modify, which is why
`digestTokenStream` now takes a node sequence rather than a node. That
one signature change serves both languages — Java's overload group is a
sequence too — and joining a one-element sequence is byte-identical, so
no existing digest moved.

**Formatting dimensions.** rustfmt: line rewrapping, indentation, and
attribute placement are absorbed by the token stream, and the trailing
comma it adds when exploding a container is dropped — never a
one-element tuple's, the carve-out Python already makes. Unlike Go,
newline removal is a legal reformat in Rust, because there is no
semicolon insertion; and unlike TypeScript, semicolons stay, because one
turns a block's trailing expression into a statement. google-java-format:
wrapping, indentation, and annotation-per-line are absorbed, and a
trailing comma in an array initializer or after the last enum constant is
dropped; Java's semicolons are mandatory, so no formatter can make one
noise, and the language has no `(1,)` needing a carve-out.

Seven golden literal digests freeze all of it —
`tests/golden-hash.spec.ts` — beside the ten that pin the first three
languages, none of which moved.

## Alternatives considered

**`Foo<T>.bar` as the Rust citation**, keeping the impl's generics in the
name. Rejected: it makes the anchor's spelling depend on a signature
detail, so adding a second type parameter silently renames every method
of the type. The generic-receiver looseness phase one left on the Go side
is the same mistake caught early.

**`Trait.name` for trait impls**, or both names. Rejected: one trait has
many implementors, so `Display.fmt` names nothing in particular; offering
both would double the citation space to make one kind of anchor
ambiguous.

**First overload wins for Java**, which is what every other language in
this seam does for a re-declared name. Rejected for the reason above —
it is the only formulation here that can produce a false *fresh* rather
than a false *stale*, and the seam's whole value is that a fresh verdict
means something. The cost of the choice is real and is stated in the
README: a document about one overload is stale when a sibling changes.

**Keeping doc comments in the hash**, mirroring Python's docstrings.
Rejected: it puts prose churn in the hash domain for every Rust and Java
anchor, and inside Rust it would mean that changing a `//` comment to a
`///` one moves a hash, which is noise with no reading behind it.
Documents that genuinely watch prose have `churn`.

**A `mod::item` path for Rust and a `$` separator for Java nested
types.** Rejected together: each would add a second separator to the
citation grammar for a case the existing one already covers — a module
anchors whole, and Java source itself writes `Outer.Inner`.

**Adding `>` to the shared closing-delimiter set** so rustfmt's trailing
comma inside exploded `<...>` generic lists would drop too. Rejected as
unpaid-for: rustfmt explodes a generic list only when it is very long,
and the change touches a constant every language shares.

## Consequences

The sample repositories that motivated the phase are covered end to end:
vaultwarden (Cargo) and petclinic / petclinic-micro (Maven) now carry the
full anchor vocabulary, so the turn-end sentinel fires for them and the
census's `churn-only` footnote recedes again — this time to languages
with no parser at all, C#, Ruby, PHP, Kotlin and the rest. The bootstrap
skill's constrained branch was recalibrated to match, and no longer uses
Rust as its example of the constrained case.

The cost is weight and two more pins inside the hash domain. The
loadable wasm total reaches about 2.4 MB (Rust 1103 KB, Java 415 KB on
top of phase one's 880 KB), still lazy and still cached once per
language, while the unpacked node_modules footprint of the grammars
roughly doubles to 37 MB of native prebuilds nothing loads. Rust's
grammar is by itself larger than the other three combined, which is what
a language with that much surface costs.

Both grammars are **ABI 14** against a runtime whose floor is 13. That is
one version of headroom, not a guarantee: a web-tree-sitter that raises
its floor forces the grammar bump ritual, and a grammar bump stales every
content-hash anchor of that language at once. The recorded fallback
remains `@vscode/tree-sitter-wasm`.

Five languages is where the extension-keyed registry stops being free to
extend: each new language is still one file and one entry, but it is also
a new set of naming decisions with no shared vocabulary to inherit beyond
`Type.name`. The two decisions worth carrying forward are the ones that
generalize — a citable name is one level deep, and a name that means
several declarations hashes all of them.
