# @zhchxiao123/dsh-devflow-web

English | [中文](README.zh.md)

Devflow's own browser channel: a Consumer that projects the read side of the [`ctx.devflow`](../devflow/README.md) seam onto one prefixed JSON route on [`ctx.webServer`](../../host/webserver/README.md). The board reaches its cards through this plugin rather than through any framework-owned forwarding face, which is what lets the devflow plugins compose into a stock harness — nothing here needs a change to the harness's own packages.

## The route

One prefix route, `/devflow/api`, whose last path segment names the method. The prefix names the domain, not the npm scope, so republishing these plugins under another scope is not a breaking rename.

```
POST /devflow/api/<method>    { "sessionId": "...", "id": "..." }
  -> 200 { "ok": true, "value": ... } | { "ok": false, "error": "..." }
```

Six methods exist across two dispatch tables, and together they are the whole of the face. Three read: `list` returns the session's active cards, `detail` returns one card with its complete decoded journal and current lease holder in a single round trip, and `archived` returns one page of the session's archive — newest bucket first, narrowed by an optional `YYYY-MM` `month`, resumed by the `cursor` a truncated page carries. The archived method fixes the set it reads rather than taking one from the body: opening the seam's full query to an untrusted caller would let it choose which set the host walks, and the board has no need to. Three write, and they are exactly the decisions a person makes about a card's place on the board: `archive-done` sweeps the finished cards, `archive` files one, and `abandon` drops one with the reason that is all it leaves behind. A segment absent from both tables has no route at all (404) and every method is POST-only (405).

What is *not* projected is the executing surface: `transition`, `create`, `claim`, and `attachArtifact` have no route here, and neither does `restore` — offering "take it back" beside "drop it" reads as though dropping were reversible, which it is not. Devflow's plane split has always been about who decides what, not about which channel carries it: the model tool plane executes, and filing and dropping are decisions people make. The board is one of the surfaces they make them on; it is not a second executor.

The two tables are kept apart rather than merged. A read's failure is a settled "cannot see it" whose reason stays host-side; a write's domain rejection is the branch the caller acts on, and travels with a stable code — `revision-mismatch`, `not-done`, `parent-active`, `already-done`, `already-archived`. One table carrying both semantics would have to give up one of them. An infrastructure failure still stays host-side for writes exactly as it does for reads.

Every write's actor is the host's own — `{ kind: 'human' }`, distinct from the `/devflow` plane's `command` actor so the journal says which surface the decision was made on. A browser does not get to say who it is, and the request states a session rather than a root, so it cannot name a path either.

A method's value is the seam's read value verbatim — `list` carries the session's `DevCard`s, `detail` adds the decoded journal and lease holder — so this face publishes exactly what the [Definition](../devflow/README.md) publishes and holds no projection of its own. A field the Definition adds is on the wire the release it lands: `artifactRecords` (each registered deliverable's path, kind, revision, and stage) arrived with store-written artifacts, and the board's card detail is its reader as kind-aware artifact display lands there; until then the board renders the `artifacts` path projection it always has.

Writes carry `expectedRevision` (a non-negative integer) and, for `abandon`, a non-blank `reason` under a fixed length. The blank reason is refused here as well as by the store: this face describes what the caller sent, while the store's own `empty-reason` stays the contract it has always been. `archived` is the one read whose body carries narrowing of its own, and each field is checked before it reaches the seam: `month` must be `YYYY-MM`, `limit` a positive integer clamped to a fixed ceiling, and `cursor` a string of usable length. The ceiling is fixed rather than configured because what it bounds is how many card directories one untrusted request can make the host walk — a property of serving untrusted callers, not a deployment preference; the store's own page size is the tunable one. A cursor's *shape* belongs to the store, so the fence checks only that it is a plausible string and lets the store reject one it did not issue.

The request body names the viewing session and nothing else that scopes a read. The host resolves that session's workspace to its devflow root, so the browser can neither choose nor send a root, a cwd, or any other path. A session omitted reads the store's default root; an unknown session, a missing card, and an unreadable journal all arrive as `ok: false` — a settled answer the board renders as "no board", never a transport failure. The reason for a read failure stays host-side, in the log: the store names files under the devflow root, and the browser must not learn from an answer a path it could not have asked with. A refusal the face itself decides does carry its reason, because it describes what the caller sent — an unknown method, a non-POST read, or a body that is oversized, unparsable, or not an object (the last three at 400, before dispatch). The trust fence alone answers bare, so an untrusted caller learns nothing about what this route expects.

## The change stream

One upgrade endpoint, `/devflow/ws`, behind the same fence. The host listens for `devflow/card-created`, `devflow/stage-changed`, `devflow/card-archived`, and `devflow/card-restored`, and sends every connected browser one frame:

```json
{ "type": "devflow/stage-changed" }
```

A frame says that something in this host's devflow moved and nothing else. The browser answers it by refetching through the read face, so a frame can never become a second truth racing what the board renders — and it can never leak a card into a page whose workspace does not hold it, because the refetch is the same session-scoped read as every other. The channel is one-way: a client that sends anything is closed with 1008, an invalid frame drops that socket alone, and disposal takes the endpoint, the listeners, and every live socket down together.

## The trust fence

Every API request, report read and WebSocket upgrade explicitly calls the public `connection.requestRejection(req)` before dispatch. Registering a WebServer route does not apply authentication automatically. The Connection service verifies the signed browser cookie and host policy; missing, invalid or expired cookies return 401, and a missing or failing Connection service also returns 401. Devflow additionally restricts requests using its own `trustedHosts` fence. The `Host` header must be loopback or a configured `trustedHosts` authority (DNS-rebinding defense — `Host` is the one header a rebound page cannot forge); an explicit cross-site fetch marker is refused; and an attached `Origin` must be exactly this authority. `trustedHosts` entries must be bare canonical `host` or `host:port` values, asserted at load so a typo fails loudly instead of silently voiding or broadening the grant. Set it to whatever the deployment's `/api` fence is set to, or the board breaks exactly where the chat does.

Composition is one line beside the store and the webserver; a deployment that leaves it out keeps the tool and command planes and simply has no web board.

```yaml
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
- id: devflow-web
  name: '@zhchxiao123/dsh-devflow-web'
```

## Model Experience

None, as this package answers a human's browser with card state and touches no prompt, message, schema, stream, or tool result. The model's own view of the same cards stays with [`dsh-tool-devflow`](../tool-devflow/README.md).

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The face is read-only and stays that way** — an approval or a stage move from the browser would need its own plane, not a write method here.
- **No protocol version negotiation** — the host and browser halves ship from one package version, so neither the envelope nor the frame carries a version field; a channel that outlives that assumption needs one.
- **A frame does not say which root moved** — every connected browser refetches on every change, which is what the board did when these events reached it through the framework's forwarding face. Naming the affected root would let a page skip a refetch, but the browser has no root-to-page map to skip with; that map, not the frame, is the missing piece.
- **`trustedHosts` is configured twice** — once here and once on the harness's `/api` fence, because requests must satisfy both the host Connection policy and this plugin’s additional authority restriction. A deployment that changes one and not the other gets a board that will not fetch.

## Acceptance build identity

`POST /devflow/api/build-info` follows the existing host authentication and POST trust fence.
It returns `{ ok: true, value: { schemaVersion: 1, available: false } }` until a built deployment supplies
`buildClient: { artifact: "/absolute/installed/devflow-ui/lib/client.js", entry: "@zhchxiao123/dsh-devflow-ui" }`.
The artifact path stays server-side. The response carries `buildId`, a per-activation `instanceId`,
`serverSha256`, and `client: { path, sha256 }`. The identifier hashes this web plugin's loaded index bundle
and the selected client bundle. It does not identify every Harness or Devflow package; deployment evidence
must separately retain the full installed package hashes.

`artifactIdentity(serverArtifact, buildClient)` computes the same identifier from local built files for deployment tooling.
Activation snapshots the bytes; changes or missing files invalidate subsequent reads. Source-mode execution reports unavailable.
Acceptance callers must fetch `client.path` with the same authenticated context and verify its bytes against `client.sha256`;
the configured path alone is not proof of what the host serves. The Midscene JSON build probe performs that check before and after cases.

`acceptanceReports: [{ workspace: "/canonical/workspace", output: "/private/external/results" }]` enables
`GET /devflow/reports/<sessionId>/<runId>/<asset>` for that session's workspace. Formal report files must appear in the
run manifest; exploration files must appear in its explicit `artifacts` list. The route explicitly checks the host Connection authentication before resolving sessions or reading files.
Responses are no-store, nosniff and sandboxed, and reject symlinks, traversal, unlisted/private files and payloads over 64 MiB.

Client paths come from the published `clientModules.graph()` entry, including its `/plugins/??…&rev=…` query. The endpoint checks public `clientPath()` against the configured artifact and `fetchBundle()` against the raw local executable source using only rc.2's documented-in-source final debug-trailer and single-entry combo transform. `client.sha256` identifies the exact served response, while the receipt's build ID still binds raw local artifact hashes. Registry absence or mismatched/stale bytes returns unavailable; no static route is guessed.
