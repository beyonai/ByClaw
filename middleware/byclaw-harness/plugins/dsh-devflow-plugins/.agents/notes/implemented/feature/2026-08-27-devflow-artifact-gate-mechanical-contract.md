# Agent Note: devflow — the mechanical artifact-contract gate

Status: implemented

English | [中文](2026-08-27-devflow-artifact-gate-mechanical-contract.zh.md)

## Problem

The seam learned typed deliverables — artifact kinds, store-written content, `artifactRecords` on the read value — but nothing enforced that a stage move is backed by them. The existing waterfall policies check other facts: `dsh-devflow-gates` runs shell commands, `dsh-devflow-parent-gate` counts children. "This edge needs a registered design, and that design must at least be shaped like one" had no policy, so a card could reach `ready` with no design at all and the gap would surface stages later, as review churn.

The same specs have a second consumer coming: a driver that feeds a template to whatever produces the deliverable. Defined in two places, the template and the check drift apart — the produced file passes one and fails the other.

## Decision

**One read-only function plugin on the `devflow/transition` waterfall**, `@zhchxiao123/dsh-devflow-artifact-gate`, shaped like `parent-gate` (no store, no state, one listener plus the invariant companion). Config declares `kinds` — per-kind frontmatter fields and `## ` section titles — and `edges`, the kinds each `from->to` edge requires. An edge with no entry delegates without reading the card; misconfiguration (bad edge key, kind outside the seam's grammar, an edge requiring an undeclared kind, blank list entries) fails the load naming the config item, at `devflow-gates` strictness.

**The newest registration of a kind is the checked object.** Records replay in revision order, so the last record of a kind is its current content — the same rule `devflow_read_artifact` serves by. Path-only registrations carry no kind and never match; superseded registrations are history, not evidence.

**Every defect in one veto.** Missing kind, unreadable file, missing frontmatter block or field, missing section — all collected per attempt and returned as one `{ allowed: false, reason }` without calling `next()`, each item `<kind>: <what>` naming the file. A rework agent sees the whole gap in one round instead of one item per attempt.

**An unreadable registered file is a veto, not a throw.** The journal saying a file exists that the disk does not serve is a corrupt deployment, but throwing would fail the transition as infrastructure, with nothing actionable. The veto text names the file and says the journal references what the disk does not serve, so a human can repair the state.

**The gate is strictly read-only inside the waterfall.** It reads through `ctx.devflow.read` and locates files as `dirname(card.path)` + the journal-recorded relative path — the same derivation as the read tool, restating no provider layout. No store write can happen here: the store serializes per card and the waterfall runs inside the very transition holding that card's turn, so any write would deadlock in-process.

**The specs are a service.** `ctx.effect(() => ctx.provide('devflowArtifactStructures', frozen))` publishes the validated specs — normalized, deep frozen — and the disposer removes them with the fiber. A producer reads the same object the gate checks against, through `ctx.get`, never a value import; the types travel type-only.

## Alternatives considered

**Enforce the contract in the provider's `transition`.** That makes it a seam rule every deployment pays for and no deployment can tune. As a waterfall plugin it composes exactly like the other policies: not installed or not configured means not enforced, and the store never learns the vocabulary.

**Throw on an unreadable artifact.** Fail-loud is the read-side rule, but here the read is advisory to a decision this plugin owns; a throw would surface as a transition infrastructure failure with the card stuck and the cause buried in a rejection nobody renders. The veto channel already reaches the caller with prose.

**Stop at the first defect.** Cheaper per attempt, but the rework loop then discovers the contract one veto at a time — the exact drip this gate exists to prevent in reviews.

**Check `foldJournal`-derived paths instead of `artifactRecords`.** The path projection has no kinds; matching filenames against `<rev>-<kind>.md` would restate the provider's naming scheme this plugin otherwise never mentions. `artifactRecords` exists precisely so consumers match on the journal fact.

**Publish the specs by letting consumers read this plugin's config.** Cross-plugin config reading is not a seam; a service name is. The frozen value also guarantees the producer cannot mutate the contract it is templating against.

## Consequences

- **Waterfall order is deployment order.** The mechanical layer only saves work if it runs before command gates and approvals; nothing enforces that, the composition's row order does. The full four-layer ordering story belongs to the deployment slice, not this package's README alone.
- One gated attempt costs one extra card read plus one file read per required kind; ungated edges cost nothing.
- `devflowArtifactStructures` is published surface whose consumer is the driver's `produces` templating ([driver artifact feeding](2026-08-27-devflow-driver-artifact-feeding.md)); a template rendered from the service cannot drift from the check.
- The frontmatter split is restated from the provider (first `---` pair, YAML between) rather than imported; a divergence from the provider's parsing is a defect in this copy.
