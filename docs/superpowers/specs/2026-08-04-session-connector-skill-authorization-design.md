# Session Connector Skill Authorization Design

## Goal

Use inbound `metadata.authConnectorList` to describe which third-party connector skills are available for the current ByAI conversation. A connector whose value is `false` must be absent from the current dispatch's skill catalog, and the model must explain that the connector is not connected when the user's intent requires it.

The map key is the OpenClaw skill filter name. For example, `dws: false` disables the `dws` skill for that dispatch. A `true` value permits an already registered skill but does not register or grant a new skill.

## Compatibility Rules

- Missing `authConnectorList`, a non-object value, an empty object, or an object with no boolean entries preserves current behavior.
- Only entries whose values are exactly boolean are accepted. Connector names are trimmed; empty names are ignored.
- Only `false` entries change skill visibility. Other dynamically registered and workspace skills remain available.
- The policy is scoped to one inbound message/dispatch and must not mutate `openclaw.json` or the process-wide `agents.list[].skills` configuration.
- Multi-agent lane messages inherit the normalized connector authorization map from the original inbound message.

## Architecture

### 1. Inbound parsing and session propagation (`byai-channel`)

`sdk-app.ts` reads `metadata.authConnectorList`, normalizes it to `Record<string, boolean>`, and stores it on `ByaiSdkInboundMessage`. `sdk-message-processor.ts` copies it into `ActiveSdkRequest`; `session-context.ts` also publishes it in the existing process-local shared channel request context so a sibling extension can resolve the policy by `sessionKey` without importing `byai-channel` source.

The normalized map remains attached when an inbound message is split into multi-agent lane messages. Field absence remains distinguishable from an explicit map so legacy requests do not acquire a skill filter.

### 2. Business-rule prompt injection (`byai-channel`)

`prompt-injection-snapshot.ts` adds a connector-availability section when at least one connector is disabled. The section is generated in the request language and instructs the model to:

- recognize when the user's intent requires a disabled connector;
- not call, simulate, or claim success from that connector skill;
- state that the named connector is currently not connected/authorized and the requested operation cannot be completed;
- guide the user to open ByClaw connector management, find the connector, select connect/authorize, complete identity authorization, and retry after connection succeeds.

The wording follows the supplied screenshot's structure. The metadata key is shown as the connector identifier; the model may include a familiar product name when it knows one, but must not invent connection state or connector details.

The section is part of the existing per-dispatch prompt snapshot, so tool rounds receive the same rule without additional state mutation.

### 3. Dynamic registration-aware filter provider (`baiying-enhance`)

A focused `connector-skill-filter.ts` module owns calculation of the effective skill allowlist:

1. Resolve the current agent's effective skill filter from the live OpenClaw config populated by `baiying-enhance` dynamic agent registration.
2. If the agent has no explicit filter, enumerate the currently visible workspace/plugin skills through the OpenClaw skill runtime.
3. Remove skill names whose same-named `authConnectorList` entry is `false`.
4. Return the remaining names as the dispatch `skillFilter`. A `true` key never adds a name that was absent from the dynamic registration result.

`baiying-enhance` registers this resolver as a narrow process-local runtime service. The service contract and accessor live under `byclaw-exe/extensions/shared/`, the repository's existing boundary for communication between extensions. This avoids a direct source import between product extensions.

The provider is read-only: it does not write config, invalidate the global skill snapshot, or restore state after a run. Therefore two concurrent sessions may use different authorization maps without affecting one another.

### 4. Per-dispatch enforcement (`byai-channel`)

Before calling `dispatchReplyFromConfig`, `sdk-message-processor.ts` asks the runtime service for the current agent's allowlist and passes it as `replyOptions.skillFilter`. OpenClaw then builds or refreshes that session's skill snapshot against the allowlist, so disabled connectors are absent from the model-visible skill catalog.

The allowlist is calculated once for the inbound request and reused by context-overflow continuation dispatches. It is not persisted as a global agent policy. When no connector is disabled, `skillFilter` is omitted so current OpenClaw behavior is unchanged.

If authorization requires filtering but the `baiying-enhance` runtime service is unavailable or fails, the request fails closed by using an empty per-dispatch filter and logs a warning. This prevents a connector explicitly marked `false` from becoming visible because of plugin load order or a provider error; it affects only that dispatch.

## Data Flow

1. Gateway receives `metadata.authConnectorList`.
2. `byai-channel` normalizes and stores it on the inbound message and active request.
3. The prompt snapshot records the disabled-connector response rule.
4. `byai-channel` requests an allowlist from the `baiying-enhance` runtime provider.
5. The provider starts from the live dynamically registered skill set and removes same-named `false` connectors.
6. `byai-channel` passes the result as `replyOptions.skillFilter` for the current dispatch and any overflow continuation.
7. A later request recomputes its own policy; no prior authorization map is reused.

## Error Handling and Observability

- Malformed authorization metadata is ignored rather than rejecting a legacy inbound message.
- Provider absence/failure with disabled connectors logs the session/agent and disabled connector names, without logging tokens or other sensitive metadata, then applies an empty per-dispatch filter.
- Prompt content lists only connector names explicitly present with `false`; it does not expose unrelated inbound metadata.
- Dynamic registration data remains unchanged on disk and in memory.

## Tests

### `byai-channel`

- Normalize boolean connector entries and ignore invalid values/blank names.
- Preserve missing/empty metadata behavior.
- Carry the map through inbound parsing, active request registration, shared request context, and multi-agent lane cloning.
- Generate Chinese and English disabled-connector prompt rules, and generate no rule when nothing is disabled.
- Pass the provider result into `replyOptions.skillFilter`.
- Reuse the same filter during overflow continuation.
- Fail closed for that dispatch when the provider is missing or throws.

### `baiying-enhance`

- Remove `false` connector skills from an explicit dynamically registered agent skill list.
- Keep `true` connectors only when already registered; never add them.
- Preserve unrelated dynamic/workspace skills.
- Enumerate visible skills when the agent has no explicit filter, then remove disabled connectors.
- Return no override when there are no disabled connectors.
- Resolve different authorization maps independently for concurrent session inputs.

### Verification

Run focused Vitest suites for both extensions, then each extension's complete test and build commands.
