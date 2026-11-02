# Agent Note: devflow — the driver waits for subagent provider activation

Status: implemented

English | [中文](2026-08-27-devflow-driver-provider-lifecycle.zh.md)

## Problem

**Current status.** The package this note repaired is absent from the shipped line; [the Harness-owned execution decision](../architecture/2026-08-29-harness-owned-workflow-execution.md) owns the current boundary. This note remains active because concurrent provider activation is a lifecycle constraint for any future background orchestrator.

Cordis Loader entries activate concurrently. The `subagents` service can therefore satisfy the driver's injection before a separately mounted provider plugin has registered its name. A load-time `getProvider()` check made a valid composition order-dependent: the base bundle declared `spawn`, but an enabled devflow driver could observe the registry first and fail the whole profile with `unregistered subagent provider "spawn"`.

Configuration order cannot establish provider readiness. The provider and driver both inject the same registry service, while provider names are dynamic entries inside that service rather than Cordis services of their own.

## Decision

Provider availability is runtime lifecycle state. A card at a configured stage whose provider is absent enters a waiting map keyed by its root and id. A later state event replaces that pending value, and moving to an undriven stage removes it. The first wait for each provider logs at `debug`.

The driver listens for `subagent/provider-added`. Registration releases every matching pending card through the existing `enqueue()` path, preserving the concurrency cap, engaged-card exclusion, lease acquisition, and child-exit re-entry behavior. A provider already present at enqueue time takes the ordinary path without entering the waiting map.

## Alternatives considered

- **Rely on bundle row order.** Loader starts sibling entries concurrently, so textual order documents composition but cannot serialize activation.
- **Delete the check and let `ctx.subagents.start()` fail.** The activation sweep could claim and park a valid card before its provider finishes registering, converting a startup race into durable task state.
- **Fail after a provider-registration timeout.** A timeout adds a deployment-varying boot delay, still races slow provider initialization, and needs a new tunable without improving dispatch correctness.

## Consequences

Cold-start and hot-added providers have the same behavior: cards wait without taking leases and dispatch when their provider appears. A misspelled provider name is no longer a load-time error; its cards remain pending, and the debug log identifies the unresolved name. This is the unavoidable ambiguity of a dynamic registry without a composition-settled event.

The real-composition driver suite loads the driver before its provider, proves that no child starts while the provider is absent, then registers it and observes the pending cards dispatch. This pins the profile startup order that exposed the defect.
