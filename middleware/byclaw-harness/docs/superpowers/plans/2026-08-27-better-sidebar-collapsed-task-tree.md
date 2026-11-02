# Better Sidebar Collapsed Task Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task Management root and nested branches default to collapsed and observe only expanded catalogs.

**Architecture:** `SubagentView` owns an expanded-parent ID set and reconciles catalog subscriptions from it. `CatalogRows` becomes a controlled recursive tree that renders disclosure controls and descendant groups only for expanded branches.

**Tech Stack:** TypeScript ESM, React, CSS modules, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-08-27-better-sidebar-collapsed-task-tree-design.md`

## Global Constraints

- Modify only the ByClaw plugin; do not change DeepSeek Harness source.
- Root and nested branches start collapsed for each newly mounted session tree.
- Card navigation and disclosure toggling are separate actions.
- Only expanded branches observe membership or poll child live previews.
- Background jobs remain visible independently of topology expansion.

---

### Task 1: Controlled collapsed topology

**Files:**
- Modify: `plugins/dsh-better-sidebar/src/client/SubagentView.tsx`
- Modify: `plugins/dsh-better-sidebar/src/client/SubagentView.module.css`
- Test: `plugins/dsh-better-sidebar/tests/subagent-jobs-view.spec.tsx`
- Test: `plugins/dsh-better-sidebar/tests/subagent-live-polling.spec.tsx`

**Interfaces:**
- Consumes: existing `SidebarSubagentCatalog`, session list mirror, and `setSubagentCatalogOpen`.
- Produces: controlled `CatalogRows` props `expanded: ReadonlySet<string>` and `onToggle(parentSessionId: string): void`.

- [ ] **Step 1: Write failing component tests**

Add assertions equivalent to:

```ts
expect(rootItem.getAttribute('aria-expanded')).toBe('false')
expect(screenText()).not.toContain('child label')
clickDisclosure(rootItem)
expect(rootItem.getAttribute('aria-expanded')).toBe('true')
expect(screenText()).toContain('child label')
expect(nestedItem.getAttribute('aria-expanded')).toBe('false')
```

Also prove the disclosure click does not call `sessions.open`, nested expansion is isolated, and collapse calls `setSubagentCatalogOpen(parentId, false)`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/subagent-jobs-view.spec.tsx tests/subagent-live-polling.spec.tsx
```

Expected: FAIL because branches currently render `aria-expanded="true"` and descendants immediately.

- [ ] **Step 3: Implement the controlled expansion set**

In `SubagentView`, add:

```ts
const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
const toggleBranch = useCallback((id: string): void => {
  setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}, [])
useEffect(() => { setExpanded(new Set()) }, [rootId])
```

Pass this state through `CatalogRows`. Render a disclosure button before the state dot, expose `aria-expanded={expanded.has(entry.id)}`, and render the child `role="group"` only when expanded.

- [ ] **Step 4: Reconcile subscriptions and keyboard behavior**

Replace all-branch observation with the exact desired set:

```ts
const desired = active ? expanded : new Set<string>()
for (const id of observedRef.current) if (!desired.has(id)) observe(id, false)
for (const id of desired) if (!observedRef.current.has(id)) observe(id, true)
```

Root live polling uses `active && rootId !== undefined && expanded.has(rootId)`. Add ArrowRight/ArrowLeft handling for the focused expandable item through a `data-subagent-id` attribute.

- [ ] **Step 5: Style and verify GREEN**

Add a 20px disclosure control with theme-token hover/focus states and rotate its chevron when expanded. Run:

```bash
pnpm exec vitest run tests/subagent-jobs-view.spec.tsx tests/subagent-live-polling.spec.tsx tests/subagent-detect.spec.ts
```

Expected: PASS.

