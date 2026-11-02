# Agent Note: Midscene project context and model dispatch

Status: implemented

## Problem

Workspace paths and model credentials in host-wide acceptance profiles make project switching fragile. A browser check can succeed independently of task evidence or a required completion policy.

## Decision

The initiating session supplies the canonical workspace. Optional choices and reviewed suites live under `.devflow/midscene`; private receipts and outputs live outside the source tree. Static discovery returns candidates with provenance. Harness Agent uses existing shell/jobs to prepare services and resolve runtime addresses. It does not infer application identity from a listening port alone.

An authenticated, run-scoped loopback bridge translates the pinned Midscene protocol into published DSH LLM and attachment calls. Credentials stay with DSH. Model selection is fixed, while each request obtains its own prepared adapter binding. Unsupported protocol fields and resized screenshots fail explicitly. The public LLM interface cannot freeze one adapter generation across an entire multi-request run.

A binding tool verifies task, source, suite and existing deployment receipt, obtains approval for a changed binding, and checks freshness after approval. It writes a persistent required-validator policy before publishing project settings. The gate engine reads that policy independently of the Midscene provider, so unloading the provider blocks completion. Final checks revalidate evidence and policy before the task store commits its journal.

Project report access resolves output through an optional service under the existing web authentication and asset checks. Runs attach generated Markdown through the task store; gate execution does not reenter task artifact serialization.

## Alternatives considered

**Move global profiles unchanged into another file.** This retains redundant paths and model credentials and does not resolve the initiating task or model.

**Extract provider API keys and endpoints.** Published LLM adapters own their transports; copying private configuration bypasses provider behavior and credential lifecycle.

**Treat application reachability as deployment proof.** A responding server may serve another source snapshot. Formal acceptance retains deployment receipts and runtime probes.

**Register only an in-memory project requirement.** Removing the provider could remove its obligation. The independently read project policy preserves that obligation.

## Consequences

Normal exploration requires no global profile or duplicate model key. Persistent choices use validated tools and bounded atomic writes. Exclusive mutation locks prevent lost updates; a host crash can leave a lock requiring owner-exit verification before removal. Portable Node filesystem checks do not provide a kernel-level transaction against malicious same-user ancestor replacement.

Initial formal binding still requires real deployment evidence. Discovery is static; service launch and authenticated login use the Agent's existing project procedures. Controlled-adapter tests prove protocol, browser and storage composition, not a particular paid model's visual accuracy. Real deployment acceptance remains a separate verification.

## Related decisions

[Access preparation and card reports](../feature/2026-09-16-midscene-access-reports.md) partially supersedes login preparation and report publication here: authorized snapshots have a project tool and published assets have card-local copies. This record retains discovery, model dispatch, private runtime storage and required-validator policy ownership.
