# @zhchxiao123/dsh-devflow-spec

English | [中文](README.zh.md)

**Service Definition of the `ctx.devflowSpec` capability seam**: architecture documents whose claims are tied to the code they describe by evaluable anchors. This package owns the anchor vocabulary and the structural predicates every write must pass. Storage and anchor evaluation belong to a provider such as `dsh-devflow-spec-filesystem`; the model-facing write tool is `dsh-devflow-spec-tool`.

A document here is not prose that happens to cite code. Every claim rests on a declared anchor, and an anchor that no longer resolves makes the document report itself stale. That is the whole point: a stale architecture document is worse than none, because an agent follows it confidently.

## Service

`DevflowSpecStore` is an abstract Cordis `Service` registered as `ctx.devflowSpec` (one implementation per context; a second registration throws). It is an **optional** service — consumers read it with `ctx.get('devflowSpec')`, never the property proxy, so a deployment without the seam simply has no documents.

| Method | Behavior |
|---|---|
| `list(scope?, root?)` | Index values ordered by id; `scope` narrows by id prefix to one package or face. Each summary carries rolled-up freshness, its anchors' reference face (`anchorRefs`: kind/file/symbol in declaration order, digests and anchor ids omitted), and the scopes it `waives`. |
| `read(id, root?)` | One document, its declared anchors, and their verdicts. A reader must be able to learn that what it just read is stale. |
| `evaluate(id, root?)` | The verdicts alone, one per declared anchor in declaration order. |
| `resolveWrite(request)` | Implementation-owned defaults: the spec root when omitted, plus the commit timestamp recorded as `updatedAt`. |
| `write(spec)` | Commit one document: id check, structural checks, anchor evaluation, then the file write. Domain rejections resolve with `ok: false`; only infrastructure failures reject. |

Every declared anchor must evaluate `fresh` at write time — a document may not be born stale.

`anchorableExtensions` is the seam's one non-method member: the file extensions this implementation's anchors can point at, each with its leading dot, because what an anchor can resolve is decided by the evaluators the provider ships. It exists for a consumer that needs a denominator — `/devflow spec`'s coverage census asks how many files under a scope a document could anchor — and such a consumer reaches the store through `ctx.get('devflowSpec')`, so the alternative would be a second copy of the provider's language list, which starts wrong the day a language is added and never says so. There is no default here for the same reason.

## Anchors

Three kinds, discriminated by `kind`:

| Kind | Ties a claim to | Goes stale when |
|---|---|---|
| `symbol` | a symbol's continued existence | the symbol is renamed or removed |
| `content-hash` | a symbol's implementation, hashed over its normalized body | a line changes; reformatting does not |
| `churn` | a whole file's last commit | the file was committed after the document's `updatedAt` |

`AnchorVerdict` is **three-valued** — `fresh`, `stale`, `unevaluable` — and the third is reported as itself, never folded into the first. A check that can no longer run is not a check that passed; folding it into a pass is exactly how a permanently-green check appears. `worstFreshness` rolls a document up with `stale` outranking `unevaluable`, because a definite failure survives any number of unknowns.

## Structural contract

`write` refuses a document with a stable code rather than accepting one nothing can check later:

| Code | Cause |
|---|---|
| `invalid-id` | a segment fails `^[@a-z0-9][a-z0-9._@-]*$`; rejection happens at the id, before any path is built |
| `missing-source-of-truth` | no `## Source of truth` section |
| `no-anchors` | a document that anchors nothing; it would report `fresh` forever |
| `duplicate-anchor-id` | two anchors share an id, so citations would be ambiguous |
| `uncited-anchor` | a declared anchor the body never cites as `[[<id>]]` |
| `unknown-anchor` | a citation no declared anchor defines |
| `anchor-unresolvable` | an anchor that does not evaluate `fresh` at write time |
| `exists` | the id is taken |
| `unknown-replaced` | a `replaces` entry naming a document that does not exist under the root |
| `budget-exceeded` | one write's **net** growth — the new file's bytes minus everything it replaces — over the provider's ceiling, so a merge is never refused for being large |
| `self-waiver` | a `waives` entry naming a scope this document itself sits in; that scope has a document, so it is covered rather than waived |

The citation relation is checked **in both directions**: one half alone lets a document accumulate anchors nothing depends on, or rest claims on anchors that were never declared.

What this contract deliberately does **not** check is whether every substantive claim carries an anchor. That is a natural-language judgement, so it belongs to an LLM admission gate on a transition edge, not to a mechanical structure check. Putting an uncheckable rule in the mechanical layer only produces a check that pretends to be strict.

## Waivers

A document may declare `waives: [<scope-id>, …]`: scopes that deliberately need no architecture document of their own. The field rides the index, so a coverage census learns who waives what without opening a body.

Nothing else about a waiving document is special, and that is the design. It passes every rule any other document passes, so it cannot be a placeholder: it has to say **why** those scopes need no document and rest that reason on anchors that all resolve at write time. The consequence runs the other way too — when those anchors stop resolving the document goes stale, and so does the standing of its waiver, because the judgement "this scope needs no document" rested on code that has since moved. A consumer reporting the waiver reports that doubt with it.

Entries are exact ids, never prefixes; a prefix would quietly waive packages that do not exist yet. Two things this seam does not check, because the answer is not in the document: whether anything expects a document from the waived scope, and whether another document already waives it. Both belong to whoever holds the expected set — in the shipped line, `/devflow spec`, which reports an unexpected or duplicated waiver rather than dropping it.

## Model Experience

Indirectly, through the model-facing tool in `dsh-devflow-spec-tool`: the service interface itself registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No revision replay.** A document's history is the file plus git, not a folded event stream. Spec state stays out of the card journal on purpose, so introducing or removing this seam never changes how any committed card replays.
- **`symbol` and `content-hash` reach only languages with an evaluator** — TypeScript/JavaScript, Python, Go, Rust, and Java today. Files no parser reads can carry `churn` only.
- **The seam itself never refuses to serve a stale document.** It reports freshness; the read-side *reaction* — one turn-end interruption when a turn's writes leave a document stale, and the pre-step index that keeps the staleness visible after it — ships in [`dsh-devflow-spec-sentinel`](../devflow-spec-sentinel/README.md). What remains a limitation here is exactly that: a consumer that ignores verdicts can still follow stale prose, and no method of this seam will stop it.
