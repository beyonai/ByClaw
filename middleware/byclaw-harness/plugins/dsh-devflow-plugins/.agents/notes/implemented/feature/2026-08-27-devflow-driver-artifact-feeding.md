# Agent Note: devflow — driver artifact feeding and production templates

Status: implemented

English | [中文](2026-08-27-devflow-driver-artifact-feeding.zh.md)

## Problem

**Current status.** The package this note described is absent from the shipped line; [the Harness-owned execution decision](../architecture/2026-08-29-harness-owned-workflow-execution.md) owns the current boundary. This note remains active because its context-feeding alternatives and token-cost trade-offs are reintroduction constraints for any future background orchestrator.

The artifact contract closed its checking half — kinds on the seam, the [mechanical gate](2026-08-27-devflow-artifact-gate-mechanical-contract.md) on the waterfall, `devflowArtifactStructures` published for a producer — but no producer existed. A driven child received only the card body: a developer child never saw the registered design it was implementing against, a rework child never saw the review verdict that sent the card back, and nothing told any child which kind to deliver or what shape the gate would demand of it. Children rediscovered context through tool calls or guessed, and the first structural defect surfaced as a gate veto after the work was done.

## Decision

**Two optional per-stage config fields on the driver, `inputs: string[]` and `produces: string`.** Before each dispatch the driver inlines the newest registration of every input kind into the child prompt — between the card body and the fixed closing contract, one `--- artifact <kind> (rev N) ---` separator per artifact — and a `produces` kind appends the instruction to register the deliverable through `devflow_attach_artifact`'s kind + content form. Newest-of-a-kind is `artifactRecords.filter(kind).at(-1)`, the same seam guarantee the gate and the read tool serve by, and the file is located as `dirname(card.path)` plus the journal-recorded relative path — the same derivation, restating no provider layout.

**Feeding is best-effort, the opposite of the gate's fail-closed check.** A kind with no registration skips silently — the first round of a rework loop has no review yet, so absence is the normal case, not a defect. An unreadable registered file warns (`devflow-driver:` prefixed) and skips that one artifact, and the dispatch proceeds: the child can still work the card from its body, while a refused dispatch would stall the board over missing prompt context. The gate remains the enforcement point — it stops the card's next move until the disk serves the file — so the driver blocking too would add an outage without adding safety.

**The template comes from the `devflowArtifactStructures` service, never a second definition.** At dispatch time the driver reads `ctx.get('devflowArtifactStructures')` (optional service, type-only types import) and renders the produced kind's frontmatter fields and `## ` section titles as a skeleton beside the registration instruction, so the producer shapes the file to the same spec the gate checks. Service absent, kind undeclared, or kind declared without structure all degrade to the bare registration instruction — the child still knows what to register, just not what shape it takes.

**Misconfiguration fails the load; the unconfigured prompt is byte-identical.** An `inputs` or `produces` kind outside the seam's kind grammar (restated: lowercase letters, digits, dashes, starting alphanumeric) throws at `apply`, naming the config item. A stage with neither field produces exactly the previous prompt — the new sections are empty splices — so existing deployments and the existing test suite are untouched.

## Alternatives considered

**Fail closed on an unreadable input, like the gate.** The gate's read is evidence for a decision it owns; the driver's read is prompt context for work that can proceed without it. Parking or skipping the dispatch turns a degraded prompt into a stalled board, and the corruption still surfaces — as the gate's veto on the next move, where it is actionable.

**Let the child fetch its own context through `devflow_read_artifact`.** The tools stay available, but a child does not know which kinds matter for its stage — that is deployment knowledge, which is exactly what stage config encodes — and a fetch costs a model round-trip per artifact on every dispatch. Inlining puts the newest revision in context before the first token is generated.

**Feed every registered kind automatically instead of a configured list.** Registrations accumulate across the card's life; feeding all of them grows the prompt without bound and hands a testing child the design history it does not need. An explicit list keeps the token cost a deployment decision and keeps unconfigured stages byte-identical.

**Restate the produced kind's shape in driver config.** Defined twice, template and check drift apart — the exact failure the `devflowArtifactStructures` service was published to prevent. The driver reads the service or degrades; it never owns a spec.

**Import the gate's spec value directly.** Cross-plugin collaboration goes through service names, never value imports; the gate may be absent entirely, which the service name models as `undefined` and a value import cannot.

## Consequences

- Each dispatch with `inputs` pays the full content of every fed artifact, per round — the README's Model Experience section carries the token accounting. Bounding oversized artifacts is the deployment's problem (choose the inputs), not the driver's.
- A child can be dispatched with context missing (unregistered kind, unreadable file) and fail the gate later; best-effort feeding trades that round for never stalling the board on a prompt garnish.
- The driver gains a type-only dependency on `@zhchxiao123/dsh-devflow-artifact-gate` for the spec types and the service's Context entry; runtime coupling stays the optional service name, and a deployment without the gate just runs untemplated.
- The seam's kind grammar gains a third restatement (the artifact gate, the admission gate, and now the driver); a divergence from `ARTIFACT_KIND` in the provider is a defect in the copy.
