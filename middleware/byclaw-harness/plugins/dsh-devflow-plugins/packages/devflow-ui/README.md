# @zhchxiao123/dsh-devflow-ui

English | [中文](README.zh.md)

The browser half of the Devflow board. It integrates directly with the official right Sidebar shipped by DeepSeek Harness `0.1.5-rc.2`: the plugin registers a `devflow` tab type through `ctx.sidebarRightTabs` and mounts its body in the keyed `sidebar.right.pane.tab` slot. No extra sidebar plugin or floating fallback is required.

The page is a full-height, stage-centric Kanban. Its wide view has the seven ordered `DevStage` columns; each header reports the number of leaf work items in that stage. `blocked` remains a bypass rather than an eighth column: a blocked card stays in its `blockedFrom` column with warning treatment, while malformed data without an origin remains reachable in a fallback group. A top-level requirement with children becomes a collapsible swimlane, and each child appears exactly once in its actual stage. Standalone cards and children whose parent has left the active set share an independent-work lane. Completed cards are visually quiet and capped until expanded. A compact list remains available from the view switch. Narrow panes expose a stage selector instead of crushing all seven columns together.

The toolbar reports counts for whichever scope is selected and selects that scope: work in progress, or the archive. The archive counts what has been loaded and says so, because the read face pages it and reports no total — a "total" here would be a number nobody can compute. Scope is a separate axis from the Kanban/list switch, so the archive is reachable from either — a reader who just filed their last card asks "where did it go", not "show me extra rows", and a control buried in one view answers neither. The toolbar is chrome: it stays while the active set is empty, which is exactly when the route to the archive matters most. Archived cards read as a read-only list grouped by the month each was filed under, so the month heads its run instead of repeating on every row. Within a month a requirement keeps its slices: the store files them in one bucket to keep the family together, and the list indents them under it rather than scattering them among unrelated work. Only the slices move — the top level stays in the order the pages arrived, because re-sorting a paged set would lift a later page's card above an earlier one. A slice whose requirement is not among the loaded pages says whose it is instead, since a family can straddle a page boundary and position alone cannot say. Each card sits in a box of its own — bordered, but lighter than an active card and without its shadow, because a box identical to one on the board would imply this work can still move. The title heads the box beside how the card left; the id and, for a dropped card, why it stopped share the line below. The reason gets that width and up to two lines: the journal refuses a blank one and it is the only account of the decision, so a reason clipped to a few words would be one nobody can act on. The scope opens with the rule that decides what a reader does next: a filed card can be restored through `/devflow`, a dropped one cannot, and neither is offered here. Entering the scope is what fetches the archive, and leaving discards it: the set is unbounded and secondary to the board. Its pages accumulate behind a "load more" control, and a change frame restarts them rather than resuming, because a card filed or restored between two pages shifts the set the cursor was issued against. The scope holds no stage columns — filed work does not flow, so the view switch is disabled there with its reason shown rather than quietly removed.

Every row carries the one decision its card is open to, and nothing when it is open to none. A finished card offers filing and every other card offers dropping — except where the store's family rules would refuse: a delivered slice whose requirement is still on the board cannot be filed ahead of it, and a requirement whose slices are unfinished cannot be dropped out from under them. Those rows carry no control rather than one whose only outcome is a refusal; the structure already says why, since a slice sits inside its requirement's lane and the lane header carries its `k/n`. A requirement is drawn as a lane rather than a card, so its own controls live on the lane header — without them the Kanban is the one view where a decomposed requirement can be neither filed nor dropped. This mirrors the store rather than replacing it: the store still refuses either way, and a mirror that drifts fails softly in both directions. The toolbar carries the sweep beside the count it acts on, and is absent while that count is zero — a control that is usually inert teaches readers to stop seeing it.

Filing is reversible, so it commits on the click. Dropping is not, and the store refuses a blank reason, so it opens a prompt whose confirm stays disabled until a reason is written: writing why the work stopped **is** the confirmation, and an extra acknowledgement on top of it would be ceremony rather than protection. Restoring is deliberately not offered here at all.

The actions sit inside each card's own box, beside its opener rather than within it: a button nested in a button is invalid, and the browser would hand the inner one's click to the outer. The box is therefore an ordinary element with the opener as one of its children, so an action reads as belonging to the card it acts on instead of floating beneath it. A refused write leaves the board in place and says what to do next in its own words; `revision-mismatch` in particular is not the reader's mistake but another plane having moved the card, so the board is refreshed underneath them before they are told. Loading, a settled empty board, and a failed first read are distinct states; failures offer retry, while a failed background refresh preserves the last successful board. Opening a card shows its requirement, breakdown, artifacts, holder, named pipeline, and newest-first journal timeline. Each artifact path opens its file in the Sidebar — from the artifact list and from the timeline registration naming the same file — in a tab beside the board rather than in its place, because the board is the context the reader is opening the file *from*. Sections arrive open and can be folded. In the Sidebar's normal presentation, detail replaces the board and offers a back action; in the official fullscreen presentation, board and detail sit side by side.

Every tab reads the workspace belonging to its own session-scoped slot. A binding is created per session and begins fetching only while that tab body is visible. Change frames refetch visible bindings, so hidden tabs do not create background board traffic. The read-only JSON face and `/devflow/ws` change stream are served by [`@zhchxiao123/dsh-devflow-web`](../devflow-web/README.md) on the same origin as the app.

The plugin issues no mutations. Card moves belong to the model-facing Devflow tools and the `/devflow` intervention plane; human approvals continue through Harness's approval composer.

## Runtime contract

Harness composes the official Sidebar implementation in its Web bundle and publishes `@deepseek-ai/dsh-client-ui-sidebar-right` on npm, but that tarball declares no dependency beyond `@deepseek-ai/cordis` while its `.d.ts` imports `dsh-client-ui-dockkit` and `dsh-client-ui-layout/client`, which reach on to `dsh-brand`, `dsh-client-ui-theme`, `dsh-client-ui-settings`, and the host package `dsh-host-webserver`. Depending on it means pinning that whole graph here, and under `skipLibCheck` every member left unpinned degrades to `any` with no diagnostic. `sidebar-right.ts` therefore restates only the public registry and slot types this plugin consumes, and names each narrowing at its declaration. Runtime behavior still comes entirely from Harness. Component tests cover this plugin's registration and keyed body behavior against that restatement; they do not replace a real host-composition test. The packed plugin has therefore also been exercised in a real Harness `0.1.3-alpha.2` Web profile. A portable automated host-composition fixture remains a release exception until the official package carries the dependencies its types require.

## Model Experience

None. This package renders board state for a human and carries their decisions about a card's place on it; it does not touch prompts, messages, schemas, streams, or tool results. The model's view of the same cards belongs to [`@zhchxiao123/dsh-devflow-tool`](../devflow-tool/README.md).

#### KV Cache effect

None; this package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Read-only by design** — semantic moves stay in chat tools and operational intervention stays in `/devflow`.
- **A card opener announces its id, not its title** — the opener carries an `aria-label` naming the detail it opens, which overrides its content for assistive technology, so the title a sighted reader sees is not read out. Fixing it is a copy decision on `row.open`, not a structural one.
- **No WIP limits or inferred stage age** — the listing does not carry workflow limits or stage-entry time, so the board reports placement and counts without inventing metrics.
- **Whole-board refetch per change frame** — incremental frames can wait until board sizes justify the added protocol complexity.
- **Breakdown markers only see currently blocked children** — showing rework history on parent cards would require every child's journal.
- **Collapse, view-mode, and scope state is per mount** — these are local viewing preferences and reset when the page remounts.
- **The official Sidebar package's published types are not self-contained** — its tarball declares none of the packages its `.d.ts` imports, so this plugin restates the slice it consumes and installation targets a Harness Web profile that already composes the service and slot. The plugin intentionally does not fall back to a second navigation system.

### Optional Midscene diagnostics

When the Midscene plugin is mounted, the existing card detail response includes a
session-scoped, read-only summary. The detail sheet shows matching profile model
and family, target and login mode, the latest persisted model preflight, the
latest formal suite run for this card, and Midscene jobs accessible to the viewing
session. Credentials and model endpoints are omitted. Report links require an
explicit Harness `reportBaseUrl`; target application origins are never guessed.

A suite result is diagnostic evidence, not authorization to complete a card. The
existing transition history remains authoritative, and the summary explicitly
says whether the gate engine is available without claiming its deployment policy
requires Midscene. Missing or failing optional providers do not prevent ordinary
card reads. Summary freshness follows the existing detail reload behavior; it
introduces no polling, action buttons or orchestration state. Preflight, browser
exploration, formal acceptance, and job read/wait/cancel requests remain in chat.
