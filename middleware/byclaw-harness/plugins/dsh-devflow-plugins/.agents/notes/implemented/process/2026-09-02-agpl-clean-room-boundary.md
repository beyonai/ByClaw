# Agent Note: Clean-room boundary against the Trellis licence chain

Status: implemented

## Problem

The spec seam's authoring skill was planned as an adaptation of an existing Trellis skill, which sits in this workspace as `@byclaw/dsh-trellis` and declares `"license": "MIT"`. Its `UPSTREAM.md` records an import from the intermediate fork `1264459640/dsh-trellis`, also claiming MIT.

The original is `mindfold-ai/Trellis` under **AGPL-3.0**. AGPL is strong copyleft: a downstream has no right to relicense it as MIT. **The declared chain has a break in it**, and the MIT notice this workspace carries rests on that break.

This matters specifically for a plugin line. AGPL-3.0 extends its source-disclosure obligation to software offered over a network, so a derivative work reached through a web channel carries the obligation whether or not anyone ships a tarball. A licence question that would be a footnote for a local script is a structural constraint here.

## Decision

**Nothing in `packages/` derives from Trellis.** The devflow spec seam — the anchor model, the three-valued verdict, the structural contract, the store, the tool — was designed here and owes Trellis nothing. The authoring skill at `packages/devflow-spec-tool/skills/dsh-write-spec/SKILL.md` was written clean-room from that design rather than adapted, and it is the artefact this note exists to constrain: the plan of record before this decision said "adapt", and adaptation is exactly what the licence forbids.

Three lines the decision draws, which apply to any future temptation to borrow:

- **Using it as a tool creates no obligation.** AGPL binds distribution and network provision of the program itself; it does not reach the files a program manipulates. Running Trellis to track tasks is fine, and the task artefacts under `.trellis/` are our content.
- **Reading it to critique it creates no obligation.** Planning documents in this change describe and argue against Trellis's approach — that is commentary on a design, not copying of an expression.
- **Copying or adapting any of its text or code is out of bounds**, including prompt text, skill bodies, and directory-format conventions carried over verbatim.

An MIT notice downstream of an AGPL work is not a licence grant; it is a claim that may simply be wrong. **Treat a declared licence as evidence, not as a conclusion, when a package announces an upstream.**

## Alternatives considered

**Rely on the `@byclaw/dsh-trellis` MIT declaration.** Rejected. The declaration is the thing in question. A relicensing that the intermediate fork had no authority to perform does not become valid by being written down twice, and the risk lands on this line rather than on whoever wrote the notice.

**Adapt the skill and attribute it.** Rejected. Attribution satisfies permissive licences, not copyleft. AGPL would require the derivative — and anything it is combined with under the licence's terms — to be offered under the same licence, which is incompatible with how this line is distributed.

**Treat the question as settled because the code is unrelated anyway.** Rejected as reasoning backwards. The packages genuinely are unrelated, but that is a fact established by writing them independently, not a reason to skip the check. Recording the boundary is what makes the independence auditable later.

## Consequences

The cost was writing the authoring skill from scratch instead of editing an existing one. That cost was small and partly illusory: the skill's subject is this line's own anchor model, about which the Trellis original has nothing to say. A genuine adaptation would have carried structure that did not fit.

The benefit is a stated boundary rather than an assumption. A future contributor who finds a useful Trellis idea now has the rule in front of them — describe it, reimplement it, do not carry its text — and the reason the rule exists, which is the network clause rather than distribution alone.

This note is not legal advice. It records an engineering decision made under uncertainty; the licence chain itself deserves review by someone qualified before anything here is published more widely.

## Related

The seam this decision was made while building is [the anchor model note](../architecture/2026-09-02-devflow-spec-anchor-model.md).
