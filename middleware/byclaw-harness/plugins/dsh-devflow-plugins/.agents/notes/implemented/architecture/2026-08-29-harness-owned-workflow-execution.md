# Agent Note: devflow — the Harness owns workflow execution

Status: implemented

English | [中文](2026-08-29-harness-owned-workflow-execution.zh.md)

## Problem

devflow had two workflow executors. The interactive Harness agent could read a card, author its deliverables, and advance it through model tools, while `dsh-devflow-driver` watched stage events and dispatched separate children to do the same work. The second executor added provider lifecycle, model routing, lease, prompt, and concurrency ownership without adding a state or policy capability. A deployment had to choose which agent owned the next move, and enabling both could make progression difficult to attribute.

Artifact policy also exposed its requirements too late to the interactive executor. The artifact gate enforced a transition correctly, but a model often learned the required kind and structure only by attempting a move and receiving a veto. That made a rejected transition part of ordinary discovery.

## Decision

**The Harness agent is the sole workflow executor.** The driver package, its bundle row and dependency, workspace references, package tests, and active installation documentation are removed. The bundle contains state, model tools, policies, commands, and views; it does not start a second background orchestrator. Existing profiles remove both the driver package and loader entry. No disabled compatibility row or empty package remains.

**Artifact policy is discoverable through an optional read-only service.** The core devflow Definition owns the immutable `ArtifactContract` inspection vocabulary and its tool-output schema. The artifact gate provides `devflowArtifactContract`, whose `inspectOutgoing(card)` reports configured legal outgoing edges and runs the same structural checker used by transition enforcement. The tool plugin reads the service with `ctx.get()` and adds its point-in-time result to create, show, attach, and successful stage-changing results. A deployment without the provider keeps its previous output.

**Semantic admission remains an independent policy, not an executor.** The agent gate may dispatch a one-shot checker while deciding a transition, but it does not claim stage work or advance the card. Its synthetic parent carries the explicit `agents` injection required by the child runtime, so profile-level injection overrides are unnecessary.

Historical Agent Notes retain the rationale for the removed implementation. They describe decisions that shipped before this removal and are not an installable or compatibility surface; this note owns the current execution boundary.

## Alternatives considered

**Keep the driver installed but disabled.** A dormant package still preserves two ownership models in manifests, docs, configuration, and maintenance work. Nothing in the current use case requires unattended queue consumption, so a compatibility shell would keep cost without preserving needed behavior.

**Keep the driver only for unattended operation.** This would remain a second agent lifecycle with its own routing, prompts, leases, and recovery semantics. If unattended scheduling becomes a concrete requirement, it needs a separately justified orchestration design rather than an always-shipped alternate executor.

**Generate blank artifacts when a card enters a stage.** Empty files satisfy discovery poorly and can look like deliverables before they contain evidence. Reporting the exact contract lets the Harness agent author the document intentionally while the gate continues to reject missing or malformed content.

**Let the model discover requirements through a rejected transition.** Rejection remains necessary for enforcement, but using it as the normal read API creates avoidable failed actions. The inspection service gives the same defects before the attempt without duplicating the checker.

## Consequences

- Chat-driven work has one attributable owner: the active Harness session. A user who wants progression must keep or resume that agent; devflow no longer consumes queued cards in the background.
- The published package line contains twelve packages. Removing the driver is a breaking packaging/configuration change for profiles that enabled it; those profiles must delete the dependency and loader entry.
- Artifact requirements are visible before a move and after every relevant committed change, while transition enforcement remains fail closed and authoritative.
- The core Definition now owns the shared inspection wire vocabulary. Provider and consumer collaborate through the optional Cordis service rather than importing runtime values from each other.
- Repository verification passes 44 test files and 382 tests, all twelve tarballs pass preflight, and a locally installed driver-free bundle boots. A fresh Harness chat created a card, observed and corrected artifact preflight, passed the `draft -> designing` agent gate without an injection error, and parked the card at `blocked` without dispatching a workflow child.
