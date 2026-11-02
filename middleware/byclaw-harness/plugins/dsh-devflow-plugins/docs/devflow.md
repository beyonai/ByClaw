# Devflow task cards

English | [中文](devflow.zh.md)

Types shared by the file-backed task-card seam and its consumers. The [devflow Agent Note](../../.agents/notes/implemented/feature/2026-08-25-devflow-file-based-task-cards.md) owns the seam decisions; this page records the exact fields and variants from [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts).

## Identity and stages

`DevflowCardId` is a [branded id](core.md#branded-ids) equal to the card's directory name (`<seq>-<slug>`), stable from creation. `DevStage` is the closed pipeline union; `blocked` is a bypass location, not a stage, and a blocked card remembers the stage it interrupted.

```ts type-equiv
/**
 * The closed set of pipeline stages a card moves through. `blocked` is not a
 * stage: it is a bypass location that remembers the stage it interrupted (see
 * {@link CardLocation}).
 */
type DevStage =
  | 'draft'
  | 'designing'
  | 'ready'
  | 'developing'
  | 'reviewing'
  | 'testing'
  | 'done'
```

```ts type-equiv
/** Where a card currently sits: a pipeline stage, or the `blocked` bypass. */
type CardLocation = DevStage | 'blocked'
```

```ts type-equiv
/**
 * The closed set of service classes a card is created under, each selecting
 * which edges of the pipeline that card may take. Every class is a superset of
 * `standard`, so a class only ever adds a shortcut.
 */
type ServiceClass = 'standard' | 'express' | 'emergency'
```

A card is created under one of three closed **service classes**, fixed at creation and never changed, which selects the edges it may take. `standard` is the default and walks the whole pipeline. `express` reaches `developing` from `draft` and `done` from `reviewing`, skipping design, readiness, and independent verification while keeping peer review. `emergency` reaches `developing` from `draft` and `done` from `developing`, giving up review as well; its follow-up is an ordinary card rather than an obligation in the state machine. Every class is a superset of `standard` — a class adds shortcuts and removes nothing — and a stage a class skips is not a bypassed gate, because the card never traverses that edge. The shortcuts are ordinary `from->to` keys, so a deployment may gate them like any other edge. The vocabulary is closed for the same reason the stage list is; [the service-class Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-devflow-service-class.md) owns the decision.

Moves follow the pipeline order, plus the rework edges that send a card back to the stage owning the fault: `reviewing` and `testing` both reach `developing` and `designing`, and `developing` reaches `designing` — because implementing a design is the most common way to discover it is wrong, and the alternative was routing the card through a review that never happened. Every rework edge requires a recorded `reason`. Any non-terminal location may enter `blocked`, which recovers only to the exact stage it interrupted; nothing leaves `done`.

A card that will never be finished is **abandoned** rather than parked: any location except `done` accepts it, the reason is required because it is all that survives the card, and the card leaves the board for the archive instead of occupying a column nobody is working in. Abandoning is terminal — no journal entry may follow it, so an abandoned card is the one archived card that cannot be restored — and it is a human decision, so it lives on the human surfaces — `/devflow` and the board — and has no model-facing tool. It stays readable in the archive, reason and all. [The abandonment Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-devflow-reasoned-abandonment.md) owns the decision.

Two of those names are read wrongly often enough to state plainly. `testing` is independent verification and acceptance, not the stage in which tests are first written — this line's own gate is per-file 100% coverage with the tests in the same change as the implementation, so a card arriving at `testing` with its tests unwritten already failed `developing`. `done` means the change is proven good in the repository; it does not mean a user received it. Deployment, release, and outcome measurement sit outside this model, so a column full of `done` cards is not evidence of delivered value.

## Journal entries

The append-only journal is the authoritative card history; the card file's frontmatter is a rebuildable projection. `decodeJournalEntry` validates each parsed line at the durable boundary, and `foldJournal` enforces contiguous revisions from 1, `created` first and only first, transitions departing the current location, exact blocked recovery, nothing following an `abandoned` entry, archiving only a `done` card, and nothing but a `restored` entry following an `archived` one.

Archiving is a journal event like any other state change, so a filed card carries an `archived` entry and a card brought back carries a `restored` one. Both are human decisions, made on `/devflow` or on the board; the directory move under `archive/<YYYY-MM>/` follows the append and is cleanup, so `list` decides what is active from folded state rather than from where a directory sits. Restoring returns visibility, not progress — a restored `done` card is still done. [The archive-lifecycle Agent Note](../../.agents/notes/implemented/architecture/2026-09-09-devflow-archive-lifecycle.md) owns the decision.

A requirement too big for one card becomes a parent card plus one child card per slice. The edge is the `created` entry's `parent`, fixed at creation and never re-pointed; it folds into `DevCard.parent`, projects as the frontmatter `parent:`, and narrows reads through `CardFilter.parent`. The breakdown is one level deep and never crosses roots — the provider enforces both when a child is created (`unknown-parent`, `nested-parent`, `parent-settled`).

```ts type-equiv
/** Who performed a journal action; `command` marks the human-command intervention plane. */
type DevActor =
  | { kind: 'human'; name?: string }
  | { kind: 'agent'; session?: string }
  | { kind: 'command'; name?: string }
```

```ts type-equiv
/** First journal entry of every card; `rev` is always 1. */
interface JournalCreated {
  rev: number
  at: string
  type: 'created'
  by: DevActor
  /** The card this one decomposes, fixed here at creation and never changed. */
  parent?: DevflowCardId
  /**
   * The card's service class, fixed here at creation and never changed.
   * Omitted is `standard`, so a journal written before classes existed reads
   * as one and a `standard` card's first entry keeps its original bytes.
   */
  serviceClass?: ServiceClass
}
```

```ts type-equiv
/**
 * One recorded gate verdict on a committed transition: which actor allowed the
 * move and, optionally, what the check covered. Only permitting verdicts
 * exist — a refusal vetoes the transition instead of being recorded.
 */
interface GateCheck {
  /** The actor that allowed the move. */
  by: DevActor
  verdict: 'allowed'
  /** One-line account of what the check covered. */
  summary?: string
}
```

```ts type-equiv
/**
 * One stage move. A move to `blocked` remembers `from`; the matching recovery
 * must return to exactly that stage.
 */
interface JournalTransition {
  rev: number
  at: string
  type: 'transition'
  from: CardLocation
  to: CardLocation
  by?: DevActor
  reason?: string
  /**
   * Gate facts attached by the transition waterfall: the human approval
   * signature and/or the recorded gate verdicts. At least one is present —
   * a move nothing gated carries no `gate` at all.
   */
  gate?: { approvedBy?: DevActor; checks?: GateCheck[] }
}
```

```ts type-equiv
/** Registration of a stage deliverable produced under `artifacts/`. */
interface JournalArtifact {
  rev: number
  at: string
  type: 'artifact'
  path: string
  stage: DevStage
  by?: DevActor
  /**
   * Deliverable kind of a store-written artifact; absent for a path-only
   * registration and for entries predating kinds.
   */
  kind?: string
}
```

```ts type-equiv
/**
 * The decision to stop: this card will never be finished. Terminal — no entry
 * may follow it — and the card leaves the active board rather than occupying
 * a stage nobody is working in.
 */
interface JournalAbandoned {
  rev: number
  at: string
  type: 'abandoned'
  by: DevActor
  /**
   * Why the work stopped. Required, unlike a transition's reason: a transition
   * leaves the card visible and explicable from where it sits, while this
   * removes it from the board, so the reason is all that is left of it.
   */
  reason: string
}
```

```ts type-equiv
/**
 * A delivered card left the active set for the root's archive. Unlike
 * `JournalAbandoned` this is not terminal: a `restored` entry may follow it,
 * which is what makes archiving reversible. Only a `done` card may carry one,
 * and while it is in force no other entry type may follow.
 */
interface JournalArchived {
  rev: number
  at: string
  type: 'archived'
  by: DevActor
  /**
   * Why the card was archived. Optional, unlike an abandonment's reason: an
   * archived card keeps its complete history, so nothing is lost by silence.
   */
  reason?: string
}
```

```ts type-equiv
/**
 * An archived card returned to the active set. It restores visibility only —
 * the card's stage is whatever its journal already said, so a restored `done`
 * card is still `done` and continuing its work is an ordinary rework
 * transition.
 */
interface JournalRestored {
  rev: number
  at: string
  type: 'restored'
  by: DevActor
  /** Why the card was brought back; recorded when present. */
  reason?: string
}
```

```ts type-equiv
/** Takeover of a stale lease: the previous holder's heartbeat lapsed. */
interface JournalClaimExpired {
  rev: number
  at: string
  type: 'claim-expired'
  previousOwner: DevActor
  by: DevActor
}
```

```ts type-equiv
/** The journal entry union; the discriminant is `type`. */
type DevflowJournalEntry =
  | JournalCreated
  | JournalTransition
  | JournalArtifact
  | JournalAbandoned
  | JournalArchived
  | JournalRestored
  | JournalClaimExpired
```

## Read values

```ts type-equiv
/**
 * Read-side value of one artifact registration: the journal entry's facts
 * without its envelope. Registrations are immutable — the newest record of one
 * `kind` (the highest `rev`) is that kind's current content.
 */
interface ArtifactRecord {
  /** Artifact path relative to the card directory. */
  path: string
  /** Deliverable kind; absent for a path-only registration. */
  kind?: string
  /** Journal revision of the registration; orders records of one kind. */
  rev: number
  /** The stage the deliverable was registered against. */
  stage: DevStage
}
```

```ts type-equiv
/** Read-side value of one card, current state derived by journal replay. */
interface DevCard {
  id: DevflowCardId
  /** Resolved devflow root directory this card belongs to (absolute path). */
  root: string
  /** Human title from the card file's frontmatter. */
  title: string
  /** Current location derived from the journal, never from the frontmatter projection. */
  stage: CardLocation
  /** Revision of the last journal entry; optimistic-concurrency token for transitions. */
  stageRevision: number
  /** The stage a `blocked` card returns to on recovery; absent unless `stage` is `blocked`. */
  blockedFrom?: DevStage
  /**
   * The card this one decomposes; absent for a top-level card. Only one level
   * exists, so a card carrying `parent` is never itself a parent.
   */
  parent?: DevflowCardId
  /**
   * The card's service class, selecting which pipeline edges it may take.
   * Always present: a card whose journal states none is `standard`.
   */
  serviceClass: ServiceClass
  /**
   * Set once the card was abandoned: the work stopped and will not resume.
   * Such a card is off the active board, so `list` never reports one.
   */
  abandoned?: true
  /**
   * Set while the card sits in the root's archive. Off the active board like
   * `abandoned`, but not terminal: a restore clears it. A card archived
   * before archiving became a journal event carries no `archived` entry, so
   * this may be derived from where the card's directory sits.
   */
  archived?: true
  /**
   * The `YYYY-MM` bucket an archived card is filed under — the month its work
   * finished, which is what `CardQuery.month` narrows by. Present exactly
   * while `archived` is; it is not derivable from `updatedAt`, which by then
   * names the archiving itself.
   */
  archivedMonth?: string
  /** Timestamp of the card's first journal entry: when it was created. */
  createdAt: string
  /** Timestamp of the card's last journal entry: when it last moved. */
  updatedAt: string
  /** Markdown body of the card file below its frontmatter. */
  body: string
  /** Display path of the card file. */
  path: string
  /** Artifact paths registered in the journal, in registration order; the path projection of {@link artifactRecords}. */
  artifacts: string[]
  /** Artifact registrations in registration order, each carrying its journal revision, registering stage, and optional kind. */
  artifactRecords: ArtifactRecord[]
}
```

Both card reads narrow by one predicate vocabulary; they differ in pagination, not in how a card is selected. `list` returns the whole active set — six of its seven consumers depend on that, one of them a gate — while `query` pages and is the only way to reach the archive, whose size cannot be promised.

```ts type-equiv
/**
 * The predicate vocabulary both card reads narrow by. Declared once so
 * `CardFilter` and `CardQuery` can never drift into two dialects of the same
 * idea.
 */
interface CardPredicates {
  /** Only cards currently at this location. */
  stage?: CardLocation
  /** Only cards decomposing this one; an id with no children matches nothing. */
  parent?: DevflowCardId
  /** Only cards with no parent. Mutually exclusive with `parent`. */
  topLevel?: true
  /** Only cards created under this service class. */
  serviceClass?: ServiceClass
}
```

```ts type-equiv
/** Read filter accepted by {@link import('./index.ts').DevflowStore.list}. */
interface CardFilter extends CardPredicates {}
```

```ts type-equiv
/** Which card set a {@link CardQuery} reads. */
type CardSet = 'active' | 'archived' | 'all'
```

```ts type-equiv
/**
 * Narrowing and pagination accepted by
 * {@link import('./index.ts').DevflowStore.query}.
 */
interface CardQuery extends CardPredicates {
  /** Which set to read; omitted reads the active set. */
  set?: CardSet
  /**
   * Only archived cards filed under this `YYYY-MM` bucket. Meaningless
   * against the active set, so pairing it with `set: 'active'` is a usage
   * error rather than an empty result.
   */
  month?: string
  /** Page ceiling; omitted uses the implementation's configured default. */
  limit?: number
  /**
   * The previous page's `nextCursor`, passed back verbatim. Its encoding
   * belongs to the implementation — callers never parse or construct one, and
   * an unparsable cursor is a usage error rather than a silent restart from
   * the first page.
   */
  cursor?: string
}
```

```ts type-equiv
/**
 * One page of {@link import('./index.ts').DevflowStore.query}. Truncation is
 * always stated: a caller that cannot tell a full page from a complete result
 * will report the page as the whole set.
 */
interface CardPage {
  /** The cards of this page, in the set's reading order. */
  cards: DevCard[]
  /** Whether the limit cut the result short. */
  truncated: boolean
  /** Cursor for the next page; absent once the set is exhausted. */
  nextCursor?: string
}
```

## Service behavior

The abstract [`DevflowStore`](../../packages/devflow/src/index.ts) Service Definition specifies journal-authoritative `list`/`read`, explicit create/transition requests, the transition waterfall, and exclusive claim leases. [`FilesystemDevflowStore`](../../packages/devflow-filesystem/src/index.ts) is the file Service Provider; [`dsh-tool-devflow`](../../packages/devflow-tool/README.md) is the model-facing Consumer through which the Harness agent creates, inspects, attaches artifacts to, and advances cards. [`dsh-devflow-fs-guard`](../../packages/devflow-fs-guard/README.md) keeps the store as the only write path over protected card state. Four policies compose on the transition waterfall: [`dsh-devflow-artifact-gate`](../../packages/devflow-artifact-gate/README.md) checks registered artifacts mechanically and publishes proactive requirements; [`dsh-devflow-agent-gate`](../../packages/devflow-agent-gate/README.md) runs independent LLM admission checks; [`dsh-devflow-gates`](../../packages/devflow-gates/README.md) runs commands and one-shot approvals; and [`dsh-devflow-parent-gate`](../../packages/devflow-parent-gate/README.md) prevents a decomposed requirement from finishing before its children. [`dsh-command-devflow`](../../packages/devflow-command/README.md) is the deterministic human intervention plane, and carries the two read-only health reports as well: `/devflow spec` on the document set, and `/devflow doctor` on the deployment itself — the board's git preconditions asked through the worktree fence's own checker, every held lease with the age of its heartbeat, each dispatched worktree's existence and linkage, and which optional planes are mounted. Both close with what they could not answer, because a report that renders "could not check" as "no problem" is worse than no report; for `doctor` that list always includes validator availability and each gate's edge configuration, neither of which any service on this line publishes. [`dsh-devflow-web`](../../packages/devflow-web/README.md) and [`dsh-client-ui-devflow`](../../packages/devflow-ui/README.md) expose the browser channel and board: reads of the active set and the archive, plus the decisions a person makes about a card's place on the board — filing a finished card, sweeping the finished ones, dropping one that will not be built. Executing verbs are not on that channel, and restoring stays on the command plane. There is deliberately no second background executor: execution and progression belong to the Harness agent, while plugins own state, tools, policy, commands, and views.

## The artifact contract

A deployment that wants artifact discipline composes the four transition policies while the Harness agent remains the executor — no policy hardcodes a contract, so the whole thing is configuration. That configuration is written once, as [`examples/full-pipeline/cordis.patch.yml`](../examples/full-pipeline/cordis.patch.yml): a profile patch over the [bundle](../packages/devflow-bundle/README.md)'s rows in which every pipeline edge carries a contract, two edges carry an admission check, one runs the verify suite, and the worktree row's dispatch kind is pinned to the kind the artifact gate shapes. Copy it into a profile's own `cordis.patch.yml` (the harness's shell executor, subagent runtime, and default-model rows are composed as usual); [`tests/artifact-contract-composition.spec.ts`](../tests/artifact-contract-composition.spec.ts) boots that composition shape through the real Loader and drives one card draft→done across it.

The rest of this section is why it is configured that way. The settings themselves are not restated here: one contract written in two places drifts, and the copy nobody runs is the one that stays wrong.

**Load order is the waterfall.** Listeners on `devflow/transition` run in registration order, so the mount order of the four policies is the decision order, and the sample's order is deliberate: **mechanical → agent → command → approval/completion**, cheapest and most deterministic first. The free structure check vetoes before a checker spends model budget on an incomplete deliverable; the checker vetoes before a command gate spends a test suite's wall-clock on unsound work; and commands run before a human is asked. A deployment that configures an approval at all buys the same ordering: the human is asked only once every automatic layer has said yes. The [bundle](../../packages/devflow-bundle/README.md) mounts its policy rows in exactly this order, and the composition test asserts it holds — a mechanical defect dispatches zero checkers and runs zero gate commands.

**Kinds are defined and judged at one point.** The `kinds` section of `devflow-artifact-gate` is the only place a kind's structure exists; it is published as the read-only [`devflowArtifactStructures`](#ctxdevflowartifactspecs--artifactspecs-value-service) service, while [`devflowArtifactContract`](#ctxdevflowartifactcontract--artifactcontract-value-service) exposes the gate's exact outgoing-edge judgment before a move. Everything else consumes that vocabulary without restating its shape: the agent gate's `inputs` select which registrations feed a check, and model tools render the dynamic inspection returned by the contract service — so preflight cannot drift from enforcement.

**The mount order is the bundle's, and the patch does not change it.** A profile patch that addresses rows by id — which is what the sample is — configures them where they already sit. Re-`insert`ing a row instead appends it, which moves its listener to the end of the waterfall; that is how a deployment silently puts its mechanical check behind the checker it was meant to spare.

**Approvals are deliberately absent.** `devflow-gates` takes an `approvals` list and the sample configures none, because a human approval on a pipeline edge stops every card that crosses it, and the defects it is meant to catch are already the job of the command gate beside it and of the `reviewing` stage the pipeline enforces on every card. Add an approval only to an edge whose blast radius warrants stopping all of them, and read its price as per-card latency rather than as one-time setup.

**The agent is the producer, and nothing in the contract produces for it.** It reads each tool result's `artifactGates` preflight, registers the required kind through `devflow_attach_artifact`, and advances the card explicitly. No row in the sample writes a deliverable or moves a card.

The rework loop needs no second orchestrator: a veto leaves the card in place with the reason (an agent veto's full report lands under the card's `.devflow/reports/agent-gate/`), the Harness agent registers a fixed revision of the same kind, and the retry re-checks against that newest registration — the agent gate re-dispatches because the changed input revision misses its verdict cache, while a retry with nothing changed reuses the cached verdict instead of paying a second checker.

### Rich-content artifacts: pointer plus a separate file

The five deliverable kinds the sample defines are all plain Markdown, and `sections` only checks that a heading exists — it does not care about the semantics of what sits under it. A deliverable like a test report wants richer content — screenshots, progress bars — that Markdown cannot express well, without either bloating the journal with a large file or hitting the model's single-turn output cap. No new mechanism is needed: the existing `nonEmptySections` structure check plus the existing two `attachArtifact` registration forms (kind+content and path-only) already compose into an answer. Here is a kind definition a deployment that wants this capability can adopt directly:

```yaml
test-report-html:
  frontmatter: [card]
  nonEmptySections: [Report]
edges:
  'testing->done': [test-report-html]
```

Use `nonEmptySections` rather than `sections`: `sections`, which only requires a heading to exist, would pass an empty section — equivalent to passing a "pointer" that points at nothing. `nonEmptySections` additionally requires at least one non-blank line between a heading and the next, forcing the pointer text to actually say something (even if it is just a relative path). A registered pointer's content looks like:

```md
---
card: 0001-my-card
---

## Report

HTML report: artifacts/report.html
```

Landing this deliverable follows the **"Bash writes, double registration"** pattern — one landing in three steps:

1. **Bash writes the file.** The step that produces the report uses Bash (not the Write/Edit tool) to write `report.html` and any screenshots into `<card directory>/artifacts/`. `devflow-fs-guard` intercepts any tool's write/edit intent under the `.devflow` subtree by matching a path segment name, down to the `artifacts/` subdirectory, with no exception — the model's Write/Edit tools cannot create `report.html` directly under a card directory. The guard's own module doc states it is a "policy fence over the tool plane, not a kernel boundary," and a Bash write is not intercepted by it; that is exactly the opening this pattern uses.
2. **A path-only registration.** `attachArtifact({ path: 'artifacts/report.html', ... })`, carrying no `kind`. This registration takes no part in the gate's judgment (the gate only recognizes registrations with `kind === 'test-report-html'`) — its job is the board's "open" visibility: `devflow-ui` opens the real file on disk by the registered `path`, treating a record the same whether or not it carries a `kind`.
3. **A kind+content registration.** `attachArtifact({ kind: 'test-report-html', content: <pointer text>, ... })`, where `content` is a short passage that satisfies the kind's structure above and names the relative path `artifacts/report.html` in its body. This registration's job is satisfying the structural gate on `testing->done`; `content` is only a pointer, not the report itself — stuffing the whole `report.html` into `content` would reintroduce the very two problems this pattern exists to avoid: a large file in the journal, and the model's single-turn output cap.

The order of the two registrations does not matter, but both are required: with only the path-only registration, `testing->done` is still rejected ("test-report-html: no artifact of this kind is registered"); with only the kind+content registration, the gate passes, but the board loses the clickable row pointing at the real `report.html` — opening it shows the pointer text itself, not the report. This pattern is shown only on the `testing->done` edge as an example; the edges for `prd`/`design`/`implement`/`review` do not need it and stay plain Markdown.

## Architecture documents

Knowledge that outlives a card lives behind a second seam, [`ctx.devflowSpec`](../packages/devflow-spec/README.md), not in the card journal. Documents sit under `.devflow/spec/<id>.md` as frontmatter plus body, and every substantive claim rests on a declared **anchor** the store evaluates on every read: `symbol` (the name must still be declared), `content-hash` (the symbol's parser-normalized body must still hash the same), or `churn` (the file must not have been committed after the document). A verdict is three-valued — `fresh`, `stale`, `unevaluable` — and the third is never folded into the first, because a check that can no longer run has not passed.

Every anchor must resolve `fresh` at write time, so a `stale` verdict later always means the code moved rather than that the document was wrong from the start. A `content-hash` anchor written without a digest takes the anchored symbol's current one: no caller outside this line can compute a digest over a normalized body, and requiring one would leave the strongest anchor kind unreachable from the model plane.

The root sits inside `.devflow/`, which [`dsh-devflow-fs-guard`](../packages/devflow-fs-guard/README.md) already denies file tools, so [`dsh-devflow-spec-tool`](../packages/devflow-spec-tool/README.md) is the only write path by enforcement rather than by intent. Spec state stays out of the journal on purpose: a document's authority is the file plus git, so mounting or removing this seam never changes how a committed card replays. The decisions are owned by [the anchor-model Agent Note](../.agents/notes/implemented/architecture/2026-09-02-devflow-spec-anchor-model.md).

### Reacting to drift

The default reaction to drift is session-hosted, not edge-hosted. [`dsh-devflow-spec-sentinel`](../packages/devflow-spec-sentinel/README.md) watches which files each turn's first-party `write`/`edit` calls landed; when a stopping turn has left an anchored document stale, it forces one continuation step naming the document, the failing anchors, and the four legitimate exits — rewrite via `replaces`, replace a document that was wrong, retire the claim through a merge, or explicitly defer. The same document never interrupts the same session twice, and there is no retry ceiling: a stale document is a reference whose reader owes it one informed look, not an obligation to fight over, so a mid-refactor rename that keeps a document stale for many turns is a legitimate state, and the sentinel's own message says so. `churn` anchors never trigger it — an uncommitted edit cannot flip one, so churn health belongs to the census below.

After that one interruption — or a defer — staleness stays visible rather than forceful. The `devflow-spec-map` runtime context lists, before each model step, the documents relevant to what the session has touched, as index lines only. Two layers: documents whose anchors claim files the session's writes landed, stale ones first with their failing anchors named; and the other documents of every package the session has touched at all, reads included, because reading a file is the early "about to work here" signal. The index is byte-capped and diffed by the harness; a body still reaches the model only through `devflow_read_spec`, warning line attached. Zero configuration is meaningful: without the seam the sentinel and the index are inert, and mounting them enforces nothing a deployment did not already write down as anchors.

### Reaching a card

The declarations below are the **opt-in paper record**: a card-level contract a deployment configures deliberately, on top of the automatic path above, which needs none of it.

A card says which documents its work touches through a `spec-refs` artifact — a `## Scope` section listing id prefixes. Make it a required kind on `draft->designing` and a card cannot leave draft without answering — on the standard route only: `express` and `emergency` enter work through `draft->developing` and never cross that edge, so this contract as written binds none of their cards. A deployment adopting it either accepts standard-only coverage or requires the kind on `draft->developing` as well; both are defensible, but it has to be a decision. The same registration then sources an optional `specRefs` index on every single-card result, shaped exactly like `artifactGates` beside it: id, title, description, path, and rolled-up freshness, **never the body**. A body reaches the model through `devflow_read_spec` on demand, and that read renders an explicit warning line whenever the document is not fresh — a read returning only prose would drop the one signal this seam exists to carry.

A scope that was never declared stays silent — a card that has not yet said what it touches is an ordinary card — and declared prefixes that reach nothing omit the index too, leaving that coverage gap to the census. But a registration that yields no readable scope — an unreadable file, no `## Scope` section, or no entry under it — puts one warning line on the single-card result saying the index is not being served: that card promised a declaration, and silence would read as "no documents".

### Revising and retiring

`replaces` is what lets the set shrink. Naming the written id revises in place; naming others merges a cluster and deletes them. The growth ceiling charges the **net** change, so folding three documents into one is never refused for being large — billing a merge as pure addition would refuse precisely the move that relieves the pressure. Every rejection settles before the first write, so a refused merge leaves the root byte-for-byte as it was; this is deliberately not crash atomicity across the several files a merge touches, since the replacement is written before anything is removed and an interrupted merge therefore leaves duplication rather than a gap.

On the way out, a `spec-delta` artifact makes the card triage what it produced: `reference` becomes a document here, `obligation` goes to a rule set that stays resident and is enforced by a check script. Mount it on **all three** terminal edges — a service class adds edges rather than replacing them, so a contract naming only `testing->done` lets precisely the cards that skipped review also skip triage. Like `spec-refs`, this is opt-in paperwork: a default composition already reacts to the staleness itself through the sentinel, and `spec-delta` is for deployments that want a per-card written triage on top.

### Reading the health of the set

`/devflow spec` reports it on the human plane: how many documents are fresh, which are stale or unevaluable **and which anchor failed**, then a coverage census placing every expected scope in one of three states — documented, waived by a named document, or no document — each measured over the count of files under it an anchor could point at. It is derived from `list()` plus `evaluate()` rather than a store method, and it is not a model-facing tool — a whole-set census is the opposite of the index-not-bodies discipline the card results follow. Expected coverage is discovered before it is configured: with no `specScopes` configured, the census asks the optional `devflowSpecWorkspace` service — the sentinel's workspace-layout resolver — for the invoking workspace's package layout and treats its scope ids as the expected set, saying so in the report. Configuring `specScopes` overrides that discovery whole rather than joining it — listing scopes is saying "ask about exactly these", which includes the right to leave a discovered package unasked. With neither source the report says the coverage question was not asked, which is not the same as saying there are no gaps.

The waived state is what a document's optional `waives` field buys: a deliberate decision that a scope needs no architecture document, carried by an ordinary document that had to say why and rest that reason on anchors — so the waiver falls into doubt on the day the document goes stale, and only `no document` is ever counted as a gap. No count in the census is a threshold. Whether a scope has enough documents is the judgement it hands back, the same line the structural contract draws when it declines to check whether each claim carries an anchor, and the file count is what makes that judgement possible rather than what makes it for you.

### Bootstrapping on the board

Cold-starting a large repository's document set takes several passes across several sessions, and a pass currently leaves nothing behind but its documents: the candidate list it judged — what it considered, what it rejected and why — is spoken in a turn and gone, and nothing reviews it. A deployment that wants that list kept and checked can put the run on the card board, and **needs no new mechanism to do it**: the artifact contract, the admission gate, and the completion policy already compose into the whole route, which is why what follows is a configuration sample rather than a package.

**A card carries a pass's work; it never carries coverage.** That is the boundary the shape is built around, and it is not a style preference. `/devflow spec` computes coverage from what is on disk and cannot drift; a board tracking the same question necessarily does, because `devflow_write_spec` is a complete commit point on its own and nobody has to touch a card for a document to land. Mirroring the census onto cards would also break this line's own rule that state is published at its commit point — the commit point of "this scope has a document" is the write, not a transition. So a parent card's completion criterion **cites** the census (it finishes when the census stops reporting these scopes with no document) rather than restating it, and the `bootstrap-pass` kind below deliberately has no `Remaining` section for anyone to fill in.

This adds no fourth place to read documents from. The census answers "what does the whole set look like" on the human plane; the `devflow-spec-map` pre-step index answers "which documents touch what this session is editing"; a card's `spec-refs` answers "which documents does this card's work touch". A `bootstrap-pass` registration answers none of those — it is not a read face at all, but the record of one pass's decisions, kept so a gate can judge them.

The shape is one parent card for the repository and one child card per uncovered scope, with the cross-cutting pass as the parent's own direct work. `dsh-devflow-parent-gate` already refuses a parent's `done` while any child is elsewhere, so nothing here re-states completion policy. The devflow half of such a profile:

```yaml
# The store, then the three policies this route needs, in waterfall order.
- name: '@zhchxiao123/dsh-devflow-filesystem'

# Layer 1 — mechanical: the pass's verdict list is registered and whole.
# `Verdicts` is a nonEmptySection because an empty verdict section is not a
# pass that judged nothing, it is a pass that did not answer; `Scopes` and
# `Candidates` are held to the same bar for the same reason. `Written` and
# `Waived` only have to exist: a pass where no candidate cleared the bar
# writes no document, and most passes waive nothing.
- name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      bootstrap-pass:
        frontmatter: [card]
        sections: [Written, Waived]
        nonEmptySections: [Scopes, Candidates, Verdicts]
    edges:
      # BOTH edges that leave `developing`. A service class adds edges and
      # removes none: `express` leaves through the standard
      # `developing->reviewing`, but `emergency` leaves through
      # `developing->done`, so a contract naming only the first lets
      # precisely the fastest cards out with no verdict list at all.
      'developing->reviewing': [bootstrap-pass]
      'developing->done': [bootstrap-pass]

# Layer 2 — admission: the three things a structure check cannot see. Both
# edges share one instruction on purpose; a checker that judged the
# emergency route more loosely would make the shortcut the way around the
# review rather than around the design round.
- name: '@zhchxiao123/dsh-devflow-agent-gate'
  config:
    edges:
      'developing->reviewing': &bootstrap-check
        provider: claude
        inputs: [bootstrap-pass]
        prompt: |
          Judge this bootstrapping pass's verdict list. The structural check
          has already passed, so every section exists; you are checking
          whether what is written in them is honest. Read the documents named
          under `Written` with devflow_read_spec when you need to see their
          anchors. Judge exactly these three things, and veto naming the
          offending line if any of them fails.

          1. Every candidate has a verdict, and every rejection carries a
          reason about that candidate. A reason that would read the same
          under any other line — "not load-bearing", "the code already says
          this", "out of scope" with nothing specific to the claim — is a
          rejection with the reason left out, and the count of documents
          written is only reviewable when the rejections are real.

          2. Every claim under `Written` rests on an anchor kind that can
          falsify it. A behavioral claim — which methods an endpoint answers,
          what a failure path returns, an algorithm, a validation rule — must
          rest on `content-hash`. A `symbol` anchor watches only the name, so
          adding a handler turns the claim false while the anchor still
          reports fresh, and the document then states the opposite of the
          code with nothing left to report it. `symbol` is right only for a
          claim about what the code is called or how it is shaped, `churn`
          only where no parser reads the file. Veto naming the document, the
          anchor, and the claim the anchor fails to watch.

          3. Every scope under `Waived` is carried by a real document that
          names it in `waives`. Read that document: it has to say why the
          scope needs none and rest that reason on its own anchors. A scope
          listed as waived without such a document is an undocumented
          decision, not a waiver.

          `Scopes` is what this pass took, never what the repository has
          left. Coverage is the `/devflow spec` census's answer and its
          absence here is deliberate, so do not ask for a remaining-scope
          list.
      'developing->done': *bootstrap-check

# Layer 3 — completion: the repository card finishes after every scope card
# does. No config; the rule is the parent/child relation.
- name: '@zhchxiao123/dsh-devflow-parent-gate'
```

A registration the gates accept looks like this — the `Written` lines name the anchor kind, which is what makes criterion 2 judgeable from the artifact instead of from a re-read of the whole scope:

```md
---
card: 0002-scope-api-gateway
---

## Scopes

spring-petclinic-api-gateway

## Candidates

- The fallback endpoint answers POST only; a GET through the gateway gets 405.
- `default-filters` attaches a CircuitBreaker and a POST-only Retry to every route.
- A failed visits call degrades to an empty visit list rather than an error.
- The module is a Spring Boot application.

## Verdicts

- fallback method set — pass: a stranger reads the 405 as a routing defect and "fixes" it.
- default-filters — pass: the retry covers POST alone, and no single call site shows that.
- visits degradation — pass: the empty list is designed behaviour and reads as data loss.
- Spring Boot application — reject: the annotation on the class states it, so the claim is not non-obvious.

## Written

- `gateway-fallback-semantics` — claim: the fallback endpoint answers POST only — anchor: `content-hash` on `FallbackController`

## Waived

None.
```

Service class is a judgement the run makes per card, and the classes are what the two gated edges exist for: a bootstrap pass has no design round to skip, so `express` (`draft->developing`, then the standard exit through `reviewing`) is usually the honest class, and `emergency` (`draft->developing`, then `developing->done`) fits a scope whose whole answer is a waiver. Both still register the pass, because both gated edges carry the same contract. [`tests/spec-bootstrap-board-composition.spec.ts`](../tests/spec-bootstrap-board-composition.spec.ts) boots exactly this composition through the real Loader and drives an `express` scope card, an `emergency` scope card, and their `express` parent to `done`, including the anchor-mismatch veto and the emergency edge's mechanical veto.

None of this is on by default. The bundle ships `devflow-artifact-gate` and `devflow-agent-gate` disabled, and without the `kinds`/`edges` above a bootstrapping pass behaves exactly as it does with no board at all — the skill's procedure, the census as the completion criterion, and nothing registered anywhere. The [`devflow-spec-bootstrap` skill](../packages/devflow-guidance/README.md) carries the judgement of when the route is worth its paperwork: a repository whose gaps one pass can close should not pay for it.

## Iron rules

Documents are reference knowledge — worth knowing, read when relevant. The other kind is an **obligation**, where not following it is a mistake, and it takes the opposite injection strategy: [`dsh-devflow-iron-rules`](../packages/devflow-iron-rules/README.md) keeps rule bodies resident in every request rather than behind an index, because a rule the model never opened is one it never followed. Rules live under `.devflow/iron-rules/<id>/` as a `RULE.md` plus an optional `check.sh`, which runs when a turn that touched files is about to stop; failures come back as forced continuation until a retry ceiling hands the decision to a human.

Recording requires a stated triage — `script` or `judgement`, where `script` demands both a check and the paths it watches — because skipping the question "can a script decide this?" is how a rule set becomes all prose. The same write path is published as `ctx.devflowIronRules`, so a `spec-delta` obligation is forwarded as one call rather than a receipt someone typed. A deployment without that seam has nowhere to put an obligation and must say so.

<a id="devflow-commit-semantics"></a>

## Commit semantics of `.devflow`

Those three kinds of knowledge land in one directory alongside a fourth thing, and the four share no answer to "does this belong in git". What settles each one is **where its truth lives**, and getting it wrong fails silently in every case.

| Content | Files under `.devflow/` | In git | Written by |
|---|---|---|---|
| Card state | `tasks/**/journal.jsonl`, `card.md`, `artifacts/` | required | [`dsh-devflow-filesystem`](../packages/devflow-filesystem/README.md) |
| Repository knowledge | `spec/`, `iron-rules/`, `business/` | required | [`dsh-devflow-spec-tool`](../packages/devflow-spec-tool/README.md), [`dsh-devflow-iron-rules`](../packages/devflow-iron-rules/README.md), [`dsh-devflow-business`](../packages/devflow-business/README.md) |
| Deployment policy | `validation.json`, `midscene/settings.json`, `midscene/suites/` | expected | [`dsh-devflow-midscene`](../packages/devflow-midscene/README.md) |
| Process-transient state | `**/claim.json`, `**/commit.lock` | never | `dsh-devflow-filesystem` |

**Card state's truth is the journal.** `foldJournal` requires contiguous revisions, so a board that does not travel with its branch is not a board: a worktree taken from a repository that ignores `.devflow/tasks/` starts empty and renumbers new cards from `0001`. That is the precondition [the worktree fence](#worktree-development) protects, not a second rule stacked on it.

**Repository knowledge's truth is the file plus git** — the sentence the spec seam already rests on, and why a committed card and the documents it cites replay the same way in every checkout.

**A deployment policy's truth is the maintainer's decision.** `validation.json` exists so a required acceptance still blocks completion when no Midscene provider is mounted; a copy that never entered git withdraws that guarantee from every checkout but the one that wrote it.

**Process-transient state's truth is a live process**, which makes it the one kind that crosses a machine boundary as pure misinformation: a lease arriving on a branch assigns the card to a session that never existed here, and an inherited `commit.lock` fails every write on that card closed until someone deletes a lock no writer ever held. The general form answers any path this table does not name — **a file whose content means nothing on another machine does not belong in git.**

No plugin writes a transient file under this root any more: `dsh-devflow-midscene` used to take its `operation.lock` here and now takes it under the workspace's private runtime root instead, which is what the third ignore line below is a leftover guard for. The line stays because the two changes can reach a checkout separately, and a redundant rule costs nothing while a missing one leaks a pid file into git.

Every repository running devflow carries the same three lines, and they are the whole of what must never be committed:

```gitignore
# devflow process-transient state: a live process owns each of these, so a copy
# arriving on a branch describes a process that never ran here. The third line
# guards a path nothing writes today; keep it for checkouts that predate the
# midscene lock's move out of this root.
.devflow/**/claim.json
.devflow/**/commit.lock
.devflow/midscene/operation.lock
```

Ignoring `.devflow/` wholesale is how all four go wrong at once. [`tests/devflow-root-commit-contract.spec.ts`](../tests/devflow-root-commit-contract.spec.ts) pins both directions against a real repository: every transient path ignored, every card-state path tracked.

## Model guidance

That taxonomy has a third kind: **process judgment** — when work belongs on the board at all, which service class a card should carry, how a requirement decomposes, what makes an artifact worth a gate's yes, how to rework after a veto. Failing it is not breaking a rule but driving the workflow badly, so it takes the catalog strategy rather than residency: [`dsh-devflow-guidance`](../packages/devflow-guidance/README.md) ships it as the bundled `devflow-workflow` skill, one catalog line resident and the body loaded on demand, overridable by name through a lower-ranked same-layer provider. The body deliberately states no deployment's artifact contract — the artifact-gate preflight inside the tool results is the authority on that, at the moment it applies. A second bundled skill, `devflow-spec-authoring`, carries the authoring judgment for architecture documents — what deserves a document versus an iron rule, anchor choice, id scoping, revision through `replaces`, the response to a stale read — and registers only while the composition mounts `ctx.devflowSpec`, so no catalog ever advertises a skill teaching an absent capability. A third, `devflow-spec-bootstrap`, registers under the same condition and carries the cold-start procedure for a scope the census reports with no document — one scope at a time, claims established from the code rather than legacy documents, three documents read as one pass's pace rather than the scope's total with the census's file count as the way back to a large scope, and completion reached either by documents landing or by a waiver deciding the scope needs none.

The same package answers the question no tool description can — *does this workspace have a board worth reading first* — with the `devflow-board` runtime context: stage counts, the claimed cards, and a pointer at `devflow_create` and the skill, capped at 1024 bytes because awareness is not a board mirror and the real board is one `devflow_list` away. A pre-step listener re-reads the board each step (one failed readdir on a workspace without `.devflow/`, which therefore contributes nothing), and the harness diffs the rendered snapshot, so an unchanged board is never re-sent. Neither layer carries obligations: per-call protocol stays in the tool descriptions and enforcement stays with the gates, so a deployment that never loads the skill or suppresses runtime context loses guidance, never a guarantee.

## Worktree development

Several cards developed in one checkout share one branch, so a range-mode review of either card sees both cards' changes — the cross-contamination [`dsh-devflow-review-gate`](../packages/devflow-review-gate/README.md) names as its known limitation. [`dsh-devflow-worktree`](../packages/devflow-worktree/README.md) answers it with topology instead of a new state store: one card, one branch, one linked git worktree. Because `.devflow/` is committed and every consumer resolves its root from the session's own directory, a worktree is already a complete workspace — the branch carries the card, the card's workspace is the worktree, and gate commands, reviews, and checker subagents land there without any package changing how it resolves a directory. [Midscene](../packages/devflow-midscene/README.md) acceptance follows only in project mode, which resolves its workspace per session; a legacy profile's `workspace` is a fixed absolute path naming the main checkout, so a dispatched card fails its scope check.

The package contributes judgment and one fence. The bundled `devflow-worktree-runbook` skill carries the ceremony: attach a dispatch artifact (kind `worktree`, frontmatter `branch`/`base`/`worktree`) to the `ready` card, commit it, then create the branch and worktree — in that order, because a dispatch attached after branching writes the card on both sides of the fork. From then on only the card's own worktree writes it, until the merged pull request delivers code and journal together. The fence enforces exactly that rule on the transition waterfall: a dispatched card transitions only from its named worktree or from the repository's main working tree (derived per directory via `git rev-parse --git-common-dir`), and every other checkout is vetoed with both directories named. Artifact registration is outside the fence and forks the journal identically, because it appends under the same revision sequence; it stays admitted because attaching a new dispatch is how a moved worktree names its current path, and the runbook carries that half of the rule. A card without a dispatch artifact is untouched, so mounting the row changes nothing until a card is actually dispatched. The rule's teeth are structural: two checkouts appending one card's journal merge into a revision conflict `foldJournal` fails loudly on, so the fence is enforcing the precondition of the board's own durability model. The [worktree Agent Note](../.agents/notes/implemented/feature/2026-09-16-devflow-worktree-per-card.md) owns the decision.

Reaching a dispatched card is also the first mechanical moment for the flow's own preconditions, and the same listener checks the two git answers: the board is tracked (`git ls-files`) and the card's lease is ignored (`git check-ignore`, one representative path against the rules [above](#devflow-commit-semantics)). Either failing vetoes with the command that repairs the repository, because an untracked board renumbers the worktree's new cards from `0001` and a lease that travels with the branch assigns the card to a session that never existed here — both otherwise surface a development cycle later, at merge or at the next attempt to take the card. A repository git cannot answer about is admitted rather than vetoed: a check that could not run is not a check that failed, the opposite reading from the main-working-tree derivation beside it, where absence is a reason to refuse. The honest limit is timing — the dispatch ceremony contains no transition, so the earliest question is the `devflow_take` inside the worktree, when the repair is still deleting a worktree rather than repairing a journal. The [preconditions Agent Note](../.agents/notes/implemented/feature/2026-09-16-worktree-dispatch-preconditions.md) owns that decision; the two checks git cannot make — review edges in range mode, worktrees outside the main checkout — stay prose in the runbook.

The [bundle](../packages/devflow-bundle/README.md) mounts this row enabled, after the guidance row and ahead of the four policy rows, and it is the package's only mount: a package the bundle carries ships no patch of its own, because two layers inserting one row id compose into a duplicate the Loader refuses. `dsh plugin add @zhchxiao123/dsh-devflow-worktree` therefore installs a plain dependency that mounts nothing — a removal rather than an oversight, and one that cost nothing, since the runbook teaches a devflow card ceremony end to end and a profile with no board could never use it. [`tests/bundle-row-ids.spec.ts`](../tests/bundle-row-ids.spec.ts) holds the rule for every carrier. The row's position is a decision separate from its enablement: the fence is a `devflow/transition` listener and mount order is decision order, so "may this checkout write the card at all" is answered before a structure check, a checker, or a test suite is spent on a move that cannot be admitted. [`tests/worktree-dispatch-composition.spec.ts`](../tests/worktree-dispatch-composition.spec.ts) drives the whole ceremony over a real repository and a real linked worktree, and exists for its last assertion: after the branch merges back into a main checkout that moved on meanwhile, the card's journal still folds, its revisions are contiguous, and the session that dispatched the card advances it from where the worktree left off. The same spec pins the limitation nothing prevents — a card created inside a worktree takes a sequence number the main board hands out too, and because the two are different directories the merge is clean and the collision arrives silent.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` — **which this repository does not carry**: the generator stayed in the harness when this line was extracted, so the block below is maintained by hand against the JSDoc in `packages/*/src` until the script is ported. Treat the source as the authority on any disagreement. The language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevflow--devflowstore-abstract-seam"></a>

### `ctx.devflow` — `DevflowStore` (abstract seam)

Abstract task-card store registered as `ctx.devflow` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). Subclass, implement the abstract methods, and load the subclass as a plugin.

Implementations must honor these read-side semantics:

- Current state comes from journal replay (foldJournal); the card file's frontmatter is a projection. On disagreement the journal wins and the drift is warned, never silently adopted.
- A structurally invalid journal fails the read loudly, naming the file and line; a card is never silently skipped.

```ts cordis-catalog
/**
 * List the cards in the active set of one root — all of them, so a caller
 * that must reason over the whole board (a completion policy, a board
 * snapshot, a parent's progress) can trust the count.
 *
 * That completeness is why this read takes no page: it can be promised for
 * the active set and not for the archive, which grows without bound. Reach
 * archived cards through {@link query} instead.
 * @param filter - optional narrowing; omitted lists every card.
 * @param root - devflow root to list; omitted uses the implementation's default root.
 * @returns cards ordered by id.
 * @throws {Error} when the filter states both `parent` and `topLevel`.
 */
abstract list(filter?: CardFilter, root?: string): Promise<DevCard[]>

/**
 * Read one page of a card set: the same predicates {@link list} narrows by,
 * plus the set to read and where to resume.
 *
 * Implementations stop reading at the limit rather than collecting the set
 * and slicing it. The cost a caller should know: narrowing does not make the
 * read cheaper, because each card must be loaded before its predicates can
 * be judged — a page of five matches out of a thousand cards still loads a
 * thousand cards. What the limit saves is everything after the page fills.
 * @param query - narrowing, set selection, and pagination; omitted reads the
 *   first page of the active set.
 * @param root - devflow root to read; omitted uses the implementation's default root.
 * @returns the page, stating whether the limit cut it short.
 * @throws {Error} for contradictory predicates, a malformed month, a
 *   non-positive limit, or a cursor this store did not issue.
 */
abstract query(query?: CardQuery, root?: string): Promise<CardPage>

/**
 * Read one card.
 * @param id - the card id (its directory name).
 * @param root - devflow root holding the card; omitted uses the implementation's default root.
 * @returns the card with journal-derived current state.
 */
abstract read(id: DevflowCardId, root?: string): Promise<DevCard>

/**
 * Read one card's complete decoded journal, in revision order. The stream
 * is validated like a read: a structurally invalid journal fails loudly,
 * naming the file and line.
 * @param id - the card id (its directory name).
 * @param root - devflow root holding the card; omitted uses the implementation's default root.
 * @returns the decoded entries, oldest first.
 */
abstract history(id: DevflowCardId, root?: string): Promise<DevflowJournalEntry[]>

/**
 * Read the card's current lease holder.
 * @param id - the card id (its directory name).
 * @param root - devflow root holding the card; omitted uses the implementation's default root.
 * @returns the holder facts, or `undefined` while the card is unclaimed; a
 *   corrupt claim record fails loudly.
 */
abstract holder(id: DevflowCardId, root?: string): Promise<ClaimHolder | undefined>

/**
 * Apply implementation-owned defaults to a creation request: the slug when
 * omitted, the devflow root when omitted, and the creation timestamp.
 * @param request - the caller's request.
 * @returns the fully specified spec to hand to {@link create}.
 */
abstract resolveCreate(request: CreateRequest): CreateSpec

/**
 * Create one card in the active set: sequence-number allocation, the
 * exclusive card-directory creation, the journal's first `created` entry
 * (the only commit point), the projection write, then `devflow/card-created`.
 * Sequence numbers continue past archived cards, so an id is never reissued.
 * @param spec - a resolved spec from {@link resolveCreate}, never a raw request.
 * @returns the outcome; domain rejections resolve with `ok: false`.
 */
abstract create(spec: CreateSpec): Promise<CreateResult>

/**
 * Apply implementation-owned defaults to a transition request: the devflow
 * root when omitted and the commit timestamp.
 * @param request - the caller's request.
 * @returns the fully specified spec to hand to {@link transition}.
 */
abstract resolve(request: TransitionRequest): TransitionSpec

/**
 * Commit one stage move: revision check, edge check, the
 * `devflow/transition` waterfall, the journal append (the only commit
 * point), the projection rewrite, then `devflow/stage-changed`. State and
 * notifications publish only after the journal committed.
 *
 * The waterfall's gate commands put real time between those checks and the
 * append, so implementations must re-establish the checked revision at the
 * append itself, under an exclusion another process observes. A card that
 * moved in that window resolves `revision-mismatch`; a card whose commit
 * stayed excluded resolves `write-contended` with nothing written.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the outcome; domain rejections resolve with `ok: false`.
 */
abstract transition(spec: TransitionSpec): Promise<TransitionResult>

/**
 * Take the card's exclusive lease. A stale takeover journals the eviction
 * under the same cross-process commit exclusion as transitions and artifact
 * registration, so concurrent takeover attempts grant at most one holder.
 * @param id - the card to claim.
 * @param owner - the prospective holder, recorded in the lease.
 * @param options - staleness takeover policy and root; omitted never takes
 *   over and uses the implementation's default root.
 * @returns the live handle, or a holder read from the lease. On journal-commit
 *   contention that holder was observed before trying the lock, not freshly
 *   established as the current owner.
 */
abstract claim(id: DevflowCardId, owner: DevActor, options?: ClaimOptions): Promise<ClaimResult>

/**
 * Register a stage deliverable in the card's journal against its current
 * stage, in one of two mutually exclusive forms: the reference form records
 * a `path` the caller already wrote under the card directory, and the
 * store-written form hands over `kind` plus `content` for the
 * implementation to write `artifacts/<rev>-<kind>.md` itself before the
 * journal append — which stays the only commit point, so a registration
 * that loses the commit registers nothing and its unreferenced file is
 * overwritten by a same-revision retry. Registrations are immutable: the
 * newest record of one kind is that kind's current content. A blocked or
 * done card cannot register artifacts, the revision check mirrors
 * {@link transition}, and an ill-formed kind resolves `invalid-kind`.
 * @param request - card, expected revision, actor, and the artifact reference or content.
 * @returns the outcome carrying the registered record; domain rejections resolve with `ok: false`.
 */
abstract attachArtifact(request: ArtifactRequest): Promise<ArtifactResult>

/**
 * File one delivered card in its root's archive: the `archived` journal
 * append is the commit point, and the directory move that follows is
 * cleanup. Archived cards leave {@link list} but keep their complete
 * journal, stay readable through {@link read}, and can come back through
 * {@link restore}.
 *
 * A requirement archives with its finished slices: they share its bucket, so
 * a decomposed piece of work stays one family on disk. A slice cannot go
 * first — hidden while its requirement still runs, it would vanish from that
 * requirement's progress and from the completion policy's view.
 * @param request - card, expected revision, actor, and an optional reason.
 * @returns the outcome; domain rejections resolve with `ok: false`. A cascade
 *   that partially committed is not rolled back: the journal is append-only,
 *   and retrying skips what already filed as `already-archived`.
 */
abstract archive(request: ArchiveRequest): Promise<ArchiveResult>

/**
 * Return an archived card to the active set, at the stage its journal
 * already recorded. Restoring changes visibility, not progress: a restored
 * `done` card is still done, and resuming work on it is an ordinary rework
 * transition. An abandoned card is refused — that decision is terminal, and
 * reversing it means a new card.
 * @param request - card, expected revision, actor, and an optional reason.
 * @returns the outcome; domain rejections resolve with `ok: false`.
 */
abstract restore(request: RestoreRequest): Promise<RestoreResult>

/**
 * Archive every `done` card of one root that is eligible, through the same
 * commit path as {@link archive}.
 * @param root - devflow root to archive; omitted uses the implementation's default root.
 * @returns the archived card ids, in id order.
 */
abstract archiveDone(root?: string): Promise<DevflowCardId[]>

/**
 * {@link list} scoped to a viewing session's workspace, the face every
 * browser channel reads through.
 * @param filter - optional narrowing; omitted lists every card.
 * @param sessionId - the viewing session; its workspace resolves host-side
 *   to the devflow root, so the wire never carries a file path. Omitted
 *   lists the default root.
 * @returns cards ordered by id.
 */
async listForSession(filter?: CardFilter, sessionId?: string): Promise<DevCard[]>

/**
 * One card's detail scoped to a viewing session's workspace: the read value,
 * its complete decoded journal, and the current lease holder in one round
 * trip.
 * @param id - the card id (its directory name).
 * @param sessionId - the viewing session; resolved like {@link listForSession}.
 * @returns the aggregated detail; `holder` is absent while the card is unclaimed.
 */
async detailForSession(id: DevflowCardId, sessionId?: string): Promise<DevCardDetail>
```

Source: [`packages/devflow/src/index.ts`](../../packages/devflow/src/index.ts)

<a id="ctxdevflowartifactspecs--artifactspecs-value-service"></a>

### `ctx.devflowArtifactStructures` — `ArtifactStructures` (value service)

Read-only kind-spec table published by `dsh-devflow-artifact-gate`, registered for the plugin's fiber lifetime and gone when it disposes. Optional service: read it with `ctx.get('devflowArtifactStructures')`, never the property proxy — a deployment without the gate simply has no specs to template against.

```ts cordis-catalog
/**
 * The gate's configured kind specs, published read-only so a producer can
 * shape a deliverable to the same spec the gate will check. Optional
 * service: read it with `ctx.get('devflowArtifactStructures')`.
 */
devflowArtifactStructures: ArtifactStructures

/**
 * Value of the `devflowArtifactStructures` service: the configured specs, deep
 * frozen and normalized (empty lists dropped).
 */
type ArtifactStructures = { readonly [kind: string]: ArtifactKindStructure }

/**
 * Structural requirements of one artifact kind. Both lists are optional and an
 * empty list equals omission; a kind declared with neither is required only to
 * be registered. The lists stay mutable in type for the config validator's
 * sake; the published service value is deep frozen regardless.
 */
interface ArtifactKindStructure {
  /**
   * Frontmatter fields the artifact must carry, each present with a value —
   * a key mapped to nothing counts as missing.
   */
  frontmatter?: string[]
  /** Second-level section titles (without the `## ` prefix) the artifact must contain. */
  sections?: string[]
}

interface PublishedArtifactKindStructure {
  readonly frontmatter?: readonly string[]
  readonly sections?: readonly string[]
}
```

Source: [`packages/devflow-artifact-gate/src/types.ts`](../../packages/devflow-artifact-gate/src/types.ts)

<a id="ctxdevflowartifactcontract--artifactcontract-value-service"></a>

### `ctx.devflowArtifactContract` — `ArtifactContract` (value service)

Optional dynamic preflight published for the artifact gate's fiber lifetime. `inspectOutgoing(card)` returns configured legal outgoing edges with every required kind's immutable spec, newest registration, `missing | malformed | satisfied` status, and all defects. The transition listener consumes the same internal inspection, so reported defects and enforcement are identical.

```ts cordis-catalog
interface ArtifactContract {
  inspectOutgoing(card: DevCard): Promise<readonly ArtifactTransitionInspection[]>
}

interface ArtifactTransitionInspection {
  readonly from: CardLocation
  readonly to: CardLocation
  readonly requirements: readonly ArtifactRequirementInspection[]
}

interface ArtifactRequirementInspection {
  readonly kind: string
  readonly status: 'missing' | 'malformed' | 'satisfied'
  readonly spec: PublishedArtifactKindStructure
  readonly artifact?: Readonly<ArtifactRecord>
  readonly defects: readonly string[]
}
```

Source: [`packages/devflow-artifact-gate/src/types.ts`](../../packages/devflow-artifact-gate/src/types.ts)

<a id="devflow-events"></a>

### `devflow/*` events

<a id="devflowcard-created--emit"></a>

#### `devflow/card-created` — emit

A new card entered the active set: its journal committed the first `created` entry. Dispatched once per creation, after the projection write.

```ts cordis-catalog
/**
 * A new card entered the active set: its journal committed the first
 * `created` entry. Dispatched once per creation, after the projection
 * write.
 * @mode emit
 * @param card - the created card, at `draft` with revision 1.
 */
'devflow/card-created'(card: DevCard): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowcard-archived--emit"></a>

#### `devflow/card-archived` — emit

A card left the active set for the archive. Dispatched once per archived card, so a cascade over a requirement's sub-requirements dispatches once for each. Not folded into `devflow/stage-changed`: archiving does not move the card, and a listener would have to re-derive which of the two happened.

```ts cordis-catalog
/**
 * A card left the active set for the archive.
 * @mode emit
 * @param card - the card as of the committed `archived` entry.
 */
'devflow/card-archived'(card: DevCard): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowcard-restored--emit"></a>

#### `devflow/card-restored` — emit

An archived card returned to the active set at the stage it already had.

```ts cordis-catalog
/**
 * An archived card returned to the active set at the stage it already had.
 * @mode emit
 * @param card - the card as of the committed `restored` entry.
 */
'devflow/card-restored'(card: DevCard): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowstage-changed--emit"></a>

#### `devflow/stage-changed` — emit

A card settled at a new location after a committed transition.

```ts cordis-catalog
/**
 * A card settled at a new location after a committed transition.
 * @mode emit
 * @param card - the card after the move, `stageRevision` already advanced.
 * @param from - the location the card departed.
 */
'devflow/stage-changed'(card: DevCard, from: CardLocation): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowtransition--waterfall"></a>

#### `devflow/transition` — waterfall

Single-decision transition pipeline. The store dispatches this after the revision and edge checks and before the journal commit; a policy listener that owns the decision returns `{ allowed: false, reason }` without calling `next()`, while an observing listener must delegate.

```ts cordis-catalog
/**
 * Single-decision transition pipeline. The store dispatches this after the
 * revision and edge checks and before the journal commit; a policy
 * listener that owns the decision returns `{ allowed: false, reason }`
 * without calling `next()`, while an observing listener must delegate.
 * @param attempt - the resolved transition about to commit, including its departure location.
 * @param next - delegate to the remaining listeners, finally `{ allowed: true }`.
 * @mode waterfall
 */
'devflow/transition'(attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision>
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)
<!-- END GENERATED cordis-surface -->
