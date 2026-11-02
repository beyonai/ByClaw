# Agent Note: the deploy target-type seam and its inverted lifecycle

Status: implemented

## Problem

"Deploy" is not one capability. Publishing a static site, restarting a
container behind a new image, and running a cluster playbook differ most where
it matters least visibly: **what each promises about going back**. A symlink
rename is atomic and lossless; a container swap interrupts service; a cluster
migration is frequently not reversible at all.

A single `deploy_rollback` that serves all three promises nothing. A caller who
learned that rollback is safe from the static case will reach for it against a
cluster, and the tool will have encouraged that.

Deployment also inverts the lifecycle rule this line follows everywhere else.
[`devflow-testenv`](2026-09-01-testenv-orchestration-scope-and-up-rule.md)
registers its environment as an effect so that disposing the fiber guarantees
nothing is left running. Deployment's core promise is the opposite: what it
publishes must **outlive** the session, the fiber, and the harness process.

## Decision

`@zhchxiao123/dsh-devflow-deploy` is a core plus registered drivers. A
`deploy.yml` names targets by `kind`; the driver registered for that kind owns
the manifest fields the core does not, and executes them.

**The rollback promise is a first-class, per-driver, queryable fact.**

```ts
type RollbackClass =
  | { kind: 'atomic' }
  | { kind: 'disruptive'; note: string }
  | { kind: 'unsupported'; reason: string }
```

`deploy_status` renders it, so a caller knows before it tries. A rollback asked
of an `unsupported` kind fails loud with the driver's reason and issues no
remote command.

The honesty is enforced by the type system rather than by driver authors:
`TargetDriver.rollback` is optional, **absence is what `unsupported` means**,
and `DriverRegistry.register` refuses a driver whose promise and implementation
disagree. A kind cannot advertise a rollback it did not write.

**One closed phase vocabulary** — `resolve → build → preflight → transfer →
activate → verify → prune` — spans every kind, so failure reports and renders
carry no per-kind branch. `preflight` is a semantic boundary: a failure at or
before it leaves the far side untouched, and each driver is verified against
that separately.

**Release identifiers are opaque to the core.** `static` uses a timestamped
directory name; a container kind would use an image tag. The core neither
parses them nor assumes they sort — ordering is whatever the driver returned.

**Nothing on the far side is ever an effect.** `apply()` registers the tools,
the skill provider, and the driver, and that is all. Disposing the fiber removes
those three and leaves every published release exactly where it is.

## The seam is exercised, not speculative

The `static` driver lives in the same package but reaches the core only through
`registerDriver`. The core files contain no kind name, and a fake driver in
`tests/` obtains deploy, status, rollback, and rendering by registration alone,
with no change under `src/`.

That the vocabulary survives a genuinely different mechanism is the evidence
that matters: `static` transfers files with `rsync` and switches with a symlink
rename, while the planned container kind ships an image and switches by
rewriting a tag — same phases, no shared code, no core branch.

## Alternatives considered

**One driver, `kind` switched inside it.** Rejected: the core would then know
`dir`, `entry`, and every later kind's fields, and adding a kind would be a
change to the core — the opposite of what the seam is for.

**A separate package per driver.** Rejected for now: three packages for one
driver buys nothing, and the registry already makes extracting one later a move
rather than a redesign.

**A uniform rollback with a runtime "can I?" check.** Rejected: a promise
discovered at call time is discovered too late. Declaring it statically is what
lets `deploy_status` warn in advance.

**Enforcing the promise/implementation agreement in the `./invariant`
companion.** Rejected on inspection: `ctx.invariants` observes runtime event and
data relations, and this package publishes no event stream. The relation is
structural to the registration itself, so `register` checks it at the earliest
resolvable point, and the companion carries a reason naming where the real check
lives.

## Consequences

Adding a deployment kind is a registration and a driver module; the tools, the
renders, and the failure vocabulary come free, and the new kind is forced to
state what it promises about going back.

The cost is one indirection between a tool call and the code that does the work,
and a core that cannot validate a driver's manifest fields — a malformed `dir`
is reported by the driver, not by the manifest parser. Field-path issue
reporting is duplicated at the two layers to keep those messages uniform.

Because remote state is deliberately not an effect, this package has no
mechanical guarantee against leaving things behind. That is the promise, not an
oversight, and the real-composition suite pins it: after `dispose`, the tools
and the skill are gone and the published release is still serving.
