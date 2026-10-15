# Agent Note: The Runbook Skill Told Agents to Commit Their Own Machine

Status: implemented

## Problem

`devflow-e2e-bootstrap-runbook` produces a deliverable the target repository
commits: `e2e/README.md` beside `e2e/up|check|down.sh`. Three places in the
body pushed the authoring agent to write **its own machine's identity** into
that deliverable.

The most direct is the writing rule: *"命令用代码块给出可直接复制的完整形式（含 cd
和环境变量）"*. The `cd` the agent actually ran was `cd /home/<user>/work/repo`,
so "copy-pasteable and complete" resolved to an absolute home path carrying a
username. The quick-start section repeated the same pressure (*"含 cd 的三行"*),
and the document header template asked the author to fill
`<OS/资源/可用工具简述>` — an invitation to name the machine rather than its class.

The body already forbade three neighbouring things: credentials, sandbox-specific
bypasses hardcoded into scripts, and pinning the version you happen to have
instead of the minimum. Host identity is the same shape of rule and simply was
not written. Nothing covered absolute home paths, usernames, hostnames, LAN or
container IPs, personal profile directories, or a port that merely happened to be
free on the authoring machine.

Why this is worse than untidy output: a runbook carrying one machine's identity
is a **wrong instruction for every other machine**, and the body's own opening
principle already convicts that failure — *"有一份错误的文档，它会信任它，然后在错误
的环境上得出错误的结论，并且很难发现"*. A guessed runbook and a machine-bound
runbook fail the next agent identically. The deliverable also enters git history,
taking the username, directory layout, and sometimes internal addressing with it.

The defect survived because the protocol could not observe it. Clean-room
verification (phase six) re-ran the runbook **as the same user, in the same path,
on the same machine**, where a hardcoded `/home/<user>/repo` is permanently green.

## Decision

The body carries a portability rule, and clean-room verification carries a step
that can observe a violation.

**The rule separates evidence from instruction.** This is load-bearing, because
the body's first principle — *"只写你亲手跑通的东西"* — appears to contradict "do
not write your machine's paths": the command actually run *was* the one with
`/home/<user>`. Stating both rules side by side would leave a later agent to pick
one at random. The new bullet resolves it by layering: what was run is
**evidence**, kept in the verification pass and surfaced as an environment *class*
in the header and sections 8–9; what is written down is an **instruction**, a
portable re-expression of the same command, re-verified in phase six. The two
principles stop competing, and the new rule becomes mechanically checkable.

The bullet sits beside the credentials rule in phase two rather than in a section
of its own, because the two belong to one family — local facts do not enter the
deliverable — and adjacency is what makes that family legible.

**Three pressure points were cut** without losing their original intent: "complete
form" now means no elided arguments, environment variables, or working directory,
explicitly *not* an absolute path copied off the author's machine; the quick-start
three-liner names a repo-relative working directory
(`cd "$(git rev-parse --show-toplevel)"`); the header placeholder asks for an
environment class and says in line not to name the machine.

**Phase six gained step 3**, and the remaining steps renumbered to 4–6. It does
two complementary things: re-run `up → check` from a different checkout path,
which is the only way a hardcoded path turns red; and grep the deliverable for
host markers, which catches hostnames, container IPs, and hardcoded ports that
would not have caused a failure. This mirrors the body's existing
`每一条断言都要做反向验证` — a check that cannot turn red is worse than no check.

The anti-pattern list gained the matching line.

## What pins it

`skill.spec.ts` pins load-bearing sentences with `toContain`, and that suite is
the **only** thing protecting the body — this package has no other mechanism.
Three pins were added, following the package's established "few and stable"
standard rather than whole-text comparison: the rule's bold title, the
`cd "$(git rev-parse --show-toplevel)"` form, and the phase-six step title.

The pins were added **before** the body was edited and observed to fail, then
observed to pass after. A green-only run cannot distinguish "the pin guards the
body" from "the assertion was written against a string already present."

## The declaration this invalidated

`src/skill.ts`'s module doc, both package READMEs, and the Trellis backend spec
each stated that exactly **two** things diverge from the author's original — the
skill name and the deliverable's paths. This change makes it three, and all four
statements were updated in the same change. Left alone they would have been false,
and the module doc is specifically the thing a later agent reads before deciding
whether a wording change is permitted.

Both READMEs' Known Limitations section also records the new rule's enforcement
gap: the body forbids host identity and has phase six grep for it, but an agent
that skips the grep leaves a machine-bound runbook that nothing downstream flags.

## Alternatives considered

**Strip host identity when the plugin serves the skill.** `skill.ts` serves the
asset byte for byte, and `serves the body from the shipped asset byte for byte`
pins that contract. More fundamentally the defect occurs when the agent *writes
the deliverable*, not when the body is served — stripping at serve time is too
early to reach the file that carries the leak.

**Ship a checker that scans `e2e/`.** This package retreated from an executor to
pure judgment on 2026-09-11, and "nothing verifies the deliverable" is a recorded
boundary, not an oversight. A checker reinstates the execution surface that was
just removed, at a cost far above one rule plus one grep. Reconsider only on
evidence of the same defect recurring across repositories.

**Delete "含 cd" without adding a positive rule.** Removing the pressure leaves no
replacement form, so an agent still writes the absolute path it ran; and ports,
hostnames, and container IPs were never inside that phrase's reach.

**A `Config` field naming permitted host prefixes.** Violates this package's
no-tunables shape and `AGENTS.md`'s "Require a current owner and need" — no
consumer needs it to vary.

**A section of its own rather than a phase-two bullet.** Would sever the family
link to the credentials and sandbox-bypass rules, which is the cue telling a later
agent what kind of rule it is reading, and would deepen the body's outline for no
gain.

## Consequences

The divergence from the author's original grows from two items to three, and four
documents now have to move together whenever it changes again. That cost is
accepted: the alternative is a module doc that lies about what was edited.

Phase six is more expensive — an extra checkout and re-run. It buys the first
condition under which this class of defect is observable at all; the previous
clean-room pass could not fail on it.

Enforcement is still entirely the reading agent's. The grep is self-administered,
and an agent that skips it produces a machine-bound runbook that nothing
downstream flags. This is the same posture as every other rule in the body and is
recorded in both READMEs rather than silently accepted.

No runtime behaviour changes: exports, `Config`, registration rank, and disposal
semantics are untouched, and `src/` gains no branch, so the per-file coverage gate
is unaffected. Existing deliverables in other repositories are not retrofitted —
the body's maintenance mode repairs each one the next time an agent works from it.

## Related

- [The retreat to a runbook skill](../feature/2026-09-11-testenv-retreats-to-runbook-skill.md)
  — why this package contributes judgment only, which is what rules out a checker.
