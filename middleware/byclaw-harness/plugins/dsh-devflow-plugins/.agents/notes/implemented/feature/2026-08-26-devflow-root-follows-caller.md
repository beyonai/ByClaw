# Agent Note: devflow — the root follows the caller

Status: implemented

English | [中文](2026-08-26-devflow-root-follows-caller.zh.md)

## Problem

The devflow store's root was one global configuration value resolved against the host process cwd, while dsh sessions belong to workspaces (canonical directory paths). A session working in workspace A saw workspace B's (or the launch directory's) cards through the tools, `/devflow`, and the board; parallel projects shared one accidental board. The PRD (`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`) requires the root to be a per-call dimension resolved from the caller.

## Decision

The root is a seam dimension, not a card field:

- Every `DevflowStore` operation carries an explicit root — reads as a trailing optional parameter, requests as an optional `root` field resolved into their spec by the existing explicit-defaulting steps (`resolve`, `resolveCreate`, and one provider-internal `resolveRoot` funnel for the spec-less operations), leases through `ClaimOptions`. An omitted root is the configured default, which keeps every single-root deployment and the Remote read faces unchanged. `DevCard` gains a readonly `root` (the resolved absolute path), so event consumers follow the right directory from the payload alone.
- The filesystem provider serves any number of roots from one instance: per-card serialization and the driver's book-keeping key on root + id (equal ids under different roots are different cards), and creation chains serialize per root so parallel workspaces never contend for sequence numbers.
- The workspace→directory mapping lives in the consumers, never in the Definition. The model tools and `/devflow` derive `<session cwd>/.devflow` from the invoking agent's session header; a session without a cwd falls back to the default root, so the chat and command planes of one session always see one board. The gates listener runs its commands in `dirname(attempt.root)` — the card's workspace — and parks approval-blocked cards in the attempt's root; the driver claims, heartbeats, reads, and parks in the moved card's own root.
- The Remote faces take the **viewing session's id**, not a workspace id: the board is always a session view, the session's header cwd IS the workspace's canonical path for grouped sessions, and one host-side resolution (live registry, else persisted header, unknown session a stable rejection) covers grouped and ungrouped sessions alike — so the browser sends an id it already holds everywhere and no second identifier vocabulary crosses the wire. The board client refetches on every real selection change, giving each session its own workspace board.

## Alternatives considered

- **A `workspace` field on cards** — rejected: a card's membership is the directory it lives in; a stored workspace id would be a second source of truth that moves and diverges with the repository.
- **Workspace resolution inside the seam** (a `workspaceRegistry` dependency of the Definition) — rejected: the seam stays directory-only so providers need no knowledge of the workspace entity; each consumer maps its own caller notion (session cwd today, browser workspace id on the Remote face next) to a directory.
- **Root through `CardFilter`** — rejected: the filter crosses the Remote wire, and a browser must never be able to send file paths; the root rides a separate parameter the Remote adapters simply do not forward.

## Consequences

Multi-project hosts stop cross-talking: tools, commands, gates, the driver, and the board all follow the caller's or the card's root, verified by multi-root store tests, two-workspace tool/command compositions, a gate-workdir assertion, a cross-root driver dispatch, and the two-workspace real-browser e2e (per-session board isolation plus a live `/devflow` move updating the open board). The driver's activation sweep still covers only the default root, with other roots dispatching through their `stage-changed` events.
