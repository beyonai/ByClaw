# Better Sidebar Git Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Better Sidebar automatically expose Files and Source Control for Git-root sessions, and provide a safe repository → worktree source-control view with collapsed directory trees and visible status colors.

**Architecture:** The host publishes one authoritative Git workspace inventory built only from the CWD root, declared `.gitmodules`, and each repository's `git worktree list`. Every Git route resolves an opaque `{ repositoryId, worktreeId }` target through that inventory before running a command. The client persists one target per Git tab, atomically refreshes all target-derived data, and renders staged/unstaged changes through a pure path-tree model.

**Tech Stack:** TypeScript ESM, Cordis plugin routes, React, CSS modules, Vitest/jsdom, system Git CLI, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-26-better-sidebar-git-workspaces-design.md`

## Global Constraints

- Modify only `byclaw-dsh/plugins/dsh-better-sidebar`; do not modify DSH source code.
- Treat `byclaw-dsh/plugins/dsh-better-sidebar` as the source of truth, then mechanically sync it to `deepseek-harness/plugins/dsh-better-sidebar`.
- Repository discovery reads only the CWD root and paths declared by `.gitmodules`; it must not scan the disk.
- A root `.git` may be either a directory or a file.
- Uninitialized submodules remain visible but never trigger network access or automatic initialization.
- Every Git operation resolves an opaque repository/worktree target on the host immediately before execution.
- Linked worktrees outside the session CWD may use Git operations and Diff, but may not bypass the Files/editor workspace fence.
- New and existing sessions run default Git-tab initialization once; a manually closed tab must not reopen.
- Staged and unstaged sections start collapsed and use non-color status labels in addition to colors.
- `/Users/chenxiaofeng/code/project/20014944` is read-only verification data; tests create isolated temporary repositories.
- No new runtime dependency is required.

## File Map

- Create `plugins/dsh-better-sidebar/src/git-runner.ts`: Git child-process execution, command errors, and platform-aware path identity.
- Create `plugins/dsh-better-sidebar/src/git-workspaces.ts`: `.gitmodules` discovery, repository/worktree inventory, cache, opaque IDs, and target resolution.
- Modify `plugins/dsh-better-sidebar/src/git.ts`: consume resolved worktree directories instead of discovering arbitrary repository roots.
- Modify `plugins/dsh-better-sidebar/src/index.ts`: add `git.inventory` and resolve every Git request through a `GitTarget`.
- Modify `plugins/dsh-better-sidebar/src/client/api.ts`: inventory/target wire types and target-based API calls.
- Modify `plugins/dsh-better-sidebar/src/client/state.ts`: persisted one-time Git defaults marker, target metadata, and initialization reducer.
- Modify `plugins/dsh-better-sidebar/src/client/Sidebar.tsx`: run one inventory-backed default-tab initialization after CWD hydration.
- Modify `plugins/dsh-better-sidebar/src/client/builtins/tabs.tsx`: persist the selected Git target in the Git tab metadata.
- Create `plugins/dsh-better-sidebar/src/client/git-tree.ts`: pure Git path-tree construction and status classification.
- Create `plugins/dsh-better-sidebar/src/client/GitChangeTree.tsx`: collapsible directory/file rendering and subtree actions.
- Modify `plugins/dsh-better-sidebar/src/client/GitView.tsx`: two-level selector and atomic target refresh.
- Modify `plugins/dsh-better-sidebar/src/client/DiffTab.tsx`: reload diffs through the persisted opaque target.
- Modify `plugins/dsh-better-sidebar/src/client/sidebar.module.css`: tree layout and semantic Git colors.
- Modify `plugins/dsh-better-sidebar/src/client/locales.ts` and shipped locale dictionaries: repository/worktree/unavailable/status labels.
- Create `plugins/dsh-better-sidebar/tests/git-workspaces.spec.ts`: inventory, recursion, limits, worktrees, and target validation.
- Create `plugins/dsh-better-sidebar/tests/git-tree.spec.ts`: path tree and status classification.
- Create `plugins/dsh-better-sidebar/tests/git-change-tree.spec.tsx`: collapsed sections, directory toggles, subtree actions, and accessible status text.
- Modify `plugins/dsh-better-sidebar/tests/smoke.spec.ts`: target-based host routes and real temporary Git repositories.
- Modify `plugins/dsh-better-sidebar/tests/state.spec.ts` and `tests/prefs.spec.ts`: one-time default tabs and persistence migration.
- Modify `plugins/dsh-better-sidebar/tests/git-view-worktree.spec.tsx`: repository/worktree switching and stale-response rejection.
- Modify `plugins/dsh-better-sidebar/README.md` and `README_EN.md`: behavior, selector model, and safety limitations.

---

### Task 0: Record the imported ByClaw plugin baseline

**Files:**
- Add: `plugins/dsh-better-sidebar/**` (current imported v0.16.1 source before feature edits)

**Interfaces:**
- Consumes: the already imported `@byclaw/dsh-better-sidebar` package.
- Produces: a tracked source baseline so later feature commits contain reviewable diffs.

- [ ] **Step 1: Verify the imported package is unchanged and buildable**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/plugin-shape.spec.ts tests/manifest-consistency.spec.ts
pnpm --dir plugins/dsh-better-sidebar build
```

Expected: both focused suites and the build pass.

- [ ] **Step 2: Confirm only the plugin subtree will be captured**

Run:

```bash
git status --short -- plugins/dsh-better-sidebar
git diff --cached --name-only
```

Expected: the plugin is untracked; unrelated staged files remain visible but are not included by the path-scoped commit below.

- [ ] **Step 3: Commit the plugin baseline only**

```bash
git add plugins/dsh-better-sidebar
git commit --only -m "chore: import ByClaw better sidebar" -- plugins/dsh-better-sidebar
```

Expected: the commit contains only `plugins/dsh-better-sidebar/**`.

### Task 1: Build the authoritative Git workspace inventory

**Files:**
- Create: `plugins/dsh-better-sidebar/src/git-runner.ts`
- Create: `plugins/dsh-better-sidebar/src/git-workspaces.ts`
- Modify: `plugins/dsh-better-sidebar/src/git.ts`
- Create: `plugins/dsh-better-sidebar/tests/git-workspaces.spec.ts`
- Modify: `plugins/dsh-better-sidebar/tests/smoke.spec.ts`

**Interfaces:**
- Consumes: Node `child_process`, `fs/promises`, `path`, and `crypto`; system Git.
- Produces: `GitTarget`, `GitWorkspaceInventory`, `GitRepository`, `GitWorktree`, `discoverGitWorkspace(cwd, options?)`, `resolveGitTarget(cwd, target)`, `runGit(cwd, args, timeoutMs?)`, and `pathIdentity(path)`.

- [ ] **Step 1: Write failing inventory tests**

Add fixtures that initialize real temporary repositories without network access:

```ts
const inventory = await discoverGitWorkspace(root, { refresh: true })
expect(inventory.cwdHasGitEntry).toBe(true)
expect(inventory.repositories.map(repo => [repo.kind, repo.relativePath, repo.state])).toEqual([
  ['root', '.', 'ready'],
  ['submodule', 'packages/child', 'ready'],
  ['submodule', 'packages/missing', 'uninitialized'],
])
```

Add cases for a `.git` file, recursive child `.gitmodules`, an escaping `../outside` declaration, repeated/cyclic realpaths, prunable worktrees, and two worktrees belonging to different repositories.

- [ ] **Step 2: Run the inventory tests and verify failure**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-workspaces.spec.ts
```

Expected: FAIL because `git-workspaces.ts` and its exports do not exist.

- [ ] **Step 3: Extract the Git runner**

Move the existing process code into these exact exports:

```ts
export class GitCommandError extends Error {
  constructor(message: string, readonly code: string, readonly command: string) { super(message) }
}

export function runGit(cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<string>
export function pathIdentity(path: string): string
```

Update `git.ts` imports without changing its behavior. Preserve `--no-pager`, `-c color.ui=false`, `GIT_OPTIONAL_LOCKS=0`, timeout killing, stderr reporting, and `windowsHide: true`.

- [ ] **Step 4: Run existing Git smoke tests after the extraction**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/smoke.spec.ts
```

Expected: PASS; the extraction is behavior-neutral.

- [ ] **Step 5: Implement inventory types and opaque IDs**

Define these public types:

```ts
export interface GitTarget { repositoryId: string; worktreeId: string }
export interface GitWorkspaceInventory { cwdHasGitEntry: boolean; repositories: GitRepository[]; truncated?: boolean }
export interface GitRepository {
  id: string
  name: string
  path: string
  relativePath: string
  kind: 'root' | 'submodule'
  state: 'ready' | 'uninitialized' | 'missing'
  error?: string
  worktrees: GitWorktree[]
}
export interface GitWorktree {
  id: string
  path: string
  branch: string
  current: boolean
  changes: number
  locked: boolean
}
```

Derive IDs with a deterministic SHA-256 hash prefix over `pathIdentity(path)`. IDs identify entries only; `resolveGitTarget` must rediscover or read the current cached inventory and match IDs rather than decoding a path.

- [ ] **Step 6: Implement declared-path-only submodule discovery**

`discoverGitWorkspace` must:

```ts
const cwdHasGitEntry = await lstat(join(cwd, '.git')).then(() => true, () => false)
```

Then add the ready root repository when CWD is a Git top level, read each existing `.gitmodules` through:

```ts
runGit(repoPath, ['config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'])
```

Resolve declared paths relative to the declaring repository, require their real path to remain within the authoritative CWD, recurse only into ready repositories, dedupe by `pathIdentity(realpath)`, and cap recursion and repository count with named constants.

- [ ] **Step 7: Implement per-repository worktree inventory and target resolution**

Parse `git worktree list --porcelain -z`, exclude prunable/missing paths, retain locked entries, and compute status counts independently per worktree. Resolve only exact `{ repositoryId, worktreeId }` pairs from the selected repository:

```ts
export interface ResolvedGitTarget { repository: GitRepository; worktree: GitWorktree }
export async function resolveGitTarget(cwd: string, target: GitTarget): Promise<ResolvedGitTarget>
```

An unknown or mismatched pair throws `GitCommandError` with code `git-target`.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-workspaces.spec.ts tests/smoke.spec.ts
pnpm --dir plugins/dsh-better-sidebar typecheck
```

Expected: PASS.

Commit:

```bash
git add plugins/dsh-better-sidebar/src/git-runner.ts plugins/dsh-better-sidebar/src/git-workspaces.ts plugins/dsh-better-sidebar/src/git.ts plugins/dsh-better-sidebar/tests/git-workspaces.spec.ts plugins/dsh-better-sidebar/tests/smoke.spec.ts
git commit -m "feat(sidebar): discover git repositories and worktrees"
```

### Task 2: Route every Git operation through one validated target

**Files:**
- Modify: `plugins/dsh-better-sidebar/src/index.ts`
- Modify: `plugins/dsh-better-sidebar/src/git.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/api.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/state.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/DiffTab.tsx`
- Modify: `plugins/dsh-better-sidebar/tests/smoke.spec.ts`
- Modify: `plugins/dsh-better-sidebar/tests/consumer-types.ts`

**Interfaces:**
- Consumes: `GitTarget`, `discoverGitWorkspace`, and `resolveGitTarget` from Task 1.
- Produces: `git.inventory` route and target-based `api.git*` methods; `SidebarDiffRef` carries `target: GitTarget`.

- [ ] **Step 1: Write failing target-route tests**

Exercise two repositories with independent worktrees and prove every route uses the selected target:

```ts
const target = inventory.repositories[1]!.worktrees[0]!
const status = await invoke(route, 'git.status', {
  sessionId: 's',
  target: { repositoryId: inventory.repositories[1]!.id, worktreeId: target.id },
})
expect(status.root).toBe(target.path)
```

Add rejection cases for an unknown repository ID, a worktree ID from another repository, absolute file paths, and `../` relative file paths.

- [ ] **Step 2: Run the route tests and verify failure**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/smoke.spec.ts -t "git target"
```

Expected: FAIL because routes still accept `repoRoot` and `worktree` paths.

- [ ] **Step 3: Add strict target parsing and inventory route**

Add exact host helpers:

```ts
function gitTargetOf(payload: unknown): GitTarget
function requireGitRelativePath(payload: unknown, key: string): string
```

`requireGitRelativePath` rejects empty, absolute, NUL-containing, and any normalized path containing `..`. Add `git.inventory` and remove path-based `selectedRepoOf` from Git routes.

- [ ] **Step 4: Change Git functions to operate on resolved worktree paths**

Use `resolved.worktree.path` as the `git -C` directory. Each route resolves once and calls functions such as:

```ts
status(worktreePath: string): Promise<GitStatusResult>
diff(worktreePath: string, path: string | undefined, staged: boolean): Promise<string>
stage(worktreePath: string, path?: string): Promise<void>
```

Do not let a route rediscover a different default between validation and execution.

- [ ] **Step 5: Update client wire types and diff persistence**

Add:

```ts
gitInventory: (scope: SessionScope, refresh?: boolean, signal?: AbortSignal) => Promise<GitWorkspaceInventory>
gitStatus: (scope: SessionScope, target: GitTarget, signal?: AbortSignal) => Promise<GitStatusResult>
```

Apply the same `target` parameter to every `git*` call. Change both worktree and commit `SidebarDiffRef` variants to store `target: GitTarget`; update `DiffTab` so reopened diff tabs address the same validated target.

- [ ] **Step 6: Run tests, type checks, and commit**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/smoke.spec.ts
pnpm --dir plugins/dsh-better-sidebar check:consumer-types
pnpm --dir plugins/dsh-better-sidebar typecheck
```

Expected: PASS.

Commit:

```bash
git add plugins/dsh-better-sidebar/src/index.ts plugins/dsh-better-sidebar/src/git.ts plugins/dsh-better-sidebar/src/client/api.ts plugins/dsh-better-sidebar/src/client/state.ts plugins/dsh-better-sidebar/src/client/DiffTab.tsx plugins/dsh-better-sidebar/tests/smoke.spec.ts plugins/dsh-better-sidebar/tests/consumer-types.ts
git commit -m "refactor(sidebar): bind git routes to validated targets"
```

### Task 3: Initialize Files and Source Control exactly once per session

**Files:**
- Modify: `plugins/dsh-better-sidebar/src/client/state.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/Sidebar.tsx`
- Modify: `plugins/dsh-better-sidebar/tests/state.spec.ts`
- Modify: `plugins/dsh-better-sidebar/tests/prefs.spec.ts`

**Interfaces:**
- Consumes: `api.gitInventory(scope)` from Task 2.
- Produces: persisted `gitDefaultsChecked: boolean` and pure `initializeGitDefaultTabs(state, options)` reducer.

- [ ] **Step 1: Write failing reducer and persistence tests**

Cover these exact behaviors:

```ts
const initialized = initializeGitDefaultTabs(makeDefaultState(), {
  cwdHasGitEntry: true,
  editorEnabled: true,
  gitEnabled: true,
})
expect(allLeaves(initialized.splits).flatMap(leaf => leaf.tabs).map(tab => tab.type)).toEqual(['editor', 'git'])
expect(initialized.gitDefaultsChecked).toBe(true)
```

Also prove a second call is referentially stable, Files remains active, disabled types stay absent, no-`.git` only sets the marker, an older persisted state migrates with `gitDefaultsChecked: false`, and closing Git after initialization does not recreate it.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/state.spec.ts tests/prefs.spec.ts
```

Expected: FAIL because the marker and reducer do not exist.

- [ ] **Step 3: Implement the state migration and pure reducer**

Add `gitDefaultsChecked` to `SidebarState`, initialize it to `false`, and make `sanitizeState` default a missing value to `false`. The reducer must mark completion even when no tab is added and must use stable single-tab IDs so retries cannot duplicate them.

- [ ] **Step 4: Trigger initialization after CWD hydration**

In `Sidebar`, add an abortable effect keyed by `sessionId`, resolved `cwd`, and the current marker:

```ts
api.gitInventory({ sessionId, cwd }, false, controller.signal).then(inventory => {
  store.reduce(state => initializeGitDefaultTabs(state, {
    cwdHasGitEntry: inventory.cwdHasGitEntry,
    editorEnabled: store.getPrefs().tabsEnabled.editor !== false,
    gitEnabled: store.getPrefs().tabsEnabled.git !== false,
  }))
})
```

On inventory failure, leave the marker false so a manual refresh/session remount can retry; do not loop in the same mount.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/state.spec.ts tests/prefs.spec.ts
pnpm --dir plugins/dsh-better-sidebar typecheck
```

Expected: PASS.

Commit:

```bash
git add plugins/dsh-better-sidebar/src/client/state.ts plugins/dsh-better-sidebar/src/client/Sidebar.tsx plugins/dsh-better-sidebar/tests/state.spec.ts plugins/dsh-better-sidebar/tests/prefs.spec.ts
git commit -m "feat(sidebar): seed source control for git sessions"
```

### Task 4: Build a pure Git change tree and semantic status model

**Files:**
- Create: `plugins/dsh-better-sidebar/src/client/git-tree.ts`
- Create: `plugins/dsh-better-sidebar/tests/git-tree.spec.ts`

**Interfaces:**
- Consumes: `GitStatusEntry` from the client API.
- Produces: `GitStatusKind`, `GitChangeNode`, `statusKind(entry, side)`, and `buildGitChangeTree(entries, side)`.

- [ ] **Step 1: Write failing tree tests**

Use an unordered list and assert deterministic folder-first output:

```ts
const tree = buildGitChangeTree([
  { path: 'src/api/client.ts', xy: ' M' },
  { path: 'README.md', xy: '??' },
  { path: 'src/index.ts', xy: 'A ' },
], 'unstaged')
expect(tree.map(node => node.name)).toEqual(['src', 'README.md'])
expect(tree[0]!.children!.map(node => node.name)).toEqual(['api', 'index.ts'])
```

Add cases for staged/unstaged filtering, `MM` appearing on both sides, deleted/conflict status, rename/copy display path, Windows separators, directory descendant paths, and deterministic status severity.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-tree.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure tree model**

Define:

```ts
export type GitSide = 'staged' | 'unstaged'
export type GitStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'
export interface GitChangeNode {
  kind: 'directory' | 'file'
  name: string
  path: string
  count: number
  status?: GitStatusKind
  entry?: GitStatusEntry
  children?: GitChangeNode[]
  conflicted: boolean
}
```

Normalize separators to `/`, reject empty/dot/parent segments defensively, merge directory prefixes through a trie, then emit immutable nodes sorted directories-first and locale-stably by name.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-tree.spec.ts
pnpm --dir plugins/dsh-better-sidebar typecheck
```

Expected: PASS.

Commit:

```bash
git add plugins/dsh-better-sidebar/src/client/git-tree.ts plugins/dsh-better-sidebar/tests/git-tree.spec.ts
git commit -m "feat(sidebar): model git changes as directory trees"
```

### Task 5: Render collapsed, colored change trees

**Files:**
- Create: `plugins/dsh-better-sidebar/src/client/GitChangeTree.tsx`
- Modify: `plugins/dsh-better-sidebar/src/client/GitView.tsx`
- Modify: `plugins/dsh-better-sidebar/src/client/sidebar.module.css`
- Modify: `plugins/dsh-better-sidebar/src/client/locales.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/locales-*.ts`
- Create: `plugins/dsh-better-sidebar/tests/git-change-tree.spec.tsx`
- Modify: `plugins/dsh-better-sidebar/tests/locales.spec.ts`

**Interfaces:**
- Consumes: `GitChangeNode` and `GitSide` from Task 4.
- Produces: `GitChangeTree` component with file/directory action callbacks.

- [ ] **Step 1: Write failing component tests**

Render a section and assert:

```ts
expect(screen.getByRole('button', { name: /Unstaged/ })).toHaveAttribute('aria-expanded', 'false')
expect(screen.queryByText('client.ts')).toBeNull()
await user.click(screen.getByRole('button', { name: /Unstaged/ }))
expect(screen.getByText('src')).toBeVisible()
expect(screen.getByText('client.ts')).toHaveAttribute('data-git-status', 'modified')
```

Also assert directory collapse, subtree stage/unstage callback paths, file Diff callback side, conflict accessible label, and that status remains readable with CSS disabled.

- [ ] **Step 2: Run component tests and verify failure**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-change-tree.spec.tsx
```

Expected: FAIL because `GitChangeTree` does not exist.

- [ ] **Step 3: Implement section and directory disclosure state**

`GitChangeTree` accepts:

```ts
interface GitChangeTreeProps {
  title: string
  side: GitSide
  nodes: readonly GitChangeNode[]
  busy: boolean
  onOpenFile(entry: GitStatusEntry, side: GitSide): void
  onTogglePath(path: string, side: GitSide): Promise<void>
  onToggleAll(side: GitSide): Promise<void>
  onContextMenu(event: MouseEvent, entry: GitStatusEntry, side: GitSide): void
}
```

The section starts closed on mount. Its first opening seeds all directory paths into an expanded set; later folder toggles affect only that component instance.

- [ ] **Step 4: Add semantic status styles**

Apply `data-git-status` to the file name and badge. Define light/dark-compatible variables for added, modified, deleted/conflicted, renamed/copied, and untracked. Keep the one-letter badge and an `aria-label` such as `Modified: src/client.ts` so color is supplementary.

- [ ] **Step 5: Replace flat GitView rows with the tree component**

Build staged and unstaged nodes through `buildGitChangeTree`. Directory actions pass the directory's repo-relative path to the same target-based stage/unstage route; file actions preserve the existing context menu and Diff behavior.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-tree.spec.ts tests/git-change-tree.spec.tsx tests/locales.spec.ts
pnpm --dir plugins/dsh-better-sidebar typecheck
```

Expected: PASS.

Commit:

```bash
git add plugins/dsh-better-sidebar/src/client/GitChangeTree.tsx plugins/dsh-better-sidebar/src/client/GitView.tsx plugins/dsh-better-sidebar/src/client/sidebar.module.css plugins/dsh-better-sidebar/src/client/locales*.ts plugins/dsh-better-sidebar/tests/git-change-tree.spec.tsx plugins/dsh-better-sidebar/tests/locales.spec.ts
git commit -m "feat(sidebar): render colored git change trees"
```

### Task 6: Add atomic repository and Worktree selection

**Files:**
- Modify: `plugins/dsh-better-sidebar/src/client/GitView.tsx`
- Modify: `plugins/dsh-better-sidebar/src/client/builtins/tabs.tsx`
- Modify: `plugins/dsh-better-sidebar/src/client/state.ts`
- Modify: `plugins/dsh-better-sidebar/src/client/DiffTab.tsx`
- Modify: `plugins/dsh-better-sidebar/tests/git-view-worktree.spec.tsx`
- Modify: `plugins/dsh-better-sidebar/tests/builtins.spec.ts`

**Interfaces:**
- Consumes: inventory and target-based APIs from Task 2; `GitChangeTree` from Task 5.
- Produces: a persisted per-tab `GitTarget` and two-level selector whose target-derived state is updated atomically.

- [ ] **Step 1: Replace worktree-only test fixtures with repository inventories**

Use two repositories, each with two worktrees. Add a stale request deferred from repository A, switch to repository B/worktree B2, resolve A late, and assert no A status, branches, history, commit errors, or selection reappears.

- [ ] **Step 2: Run the switching tests and verify failure**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-view-worktree.spec.tsx
```

Expected: FAIL because `GitView` still owns separate `repoRoot` and `selectedWorktree` path state.

- [ ] **Step 3: Replace separate selection with one target**

Use:

```ts
const [inventory, setInventory] = useState<GitWorkspaceInventory | null>(null)
const [target, setTarget] = useState<GitTarget | null>(initialTarget ?? null)
const generation = useRef(0)
```

Repository changes select the repository's current worktree; worktree changes retain the repository ID. Before any fetch, clear `status`, `branchNames`, `logEntries`, menus, and errors, then increment generation. Only responses matching the current generation and target may publish.

- [ ] **Step 4: Render ready and unavailable repository choices**

The repository selector includes root and declared submodules. Ready entries are selectable; `uninitialized` and `missing` entries display localized suffixes and are disabled. The worktree selector shows branch, basename, and changes. If the persisted target disappears, choose root/current and persist the fallback without replaying a pending write operation.

- [ ] **Step 5: Persist selection through tab metadata**

Add a typed optional `gitTarget` field to tab metadata. Pass it from the builtin Git tab descriptor to `GitView` as `initialTarget`; on selection change, patch only that tab through the store. Verify serialization/sanitization retains only string IDs.

- [ ] **Step 6: Ensure every action captures the current target**

All handlers copy `target` before awaiting. Confirm modals capture that exact target. Polls refresh status only; manual refresh requests `git.inventory?refresh=true` and then reloads the full target view.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-view-worktree.spec.tsx tests/builtins.spec.ts tests/state.spec.ts tests/smoke.spec.ts
pnpm --dir plugins/dsh-better-sidebar typecheck
```

Expected: PASS.

Commit:

```bash
git add plugins/dsh-better-sidebar/src/client/GitView.tsx plugins/dsh-better-sidebar/src/client/builtins/tabs.tsx plugins/dsh-better-sidebar/src/client/state.ts plugins/dsh-better-sidebar/src/client/DiffTab.tsx plugins/dsh-better-sidebar/tests/git-view-worktree.spec.tsx plugins/dsh-better-sidebar/tests/builtins.spec.ts
git commit -m "feat(sidebar): switch repositories and worktrees atomically"
```

### Task 7: Document, build, synchronize, and verify end to end

**Files:**
- Modify: `plugins/dsh-better-sidebar/README.md`
- Modify: `plugins/dsh-better-sidebar/README_EN.md`
- Synchronize: `/Users/chenxiaofeng/code/open/byclaw-dsh/plugins/dsh-better-sidebar/**` → `/Users/chenxiaofeng/code/open/deepseek-harness/plugins/dsh-better-sidebar/**`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: documented ByClaw source, built plugin artifacts, synchronized DSH installation, and verification evidence.

- [ ] **Step 1: Update user documentation**

Document:

- automatic Files + Source Control tabs for CWD roots with `.git`;
- root/submodule repository selector;
- per-repository linked worktree selector;
- uninitialized child behavior;
- default collapsed directory trees and status colors;
- external worktree editor restriction;
- no disk scan and no automatic submodule initialization.

- [ ] **Step 2: Run the focused feature suite**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar test -- tests/git-workspaces.spec.ts tests/smoke.spec.ts tests/state.spec.ts tests/prefs.spec.ts tests/git-tree.spec.ts tests/git-change-tree.spec.tsx tests/git-view-worktree.spec.tsx tests/builtins.spec.ts tests/locales.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run package verification**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar typecheck
pnpm --dir plugins/dsh-better-sidebar build
pnpm --dir plugins/dsh-better-sidebar check:consumer-types
git diff --check -- plugins/dsh-better-sidebar
```

Expected: all commands pass.

- [ ] **Step 4: Capture the real project read-only baseline**

Run:

```bash
git -C /Users/chenxiaofeng/code/project/20014944 status --porcelain=v1 -z > /tmp/byclaw-20014944-before.status
git -C /Users/chenxiaofeng/code/project/20014944/beyonai/byclaw-test status --porcelain=v1 -z > /tmp/byclaw-20014944-child-before.status
```

Expected: two snapshots exist; no writes occur in the project.

- [ ] **Step 5: Validate the inventory against the real project**

Use a small read-only test/script that calls `discoverGitWorkspace('/Users/chenxiaofeng/code/project/20014944', { refresh: true })` and assert:

```ts
expect(repositories.map(repo => repo.relativePath)).toContain('.')
expect(repositories.map(repo => repo.relativePath)).toContain('beyonai/byclaw-test')
expect(repositories.every(repo => repo.worktrees.length >= 1)).toBe(true)
```

Expected: root and child are ready and each exposes its current worktree.

- [ ] **Step 6: Sync the exact plugin subtree into DSH**

First verify both exact roots, then perform a mechanical mirror excluding source-repository `.git` metadata and local dependency caches:

```bash
realpath /Users/chenxiaofeng/code/open/byclaw-dsh/plugins/dsh-better-sidebar
realpath /Users/chenxiaofeng/code/open/deepseek-harness/plugins/dsh-better-sidebar
rsync -a --delete --exclude node_modules --exclude .git \
  /Users/chenxiaofeng/code/open/byclaw-dsh/plugins/dsh-better-sidebar/ \
  /Users/chenxiaofeng/code/open/deepseek-harness/plugins/dsh-better-sidebar/
```

Expected: only the named destination plugin is mirrored.

- [ ] **Step 7: Build the synchronized copy and run the Web profile smoke**

Run:

```bash
pnpm --dir plugins/dsh-better-sidebar build
pnpm dsh web
```

Working directory for these commands: `/Users/chenxiaofeng/code/open/deepseek-harness`.

Expected: DSH starts without plugin-load errors. In the browser session rooted at `/Users/chenxiaofeng/code/project/20014944`, Files and Source Control are present; repository selector contains root and `beyonai/byclaw-test`; each repository exposes its worktree; staged/unstaged sections begin collapsed and expand into colored directory trees.

- [ ] **Step 8: Prove the real project stayed unchanged**

Run:

```bash
git -C /Users/chenxiaofeng/code/project/20014944 status --porcelain=v1 -z > /tmp/byclaw-20014944-after.status
git -C /Users/chenxiaofeng/code/project/20014944/beyonai/byclaw-test status --porcelain=v1 -z > /tmp/byclaw-20014944-child-after.status
cmp /tmp/byclaw-20014944-before.status /tmp/byclaw-20014944-after.status
cmp /tmp/byclaw-20014944-child-before.status /tmp/byclaw-20014944-child-after.status
```

Expected: both `cmp` commands exit 0.

- [ ] **Step 9: Commit documentation and final feature integration**

```bash
git add plugins/dsh-better-sidebar/README.md plugins/dsh-better-sidebar/README_EN.md
git commit -m "docs(sidebar): describe git workspace controls"
```

Expected: the final ByClaw source history contains the baseline plus independently reviewable feature commits.
