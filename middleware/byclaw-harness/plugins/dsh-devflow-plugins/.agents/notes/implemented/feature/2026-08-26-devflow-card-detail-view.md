# Agent Note: devflow — the board row opens a read-only card detail

Status: implemented

English | [中文](2026-08-26-devflow-card-detail-view.zh.md)

## Problem

The board showed one summary line per card while the two densest pieces of information stayed invisible on the Web: the requirement Markdown that chat creation writes into `card.md` (already on the Remote `read` face, never consumed), and the journal history (delivered by the next slice). Reading "what is this card actually about" meant leaving the Web for `/devflow show` or the chat.

## Decision

Clicking a board row swaps the list for that card's read-only detail inside the same body-portal panel (widened, back control in the header, Esc/outside/collapse close the whole popover and settle the detail with it). The requirement sheet renders identity, an enlarged pipeline naming every stage, the `body` Markdown through the shared `MarkdownText` primitive from ui-primitives — no renderer extraction was needed, the primitive already existed and the package already depends on ui-primitives — with the GFM task-list checkboxes arriving disabled, plus the artifact list and the card file path.

The plugin owns a second observable source (`detail`: closed / loading / loaded) beside the board source, and the slot inject carries two intents (`openCardDetail`, `closeCardDetail`) so the component stays a pure renderer. Each open fetches once through the existing Remote `read(id, sessionId)` — no seam or wire change at all; the open detail rides every board refresh (forwarded devflow events), a stale settlement never clobbers a newer state (open/close/reopen races are guarded by comparing the settled id against the current snapshot), a failed or rejected fetch closes back to the list, and a session switch closes the detail because its card belongs to the old workspace.

The transition timeline extends the same drawer from the seam side: `DevflowStore` grew two fine-grained reads — `history` (the complete decoded journal, stream-validated exactly like a read so a broken journal fails loudly in both views) and `holder` (the lease facts, `undefined` while unclaimed, loud on a corrupt record) — and the Remote face aggregates them with the read value behind one `detail(id, sessionId)` call, resolved through the same session-to-root path, so the drawer costs one round trip and the browser still sends only ids. The timeline renders newest-first with per-entry actors (agent actors whose session the client list knew at load time become backlinks through the client sessions service's own `open`; vanished sessions stay plain text), rework reasons, approval signatures, and takeover records; card age, per-entry stayed durations, and the rework count derive client-side from the entry timestamps and quietly disappear when a hand-written timestamp does not parse — the seam grew no statistics API.

## Alternatives considered

- **Accordion expansion inside the 344px list** — rejected: the requirement Markdown and (next slice) the timeline need document width; the two-state panel keeps one anchor and one stacking context instead.
- **Prefetching bodies with the list** — rejected: the list stays a light summary; the body loads per open and the loading state is explicit.
- **A dialog/modal layer** — rejected: the panel already owns a portal, dismiss handling, and a z-index slot; a second layer would duplicate all three.
- **Separate Remote `history`/`holder` wire calls** — rejected: the drawer always needs all three values together, so the aggregation lives in the Remote adapter (one round trip) while the seam keeps the fine-grained operations other consumers can compose.
- **A seam-side statistics face (durations, rework counts)** — rejected: every metric derives from the entries the wire already carries; presentation math stays in the client.

## Consequences

The Web answers "what is this card", "who moved it and why", and "who holds it now" without leaving the page, still issuing no mutations — the drawer's only actionable elements are the back control and the session backlinks. Rows became buttons (the previous no-buttons read-only assertion moved to "exactly one opener per row, no inputs").
