# Agent Note: Midscene Web acceptance through existing gates

Status: proposed

## Problem

Devflow needs browser acceptance evidence bound to source, suite and running build. An exit code alone cannot establish that the intended UI was checked. The legacy plugin does not establish compatibility with current Harness contracts.

## Proposal

Add the separately installed Midscene skill and isolated CLI. Harness owns shell jobs; Devflow owns artifacts and transitions. Each run records source identity, an observed build marker, finite case results, cleanup status, usage when available and linked reports outside the Git workspace. Completion gates execute a fresh run. This extends the [testenv runbook decision](../../implemented/feature/2026-09-11-testenv-retreats-to-runbook-skill.md); the earlier note is not superseded.

## Alternatives considered

**Port native tools first.** This expands the compatibility surface before proving acceptance behavior. Native tools remain M2, conditional on real M1 acceptance.

**Use only MCP.** The researched Midscene MCP package is retired; the initial integration needs explicit process ownership and durable evidence.

**Restore the testenv executor.** This duplicates lifecycle responsibilities removed by the selected local baseline.

## Acceptance criteria

Actual SDK/Chromium tests must cover success, failure, cancellation, changed inputs and reports. Real Loader/skill and shell/tool/store/gate compositions must prove registration and fresh reruns. Tarballs must carry the CLI, worker, shared chunks and skill assets. Repository checks must pass.

M1 also requires real visual-model acceptance against the intended Devflow UI/profile, including a deliberate failure and reachable report links. Controlled model responses cannot satisfy this condition. M2 waits for that evidence. See the [PRD](../../../prd/2026-09-14-devflow-midscene.md).

## Risks

Reports may contain application data; projects own retention and hosting. Lost processes are unknown and never silently resumed because replay can duplicate side effects. Token usage is a measurement, not a currency budget. Implementation and verification remain in progress, so this note stays proposed.

## Authenticated deployment remediation

Formal execution now accepts a private, external Playwright storage snapshot and deployment receipt. The receipt binds commit and workspace fingerprint to a build identifier calculated from local web/UI artifacts. Runtime probes use authenticated POST JSON and verify the served client bytes before and after the suite; a changed instance or input cannot pass. The build identity intentionally covers the web index and client bundles, while deployment evidence retains the full installed package set separately.

The report face resolves the caller's session workspace through published session services, matches an operator-configured output root and durable run identity, and serves only explicitly listed artifacts. It rejects symlinks, traversal and private working folders. HTML runs with a sandbox without same-origin privileges. This retains restart readability without treating historical reports as fresh gate proof.

Midscene 1.12.6 starts a detached CDP proxy even for borrowed Chrome. Cleanup therefore verifies its private PID metadata against the pinned proxy script and endpoint, stops that proxy, and independently releases owned Chromium or disconnects borrowed Chrome. The user's Chrome process is never a cleanup target. Unknown ownership or cleanup remains unavailable evidence.

Explicit crash recovery records the original host and current official command as well as proxy/browser ownership. It refuses a live owner, stops only matching orphan processes, and persists interrupted evidence without replay. An actual separate-host SIGKILL test during a real official CLI model request proves recovery stops the surviving command and browser. Bridge resources without verifiable ownership remain unknown.

## Official Skills and managed execution

The remediation adds a narrow managed adapter over the pinned official browser Skill and CLI (Midscene 1.12.6; Skill commit dec1d1c55252ecb1a90c4ecbcfd0d2cb3ce0ac7b). Five tools resolve the real session workspace and expose doctor, exploration, approved-suite execution, inspection and explicit interrupted-run cleanup through existing Harness services. These adapters are now part of remediation; the earlier proposal to defer all native tools no longer describes this scope. No second workflow state machine is introduced.

Each managed child discards inherited MIDSCENE settings and receives a freshly resolved credential reference, explicit endpoint and visual model family. Formal suites must share the configured target origin. Named required validators fail closed when unavailable, run after shell checks, and revalidate input/deployment identity after downstream approval. Historical success never authorizes a new completion request.

Actual host-death verification kills a separate host during an official CLI model request and proves explicit recovery stops only the recorded CLI, proxy and owned Chromium. Recovery never replays actions or turns an interrupted run into passed evidence.

### Approval freshness follow-up

The formal manifest now records the actual target process instance. A final request-only authenticated probe after downstream approval reuses the original private login snapshot and verifies source, suite, deployment receipt, build, served UI bytes, and target instance before the transition commits. Restarting the target with identical build bytes still invalidates the earlier acceptance. The recheck requires the original in-memory run result; recovered JSON evidence is insufficient. Regression coverage includes restart during approval and cancellation during the probe.

Source fingerprints exclude only root `.devflow` runtime state, so creating, claiming, or transitioning cards does not require rebuilding the application. Nested or similarly named paths remain bound. Formal suite files resolving into the excluded runtime directory are rejected, including symlink aliases. Real Git fixtures verify runtime edits preserve identity while application and suite edits invalidate it.

Final review fixed two concrete seams: all model/login secret redaction now shares one helper that preserves JSON literals for short local keys; final approval also checks original report publication before commit. A real authenticated HTTP/Git/filesystem regression confirms deleting a report during approval or restarting the target rejects the transition evidence.

## Related decisions

[Access preparation and card reports](../../implemented/feature/2026-09-16-midscene-access-reports.md) implements and owns the private-login preparation and card-local report portion of this proposal. This is partial fulfillment; the broader acceptance proposal remains active rather than being archived or treated as fully delivered.
