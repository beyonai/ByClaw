# Better Sidebar Collapsed Task Tree Design

Date: 2026-08-27

## Goal

Make the Task Management topology start collapsed while preserving explicit navigation, live status, lazy catalog hydration, background jobs, and keyboard accessibility.

## Confirmed behavior

- The main-agent root starts collapsed whenever a Task Management view mounts for a session tree.
- Every non-leaf subagent starts collapsed independently.
- A disclosure control expands or collapses a branch. Clicking the card body continues to open that session and does not toggle disclosure accidentally.
- Only expanded branches subscribe to catalog membership. Collapsing a branch releases its subscription and hides its descendants.
- Live child previews poll only while the root is expanded and the tab is visible. Background jobs remain visible below the collapsed topology because they are a separate task surface.
- Arrow keys continue to navigate only currently visible treeitems. Left collapses an expanded item; Right expands a collapsed item; Enter/Space opens the selected session.
- Expansion is local UI state. Switching to a different session tree resets the new tree to collapsed rather than carrying branch IDs across unrelated trees.

## State model

`SubagentView` owns a `ReadonlySet<string>` of expanded parent session IDs. The root ID uses the same representation as nested branches. `CatalogRows` receives the set and an `onToggle` callback; a branch renders `aria-expanded`, a disclosure button, and its `role="group"` only when expanded.

Catalog observation is derived from the visible branch set rather than from every known catalog. An effect reconciles the desired observed IDs (`active && expanded`) against the currently observed IDs, opening new subscriptions and closing removed ones. Unmount and root changes close every remaining subscription.

## Accessibility and presentation

The disclosure button has a localized expand/collapse label and is visually aligned before the state dot. The row remains a `treeitem`; the nested group remains a `group`. The root exposes `aria-expanded` whenever it has descendants. Disabled diagnostic rows remain leaves.

## Verification

- Component tests prove the root and nested branches start collapsed, disclosure does not navigate, expansion reveals only one level, collapse releases catalog observation, and keyboard Left/Right works.
- Existing live polling and background-job tests remain green.
- The assembled web UI is verified with a ByClaw inbound session containing multiple task levels.

