# @byclaw/dsh-group-task-publication

English | [中文](README.zh.md)

Optional DSH plugin providing `prepare_group_task_publication` for eligible ByClaw sessions. It owns HACU detection, durable activation, tool registration, file validation, and BE calls. ByClaw Integration does not depend on this plugin and works without it.

## Composition and activation

The plugin listens to Integration's awaited `byclaw/session-setup` event. Integration supplies the trusted command, explicit Agent instance and context, and host callbacks for current login headers and `/by/` path mapping. It contains no publication-specific branch, configuration, or stored field. No async `agent/created` interception or method patching is used.

Nonblank strings or positive safe integers at both `extraPayload.groupChat.conversationKey` and `extraPayload.groupChat.childSessionId` enable the tool. Its task ID comes only from `command.header.sessionId`. The plugin records activation by user code and business `command.header.sessionId` in its own `byclaw_group_publications` storage domain. First activation survives switching `agent_id`, recreating a DSH session, later messages without `groupChat`, plugin reload, and process restart. Different users and business sessions remain isolated. Legacy records are read using their saved task and user identity and copied to the business key on use; their DSH creation time no longer controls eligibility. A later qualifying message can activate an existing normal session.

The host awaits the event during Agent setup and before reused input admission, including background-team follow-ups. State persistence finishes before registration and before the factory publishes a new or resumed Agent. The tool is registered only through that Agent context. Repeated setup does not duplicate it; Agent disposal or publication-plugin unloading unregisters it. Loading the plugin creates no global model tool and makes no BE request.

## Implementation

| File | Responsibility |
| --- | --- |
| `index.ts` | Plugin configuration and generic session-event subscription |
| `context.ts` | HACU condition and trusted task/user binding |
| `state.ts` | Plugin-owned durable activation |
| `tool.ts` | Model-facing tool definition and scoped registration |
| `client.ts` | Input/file checks, authentication callbacks, BE protocol and errors |

The dependency goes from this extension to `@byclaw/dsh-integration/session-extensions`, never the reverse. Integration supplies its existing `resolveByClawAuthorization` and `resolveByClawInboundPath` behavior through generic callbacks. This plugin opens no additional Redis connection. `timeoutMs` in this plugin's config sets the POST/file-preflight deadline, defaulting to 30000 ms.

## Tool behavior

`text` is a complete replacement body of at most 100000 characters. `sourcePaths` is the complete replacement attachment list, with at most 100 paths of 1–4096 characters each. Nonblank text or at least one path is required; undeclared arguments are rejected. Files must be readable regular files inside the current user's mounted `/by/` root. The host mapping handles local-test mounts, while BE receives the original virtual paths. Length keywords are preserved in the raw JSON Schema and enforced by Zod; the current DSH PTC renderer may describe bounded input types as `unknown`.

Each call refreshes login headers through the host callback, requires `Beyond-Token`, and sets JSON Content-Type. `groupChat.contextToken` is never an authentication credential. The request is one POST to `/group-chat/tasks/{taskId}/pending-publication` below the configured service prefix; a bare origin gets `/byaiService`. BE checks ACTIVE status, initiator identity, and current group membership, then pushes the private card after commit.

Success requires HTTP success, `ResponseUtil.code` equal to numeric `0` or string `"0"`, and valid data with a matching task ID after string normalization. Numeric task and publication IDs must be positive safe integers; larger IDs must arrive as strings. Only `taskId`, `pendingPublicationId`, `text`, `sourcePaths`, and unchanged `createTime` are returned; attachment-only cards may have `text: null`. Known business failures receive safe explanations; raw diagnostics and credentials are not returned.

Preparing a card does not upload files, send group messages, or complete a task. The user confirms publication on the BE card. A lost connection, malformed success response, or unverifiable outcome is reported as uncertain. POST is never automatically retried. GET at the same URL can inspect the current card but cannot prove which concurrent request produced it.

## Installation and verification

Place this package and Integration in the DSH workspace. Build Integration first, then this optional extension, and add both to the same profile. The repository Docker flow discovers all plugin bundles and builds them in dependency order.

```sh
pnpm --filter @byclaw/dsh-integration run build
pnpm --filter @byclaw/dsh-group-task-publication run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/byclaw-integration
dsh plugin --profile web add /path/to/deepseek-harness/plugins/group-task-publication
pnpm --filter @byclaw/dsh-group-task-publication run verify
```

`--dump-config` includes `group-task-publication`. Its patch contains no credentials or host paths. Verification covers validation, authentication, no-retry failures, optional installation, awaited state writes, session reuse/resume, and plugin unloading without contacting Redis or BE.

Uncertain outcomes identify the failure stage: transport, HTTP status, JSON decoding, response validation, or task identity mismatch. Diagnostics expose only fixed labels, status codes, and known field names; raw response contents and credentials are excluded. POST is never automatically retried.

Runtime logs use the `[group-task-publication]` prefix and a per-call `requestId`. They record validation/authentication/file-check stages, the POST URL and timeout, HTTP status, content type, a bounded sanitized response summary (`code`, `msg`, IDs, creation time, text length, and attachment count), and success or failure. Network failures include recognized transport codes and cancellation state. Request headers, full publication text, attachment paths, and unknown response fields are excluded. Non-JSON responses log only their length.
