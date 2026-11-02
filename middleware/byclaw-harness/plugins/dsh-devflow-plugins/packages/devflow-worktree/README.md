# @zhchxiao123/dsh-devflow-worktree

English | [中文](README.zh.md)

Worktree-per-card development: one card, one branch, one linked git worktree.
The package ships two contributions — the bundled `devflow-worktree-runbook`
skill carrying the ceremony, and a fence on the `devflow/transition`
waterfall holding a dispatched card to the worktree its dispatch names.

## Install

This package has **no bundle patch of its own**. It arrives mounted, enabled,
as the `devflow-worktree` row of
[`@zhchxiao123/dsh-devflow-bundle`](../devflow-bundle/README.md):

```sh
dsh plugin --profile web add @zhchxiao123/dsh-devflow-bundle
```

`dsh plugin --profile web add @zhchxiao123/dsh-devflow-worktree` installs the
package as a plain dependency and mounts nothing. That is a removal, not an
oversight: this package used to ship its own `cordis.patch.yml`, and it was
deleted when the bundle adopted the row. Two layers inserting one row id
compose into a duplicate the Loader refuses (`duplicate loader entry id`), so a
package is bundle-mounted or self-patched and never both —
[`tests/bundle-row-ids.spec.ts`](../../tests/bundle-row-ids.spec.ts) holds the
rule. Nothing was lost with the patch: the runbook teaches a devflow card
ceremony end to end and the fence reads the card store, so a profile with no
devflow board had no use for the standalone mount.

**If you installed this package standalone before the adoption**, your
profile's `dsh.profile.bundles` still names it. The entry now resolves to a
package with no `dsh.bundle`, and a boot fails loud with `profile bundle
"@zhchxiao123/dsh-devflow-worktree" declares no dsh.bundle in its
package.json`. Any `dsh plugin --profile <name> add …` reconciles the list and
drops the entry; adding the bundle is the one to run.

A composition assembled by hand names the plugin directly; see
[Configuration](#configuration).

## Why a worktree is already a workspace

Devflow resolves every root from the calling session's own directory
(`<cwd>/.devflow`), and `.devflow/` is committed to the repository. A linked
worktree therefore checks out a complete board: the branch carries the card,
the card's workspace is the worktree, and gate commands, review-gate
reviews, and agent-gate checkers all run there — those packages already anchor to the
parent of the card's devflow root. Nothing here changes how any consumer
resolves a directory; the package adds the process (a skill) and the one
guarantee the process cannot carry by itself (the fence).

## The ceremony

The runbook's contract, in one paragraph: bring the card to `ready` on the
main board; attach a dispatch artifact — the configured kind, default
`worktree`, with frontmatter `branch`, `base`, and `worktree` — then commit
it and `git worktree add <path> -b <branch>`, in that order. Develop in a
session whose working directory is the worktree: `devflow_take` there, commit
code and card state to the branch, drive the card through its edges. Merge
the branch to deliver code and journal together, then remove the worktree
and branch. From dispatch to merge, only the card's own worktree writes the
card — two checkouts appending one journal merge into a revision conflict
that renders the card unreadable, by design and loudly.

## The fence

On each transition the fence reads the moving card (via the optional
`devflow` service, by name), and looks for the newest artifact of the
configured kind. No such artifact: the card is untouched and the fence
delegates. Otherwise the transition's workspace — the parent of the
attempt's root — must canonicalize to the dispatch's `worktree`, or to the
repository's main working tree, derived per directory from
`git rev-parse --path-format=absolute --git-common-dir` and cached. The
main-tree admission is what lets the main checkout archive or follow up a
merged card after its worktree is deleted. Every other checkout is vetoed
with both directories named; an unreadable or malformed dispatch record also
vetoes, because a fence that guessed would wave through exactly the writes
the record exists to stop.

## The preconditions it checks

Reaching a dispatched card is also the first moment the flow's own
preconditions can be asked about mechanically, and two of the four are
questions git answers in the transition's workspace: the board is tracked
(`git ls-files`), and the card's lease is ignored (`git check-ignore`). Either
one failing is a veto carrying the command that repairs the repository,
because both otherwise fail in silence — an untracked board gives the worktree
an empty one that renumbers new cards from `0001` and collides at merge, and a
lease that travels with the branch assigns the card to a session that never
existed here. The lease probe is one representative path and the veto points
at "Commit semantics of `.devflow`" in the walkthrough for the canonical list,
which this package does not restate. Verdicts are cached per workspace
directory, and a repository git cannot answer about at all — no git, no work
tree — is admitted: a check that could not run is not a check that failed.

## Configuration

From a profile patch, addressing the bundle's row:

```yaml
- devflow-worktree:
    config:
      artifactKind: worktree   # must match the kind the artifact-gate declares
```

From a composition assembled by hand, as its own row:

```yaml
- name: '@zhchxiao123/dsh-devflow-worktree'
  # config:
  #   artifactKind: worktree
```

Declare the kind's structure in the deployment's artifact-gate so a dispatch
cannot be registered half-filled:

```yaml
kinds:
  worktree:
    frontmatter: [branch, base, worktree]
```

## Known limitations

- **The fence guards transitions only.** Artifact registration and card
  creation are not fenced: attaching from the wrong checkout is still a
  both-sides write the runbook prohibits but the fence cannot see. The
  attach plane is also the escape hatch — a moved worktree re-dispatches
  itself by attaching an artifact naming its current path — so fencing it
  would close the recovery path along with the mistake.
- **The preconditions are checked a cycle late.** The dispatch ceremony —
  attach, commit, `git worktree add` — contains no transition, so the earliest
  the fence can ask is the `devflow_take` inside the worktree, after the
  worktree exists. That is still a full development cycle before the collision
  it prevents, and the repair at that point is deleting a worktree rather than
  repairing a journal.
- **A dispatch in a non-git checkout always vetoes.** A copy of the board
  outside any git work tree has no main working tree to admit, which is the
  fail-closed reading of a checkout the ceremony never produces.
- **Worktree sessions do not see harness workspace registrations.** The
  automation, scheduler, and github-sync planes resolve the session's
  directory against the harness workspace registry, and a worktree is not
  registered there; those tools reject in a worktree session. They are
  background intake, not the development loop, and the main checkout's
  session keeps serving them.
