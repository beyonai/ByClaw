# Agent Note: devflow — chat-driven card creation through the seam

Status: implemented

English | [中文](2026-08-26-devflow-chat-card-creation.zh.md)

## Problem

Creating a devflow card meant hand-writing `card.md` plus a journal line in the provider's on-disk format — disconnected from the workflow the PRD (`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`) targets, where the requirement is agreed in chat and should land as a tracked task without leaving it. A format mistake (rev, timestamp, actor) also fail-louds the whole board read.

## Decision

Creation is a seam operation, not a tool-side file writer:

- `DevflowStore` grows `resolveCreate(request): CreateSpec` (the explicit defaulting step: slug derived from the title when omitted, creation timestamp) and `create(spec)` with the seam's domain-result posture — stable codes `empty-title`, `invalid-slug`, `exists`; only infrastructure failures reject.
- The filesystem provider allocates the next sequence number past every active **and archived** card (an id is never reissued, so a later `archiveDone` cannot collide in the month directory), reserves `tasks/<seq>-<slug>/` with an exclusive non-recursive `mkdir`, and on losing the reservation to another process rescans for a fresh number — five straight losses resolve `exists`. In-process creators serialize on one chain, so same-host agents never race each other's numbers; the cross-process same-instant different-slug corner keeps ids unique but may share a number, recorded as a provider limitation instead of buying seq-level locking with a bare-directory-then-rename dance.
- The journal's first `created` entry (with the creating actor) is the only commit point; `card.md` is written afterwards through the standard projection path, so a failed projection write degrades exactly like a lost card file instead of leaving a half-created card.
- `devflow/card-created` is a separate emit, not a `stage-changed` variant, and creation runs no `devflow/transition` waterfall: a draft card is harmless and governance starts at its first move. The Definition's invariant companion checks the new stream (fresh draft, revision 1, never-seen id). The event joins the Remote forwarded allowlist, and the board client refetches on it, so a chat-created card appears without a refresh.
- `devflow_create` (title, Markdown body, optional slug) requires an owning agent session and appends a `devflow/created` Session event on commit — model-visible ⟺ logged. Hand-written cards keep working; the tool is a second producer over the same journal format.

## Alternatives considered

- **A `/devflow new` subcommand** — rejected: the command plane is single-line input, unfit for a Markdown body with acceptance criteria; creation belongs to the chat plane, interventions to `/devflow`.
- **Creation through the transition waterfall** — rejected: gates key on `from -> to` edges of existing cards; a creation has no departure, and vetoing a draft protects nothing.
- **Tool-side file writing (no seam operation)** — rejected: sequence allocation and the journal-first commit belong behind the seam so the command plane, driver, or a future provider reuse them; a tool-side writer would also bypass the provider's serialization.

## Consequences

The board's "no creation" gap is closed end to end (store → tool → session log → forwarded event → panel refetch) while the journal replay contract is unchanged — `created` was always the mandatory first entry, so pre-existing cards and the new path fold identically. Cards remain uneditable through the seam after creation; changing a body is still a direct `card.md` edit.
