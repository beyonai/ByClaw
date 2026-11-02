# Agent Note: devflow-ui — artifact records and gate verdicts on the detail sheet

Status: implemented

English | [中文](2026-08-27-devflow-ui-artifact-and-verdict-detail.zh.md)

## Problem

S1 put `DevCard.artifactRecords` and `JournalTransition.gate.checks` on the `devflow-web` wire — the read face serializes the card and the decoded journal wholesale — but nothing in the browser read either. The detail sheet listed bare artifact paths, hiding the kind vocabulary and the version history the artifact model exists to carry, and the timeline showed a human approval while silently dropping the agent-gate verdicts recorded beside it in the same committed entry. A published wire field nothing reads is surface kept without benefit; both needed their reader.

## Decision

**The artifact section reads the records through index alignment.** `artifacts` is the path projection of `artifactRecords` — same order, entry for entry — so each line takes its registration facts (kind, registering stage, revision) from its own index. Every registration stays listed, because the journal is a truthful history of every deliverable version. Among several registrations of one kind, the highest revision carries a "latest" marker; a kind registered once carries none — the marker distinguishes among versions, not membership — and a path-only registration (predating kinds) shows a neutral placeholder and never takes the marker. The view keeps its established stance of rendering whatever one fetch delivered: a payload without the records still lists its bare paths.

**The timeline renders each recorded verdict.** A transition entry's `gate.checks` renders one note line per check — the same actor label the rest of the timeline uses, plus the summary verbatim, so an agent-gate cache hit's `[cached] ` prefix reaches the reader untouched — beside the `approvedBy` approval note when the move recorded both. Entries without a gate, or with only the approval, render exactly as before.

New copy went through the existing bilingual `locales.ts` mechanism, and the sheet stays read-only: no new control, no mutation. `packages/devflow-ui` is the only package touched; `devflow-web` already carried everything the sheet needs.

## Alternatives considered

**Mark every kinded registration's newest.** A lone registration would carry a marker distinguishing it from nothing; the marker earns its place only where a superseded version sits below it.

**Join records to paths by path lookup.** A re-registered path would match several records and need a tie-break; the seam documents `artifacts` as the records' path projection, so the index is the contract, not a heuristic.

**Assume `artifactRecords` and drop the bare-path fallback.** The wire always carries the field, but the view's precedent (the blocked card whose journal lost its origin stage) is to render the delivered payload rather than the fold's guarantee — and the fallback is what let the pre-existing surface specs keep pinning legacy rendering without a single modification.

**Give verdicts their own timeline entries or section.** A check is a fact of one committed move, like its reason and its approval signature; detaching it from the entry would misstate when it happened.

## Consequences

- `artifactRecords` and `gate.checks` now have real browser readers; the deferred rendering decision recorded in [the artifact-kinds Agent Note](2026-08-27-devflow-artifact-kinds-and-store-written-content.md) is made, and its consequence line updated with it.
- The agent gate's summary strings, `[cached] ` prefix included, are user-visible copy now: changing their format changes what the timeline shows.
- The board rows are untouched: registration facts appear only on the detail sheet, and no content preview or download exists — the sheet renders journal facts, not artifact bodies.
