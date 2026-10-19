# Agent Note: Persistent scheduling and GitHub content intake

Status: implemented

English | [中文](2026-09-14-scheduler-github-sync.zh.md)

## Problem

Repository monitoring needs to survive conversation inactivity and host restarts. Combining timers, remote synchronization, model evaluation, and development would couple unrelated consumers and obscure the difference between delivering work and finishing it. Memory-only notifications lose changes while consumers are absent.

## Decision

Two optional capabilities own separate state. The scheduler owns plans and trigger delivery; GitHub sync owns subscriptions, synchronization runs, versioned content, durable changes, and independent consumer positions. Each has a Service Definition and a local SQLite provider, accessed through Cordis services. The existing Harness agent remains the Devflow workflow executor.

The optional `github.sync` handler accepts a stable trigger ID and returns only after the run receipt is durable. The scheduler polls the specific run, rather than interpreting agent idleness or receipt as completion. Handler registration belongs to an injection fiber and is removed when either service becomes unavailable. Manual synchronization does not depend on the scheduler.

Snapshots and corresponding changes commit in one SQLite transaction. Consumers read the version attached to the change, acknowledge their own delivered sequence, and tolerate redelivery after an unconfirmed acknowledgement. External content is data, never an instruction to execute tools or change permissions. Credentials stay outside the content records.

Local database transactions and execution generations fence ownership after cancellation or takeover. SQLite files require a supported local filesystem; this is not a distributed execution cluster. Runtime failures and resource limits remain visible and cannot be represented as successful synchronization.

Cancellation retries carry a durable cancellation flag. GitHub acceptance records a cancelled receipt when no run exists, so late normal delivery cannot create work. Explicit resume keeps a failed/partial run identity and committed page checkpoints, but rejects a changed baseline or competing active synchronization. Capacity administration persists its caller and time. Scheduler parameters are lossless JSON snapshots, copied before validation and persistence.

## Alternatives considered

**Session reminders.** Existing reminders require a live root agent to deliver follow-ups, while repository monitoring must continue without an active conversation.

**One Issue-to-development plugin.** Combining discovery and business decisions prevents reuse for summaries and knowledge collection. Evaluation and Devflow intake remain consumers of synchronized content.

**Memory-only events.** Events alone cannot support offline consumers or restart recovery. Durable records own delivery history; notification only improves latency.

**Shared workflow state.** A second copy of Devflow stages would compete with existing gates and journal state. These capabilities do not create or transition cards.

## Consequences

The four packages can be composed without modifying Harness or enabling automatic development. Callers must distinguish accepted work from completed work and implement consumer-side idempotency. Retaining historical content supports replay but requires explicit capacity management. Real Loader tests cover the optional integration, downstream failure, cancellation, and durable consumption; installation and runtime acceptance evidence is recorded separately from build results.
