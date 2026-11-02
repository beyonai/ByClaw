# @zhchxiao123/dsh-devflow-bundle

One-command install for the [devflow](../../README.md) plugin line. This package has no behavior of its own — its substance is `cordis.patch.yml`, the mount list that `dsh plugin add` applies to a profile.

## Install

```sh
dsh plugin --profile web add @zhchxiao123/dsh-devflow-bundle
```

That is the whole install. `dsh plugin add` forwards to pnpm, then reconciles the profile's `dsh.profile.bundles` layer stack against what got installed: a dependency whose manifest declares `dsh.bundle` joins the stack, so this package appends itself and its patch mounts every row below. No profile file to edit.

## What it mounts

| Row | Enabled | Why |
|---|---|---|
| `devflow` (the filesystem store) | yes | `root` unset on purpose: each caller's own workspace resolves it, which is what lets one harness serve many projects |
| `devflow-tool` | yes | the model-facing plane |
| `devflow-guidance` | yes | the bundled `devflow-workflow`, `devflow-spec-authoring`, and `devflow-spec-bootstrap` skills (cross-tool judgment behind catalog lines, loaded on demand; the latter two register only while `devflowSpec` is mounted) and the capped `devflow-board` runtime-context snapshot; enforcement never depends on any of them |
| `devflow-worktree` | yes | worktree-per-card: the `devflow-worktree-runbook` skill and the fence holding a dispatched card to its own worktree. A card with no `worktree` dispatch artifact is untouched, so the row costs nothing until one is dispatched — and leaving it out is what keeps most deployments from knowing the capability exists, when it is the answer to the one limitation `devflow-review-gate` records about itself |
| `devflow-command` | yes | the `/devflow` intervention plane |
| `devflow-fs-guard` | yes | keeps the store the only write path over card history |
| `devflow-spec` (the document store) | yes | a workspace with no `.devflow/spec/` simply has no documents; leaving it out is what removes a capability, since the card tools and `/devflow spec` both read it opportunistically |
| `devflow-spec-tool` | yes | `devflow_write_spec` / `devflow_read_spec` — the only write path to those documents |
| `devflow-spec-sentinel` | yes | the session-hosted spec lifecycle: one forced continuation step when a turn's edits leave an anchored document stale (once per document per session), the per-session `devflow-spec-map` index, and the `devflowSpecWorkspace` layout service the census reads; inert without the seam or a `.devflow/spec/`, and a deployment that wants no steering disables this one row |
| `devflow-iron-rules` | yes | inert without a `.devflow/iron-rules/` directory; a repository that carries rules WILL have their check scripts executed, so disable this row where checkouts are untrusted |
| `devflow-artifact-gate` | **no** | an empty spec set gates nothing, and which artifact kinds guard which edge is a project decision |
| `devflow-agent-gate` | **no** | it spends model budget on every checked move, and which edges are worth paying a checker for is a project decision |
| `devflow-gates` | **no** | an empty gate set vetoes nothing, and which commands guard which edge is a project decision |
| `devflow-review-gate` | **no** | it needs the external `ocr` binary, which this line neither ships nor installs |
| `devflow-parent-gate` | yes | completion policy for decomposed requirements |
| `devflow-web` | yes | the board's host half — the read route and the change stream |
| `devflow-ui` | yes | the board itself, browser half |

The four transition policies are mounted in the waterfall order the [walkthrough](../../docs/devflow.md#the-artifact-contract) explains — mechanical artifact contract, agent admission, command gates and approvals, completion — and enabling a row keeps its place in that order.

`devflow-worktree` sits ahead of them for the same reason they are ordered at all: its fence is a `devflow/transition` listener too, and a card being written from a checkout that may not write it is a cheaper answer than any structure check, checker, or test suite that would otherwise run first. Moving the row past them reverses that silently.

**A package is mounted here XOR it ships its own `cordis.patch.yml`, never both.** Profile layers are applied by appending each layer's `insert` rows with no deduplication, so a profile holding this bundle and a package that also patches itself composes two rows of one id — and the Loader refuses the whole composition with `duplicate loader entry id`, from two installs that each worked alone. Adopting a package into this list therefore means deleting its own patch in the same change; [`tests/bundle-row-ids.spec.ts`](../../tests/bundle-row-ids.spec.ts) holds the rule, naming the offending id and both carriers when it breaks.

**What is worth that trade is decided by mounting cost, and by whether the standalone path has a current owner.** A row that needs nothing configured to be harmless belongs here; a row whose empty configuration would enforce something ships `disabled: true` with the reason above. Three packages of this line stay out. [`devflow-midscene`](../devflow-midscene/README.md) needs Node 24, Playwright, a chromium, and a vision-model endpoint, none of which this package can install, and [`devflow-deploy`](../devflow-deploy/README.md) has no fallback default for the server address and remote layout its config requires, which is why its own patch ships its row disabled — both fail the first test. [`devflow-testenv`](../devflow-testenv/README.md) fails the second: its runbook bootstraps an e2e environment and names no card, so a profile that never mounts a board still wants it, and adopting it would buy discoverability by deleting a path that works. All three install with one `dsh plugin add` of their own.

`devflow-worktree` is the package that made the rule visible. Its runbook teaches a devflow card ceremony end to end and its fence reads the card store, so a profile without a board had nothing to do with its standalone mount; that patch was deleted when this bundle adopted the row, and `dsh plugin add @zhchxiao123/dsh-devflow-worktree` now installs a plain dependency that mounts nothing.

Every row keeps the controls it would have had if you had composed it by hand. Override any of them from your profile's own `cordis.patch.yml`, which applies after every bundle layer:

```yaml
- devflow-gates:
    disabled: false
    config:
      edges:
        'developing->reviewing': ['pnpm run test']
      approvals: ['reviewing->testing']
```

[`examples/full-pipeline/cordis.patch.yml`](../../examples/full-pipeline/cordis.patch.yml) is a whole profile patch in this form: it enables and configures every row this table ships disabled.

## Model Experience

None, as this package contributes a mount list and registers no prompt, schema, or tool. The model-facing surface belongs to [`dsh-devflow-tool`](../devflow-tool/README.md) and, for the skill catalog, [`dsh-devflow-guidance`](../devflow-guidance/README.md).

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Gate defaults are off** — a bundle cannot know a project's artifact contract, test commands, or model budget, so the rows that need those answers (`devflow-artifact-gate`, `devflow-agent-gate`, `devflow-gates`) ship disabled rather than guessing. [`examples/full-pipeline/cordis.patch.yml`](../../examples/full-pipeline/cordis.patch.yml) is a complete configuration to copy, and [the walkthrough](../../docs/devflow.md#the-artifact-contract) says why it is configured that way. The Harness agent remains the sole workflow executor.
