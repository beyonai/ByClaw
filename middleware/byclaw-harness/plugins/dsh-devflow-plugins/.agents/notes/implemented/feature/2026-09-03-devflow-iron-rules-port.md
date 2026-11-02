# Agent Note: Iron rules ported into the devflow line

Status: implemented

## Problem

devflow's `spec-delta` triage sorts a card's knowledge output into `reference` (worth knowing, read on demand) and `obligation` (not following it is a mistake). References have a home — the spec seam's indexed documents — but obligations had none inside this line. The plan to forward them to `@byclaw/dsh-iron-rules` failed on inspection: that plugin publishes **no cordis service** (its only reachable surface is the `record_iron_rule` tool registration), is `"private": true`, and lives in another repository — while this line's rules forbid depending on unpublished surface and forbid cross-plugin value imports. An obligation channel that hard-codes another plugin's tool name, or fakes a tool call the model never made, was not acceptable either.

## Decision

`@zhchxiao123/dsh-devflow-iron-rules` reimplements the iron-rules plugin inside this line as a single function plugin — the policy-plugin shape `devflow-fs-guard` and `devflow-agent-gate` already use, not a Definition/Provider/Consumer seam. The vocabulary and the four mechanisms (full-body residency keyed by a data digest, dirty-turn check enforcement with a retry ceiling, stated `script | judgement` triage, `replaces` with a net-change budget plus watch-decay detection) restate the original deliberately; its module docs mark a semantic divergence as a defect in this package. Four things changed in the port:

- **Root resolution is devflow's, not git's.** Rules live at `<session cwd>/.devflow/iron-rules` (configured `root` as the no-cwd fallback), not under the nearest git ancestor — rules, cards, and spec documents share one `.devflow/`, and the fs guard's segment-name fence covers the rule directory with no extra config. Check scripts consequently run from the session workspace root; the guard's denial gained a third remedy branch pointing rule paths at `devflow_record_iron_rule`.
- **The write path is also a service.** `ctx.provide('devflowIronRules', { record })` publishes the same `recordRule` the tool calls — one write path with two names — so a `spec-delta` obligation becomes one forwarded call instead of a model remembering to make one.
- **The recording description uses concise Chinese** per the [provider-description decision](../bug-fix/2026-10-13-concise-provider-tool-descriptions.md); other model-facing strings remain English; the recording tool is `devflow_record_iron_rule` and the message-source kind is `devflow-iron-rules`, both to fit the line's naming and to stay distinct from the original's registrations.
- **The reserved `requireApproval` config field is dropped.** It had no consumer; its reasoning (the script trust boundary equals repository write permission — here plus the tool plane, since the fs guard denies the directory to file tools) lives in the README as prose instead of as a dead switch.

The `/iron-rule` command and its two render helpers are not ported: the tool is the capability and the command is convenience, deferred until wanted.

## Alternatives considered

**Move the original package wholesale.** Rejected. It would publish a private package's identity problem into npm, carry 1448 lines with zero tests into a 100 %-per-file line in one step for no behavioral gain, and leave two maintained copies until the cross-repository deletion landed. The port pays the same test cost but owns its naming, root semantics, and language from the start.

**Declare an obligation seam in devflow core and let `@byclaw/dsh-iron-rules` implement it.** Rejected. The provider would live in a repository this line does not control and is not published from, so the seam's only real implementation could never be composed by anyone installing from npm — a capability seam whose Provider role is unreachable is not complete.

**Reference instead of call** — `spec-delta` rows carry a `.iron-rules/` receipt id the model filled in after calling the other plugin's tool. Workable without any new code, and it was the design of record before this port; rejected once porting was on the table because the receipt is unverifiable prose and the two-step flow can silently drop the obligation between steps.

## Consequences

Bought: obligations recorded through one audited write path that validates before its first write, immediately resident in the recording session, enforced at turn end without model cooperation, and reachable by other plugins as an optional service. The rule directory is better fenced than the original's (`.devflow/` guard coverage).

Cost: a second implementation of iron-rules exists while `byclaw-harness` still carries the first, and nothing detects co-mounting — the READMEs state "mount one" and that is the whole protection until the original is deleted. The vocabulary-consistency promise binds this package to the original's semantics; diverging on purpose requires updating that promise in `types.ts` and this note.

## Related

The consuming triage design lives in the spec-update card's design record (`.trellis/tasks/09-02-devflow-spec-update/design.md`, outside this repository's history); its "reference, not call" conclusion is superseded by this port and is updated to forward through `ctx.get('devflowIronRules')`.
