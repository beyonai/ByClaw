# Agent Note: devflow — artifact kinds and store-written content

Status: implemented

English | [中文](2026-08-27-devflow-artifact-kinds-and-store-written-content.zh.md)

## Problem

An artifact registration was a bare path: the caller wrote a file somewhere under the card directory and `attachArtifact` recorded the string. Nothing said what the deliverable *was*, so no consumer could ask for "this card's review verdict" — the vocabulary the planned acceptance-gate slices need. Worse, the only writer of those files was the calling agent's own file tools, which `dsh-devflow-fs-guard` deliberately denies under `.devflow/`: a model wanting to deposit a deliverable had no legitimate write path at all.

The transition gate had a parallel gap. A committed entry could record at most a human approval signature (`gate: { approvedBy }`), with no slot for agent gate verdicts — and the `TransitionDecision` waterfall value could not have carried them to the journal append even if the entry had one, because the provider only mapped `approvedBy`.

## Decision

**Registration gains a store-written form.** `ArtifactRequest` is a union: the reference form (`path`) as before, or `kind` plus `content`, which the filesystem provider turns into `tasks/<id>/artifacts/<rev>-<kind>.md`, written host-side with temp + rename *before* the journal append. The append stays the only commit point: a registration that loses the lock-time revision re-check or the lock budget leaves an unreferenced file no read ever surfaces, and a same-revision retry overwrites it. `kind` follows the slug grammar; anything else is the stable `invalid-kind` rejection, shaped like `invalid-slug`.

**Registrations are immutable; the newest wins.** Re-registering a kind writes a new revision-named file, and readers take the record with the highest revision. Nothing is deleted or edited in place, so the journal stays a truthful history of every deliverable version.

**Reads surface records, not just paths.** `foldArtifactRecords` — beside `foldJournal`, over the same decoded entries — derives `DevCard.artifactRecords` (path, optional kind, journal revision, registering stage); `DevCard.artifacts` stays that list's path projection, so every existing consumer keeps its shape. `foldJournal`'s own return shape is untouched, which is what lets every pre-kind journal, fixture, and test replay identically.

**The gate got its slot.** `JournalTransition.gate` is `{ approvedBy?, checks? }` — both optional, so existing `{ approvedBy }` entries decode unchanged, while a gate carrying neither still fails decode. `TransitionDecision`'s permitting arm carries `checks?: GateCheck[]` and the provider records a non-empty list into the entry; the shape is pinned by decode tests now, ahead of the gate packages that will produce verdicts.

**Tool face.** `devflow_attach_artifact` accepts either form and rejects a mixed or incomplete call before the seam is reached; `devflow_show` lists registrations with kind, stage, and revision; the new `devflow_read_artifact({ id, kind })` returns the newest registration's content, or the stable `no-artifact` error. The read tool locates the file as `dirname(card.path)` + the journal-recorded relative path, so it restates no provider layout.

## Alternatives considered

**Let the agent write the file and register its path.** `dsh-devflow-fs-guard` exists precisely to keep agent file tools out of `.devflow/`; a carve-out for `artifacts/` would re-open the protected state directory to the executor the guard fences. The store-written form keeps the guard absolute — the file travels through the seam as content.

**Append the journal entry first, write the file second.** The entry would then reference a file that may never appear; a crash between the two produces a registered artifact readers cannot open. File-first inverts the failure mode into an unreferenced file — garbage, not corruption — which the retry semantics already clean up by overwriting.

**One canonical `artifacts/<kind>.md`, overwritten per registration.** Loses history and breaks immutability: a consumer quoting a deliverable it just resolved must not race a rewrite. Revision-named files make "newest" a journal fact rather than an mtime guess, at the cost of accumulating superseded files until archive.

**Extend `foldJournal`'s state with the records.** Every consumer of the fold — including out-of-repo fixtures asserting its exact shape — would see a new key; a sibling derivation over the same entries adds the vocabulary without moving the existing one.

**Keep `gate.approvedBy` required and put checks beside the gate.** A checks-only gate — an agent verdict with no human in the loop, the common future case — would be unrepresentable, and two sibling optional fields on the entry would say worse what one `gate` object says.

## Consequences

- The `devflow-web` wire now carries `artifactRecords` implicitly: the route serializes `DevCard` wholesale, so the field reached the browser the moment the provider emitted it. The board UI's detail sheet now reads the records — kind, registering stage, revision, and a latest-of-kind marker — per [the detail-rendering Agent Note](2026-08-27-devflow-ui-artifact-and-verdict-detail.md).
- A lost commit can leave an orphan `artifacts/<rev>-<kind>.md`. That is accepted garbage: invisible to every read, overwritten by a same-revision retry, and moved wholesale with the card on archive.
- `gate.checks` has its producer since [the LLM admission gate](2026-08-27-devflow-agent-gate-llm-admission.md) landed: that gate's verdicts are the recorded checks the detail sheet's timeline renders.
- `devflow-ui`'s timeline assumed `gate.approvedBy` was present whenever `gate` was; it now shows the approval note only when the signature exists — the one file outside the three packages this change touched, forced by the type widening.
