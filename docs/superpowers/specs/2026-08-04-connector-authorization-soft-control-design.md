# Connector Authorization Soft-Control Design

## Goal

Keep every connector skill visible so the agent can identify connector intent accurately, while using the `byai-channel` prompt hook to prevent unnecessary tool calls and produce a clear ByClaw connection message when the requested connector is disabled for the current conversation.

## Confirmed Product Rules

- `metaData.authConnectorList` is the conversation-scoped source of truth. A `false` value means the connector is not connected or authorized for the current conversation.
- Connector skills remain visible regardless of authorization state. The runtime must not use `skillFilter` to remove disabled connector skills.
- Enforcement is prompt-based soft control. The hook must tell the agent to evaluate connector availability before any tool call.
- When user intent requires a disabled connector, the agent must immediately explain that the connector is unavailable, direct the user to the ByClaw connector management page, and stop the turn without calling tools or retrying.
- An enabled connector follows the normal skill and tool path.

## Root Causes

The current implementation sends a request-scoped `skillFilter` into OpenClaw. That filter removes disabled connector skills before the model sees them, which can damage intent recognition. It also does not remove plugin tools such as `baiying_call` or `byclaw_chat_context`, so it cannot prevent the repeated failed-tool sequence shown in the supplied screenshots.

The connector prompt currently says not to call the disabled connector skill, but it does not explicitly override memory lookup, chat-context guidance, workspace tool instructions, or retry behavior. In the same request, the chat-context detector can misread a normal `@当前助手` address as a cross-agent reference and inject a conflicting instruction to call `byclaw_chat_context`.

## Architecture

### 1. Preserve connector skills

`byai-channel` will stop resolving and passing a connector-derived `skillFilter`. `baiying-enhance` will no longer register the connector skill-filter provider. The shared connector-filter runtime and the implementation that existed solely for this flow will be removed when no remaining callers exist.

This change restores the normal OpenClaw skill snapshot. The agent can still read the `dws`, `fws`, and `wecomcli` skill descriptions and use them for intent recognition.

### 2. Strengthen the prompt decision protocol

`buildDisabledConnectorPrompt` will emit a highest-priority pre-tool protocol. It will include the disabled connector identifiers and require this sequence:

1. Before using memory, chat context, connector tools, generic tools, or skill instructions, determine whether the user's current intent requires a listed disabled connector.
2. If it does, do not call any tool, do not simulate a tool, do not search memory or chat history, and do not retry an unavailable tool.
3. Reply immediately with the localized ByClaw connection guidance.
4. If the intent does not require a disabled connector, continue normally; enabled connectors and unrelated tools remain available.

The protocol explicitly overrides conflicting tool-use instructions from connector skills, workspace files, memory guidance, and the chat-context prompt. It does not claim that every tool is disabled globally.

### 3. Correct cross-agent hint detection

A plain address such as `@钉钉个人助手 帮我查询钉钉组织通讯录信息` is a request to the current lane, not a request to inspect another lane. Cross-agent context becomes required only when the text also contains an explicit handoff/review/reference intent such as continuing, taking over, reviewing, summarizing, or referring to another agent's previous output.

The base `byclaw_chat_context` usage guidance remains available, but the mandatory cross-agent call paragraph will not be injected for an ordinary addressed business query.

### 4. Add policy observability without hard blocking

The channel will log concise policy events without secrets:

- normalized enabled and disabled connector identifiers for the inbound request;
- confirmation that soft-control prompt context was injected;
- confirmation that connector skill filtering is disabled;
- a warning if a tool call still occurs during a request that carries disabled connectors, including session key, tool name, and connector identifiers.

The warning is diagnostic only. It does not block or mutate the tool call because the confirmed product policy is soft control.

### 5. Preserve and verify Langfuse propagation

For enabled-connector calls, `baiying_call` must retain the active Langfuse trace and pass the current tool observation as the downstream parent. The verified propagation path is:

`byai-channel diagnostic trace` → `baiying_call tool context` → `resource_context.langfuseParentObservationId` → DOC/MCP `executeViaCallAgent` input → callAgent payload and metadata aliases.

Logs will expose non-secret correlation identifiers needed to verify the path: channel trace ID, Langfuse trace ID, parent observation ID, tool call ID, and channel session ID. The callAgent payload must carry both the canonical camel-case field and compatibility aliases already required by downstream consumers.

## Data Flow

1. `byai-channel` parses `metaData.authConnectorList` and stores the normalized map on the active request.
2. The prompt snapshot includes all normal skills plus the connector soft-control protocol when at least one connector is disabled.
3. The model evaluates user intent with connector skill descriptions still visible.
4. Disabled intent produces the ByClaw connection guidance with no tool call. Enabled or unrelated intent proceeds through the normal tool policy.
5. Tool hooks record diagnostic policy warnings but do not enforce authorization.
6. Enabled `baiying_call` requests propagate Langfuse trace and parent observation metadata through callAgent.

## Testing Strategy

### Unit tests

- Assert no connector-derived `skillFilter` is passed into dispatch for either enabled or disabled maps.
- Assert the Chinese and English connector prompts forbid all preliminary and retry tools only when current intent requires a disabled connector, while allowing unrelated enabled work.
- Assert a normal `@当前助手` business request does not require cross-agent context.
- Preserve tests for explicit cross-agent continuation and review prompts.
- Assert policy logs contain connector identifiers and tool correlation fields without payload secrets.
- Assert `baiying_call` passes the resolved parent observation ID and trace ID through `resource_context`, DOC/MCP routing, and callAgent payload aliases.

### Local integration tests

Build and install `byai-channel` and `baiying-enhance` into `~/.openclaw/extensions`, then start the local OpenClaw gateway with `openclaw_template.json` and the supplied runtime environment.

Run the same query against the 钉钉个人助手 in two states:

- `dws=false`: the response is the ByClaw connector-unavailable guidance; the run must not call `memory_search`, `baiying_call`, or `byclaw_chat_context`.
- `dws=true`: the agent may call `baiying_call`, the DingTalk organization query succeeds or reaches the real connector boundary, and the Langfuse trace contains the complete parent/child chain.

Server logs must show normalized connector policy, prompt injection, soft-control mode, tool activity, and Langfuse correlation IDs.

## Non-Goals

- No connector skill is removed or hidden.
- No `before_tool_call` hook blocks calls.
- No global tool allowlist is changed.
- No connector credentials, Redis credentials, or Langfuse secrets are persisted in source, test fixtures, documentation, or commits.
