# Agent Note: the devflow guidance layer — bundled workflow skill plus board runtime context

Status: implemented

## Problem

The model learned devflow passively. Tool descriptions teach the single-call
protocol, and the gates correct a mistake after it is made — but nothing
answered two questions: at session start, *does this workspace have an active
board worth reading before anything else*, and *where does the cross-tool
process knowledge live* — when work belongs on the board, which service class
a card should carry, how a requirement decomposes, what makes an artifact
worth a gate's yes, how to rework after a veto, how leases are shared.

Fragments of that knowledge had been crammed into tool descriptions, which is
the wrong home twice over: resident prose taxes every request whether or not
the workspace even uses devflow, and a description can only narrate its own
tool, so the knowledge that spans calls had no owner at all.

## Decision

`@zhchxiao123/dsh-devflow-guidance` — one package, two layers, each taking the
injection strategy [docs/devflow.md](../../../../docs/devflow.md) assigns its
knowledge kind. Obligations are untouched: they stay resident (iron-rules) or
in the tool descriptions, and enforcement stays with the store and gates, so
neither layer's absence degrades any guarantee.

**Judgment → catalog plus on-demand body.** The `devflow-workflow` bundled
skill (deploy's `skill.ts` form: `BUNDLED_SKILL_RANK`, model- and
user-invocable, static `assets/` body under 10 KB) owns entry judgment,
service-class selection, decomposition, artifact craft, rework etiquette, how
a card ends, and claim discipline. Its catalog description is written around
the four trigger moments: turning a discussed plan into tracked work, choosing
the rework path after a `devflow_transition` veto, deciding that work on a card
should stop, and picking up a workspace with a live board. A same-layer
provider with a lower rank overrides it by name.

**How a card ends is judgment, not protocol.** Filing a finished card, parking
a stuck one, and dropping one that will not be built are three outcomes with
three different reversibilities, and the tool descriptions cannot teach the
choice between them because no tool makes it — all three are `/devflow`
decisions. What the skill owns is telling them apart, plus two consequences a
caller learns the hard way otherwise: abandoning a requirement leaves its
slices on the board as top-level rows, and a veto that keeps repeating is a
conversation with the user rather than grounds to drop the card. Reading the
archive is the one part of this the model does itself, and the skill says so:
how a similar requirement was sliced is on the board, not in anyone's memory.

**Awareness → runtime context.** The `devflow-board` context (order 200,
above the harness's first-party 110–120 block) publishes a snapshot capped at
1024 bytes: stage counts, one line per claimed card, and a pointer at
`devflow_create` and the skill. The cap is the awareness stance made
mechanical — the board itself is one `devflow_list` away, and the harness
resends the whole merged runtime-context snapshot whenever any part changes,
so every byte here taxes every sandbox or approval change too.

**Descriptions slimmed behind it.** With the skill owning judgment,
`devflow_create` and `devflow_show` shed their cross-tool narrative
(when-to-use, parent/child slicing advice, "read the parent for the whole
picture"). Everything mechanical stayed verbatim — the `stageRevision`
optimistic-lock protocol, show-before-transition, every parameter description
including `serviceClass`, whose enum-value semantics are load-bearing for a
model that never loads the skill.

## How the snapshot refreshes

Three facts established by research corrected the first-draft design, and the
implementation follows them:

- **The context provider must be synchronous**, so it only reads an in-memory
  cache of rendered text keyed by devflow root; a delegate-first
  `agent/pre-step` listener is the cache's only writer (an empty render
  deletes the entry). The harness re-runs providers and diffs the joined
  snapshot every step, so an unchanged board is never re-sent and no
  invalidation API is involved.
- **No store-event subscription.** Assembly always follows a pre-step, so the
  per-step re-read (one failed readdir on a boardless workspace, no side
  effects) already sees every committed change — including the ones the seam
  emits nothing for, such as an artifact registration or an abandonment — and
  a listener on the emits it does have would only repeat work the refresh has
  done. The emit set has since grown (`devflow/card-archived` and
  `devflow/card-restored` joined it); the decision is unaffected, because it
  never rested on the emit set being small.
- **No archived count in the snapshot.** Awareness answers what to do now, and
  the size of the archive does not bear on that. A filed card is reached by
  asking for it — `devflow_list` with `set: "archived"` — which is the same
  trade the header already makes for every detail it counts rather than lists.
- **One `holder()` read per card.** `DevCard` carries no lease facts, so the
  claim flag costs an extra read per listed card per step, and claimed lines
  say `Claimed:` with no "by you": the per-root cache serves every agent
  assembling in that workspace, so attributing a lease to the reader would be
  invented. Card-derived text is sanitized because `{{…}}` is a strict
  variable reference to the prompt renderer.

## Alternatives considered

**Host both layers in `devflow-tool`.** Rejected: they would add `skills` and
`systemPrompt` to its required inject, changing the composition requirements
of every existing deployment of the tools. deploy carries its own skill only
because it already injects `skills`; devflow-tool does not.

**A resident pre-step message for the snapshot (the iron-rules form).**
Rejected: residency-by-injection is the *obligation* strategy. A board
snapshot is runtime state, and `ctx.systemPrompt.context()` exists exactly
for state that refreshes on change and is diffed for KV-cache reuse.

**Rendering deployment facts (configured artifact kinds) into the skill
body.** Rejected before a demonstrated need: the artifact-gate preflight
already delivers this deployment's requirements inside the tool results at
the moment they apply, and the skill names that preflight as the authority —
a static body stays true in every deployment.

**Moving the per-call obligations into the skill.** Rejected: a skill is
optional reading, and an obligation cannot be bet on the model having loaded
it. The boundary is one sentence — the skill teaches judgment, the gates
guarantee conduct — and it is stated in the skill body itself.

**Subscribing to store events to refresh the cache.** Rejected for the
coverage-gap and ordering reasons above; an event listener would add latency
masking, not freshness.

## Consequences

The model now has an entry point at both moments that previously had none:
session start (the snapshot says a board exists and what is in flight) and
judgment time (one catalog line away). Tool descriptions are cheaper and
purely mechanical, and the boundary is now enforced socially: new cross-tool
narrative belongs in the skill body, not in a description.

The costs are metered and accepted: one lease read per card per step; up to
1024 snapshot bytes riding every runtime-context republication; no snapshot
under `includeRuntimeContext: false` or an active suppressor (by harness
design); claims rendered without ownership attribution. A refresh failure
logs and serves the last snapshot rather than failing the model step — the
corrupt journal still fails loudly on the tool plane, where the model can act
on it.

Real-Loader composition tests pin the product surface: the catalog lists the
skill, the body loads from the shipped asset, a lower-ranked same-layer
provider overrides it by name, the assembled context carries a snapshot
consistent with the journal after create/transition/claim, a boardless
workspace contributes nothing and gains no directory, and disposal withdraws
the skill and the context together.
