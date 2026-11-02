# Agent Note: devflow — a card can stop, and the reason is what survives it

Status: implemented

English | [中文](2026-08-31-devflow-reasoned-abandonment.zh.md)

## Problem

`done` was the only terminal location and `archiveDone` collected only `done`
cards, so "we are not doing this", "this is obsolete", "this duplicates 0007",
and "this was superseded" had nowhere truthful to go. Both available answers
were lies: park the card in `blocked`, where a column that means *someone is
waiting on something* slowly fills with work nobody is waiting on, or mark it
`done`, which corrupts the one signal `done` carries.

## Decision

A card at any location except `done` can be **abandoned** with a required
reason. The journal records it, and the card leaves the active board.

**No new stage.** `DEV_STAGES` stays closed, so the board's columns, the
durable stage enum, both tool schemas, and the client mirror are untouched.
An abandoned card leaving the board rather than occupying a column is also the
honest reading: nobody is working on it and nobody will.

**The reason is required**, where a transition's reason is optional. A
transition leaves the card visible and explicable from where it sits; this
removes it from the board, so the reason is all that is left of the decision.
A blank one is refused before anything is written.

**A `done` card is refused.** A delivered outcome is settled by `archiveDone`,
not overwritten by a decision not to deliver it.

## Commit point and the crash window

The journal append is the commit point; moving the directory into the archive
follows it, exactly as the projection rewrite follows a committed transition.
A crash between the two therefore leaves an abandoned card under `tasks/`.

`list` excludes abandoned cards **by their folded state**, not by where their
directory sits. That makes the board correct inside that window and makes the
move cleanup rather than the thing carrying the meaning.

`foldJournal` treats the entry as terminal: any entry after it fails replay,
the way `created` may only appear first. That is what stops a card from being
quietly revived by appending to its journal.

## Ownership

Abandoning is a decision, not execution, so it is on `/devflow` — the
deterministic human intervention plane — and there is no model-facing tool for
it. The Harness agent advances work; it does not get to decide that work stops.

## Alternatives considered

**A `dropped` stage: no.** `DEV_STAGES` is load-bearing in durable journal
validation, the `DevCard` schema, two tool schemas, and a hand-kept mirror in
the client bundle. That cost buys a column for cards nobody will touch again,
which is the fake WIP this note exists to remove.

**Reusing `blocked`: no.** It already means *interrupted, will resume* — its
recovery rule is that a blocked card returns to the exact stage it left. Making
it also mean *stopped forever* would leave neither meaning readable.

**Restoring an abandoned card: no.** [The archive is write-only by
design](2026-08-27-devflow-stage-model-rigidity.md); no operation lists or
restores an archived card. Reviving a decision to stop is new work, which is a
new card.

## Consequences

**Forward compatibility is given up deliberately.** `decodeJournalEntry` throws
on an unknown `type`, so a journal carrying an abandon entry is unreadable to a
release predating this change. The exposure is narrow because the entry only
ever exists inside an archived directory and nothing reads one — the single
window is the crash described above. Accepted within one release line, and
recorded here rather than left to be discovered.

`archiveDone` is unchanged, including its parent/child month bucketing. An
abandoned card archives under its own last-entry month; it is not a done card
and does not join a family bucket.

**Known gap: a parent abandoned while its children are live.** The parent gate
governs completion, not abandonment, so nothing stops it. Each child stays
readable and archivable on its own terms. Policing it would mean deciding
whether abandoning a requirement abandons its slices, which is a product
question this change does not answer.
