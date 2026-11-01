# Tool process environment boundary

The runtime host may hold shared infrastructure credentials. A tool sandbox is a
user execution boundary, so SSH process requests must not inherit the host's Redis,
cloud provider, tracing, platform bridge, web management, JEV, or Typesafe credentials.
`scrubEnvironment` applies to the merged launch and caller environment immediately
before SSH dispatch. It preserves the logged-in user's `BEYOND_TOKEN`, identity,
locale, and ordinary business settings for authorized ByClaw CLI operations.

The tool sandbox service specification must also remain free of shared infrastructure
credentials. Adding another host provider requires extending the central protected
environment policy and its regression test before forwarding that provider's settings.
This policy does not grant file access: each tool sandbox still mounts only its
own user's AgenticFS access point, and file API requests retain user authorization.

## Purpose template catalog

`BYCLAW_TOOL_ENV_CATALOG` is a server-rendered JSON array. Each entry has
`templateKey`, a distinct `serviceKey`, `capabilities` (string array), and
`enabled`. The shared host accepts this setting from its own environment or
from the trusted per-user launch environment. It is not a model input.

The runtime registers `sandbox_templates`, `sandbox_acquire`, `sandbox_exec`,
and `sandbox_release` with the Harness tool registry. Each purpose receives an
isolated SSH/subprocess context, key directory, alias, backend, and execution
leases; the legacy default SSH context remains available for compatibility.
Purpose images mount the current user's existing AgenticFS space at `/by`.
The returned lease exposes `workspaceRoot`, `serviceKey`, and the actual
`sandboxId`, without SSH or ingress credentials.

Before admitting an environment, the SSH helper handshake must pass and the
runtime reads `/etc/byclaw-tool-sandbox/capabilities.json` through SSH. Its
contract must be `byclaw.tool-sandbox/v1`, purpose and required capabilities
must match the catalog, and operations must declare private SSH. This is a
compatibility check, not a replacement for server authorization. Catalog
backends bind their generated SSH keys to the single launch request through
`toolEnvironmentKeys`; they never update user-global private parameters.

Commands execute through the selected SSH subprocess provider, with bounded
output, cancellation, and a deadline. Returning the final reference releases
that purpose's compute. A failed release retains its lease for retry. It does
not release another purpose or another task's live reference. Idle cleanup of
the legacy default environment retains its existing behavior. This initial
catalog implementation does not implement Display access, desktop takeover,
or a Windows adapter.

Purpose environments disable the legacy idle timer while catalog handles own them.
The last explicit lease return performs real release. The awaited Harness
`agent/turn-stopping` boundary also returns only that agent's remaining leases;
`agent/status=idle` covers cancelled/failed turns that skip the normal stop hook,
and `agent/disposed` retries cleanup. These are infrastructure events with
`origin=task-end`, never fabricated `sandbox_release` model calls. Failed or
unknown cleanup retains ownership and logs `ownership-retained` for retry.
Catalog cleanup sends the exact allocated `expectedSandboxId`. It clears ownership
only after the backend returns `releaseConfirmed: true`, `remoteAbsentConfirmed:
true`, and that same sandbox ID. A generic success envelope, missing receipt, or
changed target retains the lease and its persisted allocation for retry; it must
not release a newer sandbox of the same purpose. Legacy callers without an exact
target keep their existing API behavior.
The receipt is checked directly, without a `getSandboxInfo` request that could
read an unrelated latest allocation. As soon as launch reports an ID, it is
persisted before validating the private SSH endpoint, so a rejected endpoint
can still be cleaned up by exact ID. Changing a persisted catalog service first
requires confirmed cleanup of its old ID; an unknown result blocks replacement
allocation and remains retryable through cleanup. A runtime `released` log is
not independent cloud evidence: end-to-end acceptance also verifies that exact
sandbox's cloud 404 and database released state.
The default legacy tool environment keeps its existing idle behavior.

Acquisition reserves a handle before awaiting readiness, so a concurrent last
lease return cannot destroy a newly requested environment. Failed handshakes
whose cleanup outcome is unknown retain the original allocation and actor
ownership; replacement acquisition is blocked until task-end or disposal cleanup
confirms release. Task-end cleanup waits for that actor's existing SSH executions
to settle and rejects new acquisitions/executions during cleanup.

Cancellation terminates the SSH subprocess and awaits public `waitForExit()`
without reusing the cancelled signal. Actor cleanup starts only after remote
termination settles, so a transient cleanup RPC cannot strand an idle-pinned
lease behind the connection's busy guard.
