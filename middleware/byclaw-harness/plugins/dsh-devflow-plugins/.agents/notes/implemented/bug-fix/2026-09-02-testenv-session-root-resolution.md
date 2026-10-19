# Agent Note: devflow-testenv — the workspace root resolves per call from the session cwd

Status: implemented

*Superseded 2026-09-11: the testenv executor this note describes is deleted; the
package is now the `devflow-e2e-bootstrap-runbook` skill alone — see [testenv
retreats from executor to one runbook skill](../feature/2026-09-11-testenv-retreats-to-runbook-skill.md). Kept for the reasoning a
future executor would face again.*

English | [中文](2026-09-02-testenv-session-root-resolution.zh.md)

## Problem

The plugin captured its workspace root once, at apply time, from the harness
process cwd (`resolve('.')` in `src/index.ts`), and handed it to a single
engine that resolved the manifest path and every service cwd against it. The
[orchestration-scope note](../feature/2026-09-01-testenv-orchestration-scope-and-up-rule.md)
reasoned that "the harness runs with its cwd at the workspace root" — the same
assumption `devflow-filesystem`'s default root rests on.

Real deployment disproved the assumption. A long-lived harness process runs
with its cwd at the **harness checkout**, and every agent session brings its
own workspace as session metadata — so every session's `testenv.yml` resolved
into the harness checkout, no matter which project the session was working on.
The observed failure mode was worse than an error: a model, told the manifest
was missing at the wrongly-resolved path, wrote a shim manifest full of
absolute paths **into the harness checkout** to make the tools work. The
plugin's own product line already held the correct precedent: `devflow-tool`
resolves its per-workspace root from `exec.agent.session.header.cwd` on every
call, and `devflow-bundle` omits a configured root for exactly this reason
("each caller's own workspace resolves it — which is what makes one harness
serve many projects").

## Decision

**The workspace root resolves per call, from the calling agent session's
working directory.** Every tool execution reads
`exec.agent?.session.header.cwd` first (the `devflow-tool` source, validated
absolute at the session boundary) and normalizes it with `path.resolve`. A
call that carries no session cwd — a non-agent caller, or a session created
without one — fails loud, naming both missing-cwd shapes and stating that the
harness process cwd is deliberately not a fallback. Falling back would
silently reintroduce the defect for exactly the callers most likely to hit it.

**One engine per workspace root.** `apply()` builds a lazy
`Map<root, TestenvEngine>`; the "single environment instance" semantic becomes
*one per workspace*. Each engine still registers its running environment as a
`ctx.effect()` on the plugin fiber, so one fiber disposal tears every
workspace's environment down, while `env_down` tears down only the caller's.
Sessions whose cwds resolve to the same root share one engine and its single
environment — either session's `env_down` tears the shared environment down.
The map itself holds no processes and needs no effect of its own.

**Normalization is `resolve`, not `realpath`.** The session boundary already
validates the cwd as absolute; `resolve` only folds `.`/`..` and trailing
separators into a stable map key. Chasing symlinks would split "the path the
session declared" from "the path the engine runs at" and add per-call
filesystem access; two spellings of one directory through different symlinks
therefore get two engines — a documented boundary, matching how
`devflow-filesystem` treats its root.

**Every background job is owned now.** Root resolution requires an owning
agent session on every call, and the same `exec.agent` becomes the
`integration_test` job's owner — so the jobs registry's ownership fence
applies to every registry read. The previously reachable "unowned job from an
agent-less call" shape no longer arises from these tools.

## Alternatives considered

**A `Config` field for the root.** Rejected before for duplicating what the
cwd names; doubly wrong now — one configured root still serves only one
workspace per composition, which is the defect with extra steps.

**Falling back to the process cwd when the session has none.** Silently wrong
in the deployed shape; the shim-manifest incident is what "diagnosable but
tolerated" resolution actually produces. The error text carries the repair
(call from an agent session created with a workspace cwd) instead.

**An explicit root tool parameter.** Hands the model a path decision the
session already made, and invites exactly the cross-workspace confusion the
session fence exists to prevent (PRD R6).

**`realpath` normalization of the map key.** See above; rejected for splitting
declared and executed paths and for per-call filesystem access.

## Testing

`tests/plugin-shape.spec.ts` pins the deployment shape itself: the process cwd
points at a fake harness checkout holding a decoy manifest while the calling
session's cwd is the workspace — `env_up` runs the workspace's manifest, the
marker lands in the workspace, the decoy is unread and the checkout untouched;
its previous "chdir round-trip proves apply-time capture" test died with the
behavior it proved. Its companion pins the fail-loud text for both missing-cwd
shapes. `tests/tools.spec.ts` drives two workspaces through one registration
(isolated `env_up`/`env_status`/`env_down`) and the resolve-normalization
sharing; `tests/loader-composition.spec.ts` boots the real Loader with the
agent registry, runs two session workspaces at once, proves A's teardown is
invisible to B, and disposes both environments — every pid asserted dead —
through one fiber disposal. The background suites carry the owned-job
consequence: readers pass the calling agent through the ownership fence.

## Consequences

One harness serves many project workspaces, which is the plugin's reason to
exist in its real deployment. The tools now require an owning agent session
where they previously ran for any caller — programmatic callers without a
session cwd get the fail-loud error, which is intended: there is no honest
root to give them. Per-root engines mean per-root `Config` is *not*
differentiated (one composition-wide `Config` serves every workspace; PRD R6),
and a session whose cwd changes mid-life would address a different engine —
session cwd is creation metadata, so this does not arise today. The bundled
skill now states the discipline the incident taught: `testenv.yml` belongs
only at the session's workspace root, and a manifest resolved anywhere else is
a deployment defect to report, never to shim around.
