# Agent Note: spec bootstrapping on the card board — the card carries the pass, the census carries coverage

Status: implemented

English | [中文](2026-09-15-spec-bootstrap-on-the-board.zh.md)

## Problem

A real cold start against an eight-module repository produced three documents
over two scopes and exposed two gaps that are not about judgement quality.

**The pass's reasoning does not survive it.** A bootstrapping pass judges a
list of candidate claims and writes the few that clear the bar. The list is a
working artifact by design — it holds rejections, and a document holds claims —
so it stays out of `.devflow/spec/`. Spoken in a turn, it is then gone, and
"why three documents?" has no answer the next session can read.

**Nothing reviews the anchors.** The run wrote thirteen anchors: eight
`symbol`, five `churn`, **zero `content-hash`**. The churn ones were correct
(no parser reads a `.yml`). Several of the `symbol` ones carried behavioral
claims — "the fallback endpoint answers POST only, so a GET gets 405", anchored
on the controller's type name. Add a `@GetMapping` and the claim is false, the
type name never moved, the anchor still reports `fresh`, and the document now
states the opposite of the code with nothing left to report it. That is the
quiet failure the anchor model exists to prevent, and no layer caught it.

Both gaps are the shape a card board answers: durable work product, and an
independent check on it before the work is called finished.

## Decision

Bootstrapping may be put on the devflow board as an **opt-in deployment
configuration**, and nothing was built to make that possible. The route is one
`bootstrap-pass` artifact kind on `dsh-devflow-artifact-gate`, one instruction
on `dsh-devflow-agent-gate`, and `dsh-devflow-parent-gate` unchanged. The
change set is a configuration sample in [docs/devflow.md](../../../../docs/devflow.md),
an unnumbered branch in the `devflow-spec-bootstrap` skill, and a
real-composition test that boots the sample out of the document itself.

### The card carries a pass; it never carries coverage

**No card, parent or child, is a source of truth for what the repository still
lacks.** `/devflow spec` computes coverage from disk and cannot drift; a board
tracking the same question necessarily does, because `devflow_write_spec` is a
complete commit point on its own — a document lands and no card has to move.
Within a day of adoption the board says `todo` for a scope the census says is
covered, and the two answers are both visible and both plausible.

It is also this line's own rule, stated in [docs/devflow.md](../../../../docs/devflow.md):
publish state only at its commit point. The commit point of "this scope has a
document" is the write, not a transition, so a card asserting it is a
projection nobody maintains.

Three things follow, and all three are load-bearing rather than stylistic:

- The parent card's completion criterion **cites** the census — it finishes
  when the census stops reporting these scopes with no document — instead of
  restating a list.
- The `bootstrap-pass` kind has sections for `Scopes`, `Candidates`,
  `Verdicts`, `Written`, and `Waived`, and deliberately **no `Remaining`
  section**. The absence is the contract: there is no slot to fill in, so the
  drift has nowhere to start. The composition test asserts the published kind
  spec has exactly those five.
- The skill's board branch says it in the imperative, because the next person
  to read it will want to copy a scope list onto the parent card as a progress
  bar.

### What the check is for

The `Verdicts` section is required non-empty; so are `Scopes` and `Candidates`.
An empty verdict section is not a pass that judged nothing, it is a pass that
did not answer. `Written` and `Waived` only have to exist — a pass where no
candidate cleared the bar writes no document, and most passes waive nothing.

The structure check cannot see the three things the run actually got wrong, so
the agent-gate instruction judges exactly those: that every rejection carries a
reason about *that* candidate rather than a phrase that would fit any line;
that a behavioral claim rests on `content-hash` and not on `symbol`; and that
every scope listed as waived is carried by a real document naming it in
`waives`. The second is why this gate exists at all — it is the 0-of-13 finding
turned into an admission criterion.

### Both edges leaving `developing`

The contract names `developing->reviewing` **and** `developing->done`. A
service class adds edges and removes none: `express` leaves through the
standard `developing->reviewing`, but `emergency` leaves through
`developing->done`, so a contract naming only the first lets precisely the
fastest cards out with no verdict list at all. This is the same trap
`spec-delta` documented on the three terminal edges; it is recorded here again
because the edge set differs and the first draft of this contract had it wrong.

## Why opt-in rather than default

The route costs a parent card, one card per scope, one registration per pass,
and one checker dispatch per gated move. A repository whose gaps one pass can
close pays all of that to learn what the census already reports, so the default
stays off — `devflow-artifact-gate` and `devflow-agent-gate` are already
disabled in the bundle, and without the `kinds`/`edges` above a bootstrapping
pass behaves exactly as it did before this change. The judgement of when the
paperwork is worth it lives in the skill, next to the procedure it qualifies:
put the run on the board when it outlives the session that starts it.

## Alternatives considered

**A `devflow-spec-board` package: no.** Every part of the route already exists
as configuration, and this line's own charter for the artifact contract is that
no policy hardcodes one. A package would have had to restate the kind, the
edges, and the completion rule as code, which is three copies of what a profile
already says once.

**Cards as the coverage view: no.** It is the whole reason the route is shaped
the way it is — see above. The census is derived from disk on every run; a
board is appended to by people.

**A `Remaining` section on the artifact, filled from the census: no.** A
snapshot of a derived answer is stale the moment it is registered, and
registrations are immutable, so the card would accumulate contradicting
snapshots with the newest one winning by revision rather than by truth.

**Gating the terminal edges instead of the exits from `developing`: no.** The
verdict list is the work of the pass, so it is owed on the way out of the stage
where the pass happened. Gating `reviewing->done` and `testing->done` instead
would let a card reach review with nothing to review.

**A fourth criterion in the instruction, that the pass named what it left
uncovered: no.** It reintroduces the coverage question on the card plane
through the checker, and the run's report is a turn-level obligation the skill
already carries.

## Testing

[`tests/spec-bootstrap-board-composition.spec.ts`](../../../../tests/spec-bootstrap-board-composition.spec.ts)
lifts the YAML sample **out of `docs/devflow.md` by text**, substitutes only the
scratch paths and the scripted checker provider, and boots it through the real
Loader. It drives an `express` scope card, an `emergency` scope card, and their
`express` parent to `done`, and asserts each layer decides at least once: the
two mechanical vetoes (nothing registered, `## Verdicts` present but empty) with
zero checker dispatches behind them, the anchor-mismatch veto with its report on
disk and no journal entry, the emergency edge's mechanical veto, and the
parent-gate veto while the scope cards are open. A doc edit that moves the
sample fails the suite naming the line it no longer recognizes.

The second case boots the same store and completion policy with neither gate
row and drives a card to `done` with nothing registered, which is the positive
half of the reverse claim; the negative half is that the rest of the suite
needed no change.

## Consequences

The `bootstrap-pass` vocabulary is a sample, not a published kind: a deployment
owns the section names, and a deployment that wants different ones changes its
own profile. Nothing in `packages/` knows the kind exists.

The skill's new section is unnumbered, like `## Languages without a parser`
beside it, because it qualifies the whole procedure rather than taking a place
in it — and because the numbered sections are being renumbered on another
branch.

The cross-cutting ownership rule the run arrived at by itself is now written
down: a claim spanning modules belongs to the scope that owns the contract and
is cited from the others, so it is one claim with one anchor rather than one
per scope drifting apart. The parent card is where such a pass belongs, since
making it a child's work puts one scope's card in charge of another scope's
document.

Rollback is deleting the configuration. Cards already created stay on the
board as ordinary cards and their registrations stay in their journals; the
documents those passes wrote are unaffected, because no part of the spec seam
ever learned about this route.
