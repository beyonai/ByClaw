# Agent Note: testenv retreats from executor to one runbook skill

Status: implemented

English | [中文](2026-09-11-testenv-retreats-to-runbook-skill.zh.md)

## Problem

`devflow-testenv` executed integration environments: a `testenv.yml` manifest
naming ordered services and readiness probes, an engine that started them,
polled the probes, rolled back on failure and tore down in reverse, five tools
(`env_up`, `env_status`, `env_logs`, `env_down`, `integration_test`) over
`ctx.subprocess`, a background-job path through `ctx.jobs`, and one engine per
workspace root so a long-lived harness could serve many projects. About 2200
lines of source and 3350 of tests.

Every one of those pieces was a maintained contract: manifest semantics, the
one rule covering self-exiting and long-lived `up` commands, process-tree
termination and its grace, the in-memory log tail and its offsets, job status
mapping, the session-cwd root resolution that a defect had already forced a
rewrite of. The capability it bought — deterministic replay of a start
sequence — is real, but the sequence still had to be discovered by an agent
first, written into the manifest, and proven; and the manifest could only
express what the schema had a field for.

Two things about the surrounding world had also changed. The knowledge worth
keeping is not "a list of services and ports" but the whole runbook: the
success signal per step, cold versus warm timings, the failures met and their
fixes, which dependency can be mocked, which step needs the network. And the
place that knowledge belongs is the project's own repository, where it is
reviewed, versioned, and readable without this plugin mounted at all.

## Decision

**The executor is deleted. The package is now one bundled skill.**

`devflow-e2e-bootstrap-runbook` teaches an agent to produce and maintain a
runbook the target repository carries: one `e2e/` directory holding
`README.md` beside `up.sh`, `check.sh`, and `down.sh`. Six phases — recon (CI
configuration first, because a passing job proves its own commands), real
bring-up recorded step by step, a three-layer health probe whose every
assertion is falsified by stopping its component, profile identification,
scripts-then-document authoring, and a clean-room re-run reading only the
document. The load-bearing rule is that every command in the runbook is one
the author actually ran: a runbook inferred from source is worse than none,
because the next agent trusts it and fails invisibly. Steps that cannot be
verified in the current environment are marked `[未验证]` with the reason,
never promoted to fact.

`packages/devflow-testenv/src/` keeps `index.ts`, `skill.ts`, and
`invariant.ts`; `engine.ts`, `manifest.ts`, `probes.ts`, `tools.ts`, and
`types.ts` are gone, with their four suites. `inject` narrows from
`['tools', 'subprocess', 'skills']` to `['skills']`; `Config` loses all seven
execution tunables and becomes empty; the `yaml` dependency and the
subprocess, tools, and jobs peers go with the code. The registration follows
[devflow-guidance](../../../../packages/devflow-guidance/src/skill.ts)'s
one-provider-per-skill shape rather than testenv's former shared provider,
because override is by name and a provider named after its skill says so.

Four choices inside the decision:

**The package name stays.** `@zhchxiao123/dsh-devflow-testenv`, the cordis
plugin name `testenv`, and the bundle patch id are unchanged. The name no
longer matches the capability, and both READMEs say so. Renaming would break
the published name and every profile that installs it, for a naming
improvement — the wrong trade while the package is already changing shape
underneath its consumers.

**The skill body ships in Chinese.** It was written as Chinese prose and the
text is the contract; translating it would be a rewrite performed by someone
other than its author. The module doc and both READMEs record this as
deliberate so no later change "fixes" the language.

**The deliverable is one `e2e/` directory.** The author's original split it
across `docs/agent/e2e-setup.md` and `scripts/e2e/`; consolidating puts the
document beside the scripts it must match word for word — the body's own
most-violated rule, whose observed failure mode is a path or a number drifting
between the two. `e2e/` colliding with a repository that already keeps
Playwright or Cypress specs there is the good case, not a conflict: the
runbook describes how to bring up the environment those very tests need.
`README.md` rather than `setup.md` because a directory's README renders on
sight in a web UI, and the body already mandates the `CLAUDE.md` / `AGENTS.md`
pointer that routes agents. The skill name and these paths are the only two
departures from the author's text.

**No deprecation period and no shim.** A composition upgrading past
`0.4.0-dev.7` loses the `env_*` tools outright. A compatibility layer would
have to keep the engine alive to mean anything, which is the thing being
removed.

## Alternatives considered

**Keep the executor and add the skill beside it.** The two overlap at exactly
the point that matters: both answer "how does this system start", one into a
schema and one into a script the project keeps. Carrying both would leave the
manifest's maintenance cost in place while the runbook made it redundant, and
would force every project to choose a lane with no rule for choosing.

**Keep the manifest as the runbook's data format** — the skill writes
`testenv.yml`, the tools run it. Rejected because the manifest cannot express
most of what makes a runbook trustworthy: cold versus warm timings, the
success line to look for, the failure/fix log, which assertion was falsified
and how. It would have kept the schema as a lossy subset of the document.

**Put the deliverable under `.devflow/e2e/` to keep it out of the project's
own tree.** Attractive — the artifacts stop touching the repository's layout —
and structurally impossible. [`devflow-fs-guard`](../../../../packages/devflow-fs-guard/README.md)
denies every `write` / `edit` / `str_replace_editor` whose target path carries
a `.devflow` segment, before `ctx.fs` runs, and routes the denial at
`devflow_transition` / `devflow_create` / `devflow_write_spec` — none of which
writes a shell script. The skill would fail to produce its deliverable in
exactly the deployments where devflow is fully composed. The only way through
is `bash: cat > .devflow/e2e/up.sh`, since the guard is a policy fence rather
than a kernel boundary — a skill teaching agents to route around the
repository's own guard. Two further reasons stand even without the guard:
`.devflow/` is plugin-owned durable state whose single write path is
`ctx.devflow`, and this package injects only `skills`, so its deliverable must
not depend on devflow being composed at all.

**Rename the package to `devflow-e2e`.** Honest naming, but it strands the
published name mid-flight; see above.

**Translate the body into English for consistency with this line's other
assets.** Rejected: the body's precision is the product, and a translation is
a new text that has not been through the experience that produced this one.

## Consequences

The package's maintained surface drops from an executor with process, probe,
job, and manifest contracts to one prose asset and its registration — three
small source files, three suites, no runtime state, no `ctx.subprocess`, no
`ctx.jobs`. Failure modes move with it: nothing here can orphan a process,
leak a port, or mis-terminate a tree, because nothing here spawns.

What is given up is determinism of replay. The runbook is scripts plus prose
in another repository; no gate here checks that `e2e/README.md` exists, that
its commands still work, or that they ever did. That guarantee
now rests entirely on the protocol's own gates — falsified assertions and the
clean-room re-run — which are agent discipline rather than machine checks.
The trade was accepted because the executor never guaranteed a *correct*
manifest either; it guaranteed faithful execution of whatever was written.

Consumers of `env_up` and friends break at upgrade with no migration path.
The reintroduction condition, if one ever appears: a deployment that needs
the same environment brought up identically by many sessions without an agent
in the loop — a scheduled runner rather than a person's test loop. Nothing
present has that shape.

This supersedes the testenv executor's design record:
[orchestration scope and the up rule](2026-09-01-testenv-orchestration-scope-and-up-rule.md),
[render enrichment](2026-09-01-testenv-render-enrichment.md),
[background jobs](2026-09-02-testenv-background-jobs.md),
[the testenv-author skill](2026-09-02-testenv-author-skill.md),
[session-root resolution](../bug-fix/2026-09-02-testenv-session-root-resolution.md),
[the bootstrap survey protocol](../bug-fix/2026-09-02-testenv-bootstrap-survey-protocol.md),
and [the sentinel that outlived its teardown](../testing/2026-09-10-testenv-sentinel-outlived-its-teardown.md).
They are kept for the reasoning behind decisions a future executor would face
again.
