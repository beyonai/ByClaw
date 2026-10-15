# Agent Note: a gate's artifacts belong under the card's devflow root

Status: implemented

## Problem

Three gates on the `devflow/transition` waterfall each wrote something durable
to a directory the deployment named: `devflow-agent-gate` and
`devflow-review-gate` their reports and verdict caches, `devflow-gates` its
failure logs. All three built the path with a bare `join(dir, name)` and no
base, so a relative value resolved against the **harness process's cwd** —
neither the project nor the card's own root.

That was wrong three ways, one of them a security problem.

**The reports were not protected.** `devflow-fs-guard` denies the agent's file
tools any mutation under `.devflow`. Every shipped example put these artifacts
somewhere else — `.devflow-agent-gate-reports`, and `docs/devflow.md`'s own
sample used the relative `.devflow/reports`. So the agent whose work a gate had
just rejected could rewrite the report saying so. A gate exists precisely so
the reviewed party does not get to certify itself; keeping the only evidence
where that party can edit it gave the whole arrangement away.

**One value could not serve many projects.** The bundle leaves the store's
`root` unset on purpose so each caller's workspace resolves it — that is what
lets one harness serve several checkouts. But each of these fields held a
single value, and report names are `<card>-<from>-<to>-r<rev>`: two projects
both holding `0001-x` overwrote each other.

**And the value was never a deployment's to make.** `AGENTS.md` scopes config
to deployment-varying choices. This one varies with the card, and every gate
already had the card: `attempt.root` is typed "The resolved devflow root
(absolute path)" and is present on every attempt.

## Decision

The three gates derive their locations from `attempt.root`, and the three
fields — `reportDir`, `verdictCacheDir`, `failureLogDir` — are **removed**.

```
<devflow root>/
  tasks/  archive/                    # the store's own
  reports/<gate>/<card>-<from>-<to>-r<rev>.<ext>
  cache/<gate>/<key-hash>.json
```

Inside the root, so `devflow-fs-guard` covers it without anyone configuring
anything — the same reasoning `devflow-spec-filesystem` already records for its
own default ("sits inside `.devflow/` so the fs guard's protection covers it
without extra config"). The guard stops the tool executor, not `node:fs`, so a
gate writing host-side is unaffected: the agent cannot, the gate can.

Grouped by purpose rather than by gate, because the root's existing neighbours
(`tasks/`, `archive/`) are named for what they hold. Reports are kept apart
from caches because the two are disposed of oppositely — evidence to keep
versus an optimization to delete whenever.

**Removed, not accepted-and-ignored.** A deployment that kept the field would
go on believing its artifacts land where it said and find out only when it
needed one. The load fails, names the field, says where the artifact lives now,
and leaves the old directory's disposal to its owner. The message survives the
Loader's wrapping intact — confirmed by the composition suite, which failed
with exactly that text nested two `failed to apply loader entry` layers deep.

Doing it now was free for `devflow-review-gate` (never published) and cheap for
the other two: `0.4.0` has not been released — `latest` is `0.3.0` and the
`0.4.0-dev.*` line publishes to the `dev` dist-tag — so this is a behaviour
change inside an unreleased pre-1.0 minor rather than a break mid-version.

### Two behaviour changes came with the locations

**Both verdict caches lost their off switch.** They were opt-in through their
directory field; with the location derived there is no "unset" left. Switching
one off buys no correctness — faults are never cached, a corrupt record reads
as a miss, an unwritable cache only warns — so the only thing it bought was
paying for a full checker fan-out on every rework attempt. Clearing a cache is
now deleting its directory.

**`devflow-gates` now always writes the failure log.** Unset used to mean *no
log at all*, leaving a truncated 2000-character summary as the only account of
why a gate refused — the same "evidence missing exactly when needed" that
`devflow-review-gate` had already rejected for its reports.

> The counter-argument, recorded because it may yet win: a gate command can be
> an entire test suite, so always-write grows without a ceiling. It writes only
> on failure and only for the commands that failed, and a persistently failing
> gate is the thing to fix rather than the thing to stop logging. If that turns
> out wrong, a boolean `failureLog` is a legitimate deployment choice (disk
> budget genuinely varies) — but it needs a consumer first.

## Alternatives considered

- **Resolve relative values against `attempt.root`, keep the fields.** Fixes
  the collisions and the guard gap while leaving a knob nobody needs, and still
  lets a deployment point the artifacts outside the protected root — which is
  the defect, not a feature.
- **Change `devflow-review-gate` only, as the model for the others.** Its being
  unpublished made it free, and the plan started there. Discarded once the
  version facts were checked: leaving two packages on the old rule would put
  two path conventions in one repository, which is harder to explain than
  either rule alone.
- **Keep `failureLogDir`'s opt-out as a boolean.** Rejected for now under
  "require a current owner and need" — see the recorded counter-argument above.
- **Put the artifacts in the workspace (`dirname(attempt.root)`).** Tidier for
  a human browsing the project, and useless: outside the root, `fs-guard` does
  not reach them.

## Consequences

- The agent under review can no longer rewrite the record of its own review.
- One harness serving several projects keeps each project's artifacts in that
  project, with no path on which to collide.
- Three fields fewer to document, validate, and get wrong; `devflow-agent-gate`
  also loses its "required field" load check, and `devflow-review-gate` its
  "configured edge implies a report directory" rule.
- A deployment carrying any of the three fields fails to load until it removes
  them. That is the intended migration signal.
- `docs/devflow.md` and `.zh.md` lose those lines from the deployment sample.
  `tests/spec-bootstrap-board-composition.spec.ts` reads that sample and boots
  it through the real Loader, so the document and the suite had to move
  together — which is the point of that suite.
- The three gates still differ in how hard a write failure bites:
  `review-gate` and `agent-gate` fail closed, `devflow-gates` warns and keeps
  the veto. Deliberate, and left alone.
