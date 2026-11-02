# The full devflow pipeline, as a profile patch

[`cordis.patch.yml`](cordis.patch.yml) is a complete deployment of the devflow
pipeline: every stage edge carries an artifact contract, two edges carry an
independent agent check, one edge runs the verify suite, and cards can be
dispatched to their own worktrees. It is the configuration
[`docs/devflow.md`](../../docs/devflow.md#the-artifact-contract) explains — the
document states why the layers are ordered the way they are, and this file is
the only place the configuration itself is written.

## Use it

```sh
dsh plugin --profile web add @zhchxiao123/dsh-devflow-bundle
cp examples/full-pipeline/cordis.patch.yml "$DSH_HOME/profiles/web/cordis.patch.yml"
```

The bundle mounts the rows; this patch configures them. It applies after every
bundle layer, so each entry addresses a row that already exists — which is why
it enables three rows it never names a package for. A profile that already has
a `cordis.patch.yml` appends these entries to it instead of replacing the file.

## What you still have to decide

- **`provider` on the agent-gate edges** names a subagent provider your profile
  composes. `claude` here is a placeholder for whatever yours is called; a
  provider that is not registered fails the edge closed rather than leaving it
  ungated.
- **`pnpm run verify`** is this repository's suite command. Replace it with
  yours, and keep the `timeoutMs` beside it — the shell executor's default
  sizes a check, not a test run.
- **The kind structures** (`sections`, `frontmatter`) describe what this
  project's deliverables look like. They are the vocabulary the agent gate's
  `inputs` and the model tools' preflight both read, so changing one here
  changes it everywhere.
- **Whether an approval belongs on any edge.** None is configured, and the
  comment in the file says why.

## Before the first worktree dispatch

The worktree row is mounted and enabled by the bundle, but the flow has
preconditions the configuration cannot supply:

1. `.devflow/tasks/` is committed, and process-transient card state is ignored.
   Both patterns come from the canonical snippet under ["Commit semantics of
   `.devflow`"](../../docs/devflow.md#devflow-commit-semantics), which is where
   they are written. The fence checks these two on a dispatched card's first
   transition and vetoes with the repairing command.
2. A review edge guarded by `dsh-devflow-review-gate` configures `baseRef`, and
   worktrees live outside the main checkout. Neither is answerable from the
   repository, so both stay the runbook's prose.
3. Web acceptance runs [midscene](../../packages/devflow-midscene/README.md) in
   project mode. That package is installed separately — it needs a browser and
   a vision-model endpoint the bundle cannot provide — and a legacy profile's
   fixed `workspace` names the main checkout, so a dispatched card would fail
   its scope check.

The `devflow-worktree-runbook` skill carries the ceremony itself.

## This is a sample, not a fixture

No test reads this file. The composition tests under
[`tests/`](../../tests/) build their own minimal shapes, because a sample is
edited for a person reading it and a fixture is edited for the smallest thing
that can decide a question. Keeping them separate is what lets this file grow a
comment without a test changing.
