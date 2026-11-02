# Agent Note: Architecture documents anchored to the code they describe

Status: implemented

## Problem

devflow has cards, artifacts, and gates, but no place for knowledge that outlives a card. A rule like "domain rejections resolve, infrastructure failures throw" belongs to a package, not to whichever card happened to establish it. Without a home, every card either restates it or relies on a one-size-fits-all `AGENTS.md` injection.

The obvious fix — a directory of Markdown per package — has a failure mode worse than the gap it closes. An architecture document that has drifted from the code is not merely useless: an agent reads it, believes it, and writes code against a rule that stopped being true. Prose citing `types.ts:195-197` looks rigorous and is not; nothing checks that the line numbers still mean anything. **A stale spec is more dangerous than no spec, because it is confidently wrong.**

## Decision

`ctx.devflowSpec` is a capability seam beside `ctx.devflow`, not a part of it. Documents live under `.devflow/spec/<id>.md` as frontmatter plus body, and every substantive claim rests on a declared **anchor** that the store evaluates on every read.

Three anchor kinds, chosen so a claim can be tied to the narrowest thing that would falsify it:

- `symbol` — the name must still be declared. Catches renames and removals, which is what invalidates most vocabulary and structure claims.
- `content-hash` — the symbol's parser-normalized body must still hash the same. Catches an implementation change behind an unchanged name.
- `churn` — the file must not have been committed after the document. The coarse anchor for files no parser reads.

Normalization drops comments **and statement semicolons** and collapses whitespace. Comments go through the TypeScript scanner rather than a regex, because a regex cannot tell `//` inside a string literal from a comment. Semicolons go because they are the formatting dimension tools most often disagree on, and a digest that moved when a formatter added them would mark every anchor in the repository stale at once — which teaches everyone to ignore the signal.

**`AnchorVerdict` is three-valued.** `unevaluable` is reported as itself and never folded into `fresh`: outside a git work tree a churn anchor cannot be decided, and a file no parser reads cannot carry a symbol anchor. A check that can no longer run has not passed. `worstFreshness` rolls a document up with `stale` outranking `unevaluable`, because a definite failure survives any number of unknowns.

**The store fills an omitted `content-hash` digest.** No caller outside this line can compute a digest over a parser-normalized body — a model certainly cannot — so requiring one made the strongest anchor kind unreachable through the model plane. Resolution happens in the provider's `write`, alongside the other implementation-owned defaults, not in the tool: cross-package collaboration goes through the seam, never a value import. A symbol that cannot be found leaves the digest empty and the write is refused as `anchor-unresolvable`.

**Every anchor must evaluate `fresh` at write time.** A document may not be born stale. That single rule is what makes the freshness report trustworthy later: a `stale` verdict always means the code moved, never that the document was wrong from the start.

### The structural contract stops where mechanism stops

The write path mechanically checks id legality, the `## Source of truth` section, at least one anchor, and the citation relation **in both directions** — every declared anchor cited, every citation declared. One direction alone lets a document accumulate anchors nothing depends on, or rest claims on anchors that were never declared.

It deliberately does **not** check that every substantive claim carries an anchor. That is a natural-language judgement. It belongs to an LLM admission gate on a transition edge, not to a structure check; putting an uncheckable rule in the mechanical layer produces a check that only pretends to be strict.

## Alternatives considered

**Make spec documents an artifact kind.** Rejected. Artifact registrations are immutable, belong to exactly one card, and are archived with it. A spec document is mutable, belongs to a package, and outlives every card that touched it — three mismatches against the artifact contract's core promises. The *reference list* naming which documents a card touched is a different object and does fit the artifact shape, which is why the two are split.

**Put spec state in the card journal.** Rejected. The journal's authority comes from being replayable; a document's authority is the file plus git. Mixing them would make the replay answer questions it has no business answering, and would mean introducing or removing this seam changes how committed cards replay. Keeping spec out of the journal is what makes this seam's rollback free.

**Line-range anchors.** Rejected — that is the failure mode being fixed, not a fix. Line numbers drift on every edit above them.

**Path-existence staleness, as `dsh-iron-rules` does.** Rejected as insufficient. That package's own documentation states the limit plainly: a rule whose grep patterns all stopped matching, with every watched path still present, is invisible to it. It names two real routes out — comparing git churn against the rule's own modification time, and requiring a known-violation sample. This design takes the first as the `churn` kind and covers the second failure mode with `content-hash` instead, since a reference document has no violation sample to keep.

**A pluggable evaluator interface for future languages.** Rejected under "Require a current owner and need". No second language has a consumer today, so the abstraction would be surface to maintain with nothing reading it. **This is a known debt**: when a second language arrives, `anchor-eval.ts` and `normalize.ts` are the two modules to split behind an interface, and the `symbol` / `content-hash` kinds are the only ones that need language dispatch — `churn` is language-agnostic already. The debt has since been paid on exactly that seam: [the multi-language anchor evaluation Agent Note](../feature/2026-09-13-spec-anchor-multilang.md) records the split and the Python and Go evaluators behind it, with [Rust and Java](../feature/2026-09-14-spec-anchor-rust-java.md) following through the same interface.

## Consequences

The seam **cost** a hard dependency on `typescript` in the provider, and a stated limit: `symbol` and `content-hash` worked on TS/JS only, everything else got `churn` — since narrowed to languages without an evaluator, Python, Go, Rust, and Java having joined through the seam the alternative above reserved. It cost a refusal path a naive design would not have — a document whose anchors do not resolve cannot be written at all.

It **bought** the one property the whole idea rests on: a document that reports its own decay. `packages/devflow-spec-tool/tests/loader-composition.spec.ts` proves it end to end through a real Loader composition — write a document, rename the anchored symbol, read the same document back as `stale`.

Placing the root inside `.devflow/` bought a second guarantee for free: `dsh-devflow-fs-guard` already denies file tools that subtree by directory-name match, so "the store is the only write path" is enforced rather than intended, with no additional configuration. The guard's denial message now branches on the target so a spec author is pointed at `devflow_write_spec` rather than at card tools that cannot write their file.

There is **no evaluation cache**. Every read re-parses the anchored files. The shape is designed and recorded in the provider's README, but nothing consumes this seam at a scale that needs it yet.
