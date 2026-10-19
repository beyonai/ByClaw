# Agent Note: devflow — a big requirement is a parent card plus child cards

Status: implemented

English | [中文](2026-08-26-devflow-requirement-breakdown.zh.md)

## Problem

The card model was flat: ids are globally allocated directory names, `DevCard` held no reference to another card, and no journal entry kind could express one. A requirement too big for one card therefore had two bad shapes — one card holding the whole requirement (one lease, one revision, so no parallel work, and the driver hands a subagent the entire requirement as its objective), or N unrelated cards (no place to answer "how far along is this requirement", and `archiveDone` scatters the family across month buckets). The PRD (`.agents/prd/2026-08-26-devflow-requirement-breakdown.md`) asks for a composition edge and the rules around it.

## Decision

The parent edge is data on the card, fixed at creation:

- **The edge lives in the journal's `created` entry** (`parent`), so it is authoritative, replayable, and immutable — `foldJournal` surfaces it as `DevCard.parent` and the frontmatter `parent:` is a projection like `stage`. There is no re-parenting entry kind; a wrong parent means a new card.
- **One level, one root.** The provider validates a requested parent before reserving any directory and rejects with three stable codes: `unknown-parent` (not in this root's `tasks/`), `nested-parent` (the parent carries a parent of its own), `parent-settled` (the parent is `done` or already in this root's archive). One level removes cycle detection and recursive roll-up together; same-root falls out of validating against the caller's already-resolved root.
- **Reads narrow, they do not aggregate.** `CardFilter.parent` returns one parent's children; no seam operation returns a tree, and no `children` field is stored — a parent's breakdown is always derived from a listing, so it cannot drift from the cards themselves.
- **Consumers project the relation, they do not own it.** `devflow_create` takes `parent`; `devflow_show` returns the backlink plus `parentTitle` for a child and `children` summaries for a parent, so an agent holding only a child card can read the whole requirement itself instead of every child body duplicating context; `devflow_list` carries `parent` per row and filters by it; `/devflow` indents children under their parent. A child whose parent left the active set keeps a bare backlink rather than failing the view. The Web sidebar projects the same relation into [parent swimlanes](2026-08-31-devflow-stage-centric-kanban.md), while its compact alternate and floating surface retain indented rows; both derive entirely from the listing already fetched, so the hierarchy costs no Remote face and no second fetch.
- **The invariant companion enforces the depth on the event stream**: `devflow/card-created` may not hang a card under an id the stream already knows to be a child (keyed on root + id, like every other devflow relation).

The completion semantics sit outside the seam, on the extension points that already exist:

- **The gate is a `devflow/transition` listener in its own package** (`dsh-devflow-parent-gate`), not a store rule: a parent's move to `done` is vetoed while any child is elsewhere, and the veto names the unfinished children with their stages. A composition without the plugin keeps the relation without the enforcement.
- **The gated edge is `-> done`, not an earlier one.** Blocking the parent further up the pipeline would make it walk `ready → developing → reviewing → testing` as a formality after its slices finished; gating only the last edge turns the parent's own `reviewing`/`testing` into the integration pass over the finished children.
- **Archiving moves a family, not a card.** A done child whose parent is still on the board stays with it, and the family lands in the *parent's* month bucket — otherwise one requirement's history scatters across months, which is exactly what the archive is supposed to preserve.

## Alternatives considered

- **Hierarchical ids (`0007.1-slice`)** — rejected: it breaks the global `nextSequence` allocator, the opacity of the branded id, and "the id is the directory name and never changes", buying only a prettier directory listing.
- **A `kind: epic` card with a derived state machine** — rejected: it needs either a second lifecycle beside the closed `DevStage` union or cross-card cascading commits (one transition writing two journals and two revisions), the most expensive change available for a first slice.
- **A batch `devflow_split` tool** — rejected: N `devflow_create` calls already work, batch atomicity has no current consumer, and a partial failure is resumable.
- **Storing the epic as a document instead of a card** — rejected: it leaves epic-level acceptance criteria and progress homeless, and "create a big requirement in chat" would have no tool.
- **Folding the completion rule into `dsh-devflow-gates`** — rejected: that package's role is running configured gate commands on an edge; a structural rule about card composition is a different policy with different configuration (none) and belongs beside it, not inside it.
- **Auto-advancing the parent when its last child finishes** — rejected: the gate refuses, it does not decide; a requirement's own integration work is not implied by its slices being done.

## Consequences

Chat can decompose a requirement into a parent card plus child cards, the command plane reads the structure back, and "the requirement is done" now has a machine criterion: every child done, plus the parent's own pipeline pass. The board (`list`) already carries `parent` to the browser, so the Web hierarchy needs no new Remote face. Journals written before this edge existed replay unchanged as top-level cards, and a deployment without the parent gate retains the relation without the completion veto.
