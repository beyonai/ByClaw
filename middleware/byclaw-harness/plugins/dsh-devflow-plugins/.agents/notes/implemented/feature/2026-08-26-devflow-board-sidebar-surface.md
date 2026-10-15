# Agent Note: devflow — the board picks one surface, sidebar page or floating control

Status: implemented

English | [中文](2026-08-26-devflow-board-sidebar-surface.zh.md)

The host-integration decision in this note is superseded by [the official Harness right-Sidebar integration](2026-09-08-devflow-official-right-sidebar.md). The historical rationale remains here to explain the removed compatibility path.

## Problem

The devflow board was a floating popover: a body-portal control fixed at the conversation area's top-right, 344px wide (460px with a detail open) and capped at `min(480px, 60vh)`. Everything the last three PRDs added — the requirement Markdown, the named pipeline, the breakdown relations, the full transition timeline — competes for that box, and the popover dismisses on outside click or Esc, so it can never be the thing you keep open while you work. Meanwhile [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar), an ecosystem plugin outside this workspace, had turned itself into an open sidebar foundation whose `ctx.betterSidebar` service registers third-party pages on equal footing with its own seven built-ins — a full-height, user-resizable, per-session column, which is exactly the container the board wants.

## Decision

The board has two surfaces and shows exactly one.

- **The foundation's presence picks the surface, in one place.** A single chooser reads the service by name, mounts either the floating surface or the sidebar surface as a child fiber, and swaps on `internal/service` when the foundation arrives or leaves. Two independent registration paths, each testing for the foundation itself, is exactly how a deployment ends up with two boards; the chooser makes that unrepresentable.
- **Zero dependency on the foundation.** It is neither imported (not even type-only) nor declared in `package.json`; the slice of its service this plugin calls is restated locally and everything crosses through the service name. A type-only import would satisfy both purity gates but adds a declaration edge to a package this repository does not resolve, and `verify-client-packages` only knows workspace packages. The ecosystem's own third-party pages (`dsh-sentinel`, `ego-browser`) integrate the same way.
- **Optional injection, not a declared one.** `ctx.inject([...], cb)` cannot express "activate when this is *absent*", so the floating surface cannot ride it; the chooser reads `ctx.get(name)` and listens for changes instead. Declaring the foundation in the plugin's own `inject` was never an option — it would block activation everywhere it is not installed.
- **The views are surface-neutral; only the chrome differs.** The compact card list and the detail sheet take plain values — no slot-synthesized hooks, no store handles. The floating surface keeps its pill, portal, compact list, and dismiss behavior; the sidebar page has none of that chrome, fills the pane the foundation owns, and now defaults to the [stage-centric Kanban](2026-08-31-devflow-stage-centric-kanban.md) while retaining the compact list as an alternate. The sidebar path assembles what the slot renderer used to synthesize: the translator from `ctx.locale.bind`, the snapshots by subscribing to the plugin's own stores.
- **A refused registration warns and moves on.** The foundation rejects a duplicate page id; that is a composition problem for the deployment, not a reason to take the plugin's dictionaries, fetches, and session backlink down with it.
- **The page binds to its own scope; refetching follows what someone is looking at.** Board state is one binding per session; a page uses the binding of the scope the foundation hands it, not of whichever session the app has in front. Forwarded devflow events refetch the bindings a visible page watches **plus the selected session's** — the one the tab badge and the `+` menu report on — so a background tab of another session costs nothing while the badge in front of the user stays live. The badge and the page's stats head count in-progress the same way, from one shared predicate, so the number on the tab can never contradict the line under it. The descriptor's read-only callbacks look bindings up without creating them: the foundation calls them on every tab-bar render, for whichever scopes it holds.
- **Capabilities are probed by name, not by version.** The badge, the page-local setting, and the state subscription are each gated on the foundation's `features` list; a foundation that announces none of them still gets a working page.
- **Side by side is a persisted page setting, not a width breakpoint.** The panel's width is user-dragged and shared across sessions, and jsdom cannot measure layout, so a breakpoint would be both unverifiable and unpredictable. The foundation already persists page-local settings and republishes them, which makes the preference discoverable in the host settings page and testable here.

## Alternatives considered

- **Keep both surfaces** — rejected: two entry points and two pieces of open/closed state for one board, with nothing to tell the user which to use.
- **Move to the sidebar unconditionally** — rejected for now: it would strand every deployment that has not installed the foundation, which is an ecosystem plugin we do not control.
- **Type-only import of the foundation for its descriptor types** — rejected: see above; the local restatement costs a few interfaces and owes nothing to a package outside the workspace.
- **Deciding once at activation** — rejected: plugin activation order is not ours to control, so a foundation that activates after the board would be missed forever.

## Consequences

Where the foundation is composed the board is a sidebar page (`dsh-devflow:board`, single-instance, order 60, title re-read per render so it follows a locale switch); everywhere else the floating control is byte-identical to before, which the existing two-workspace browser e2e keeps proving. The foundation cannot be booted in this repository's test lanes, so composition is verified against a stub service registered under the same name — registration, mutual exclusion in both directions, disposal, and refusal isolation — and the sidebar page's rendering is verified in jsdom against the plugin's real stores. The real sidebar rendering is verified by hand on a profile that installs the foundation; that gap is deliberate and recorded in the PRD.
