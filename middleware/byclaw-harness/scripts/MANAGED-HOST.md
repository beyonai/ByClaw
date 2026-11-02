# Managed shared DSH host

Set `BYCLAW_MULTI_HOST_MANAGED=1`, `BYCLAW_MULTI_HOST_ID` to the platform shared-instance UUID,
`BYCLAW_MULTI_HOST_CAPACITY` to its positive capacity snapshot and `BYCLAW_MULTI_HOST_TOKEN` to
its private secret. Mount `BYCLAW_MULTI_HOST_ROOT` as private persistent storage. Never share
this root across hosts or remove `managed-fences/` to retry a released generation. Preload users
are ignored. Without the managed flag the fixed-host protocol stays unchanged.
The root entrypoint prepares the absolute `BYCLAW_MULTI_HOST_ROOT` (default `/data/multi-host`)
as the image's `byclaw` user with mode `0700` before dropping privileges. Missing parent directories
are created with mode `0755`; existing parents must be trusted. Symlinks, writable/untrusted roots and overlap with
`BYCLAW_MULTI_HOST_USER_ROOT` are rejected. Preparation never recurses into existing user files.

For an explicit chat-only validation host, set `BYCLAW_DSH_TOOL_ENV=none`.
This disables the remote tool backend, browser/terminal sidebars and execution plugins.
Every model tool execution is denied and the assembled model prompt contains no tools.
Internal instruction reads use that user's `home/chat-only-workspace`; user homes, mount
validation, identities and managed admission fences remain separate and unchanged.
Unset/empty values keep the existing `opensandbox` default. Restore `opensandbox` or
`byclaw-be` to validate tools; chat-only success does not establish tool readiness.

The platform PUTs `/v1/users/<contextKey>` with `managed`, `instanceId`, `mappingId`, positive
`generation`, matching `sandboxId`, `capacity`, real `userCode`, tenant/user IDs,
`workerAgentType=BYCLAW_DSH_SHARED_<contextKey>_<generation>` and epoch-ms `leaseExpiresAt`.
The first PUT needs `env`; later PUTs without it renew the existing fence. New credentials do
not replace a running context's credentials. GET requires instanceId/mappingId/generation query
parameters. DELETE requires the same fence in JSON. Bearer host credentials or
`X-Byclaw-Host-Token` authenticate administration; provider Authorization may coexist with the
latter. Browser web tokens cannot administer the host.

DELETE writes and fsyncs an atomic mode-0600 tombstone before draining. Unknown/busy telemetry
or a disposal failure returns an error and retains capacity; callers must retry. A newer
positive generation may enter only after the old context has gone. Restarting the process does
not erase release fences. Pending and ready contexts both consume host capacity.

Lease expiry denies gateway admission, closes browser WebSockets and stops the worker consumer
without cancelling active executions. A poll already in progress cannot execute a late command:
the worker checks its context lease at execution admission. Real telemetry combines the ByClaw
session runtime (including team children), DSH agents/jobs and gateway in-flight requests. Missing
services or malformed telemetry remain busy. Unknown activity can therefore retain capacity and
requires investigation; no timer declares it safely idle. The legacy idle stream reporter is
disabled in managed contexts so it cannot trigger exclusive-sandbox cleanup.

Managed worker types are explicit and exclusive. Homes, team state, profile directories and
OpenSandbox aliases/template substitution use the opaque tenant context; credential identity
uses the real user code. Managed Redis claims include the context/generation and an executor
nonce, use owner-checked release, and reject a legacy fixed-host claim for the real user.
This build **rejects Redis Cluster configuration explicitly**; deploy only with standalone
Redis until a Cluster implementation and runtime verification are supplied.

Both Dockerfiles include the managed registry module. Unit tests do not prove a complete image
boot, model call, private-volume isolation or browser disconnect semantics on every DSH version.
The matching ByClaw integration plugin with `byclawManagedRuntime` is required for ready status.

Browser runtime directories use `<root>/run/<hash-of-context-home>/browser` instead of the long
managed context path, keeping Unix socket paths within the broker limit. The hash includes the
full home path so different contexts and host roots do not reuse a browser socket or its state.
