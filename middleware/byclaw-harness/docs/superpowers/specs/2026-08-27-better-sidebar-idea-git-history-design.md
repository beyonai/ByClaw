# Better Sidebar IDEA-Style Git History Design

Date: 2026-08-27

## Goal

Replace the compact Source Control history list with a responsive IDEA-style Git log: a real commit graph, current/all/local/remote branch selection, text-or-hash search, author/date/path filters, commit metadata columns, and automatic scroll pagination.

## Scope and layout

The history remains inside the existing Source Control tab beneath commit controls. A dense toolbar contains search plus Branch, User, Date, and Paths filters. The Branch picker groups Current, All, Local, and Remote references; it replaces IDEA's permanently visible branch tree because the sidebar is narrow.

Each row contains a graph lane, commit subject, ref badges, author, and relative date. Wide panels use columns; narrow panels keep the graph and subject on the first line and move author/date to a secondary line. Clicking or pressing Enter opens the existing commit diff tab. Existing context-menu actions remain.

## Host data model

`git.log` accepts a validated `GitLogQuery`:

```ts
interface GitLogQuery {
  scope: 'current' | 'all' | 'ref'
  ref?: string
  search?: string
  author?: string
  since?: string
  until?: string
  path?: string
  count: number
  skip: number
}
```

The response is `{ entries, hasMore }`. Every entry adds `parents: string[]`; refs remain authoritative Git decorations. The host runs `git log` with `--topo-order`, `--date-order`, `--parents`, and the selected revision scope. Search is server-side: hash-like input resolves matching reachable commit IDs, otherwise it uses case-insensitive fixed-string commit-message matching. Author, ISO date bounds, and repository-relative path are passed as separate Git arguments after strict validation.

`git.branch` retains the checkout-oriented `names` list and adds grouped `local` and `remote` references. Remote names are display-only history filters; selecting one never checks it out. No fetch, pull, or network operation is added.

## Client graph and request lifecycle

A pure `buildGitGraph(entries)` function computes stable lanes from topologically ordered rows and their parent hashes. It emits node/edge geometry and a deterministic color index per lane. Appended pages recompute from the accumulated entries, so merge lines cross page boundaries without an opaque server cursor.

History query state is independent from the checkout selector. Its default scope is Current, so checkout changes refresh the history for the new branch. Selecting All or a named local/remote ref pins that filter until the repository/worktree changes. Search is debounced; explicit filters apply immediately. Any target or query change increments the existing generation, clears rows, and rejects stale pages.

An intersection sentinel loads the next page. A visible retry button appears after a page error and also serves keyboard/non-observer environments. Only one page request may be in flight. Empty states distinguish no commits from no filter matches.

## Validation and safety

- Counts are positive integers capped at 100; skip is a non-negative integer.
- Ref values must match the authoritative local/remote branch inventory, except the host-selected current branch.
- Path filters use the existing repository-relative path validator.
- Search and author strings are passed as individual process arguments, never shell text.
- Date filters accept `YYYY-MM-DD` only and require `since <= until`.
- Repository/worktree target validation remains unchanged and precedes Git execution.

## Verification

- Host tests cover parents, local/remote refs, all/current/ref scopes, every filter, pagination, validation, and merge topology using temporary repositories.
- Pure graph tests cover linear, fork, merge, octopus-like multiple parents, and page append stability.
- Component tests cover responsive metadata, grouped branch selection, debounced search, stale response rejection, automatic pagination, retry, diff opening, and context actions.
- Typecheck and build must pass.
- End-to-end verification reloads every ByClaw plugin, starts `pnpm dsh web` from `deepseek-harness`, sends inbound messages for both `/Users/chenxiaofeng/code/project/20014944` and `/Users/chenxiaofeng/code/open/byclaw-dsh`, and inspects the resulting Source Control history in the in-app browser.

## Non-goals

- No fetch/pull/push, merge, rebase, branch creation, or remote mutation.
- No permanent IDEA branch-tree column in the narrow sidebar.
- No change to DeepSeek Harness source.
- No third-party graph runtime dependency.

