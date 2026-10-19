# @zhchxiao123/dsh-devflow-command

English | [中文](README.zh.md)

Human-facing `/devflow` intervention over the [`ctx.devflow`](../devflow/README.md) task-card seam. The plugin registers one global command through [`ctx.commands`](../../interaction/commands/README.md), so every composed command adapter discovers and executes it without a model turn. This is the deterministic plane of the devflow design: the model moves cards through [`dsh-tool-devflow`](../tool-devflow/README.md), the Web header board renders read-only, and `/devflow` covers the interventions that must not depend on a model — inspection, stage moves, lease eviction, archiving, and the two read-only health reports (`spec` and `doctor`), which change nothing at all. Every journaled effect carries the actor `{ "kind": "command", "name": "devflow" }`.

## Command contract

| Input | Result |
|---|---|
| `/devflow` | The board: one line per active card — id, location (a blocked card shows its interrupted stage), revision, and title. Children sit indented under the requirement they decompose; a child whose parent left the active set keeps its backlink on its own line. An empty board says so. |
| `/devflow show <id>` | One card: its board line, its parent backlink or its indented breakdown, registered artifacts, the reason it was abandoned when it was, and Markdown body. Reads an archived card too. |
| `/devflow move <id> <stage> [reason]` | One transition through the ordinary executor at the card's current revision. Edge legality, rework `reason` requirements, and the `devflow/transition` gates still decide — the command holds no bypass; a domain rejection returns the seam's message as a direct error. |
| `/devflow takeover <id>` | Forces the lease: any past heartbeat counts as stale, the eviction is journaled as `claim-expired`, and the lease is released immediately, so the evicted holder's next revision-checked commit fails. |
| `/devflow archive` | Sweeps every eligible `done` card into the archive and reports the archived ids. |
| `/devflow archive <id>` | Files one card, with its finished sub-requirements. Each refusal names the next thing to do: a card that is not `done` reports where it is, a slice whose requirement is still open names that requirement, and one already filed points at `/devflow archived`. |
| `/devflow restore <id>` | Brings one archived card back to the board **at the stage its journal already recorded** — restoring returns it to view, not to work, so a card that needs more takes an ordinary rework move. An abandoned card is refused: that decision is terminal. |
| `/devflow archived [<YYYY-MM>]` | The archive, newest bucket first: one line per filed card, tagged `[archived <month>]` or `[abandoned <month>]` because only the first can be restored. A month narrows to one bucket. A page cut short by the store's limit ends with the exact command that continues it. |
| `/devflow archived --cursor <cursor>` | The next page. The cursor is the store's own encoding, passed back whole — this plane neither builds nor parses one. |
| `/devflow spec` | Reports architecture-document health: how many documents are fresh, which are stale or unevaluable **and which anchor failed**, then a coverage census placing every expected scope in one of three states — documented, waived by a named document, or no document — each measured over that scope's anchorable-file count, and naming who defined the expectation (`configured`, or `discovered via <the detectors that answered>`; a discovery that fell back to the root package says so). A covered scope whose documents all rest on churn anchors is footnoted `churn-only; freshness lags commits`. Read-only, and an error rather than an empty report when no document seam is mounted. |
| `/devflow doctor` | Reports deployment health in five sections: **Board** (the two dispatch preconditions, asked through the worktree fence's own checker so a report and a veto say one thing in one wording), **Leases** (every held card with its holder and the age of its heartbeat — rendered, never judged, and never reclaimed), **Worktrees** (each dispatched card's worktree, with "does the path exist" and "does git know it as a linked worktree" answered separately, because a plain directory there passes the fence while carrying none of the card's branch), **Gates** (which optional planes are mounted, and what `.devflow/validation.json` requires), and **Not asked**. Read-only, with no `--fix`. |

**The `Not asked` section is a primary output, not a footnote.** It always renders, and it lists every question the run did not answer: which validators are actually available (`ValidatorRegistry` publishes no enumeration), how each gate is configured at the edge (`devflow-gates` provides only a registry; the review and agent gates provide nothing, so whether the review edge carries a `baseRef` is unreadable), which artifact kind this deployment dispatches with (the plugin's `worktree` default is assumed), and what `.gitignore` means (only `git check-ignore` is asked). Anything the run itself could not reach joins the list — a workspace with no board, a directory git cannot answer about, a policy file in a shape `devflow-gates` would reject. A report that rendered "could not check" as "no problem" would be worse than no report, which is the position `/devflow spec` already takes about coverage it cannot measure.

An unknown sub-command, a malformed argument list, or a target that is neither a stage nor `blocked` returns a direct usage error before touching the store.

Every sub-command operates on the invoking session's workspace root: a session whose header carries a `cwd` reads and writes `<cwd>/.devflow`, and a session without one uses the store's configured default root — so `/devflow` and the model tools of the same session always see the same board.

## Composition

The producer injects `commands` and `devflow`. A custom app mounts their owners plus this plugin:

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
- id: command-devflow
  name: '@zhchxiao123/dsh-devflow-command'
  config:
    # Optional: override the discovered scope set. Only `/devflow spec` reads
    # these, and configuring any replaces workspace-layout discovery whole.
    specScopes: ['@scope/pkg-a', '@scope/pkg-b']
```

The expected scope set is discovered before it is configured. With no `specScopes`, the census asks the optional `devflowSpecWorkspace` service — published by [`dsh-devflow-spec-sentinel`](../devflow-spec-sentinel/README.md) — for the invoking workspace's package layout and treats its scope ids as the expected set, labeled with the ecosystem detectors that answered, for example `discovered via pnpm-workspace, pyproject`. When no workspace manifest was recognized and discovery stood on the root package alone, the label says exactly that — `fell back to the repository root — no workspace manifest recognized` — rather than dressing a fallback up as discovery; against an older sentinel whose service predates the detector-detail face, the coarser `discovered from workspace layout` stands. Configuring `specScopes` overrides that discovery whole, not as a union: a deployment that lists scopes is saying "ask about exactly these", which includes the right to leave a discovered package unasked, and the report then says `configured`. With neither source — or when the layout resolves to no packages — the report says the coverage question was not asked, which is not the same as saying there are no gaps.

`/devflow spec` reads `ctx.devflowSpec` opportunistically and derives the report from the seam's existing read face — the per-document freshness roll-up, per-anchor verdicts for anything not fresh, and each summary's `waives` — so the store gains no method for a report one consumer wants. Coverage is also qualified, not just counted: a scope whose documents all rest on churn anchors is listed under `covered only by churn anchors` with the footnote `churn-only; freshness lags commits`, because staleness there shows only after a commit and the turn-end sentinel never fires — presenting such a scope with symbol-anchored confidence would overstate it. Its closing line is an instruction rather than a tally: a casualty list that ends without one trains everyone to accept a document set that is quietly decaying.

**The census answers three questions per scope, not one.** Every expected scope gets a line reading `N document(s)`, `waived by <document ids>`, or `no document`, under a tally of the three. The waived state is what a document's `waives` field buys: a deliberate decision that a scope needs no architecture document, carried by a document that had to say why and anchor the reason. Only `no document` is a gap — the closing "merge, retire, or write what is missing" never counts a waived scope, because pushing a decision already made back into the backlog undoes it. A waiver whose document is no longer `fresh` is reported as `waiver in doubt` and gets its own closing instruction: the reasoning rests on code that has since moved, so the decision is re-made rather than filled in. Nothing is folded away silently — a waiver naming a scope the expectation never asks about is listed separately (otherwise its author keeps believing it decided something), several documents waiving one scope are all named, and a scope holding both a document and a waiver is reported as documented with the overtaken waiver named, so it can be retired.

**Every line carries the anchorable-file count it is measured over, and no count decides anything.** The extensions come from the mounted provider's `anchorableExtensions` — the languages its evaluators actually read — so a sixth language moves these numbers with no edit here. Dot directories and `node_modules` are skipped whole, `.gitignore` is not parsed, a member directory that will not open says `could not read <dir>` rather than counting zero, one scope's several member directories sum into one count, and a nested scope's files belong to the innermost expected scope so a monorepo root does not inflate. **It is a denominator, not a threshold**: three documents over 360 anchorable files and three over 12 are different situations, and telling them apart is the judgement this report hands back — the same line the seam's structural contract draws when it declines to check whether each claim carries an anchor. Configuring `specScopes` gives the counts up, because an id names no directory, and the report says so instead of printing zeros. The walk runs only on this human-invoked command; nothing on the pre-step or turn-end path counts files.

## Model Experience

### Human `/devflow` intervention

#### What the model sees

Nothing directly: the slash input and its direct output are absent from model requests. A committed intervention lands in the card journal, so a model that later reads the board through the `dsh-tool-devflow` tools sees the new location and the `command devflow` actor like any other journal history.

#### Token effect

None. Board and card output is direct command text; later devflow tool reads bill as those tools' results.

#### KV Cache effect

None; command discovery, execution, and output never enter a provider request.

## Known Limitations and Deferred Work

- **No card creation or editing** — the command intervenes on existing cards; authoring `card.md` and its journal stays outside the seam.
- **Takeover trusts heartbeat timestamps** — staleness is a strict age comparison, so a heartbeat written in the same millisecond or carrying a future timestamp still counts as live and the takeover reports the holder instead.
- **Command adapters ship only in the Web client** — the headless, ACP automation, and JSON-RPC apps do not consume `ctx.commands`; there, interventions go through the model tools or directly on disk.
