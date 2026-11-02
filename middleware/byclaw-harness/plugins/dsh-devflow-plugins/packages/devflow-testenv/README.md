# @zhchxiao123/dsh-devflow-testenv

English | [中文](README.zh.md)

One bundled skill, `devflow-e2e-bootstrap-runbook`, and nothing else. It teaches an agent to settle "how does this system start" into an artifact the **target repository** carries: one `e2e/` directory holding `README.md` beside `up.sh`, `check.sh`, and `down.sh`. A later agent runs three scripts and gets a trustworthy environment in a minute or two instead of re-reading the README, guessing the start order, and drawing conclusions on top of a half-broken environment it believes is healthy.

The package registers no tools and holds no runtime state. The runbook's scripts are ordinary shell run with the harness's own `bash`; nothing here executes, validates, or supervises them. **The package name is historical** — it previously orchestrated environments itself, from a `testenv.yml` manifest through `env_up` / `env_status` / `env_logs` / `env_down` / `integration_test`. That executor and its two skills (`testenv-bootstrap`, `testenv-author`) are gone; upgrading past 0.4.0-dev.7 removes those tools with no migration path.

## What the skill owns

The body is a six-phase protocol, and its load-bearing rule is that **every command in a runbook must be one the author actually ran in that session**. A runbook written from source-reading is worse than none: with no document the next agent explores, and with a wrong one it trusts, proceeds, and fails invisibly. A step that genuinely cannot be verified in the current environment — a missing credential, no docker daemon, a package registry the egress policy blocks — is marked `[未验证]` with the reason and the condition for verifying it later, never silently promoted to fact.

| Phase | What it settles |
|---|---|
| Recon | The system's parts, from CI configuration first (a passing job proves its own commands), then orchestration files, `.env` samples, existing agent instructions, docs, entry code, test fixtures. |
| Bring-up | Real start, step by step: exact command, the output line that means success, cold-start versus warm-start timings, every failure and its fix. |
| Health probe | A single check with three layers — process, port, business path — where **every assertion is falsified** by stopping its component and confirming it turns red. |
| Profiles | The minimal start set per test scenario, so a data-layer test does not pay for the whole topology. |
| Runbook | Scripts first, prose second: `up`/`check`/`down` idempotent and self-describing, then a fixed nine-section document written *after* the scripts are final, from real output rather than memory. |
| Clean-room | `down --reset`, then up → check again reading only the document, verifying every filename, success signal, and number literally. |

Two agent-environment traps the protocol pre-empts explicitly, because both are near-universal and both produce confident wrong conclusions: a service started with `cmd &` shares the tool call's process group and dies with it (use `setsid` plus a pidfile), and a `--reset` that skips cleanup because the service is already down while still printing "clean" — "everything is stopped" being exactly the state a fresh agent starts from.

The skill also has a **maintenance mode**: an agent following an existing runbook that finds it wrong fixes the runbook first, then resumes its own task, and appends a line to the change log. Working around a documented defect leaves it for the next agent to hit.

## Behavior

`apply` registers one skill provider on `ctx.skills` as an effect of the plugin fiber; disposing the fiber withdraws the skill. The candidate is registered at `BUNDLED_SKILL_RANK` with `{ modelInvocable: true, userInvocable: true }`, so it appears in the model's `<available_skills>` catalog, loads through the `skill` tool, and answers the `/devflow-e2e-bootstrap-runbook` user gesture. A deployment overrides the body by registering a same-layer provider under the same name with a lower rank; a nearer-scope provider shadows it regardless of rank. The body ships as `assets/devflow-e2e-bootstrap-runbook.md`.

The body is written in Chinese, as its author wrote it. That differs from the other assets in this line and is deliberate: the text is the contract, and translating it would be a rewrite. Five things were changed from the author's original and nothing else — the skill name; the deliverable's paths, which were `docs/agent/e2e-setup.md` plus `scripts/e2e/` and are consolidated here into one `e2e/` directory so the document and the scripts it must match word for word sit side by side; the portability rule, because the original asked for a copy-pasteable `cd` and so carried the author's home path and username into a file the target repository commits and other machines read; the ownership invariant, because the original penalised only under-deletion and so produced runbooks whose `--reset` reused the repository's own compose project and destroyed the developer's database; and the escalation rule, because the original's only answer to a dependency this environment lacks was to mark it `[未验证]` — a fallback that never fires when the agent instead substitutes a plausible middleware and verifies that, satisfying "only write what you ran" while documenting the wrong system.

## Configuration

None. The skill body is capability prose, not deployment policy; the override path above is the customization surface.

## Model Experience

### Skill catalog entry

#### What the model sees

One `<available_skills>` line while the plugin is mounted:

> Generate or maintain an agent-oriented runbook (e2e/README.md + e2e/up|check|down.sh) that lets any future agent bring a system up for end-to-end testing without re-exploring the repo. Use whenever a task involves starting services for E2E/integration testing, setting up a local debug environment, or when the user mentions 沉淀启动文档 / runbook / 拉起服务 / e2e setup.

Loading it injects the asset body (about 18 KB) into that step.

#### Token effect

One catalog line per request while mounted. The body costs its size only in steps after the model or the user loads it.

#### KV Cache effect

The catalog entry participates in the harness's durable catalog message, republished only when the visible skill set changes.

## Known Limitations and Deferred Work

- **Nothing verifies the deliverable** — the runbook's quality rests entirely on the agent following the protocol's own gates (falsified assertions, clean-room re-run). No tool here checks that `e2e/README.md` exists, that its commands still work, or that they ever did. Portability is the same: the body forbids host identity in the deliverable and has the clean-room pass grep for it, but an agent that skips that grep leaves a machine-bound runbook that nothing downstream will flag. Destructive scope is the same again, and costs more when it fails: the body confines `down --reset` to resources the runbook itself created and has the clean-room pass diff `docker ps -a` / `docker volume ls` / `git status` across the reset, but an agent that skips that comparison ships a `--reset` that deletes the developer's own database, and it deletes it irreversibly. Missing middleware is the hardest of the three to catch: the body requires the agent to ask the user rather than substitute its own, but an agent that substitutes anyway produces a runbook that passes every gate here — it genuinely ran what it wrote — while describing a system nobody deployed.
- **The output path is a convention, not an interface** — `e2e/` is fixed by the body so a later agent knows where to look, and the body mandates a pointer in `CLAUDE.md` / `AGENTS.md` because a runbook nobody is told to read is not written. A repository with a strong conflicting convention needs the body overridden, not configured.
- **The body is static** — it cannot cite the current deployment's available tooling, so its advice about docker, credentials, and network reachability is written for the agent to check against reality rather than to trust.
- **The package name no longer matches the capability** — kept to avoid breaking the published name and every profile that installs it.
