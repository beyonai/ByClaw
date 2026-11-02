# Agent Note: devflow — the sidebar board is a stage-centric Kanban

Status: implemented

English | [中文](2026-08-31-devflow-stage-centric-kanban.zh.md)

> Superseded in part on 2026-09-08 by
> [the official right-Sidebar integration](2026-09-08-devflow-official-right-sidebar.md).
> The Kanban projection and responsive layout decisions below remain current;
> references to the floating surface, `dsh-better-sidebar`, split-view settings,
> and the Harness `0.1.2-alpha.x` runtime validation describe the former host.

## Problem

The full-height sidebar page renders one row per task with a seven-segment
pipeline. That representation explains each card's path, but it makes the
reader scan every row to answer the board's primary question: how much work is
in each stage. Repeating the pipeline on every row also leaves little visual
room for blocked work and requirement breakdowns.

The same view cannot simply flatten children into columns. A child without its
requirement loses the reason it exists, while rendering both the parent and
its children as ordinary cards counts one unit of work twice.

## Decision

The full sidebar page uses the seven `DevStage` values as Kanban columns and
keeps a compact list as an alternate view. The floating control remains a
compact list because its bounded popover cannot give seven columns a readable
width.

`blocked` remains a bypass rather than an eighth stage. A blocked card appears
in its `blockedFrom` column with a visible warning label and contributes to
that column's count. Malformed durable input without an origin stays visible
in an explicit fallback group.

A top-level card with children becomes a collapsible swimlane header. Its
children appear once, in their current columns; the header carries the parent
stage and child distribution. Standalone top-level cards and children whose
parent is absent share an independent-work lane, so incomplete relations never
hide a card.

The browser remains read-only. Cards open the existing requirement, relation,
artifact, holder, and journal detail; transitions continue through the model,
command, and approval planes.

The narrow presentation initially selects `developing` when that stage has
work, otherwise the first populated stage. An empty independent-work shell
stays out of the narrow view. Parent headers and their stage distribution stay
visible there so the hierarchy remains understandable.

The wide grid keeps all seven stages visible but does not give empty and busy
stages equal weight. Globally empty stages contract to narrow, labeled tracks;
populated stages share the remaining width, and a wide stage cell lays its
cards out in an auto-fitting subgrid. Card titles are line-clamped and long IDs
are ellipsized inside the card, with their full values available as native
hover titles.

## Alternatives considered

**Keep the task-centric progress list as the only view.** It preserves the
existing compactness but makes stage load and blocked concentration expensive
to read, which is the reason for introducing a board.

**Render eight columns including `blocked`.** It is visually direct, but it
turns a temporary bypass into a workflow stage and separates blocked work from
the stage whose capacity it still occupies.

**Flatten parents and children into the same columns.** It is simpler to
render, but either duplicates the parent as a work card or removes the
requirement context from every child.

**Add drag-and-drop transitions.** It crosses the browser's read-only boundary
and would need revision conflicts, gates, approvals, and rejection recovery in
the UI. The existing transition planes already own those decisions.

## Testing

- Pure projection tests pin stage placement, blocked origins, malformed
  fallback data, independent and orphan work, parent swimlanes, stable order,
  and counts.
- React tests pin all seven headers, responsive stage selection, parent
  collapse, exactly-once child rendering, completed-card expansion, the
  compact-list alternative, adaptive empty-stage tracks, bounded long labels,
  and unchanged detail navigation.
- Browser binding tests keep session scoping, live refresh, split detail, and
  surface selection intact. First-read failures expose retry; a failed
  background refresh preserves the last successful board.
- The packed bundle boots on Harness `0.1.2-alpha.3` through its current
  `dsh-client-store`, `dsh-client-ui-renderer`, and `dsh-api-session-controller`
  boundaries. The floating surface and the real sidebar container are both
  exercised there; the latter uses `dsh-better-sidebar@0.18.0-alpha.0`, whose
  alpha channel targets Harness `0.1.2-alpha.x`.

## Consequences

Seven columns require horizontal space, so the narrow layout needs its own
single-stage presentation. The list response has no stage-entry time, holder,
or WIP limit; the board omits those values rather than inferring them. Gate
history remains a detail fact, not a prediction of whether the next move will
pass.

Column widths therefore describe current load as well as stage order: an empty
stage remains findable but is intentionally narrower. Width changes when the
global distribution changes, while stage order, labels, counts, and card
placement remain stable.

The stage-centric page supersedes only the sidebar rendering described by the
[sidebar-surface decision](2026-08-26-devflow-board-sidebar-surface.md) and the
[requirement-breakdown decision](2026-08-26-devflow-requirement-breakdown.md).
Their surface ownership, hierarchy model, read-only boundary, and detail
contracts remain in force. The floating surface deliberately keeps the compact
list because its bounded popover cannot support seven readable columns.
