# Agent Note: The spec read faces are a division of labour, not a missing tool

Status: implemented

## Problem

`devflow_read_spec` needs an id, and nothing on the spec seam takes a scope. The spec-tool README carried that as a known limitation called "No index tool", and a run against a multi-module repository produced exactly the question it predicts: what does `customers-service` cover?

That limitation entry was wrong in the way that matters. It named one substitute — the `specRefs` index on single-card results — which needs a card, a `spec-refs` registration, and therefore `dsh-devflow-artifact-gate`, a row **disabled** in a default composition. The face that is enabled by default and already answers most of the question, `dsh-devflow-spec-sentinel`'s `devflow-spec-map` pre-step index, went unmentioned. Read as written, the entry taught that a default composition leaves a model unable to learn what a scope covers. The opposite holds: it is told, before every step, without asking.

## Decision

**No scope-listing tool, on either plane.** The four read faces are written down as one division of labour in [the spec-tool README](../../../../packages/devflow-spec-tool/README.md), and the limitation entry now states what is genuinely absent rather than what is merely not a tool:

- `devflow-spec-map`, the pre-step index — which documents claim the files this session touched, and what else those packages hold. Model plane, pushed, on by default, no tool call. A scope enters only through a first-party `read`/`write` the session made; 64 touch entries per layer; the render is byte-capped and drops the scope layer first, announcing the drop.
- `specRefs` on a single-card result — which documents sit under the prefixes this card declared. Model plane, off by default, gated on four conditions.
- `/devflow spec`'s census — the whole set's health, plus a three-state verdict and an anchorable-file count per expected scope. Human plane, takes no arguments.
- `devflow_read_spec` — one document's body. Model plane, on demand.

### The question that triggered this is a coverage question

The run asked what `customers-service` covers. The same evidence records that scope holding **zero** documents at the time — two of eight modules had any. A per-scope listing would have answered with an empty list. "Does this scope have enough" is coverage, owned on the human plane by [the coverage census](2026-09-14-spec-coverage-verdicts.md) and already written into the bootstrap skill as its completion criterion.

### "A whole-set census is the opposite of the index-not-bodies discipline", read two ways

`docs/devflow.md` states that as the reason the census is not a model-facing tool, and it is the only statement of that reason in the repository. It is compressed, and two readings both hold for the census: that the illness is **being unnarrowed** (a model-facing index must be narrowed by relevance — by the card's own prefixes, or by the files the session touched), or that the illness is **not being an index at all** (an index row points at a readable body; the census's `no document` line points at nothing, and counts, states and densities are a judgement face rather than a pointer face).

A scope listing splits under both readings, and it splits in the same place:

- **Returning index rows falls outside both.** The narrowing is the caller's scope, through the same `store.list(prefix)` call `specRefs` already makes, and every row points at a `devflow_read_spec`.
- **Distinguishing an empty scope from a scope nobody expects falls inside both.** Only the expected set answers it, and the expected set is the census's.
- **Reporting a waiver falls inside hardest.** A waiver is declared by a document living in **another** scope, so answering requires listing the whole set and scanning `waives` — a whole-set census by mechanism, not by resemblance.

The content discipline such a tool would owe is therefore the half that belongs with the census, and the half that does not is already served twice — by the pre-step index and by `specRefs`. Nothing worth building is left in between.

### What it would have cost, and one wrong argument about cost

A tool satisfying that discipline fits in ≈1366 characters of compact schema, ≈340–380 tokens **resident on every request** while the plugin is mounted — about half again this package's two existing tool literals. The pre-step index carries no comparable standing cost: `contextMaxBytes` is a cap rather than a floor, an index with nothing to say renders empty and leaves the prompt, and the harness re-sends it only when it changes.

**"A whole-set `list()` is too expensive for the model plane" is false, and no later argument may lean on it.** The pre-step index performs an argument-less `list()` before every model step, held up by the store's stat-keyed parse cache. The expensive act the census alone performs is the anchorable-file tree walk, and that walk is already confined to the human command. **The census stays on the human plane by discipline, not by compute.**

## Alternatives considered

**A `devflow_list_spec({ scope })` model tool.** Rejected under "require a current owner and need". The only scenario the existing faces miss is asking about a scope this session has not touched and no card declared, and no current caller needs it: the bootstrap route works on scopes with no documents by definition, and an incremental worker has read a file in the scope by definition. Against that, a standing per-request token cost and a new optional dependency from spec-tool on the sentinel's workspace service, for the expected set it would need.

**Teaching `devflow_read_spec` to accept a prefix.** Rejected. One tool returning either a body or a list makes the reader branch on the shape before knowing what arrived, and `read(id)` throws on an unknown id where a listing must answer "empty" — two meanings in one tool, where two tools are cheaper to read.

**Attaching the current scope's documents to every single-card result.** Rejected. It charges every card operation an extra `list()` and a full freshness recomputation — a known cost of the `specRefs` index already — for a field most calls do not use, and "the current scope" is not derivable from a card.

**`/devflow spec <scope>` on the human plane.** Rejected, and it is the candidate to reopen first if this decision is revisited — it spends no model budget and the machinery is already in place: the `spec` branch would take an optional scope, `coverageExpectation()` answers "expected but empty" versus "not expected", the waiver map answers the waived state, and the documented branch would print the ids it currently only counts. It loses on the size of the gap it closes. A human already gets every non-fresh document's id and failing anchors, every waiving document's id, each scope's document count and density, and the ids themselves from `ls .devflow/spec/<scope>/` — a document's authority is the file plus git. The one new fact is fresh document ids grouped by scope, which does not pay for a command-parse change, a census-render change, four test cases, a bilingual README pair and a note.

**A hand-written `index.md` per scope.** Rejected before this evaluation: a pure directory document has nothing to anchor and is refused with `no-anchors`, and a second copy of an index `list()` already derives from frontmatter drifts from it.

## Consequences

**Nothing shipped but prose.** No package gained surface, so coverage and composition are untouched; the spec-tool README pair and its consistency record are the whole change.

**The next proposal has a bar to clear rather than a path to re-walk.** Naming a caller that must ask about a scope the session never touched and no card declared is what reopens this; repeating the trigger question is not, because that question is answered by `/devflow spec`.

**The compressed line in `docs/devflow.md` stays compressed.** Both readings of it support the decision, so disambiguating it would have been a judgement made on the author's behalf, and this change does not make it. A future reading that contradicts both would put this decision back in play.
