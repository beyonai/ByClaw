# Agent Note: devflow — the plugin line owns its browser channel

Status: implemented

English | [中文](2026-08-26-devflow-owns-its-browser-channel.zh.md)

## Problem

`packages/devflow/` and `packages/devflow-ui/` are ordinary plugins — nothing in either tree exists upstream, and none of it patches the harness. But the board could not leave this repository, because making it work had taken four edits to harness-owned packages: two entries in `API_REMOTE_FORWARDED_EVENTS` (a hardcoded `as const` array whose own comment says an entry there is the only way to forward an event), two entries in the generated `KNOWN_SESSION_EVENT_TYPES`, a relaxed arity check in the Typert Gateway client, and a keyboard helper extracted into `ui-primitives`.

The session-event pair was the dangerous one. A harness that does not know an event type — and whose envelope is not marked `ignorable`, an escape hatch `Session.append` does not expose — **refuses to rebuild the whole session**, by deliberate design. Publishing these plugins as they stood would have corrupted session replay on every harness without the matching patch.

Meanwhile the ecosystem already had the answer: `dsh-better-sidebar`, a purely external plugin, serves its own `/sidebar/api/*` and `/sidebar/ws/*` off `ctx.webServer` — a service published on npm. The PRD (`.agents/prd/2026-08-26-devflow-standalone-plugin.md`) asks for the same move here.

## Decision

**The data path changes owner: from "the framework forwards for us" to "the plugin serves its own."**

- **One new host package, `@zhchxiao123/dsh-devflow-web`, owns both directions.** It is a Consumer, not a provider and not part of the store: its whole job is projecting `ctx.devflow` onto HTTP. A deployment that leaves it out keeps the tool and command planes and simply has no web board — the same shape as leaving out `ui-devflow` before it.
- **The read face is read-only, and the dispatch table is the enforcement.** `list` and `detail` have routes; `transition`, `create`, `claim`, `attachArtifact`, and `archiveDone` have none, and a test enumerates them. devflow's three-plane split (model tools, `/devflow`, approvals) is a property of the design, not of which channel the browser happens to use.
- **Only two methods, because only two have consumers.** The PRD listed five. `history` and `holder` were never on the browser wire — `detail` aggregates them, which is why it exists — and `read` has no browser caller. Publishing the other three would be wire surface with nothing behind it.
- **The session id is the only scoping key that travels.** The host resolves it to a devflow root exactly as the retired Remote face did, so the browser still cannot choose or send a path. Responses keep carrying the resolved `root`, as they always have; the property is one-directional and always was.
- **The trust rule is restated, not imported.** `isTrustedApiRequest` is package-internal to `client-connection`, and this plugin may depend only on published surface. A divergence between the two copies is a defect in the copy, which its module doc says out loud; `trustedHosts` is a validated Config field asserted at load, because a typo there silently voids or broadens a grant.
- **A read failure's reason stays host-side.** The store names files under the devflow root in its own messages, so forwarding one would hand the browser a path it could not have asked with. The envelope carries a stable `devflow-web: <method> failed` and the log carries the rest. Refusals the face itself decides — unknown method, non-POST, a malformed body — do carry their reason, because they describe what the caller sent; the trust fence alone answers bare, so an untrusted caller learns nothing about the route.
- **A push frame names the event and nothing else.** Not the card — that would put a second truth in the browser, racing the read the board renders. Not the root either: the acceptance criteria also pin the refetch set to what the forwarded events produced, and the browser keys bindings on session id with no root-to-page map, so a root field would be an unread value on a published wire. The frame is the trigger; the read face is the answer.
- **The browser half owns its own recovery.** It refetches on every frame and on every open — first open and every reopen, since a board that was down cannot know what it missed — and reopens after a drop on a delay that doubles from two seconds toward a thirty-second ceiling, resetting on the next open. The old `connection/reset` refetch went with the dependency: the chat connection resetting has nothing to do with this channel any more.
- **The two session events are deleted, not rescued.** Nothing in the repository read them, and the loop already logs each call and its result as `tool/call` / `tool/result`, so a devflow-shaped copy was a trace with no reader. `ignorable` would have needed an upstream change to `Session.append`; deletion needs none and is a net subtraction. `KNOWN_SESSION_EVENT_TYPES` is generated, so it returned to its upstream contents by regeneration alone.

## Alternatives considered

- **Add a runtime registration surface for forwarded events** — the right upstream fix, and still worth proposing, but it makes devflow depend on a harness version that has it. Serving its own channel makes devflow work on the harness that exists today.
- **Export `isTrustedApiRequest` from `client-connection`** — one more harness edit to carry, for a rule that is thirty lines. The restatement is the cheaper half of the trade and the ecosystem's own precedent.
- **Mark the session events `ignorable`** — needs an option `Session.append` does not have, i.e. an upstream change, to keep two events nothing reads.
- **Keep `read`/`history`/`holder` on the route for symmetry with the seam** — the seam's shape is not the wire's shape; a browser channel projects what a browser asks for.

## Consequences

`git diff origin/master -- packages/api packages/core packages/client/ui-primitives` contains no devflow reference. What remains there is unrelated: the Gateway arity fix (`b8368b8744`, its own commit with its own test, ready to propose upstream) and the `escapeDismissHandler` extraction, which is now an ordinary two-consumer primitive whose doc names neither plugin. The one apparent exception is the tool-catalog inventory test, which enumerates whichever tool packages the workspace holds and empties itself when these packages move out.

`ui-devflow` injects `sessions`, `slots`, and `locale`; board data needs no service at all. `DevflowStore` is a plain `Service` again, with no Typert Remote face and no `typert-protocol` dependency. Every visible board behavior is unchanged, which the existing two-workspace browser e2e keeps proving — it now runs the self-hosted read and push path end to end.

Still deferred, and now unblocked: relocation itself — renaming out of `@deepseek-ai/*`, a standalone repository, npm publication, `dsh.plugin.json` and a bundle patch. The user-visible identifiers were chosen for it in advance: `/devflow/api`, `/devflow/ws`, and the sidebar page id `dsh-devflow:board` name the domain, not the scope, so a rename is not a breaking one.
