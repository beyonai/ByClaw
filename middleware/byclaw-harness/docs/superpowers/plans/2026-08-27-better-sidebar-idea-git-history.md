# Better Sidebar IDEA-Style Git History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an IDEA-style responsive Git log with a real graph, grouped branch filters, search/author/date/path filters, metadata columns, and automatic pagination.

**Architecture:** Extend the plugin-owned Git routes with validated history query fields and parent hashes, then render them in a focused `GitHistoryLog` component. A pure graph-layout module derives lanes from accumulated topological rows; `GitView` continues to own repository/checkout generations and commit actions.

**Tech Stack:** TypeScript ESM, Node child processes, system Git, React, CSS modules, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-08-27-better-sidebar-idea-git-history-design.md`

## Global Constraints

- No DeepSeek Harness source changes and no new runtime dependency.
- Default history scope follows the current checkout.
- Remote refs are read-only filters and never trigger network access or checkout.
- All Git arguments are arrays; no shell interpolation.
- Existing target-generation isolation, commit diff, and context-menu actions remain intact.
- Page size is 50 in the UI and the host caps it at 100.

---

### Task 1: History query and richer Git rows

**Files:**
- Modify: `plugins/dsh-better-sidebar/src/git.ts`
- Modify: `plugins/dsh-better-sidebar/src/index.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/api.ts`
- Test: `plugins/dsh-better-sidebar/tests/git.spec.ts`
- Test: `plugins/dsh-better-sidebar/tests/smoke.spec.ts`

**Interfaces:**
- Produces: `GitLogQuery`, `GitLogPage`, `GitBranchResult`, and `GitLogEntry.parents`.
- Consumes later: `api.gitLog(scope, target, query, signal)` and grouped branch refs.

- [ ] **Step 1: Write parser and route tests that fail**

Use a merge repository and assert:

```ts
expect(page.entries[0]).toMatchObject({ parents: expect.any(Array) })
expect(page.hasMore).toBe(true)
expect(branches.local).toContain('main')
expect(branches.remote).toContain('origin/main')
```

Add current/all/ref, message/hash, author, date, path, invalid ref/date/path, count cap, and page-boundary cases.

- [ ] **Step 2: Run host tests and verify RED**

```bash
pnpm exec vitest run tests/git.spec.ts tests/smoke.spec.ts
```

Expected: FAIL because rows have no parents and `git.log` returns an array without filters.

- [ ] **Step 3: Implement wire types and strict route parsing**

Add exact types:

```ts
export interface GitLogQuery {
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
export interface GitLogPage { entries: GitLogEntry[]; hasMore: boolean }
```

Validate dates with `/^\d{4}-\d{2}-\d{2}$/`, require ordered bounds, resolve ref membership from `branches()`, reuse the relative-path validator, and cap count to 100.

- [ ] **Step 4: Implement Git argument construction and parsing**

Request `count + 1` rows to derive `hasMore`. Use:

```ts
['log', '--topo-order', '--date-order', '--decorate=short',
 '--pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D%x1f%P']
```

Add `--all` or the validated ref, `--fixed-strings --regexp-ignore-case --grep=<text>`, `--author=<author>`, `--since=<date>`, `--until=<date>`, and `-- <path>` as applicable. Resolve hash-like search against reachable commit IDs before choosing hash or message mode.

- [ ] **Step 5: Verify host GREEN**

```bash
pnpm exec vitest run tests/git.spec.ts tests/smoke.spec.ts
```

Expected: PASS.

### Task 2: Pure commit graph layout

**Files:**
- Create: `plugins/dsh-better-sidebar/src/client/git-graph.ts`
- Create: `plugins/dsh-better-sidebar/tests/git-graph.spec.ts`

**Interfaces:**
- Consumes: ordered `ReadonlyArray<GitLogEntry>`.
- Produces: `buildGitGraph(entries): GitGraphRow[]` with node lane, incoming/outgoing lane segments, and stable color indices.

- [ ] **Step 1: Write failing graph tests**

Cover linear history, fork, two-parent merge, three-parent merge, disconnected filtered rows, and recomputing after page append. Assert exact lane indices and segment endpoints.

- [ ] **Step 2: Run graph tests and verify RED**

```bash
pnpm exec vitest run tests/git-graph.spec.ts
```

Expected: FAIL because `git-graph.ts` does not exist.

- [ ] **Step 3: Implement deterministic lane allocation**

Maintain active commit hashes by lane. For each row, claim its existing lane or the first free lane, replace that lane with the first parent, allocate remaining parents to free lanes, and emit vertical/diagonal segments for the row. Remove empty lanes only from the right edge so previously visible lane positions remain stable.

- [ ] **Step 4: Verify graph GREEN**

```bash
pnpm exec vitest run tests/git-graph.spec.ts
```

Expected: PASS.

### Task 3: Responsive history component and automatic pagination

**Files:**
- Create: `plugins/dsh-better-sidebar/src/client/GitHistoryLog.tsx`
- Modify: `plugins/dsh-better-sidebar/src/client/GitView.tsx`
- Modify: `plugins/dsh-better-sidebar/src/client/sidebar.module.css`
- Modify: `plugins/dsh-better-sidebar/src/client/locales.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/locales-*.ts`
- Test: `plugins/dsh-better-sidebar/tests/git-history-log.spec.tsx`
- Modify: `plugins/dsh-better-sidebar/tests/git-view-worktree.spec.tsx`

**Interfaces:**
- Consumes: `GitLogPage`, grouped branches, `buildGitGraph`, and callbacks for diff/context menu.
- Produces: controlled `GitHistoryLog` with `query`, `onQueryChange`, `entries`, `hasMore`, `loading`, `pageError`, and `onLoadMore`.

- [ ] **Step 1: Write failing component tests**

Assert toolbar labels, grouped local/remote options, graph SVG accessibility hiding, author/date rendering, 250ms search debounce, query reset on target change, sentinel pagination once, retry after failure, and row diff/context callbacks.

- [ ] **Step 2: Run component tests and verify RED**

```bash
pnpm exec vitest run tests/git-history-log.spec.tsx tests/git-view-worktree.spec.tsx
```

Expected: FAIL because the component and query state do not exist.

- [ ] **Step 3: Implement `GitHistoryLog`**

Render a search field, grouped filter controls, responsive commit grid, inline ref badges, SVG graph lanes, loading/empty/error states, and an `IntersectionObserver` sentinel. Keep a keyboard-visible retry/load button as fallback.

- [ ] **Step 4: Integrate with `GitView` generations**

Replace `logEntries` array calls with `GitLogPage` queries. Default query is:

```ts
{ scope: 'current', search: '', author: '', since: '', until: '', path: '', count: 50, skip: 0 }
```

Repository/worktree changes reset filters to Current. Checkout changes keep filters but Current resolves to the new branch. Every query change increments the history request generation and clears stale rows. Preserve `openCommitDiff` and the existing history context menu.

- [ ] **Step 5: Add responsive styles and translations**

Use theme tokens and CSS container/media queries: wide rows use graph/subject/author/date columns; narrow rows place metadata below the subject. Add all new keys to the base locale and every shipped dictionary, using English fallback text where a maintained translation is unavailable.

- [ ] **Step 6: Verify component GREEN**

```bash
pnpm exec vitest run tests/git-history-log.spec.tsx tests/git-view-worktree.spec.tsx tests/git-graph.spec.ts tests/git.spec.ts tests/smoke.spec.ts
pnpm typecheck
pnpm build
```

Expected: all focused suites, typecheck, and build pass.

### Task 4: Assembled end-to-end verification

**Files:**
- Modify only if a verified plugin-loading incompatibility blocks the assembled app.

**Interfaces:**
- Consumes: built plugin bundle and existing ByClaw integration inbound script.
- Produces: terminal and browser evidence for both requested workspaces.

- [ ] **Step 1: Reload all plugins and start the app**

Run `pnpm dsh web` from `/Users/chenxiaofeng/code/open/deepseek-harness` with every plugin under `/Users/chenxiaofeng/code/open/byclaw-dsh/plugins` mounted.

- [ ] **Step 2: Send both inbound messages**

Run `plugins/byclaw-integration/scripts/live-e2e.mjs` with `E2E_CWD` set first to `/Users/chenxiaofeng/code/project/20014944`, then `/Users/chenxiaofeng/code/open/byclaw-dsh`. Require `appStreamResponse` for both.

- [ ] **Step 3: Inspect the assembled UI**

Using the in-app browser, verify task roots default collapsed, expansion reveals one level, Source Control history shows graph/ref/author/date, current/all/local/remote filters work, scrolling fetches another page without duplication, and repository switching remains isolated.

