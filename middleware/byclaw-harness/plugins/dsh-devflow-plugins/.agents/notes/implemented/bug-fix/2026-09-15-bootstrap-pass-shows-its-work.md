# Agent Note: a bootstrapping pass shows its verdicts, its anchors, and its remainder

Status: implemented

## Problem

One real run of `devflow-spec-bootstrap` against `petclinic-micro` — eight
Maven modules — landed three documents over two scopes. The documents were
good: one of them read spring-cloud-config's own source to establish that
`allow-override` has no read point in a config-data client and cited the
unfixed upstream issue, which is knowledge no reader gets from the repository
in front of them. Every defect the run exposed was procedural, and all three
lived in the skill body.

**Thirteen anchors, not one `content-hash`.** Eight `symbol` and five
`churn`; the churn anchors sat on `.yml` files, which is correct. But the
most valuable claims in those documents were behavioral and rested on class
names — "the fallback endpoint is `POST /fallback` only, so a GET gets a 405",
anchored `symbol: FallbackController`. Adding a GET mapping to that class
leaves the name untouched, so the anchor keeps reporting fresh while the
sentence is false. That is precisely the failure the [anchor-model
note](../architecture/2026-09-02-devflow-spec-anchor-model.md) exists to
prevent: a stale spec is more dangerous than no spec, because it is
confidently wrong. The judgement that would have caught it — reach for
`content-hash` when the claim is about behavior — lives in `dsh-write-spec`,
and bootstrap's writing section carried only a pointer at the authoring
skill's writability-then-strength ordering. Bootstrapping is the one scene
that states a whole scope's behavior at once, so the pointer was thinnest
exactly where the judgement was needed most.

**The document count rested on nothing reviewable.** No candidate list existed
before drafting, so "why three and not five" was unanswerable afterwards — by
a reviewer, and by the author.

**Two scopes of eight were covered and the pass said so nowhere.** Section 1
spends a pass on one scope, and the closing section already rested on the
census to keep the remaining gaps visible; both still hold. What was missing
is that the run ended without a sentence naming the six untouched modules, so
whoever asked for the repository to be documented read three documents as the
whole answer. The [coverage-verdicts
note](../architecture/2026-09-14-spec-coverage-verdicts.md) closed the same
leak *within* a scope — three documents are a pass's pace, not a total — and
left the half *between* scopes open.

## Decision

Four additions to `packages/devflow-guidance/assets/devflow-spec-bootstrap.md`.
No mechanism, seam, or census code moved.

**Anchor strength is stated in bootstrap's own voice, with the counter-example.**
Section 5 keeps its deference to the authoring skill's ordering and adds the
one line that ordering's strength half turns on here: `content-hash` for what
the code does, `symbol` for what it is called and how it is shaped, `churn`
only where no parser reads the file. The counter-example is the run's failure
re-told in this repository's voice — a retry endpoint that answers POST only,
anchored on the controller type, going false the day a GET handler is added
while the anchor still reports fresh. The `petclinic-micro` source is not
quoted: it is an Apache-2.0 sample, and the shape is what carries the lesson.

**A verdict step now sits between finding claims and writing them.** New
section 4: list every candidate, give each one a pass/fail verdict against
the write skill's stranger bar with a sentence of reason, then write the ones
that passed. The list is shown in the turn and stays out of `.devflow/spec/`,
because most of it is rejections and a document carries claims. An empty list
is a legitimate verdict and routes to the waiver section rather than to a
lowered bar. The sentence that already said the stranger test bounds the count
moved here from the writing section, where it was the tail of a paragraph
about pace.

**The closing section reports the sweep.** Alongside the mechanical completion
criterion, a pass now names the scopes it touched, what landed in each, and
how many scopes the census still reports with no document — worded so that
ending with six of eight uncovered reads as the staging section 1 prescribes,
which is what distinguishes it from walking away.

**The first document of a scope orients.** How the module works as a whole
and where its boundaries run, with detail documents branching off it; the run
had already produced that shape twice by instinct, and the skill now asks for
it.

## Alternatives considered

**A minimum document count per scope.** Rejected, and worth stating in full
because it is the obvious fix for the second gap. A floor is the same
size-blindness as the ceiling the coverage-verdicts note removed, pointed the
other way: it cannot tell a 16-file service from a 31-line admin module, and
it would demand the same tribute from both. It is also worse than the ceiling
was, because it pays for padding — a scope one document short of the floor is
a scope with an incentive to write a claim that already failed the stranger
bar, in a skill whose own words are that a document claiming nothing protects
nothing. The waiver mechanism was built one day earlier precisely so that
"this scope needs no document" is a recordable answer; a floor would make it
unreachable. What the skill got instead is an audit trail: the count falls out
of the verdicts, and the verdicts are visible.

**Requiring an `index.md` per scope.** Rejected as the form of the
orientation rule, which is why the skill names the refusal rather than merely
omitting the file. A table of contents describes documents, not code, so it
has nothing it could honestly anchor and `devflow_write_spec` refuses it as
`no-anchors` — the structural contract would have to be weakened to admit the
one document that cannot carry a claim. And the index already exists: `list()`
derives it from every document's id, title, and description, so a hand-written
copy is a second source for the same facts, drifting from the first write that
does not remember to update it. Orientation is therefore an ordering rule over
documents that pass the bar on their own.

**Teaching anchor strength by pointing harder at `dsh-write-spec`.** Rejected.
The old text already pointed, and the run still produced zero `content-hash`
anchors; a reference that is followed at the moment it matters is exactly what
a pointer cannot guarantee. The three-line rule and the counter-example are
bootstrap-specific — which anchor kind a batch of behavioral claims needs —
and the full selection ordering stays in the authoring skill, uncopied.

**A mechanical check that behavioral claims carry `content-hash`.** Rejected
on the line the anchor-model note drew: whether a sentence is behavioral is a
judgement, and putting an uncheckable rule in the mechanical layer produces a
check that only pretends to be strict.

## Consequences

**The body grew from 8.6 KB to 11.5 KB.** It is loaded on demand, so the cost
lands in the steps where a bootstrapping pass is actually running; the catalog
line is unchanged. The guidance README's size figure moved with it.

**The sections renumbered.** The verdict step is section 4, so writing,
waivers, and the closing section became 5, 6, and 7; the parserless branch now
qualifies steps 2-5, and its restraint clause cites section 5. Every internal
cross-reference moved with them.

**`tests/skill.spec.ts` pins the new load-bearing sentences** — the section
list, the verdict step, the absence of a floor, the empty-list verdict, the
orientation rule with its `index.md` refusal, the `content-hash` rule with the
still-fresh anchor of the counter-example, and the closing report. The pins
that survive from before (three as a pass's pace, the census pair as a fact,
the stranger test bounding the count) still read the same body.

**The three `petclinic-micro` documents were not re-anchored.** They live in a
sample repository, this change is to the skill, and re-anchoring them is a
separate decision about that checkout.
