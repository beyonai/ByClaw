# Byclaw Wiki

Bundled OpenClaw plugin that mirrors configured GitHub repositories, keeps them
indexed with CodeGraph, and exposes one agent tool: `code_to_wiki`.

## Default behavior

- Repository: `https://github.com/beyonai/ByClaw.git`
- Branch: `develop`
- Tool: `code_to_wiki`
- Schedule: every Saturday at `03:00` in `Asia/Shanghai`
- Data directory: `OPENCLAW_STATE_DIR/byclaw-wiki`
- Checkout directory: `OPENCLAW_STATE_DIR/byclaw-wiki/repos/<repositoryId>`
- Git sync uses shallow clone/fetch by default: `gitDepth: 1`.

The plugin also runs an initial sync on Gateway startup by default so the tool
can answer from a fresh local CodeGraph index. Startup sync runs in the
background and does not block Gateway startup.

If clone, pull, or indexing fails, the repository status moves to `error` and
the plugin retries in the background with exponential backoff. Defaults:

- Maximum automatic retries after a failed sync: 3.
- Initial retry delay: 5 minutes.
- Maximum retry delay: 6 hours.

Until a repository has been cloned and indexed, `code_to_wiki` returns a clear
repository-not-ready error with the last failure and next retry time.

By default, `code_to_wiki` returns raw CodeGraph output to OpenClaw tool results
so the model can inspect source and generate operation documents from code. Each
lookup result also includes the repository local checkout path. Set
`includeRawOutputInToolResult: false` only when you intentionally want quieter
tool results.

## Example config

## Enable the plugin

OpenClaw only exposes `code_to_wiki` after the plugin is built, enabled, and the
Gateway process has loaded it.

For source-checkout development:

```bash
cd byclaw-exe/extensions/byclaw-wiki
npm install
npm run build
openclaw plugins enable byclaw-wiki
```

Then restart the OpenClaw Gateway process. After startup, check logs for:

```text
byclaw-wiki: ready
byclaw-wiki: sync started (startup)
```

If `openclaw plugins enable byclaw-wiki` is unavailable in your local runtime,
add the `plugins.entries` block below to `~/.openclaw/openclaw.json` manually
and restart Gateway.

```json5
{
  plugins: {
    entries: {
      "byclaw-wiki": {
        enabled: true,
        config: {
          repositories: [
            {
              id: "byclaw",
              remoteUrl: "https://github.com/beyonai/ByClaw.git",
              branch: "develop"
            }
          ],
          timezone: "Asia/Shanghai",
          syncDayOfWeek: 6,
          syncHour: 3,
          syncMinute: 0,
          retryInitialDelayMs: 300000,
          retryMaxDelayMs: 21600000,
          retryMaxAttempts: 3,
          includeRawOutputInToolResult: true,
          gitDepth: 1,
          notificationWebhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=...",
          // Or configure only the token and let the plugin build the webhook URL:
          // notificationDingtalkAccessToken: "...",
          notificationDingtalkSecret: "SEC...",
          notificationDingtalkActionCardBtnTitle: "通过",
          // Optional. Leave empty to send the ActionCard without a jump URL.
          notificationDingtalkActionCardBtnUrl: "",
          // Upload the generated markdown document before sending the robot notification.
          notificationDocumentUploadUrl: "/api/cos/upload",
          notificationDocumentUploadPrefix: "",
          notificationRobotType: "dingtalk"
        }
      }
    }
  }
}
```

## Configuration reference

All fields below live under `plugins.entries["byclaw-wiki"].config`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `repositories` | array | ByClaw `develop` | Git repositories to mirror and index. |
| `dataDir` | string | `OPENCLAW_STATE_DIR/byclaw-wiki` | Plugin data directory. Relative paths resolve under `OPENCLAW_STATE_DIR`. |
| `timezone` | string | `Asia/Shanghai` | IANA timezone used by the weekly sync schedule. |
| `syncDayOfWeek` | number | `6` | Weekly sync day. `0` is Sunday, `6` is Saturday. |
| `syncHour` | number | `3` | Weekly sync hour in `timezone`. |
| `syncMinute` | number | `0` | Weekly sync minute in `timezone`. |
| `runOnStartup` | boolean | `true` | Start a background sync when the Gateway service starts. |
| `toolName` | string | `code_to_wiki` | Registered OpenClaw tool name. |
| `httpPath` | string | `/plugins/byclaw-wiki` | Gateway route for status and manual sync. |
| `gitCommand` | string | `git` | Git executable used for clone, fetch, checkout, and commit detection. |
| `codegraphCommand` | string | `codegraph` | CodeGraph executable used for indexing and queries. |
| `commandTimeoutMs` | number | `300000` | Timeout for each Git or CodeGraph command. |
| `maxOutputBytes` | number | `131072` | Maximum stdout/stderr bytes captured per command stream. |
| `retryInitialDelayMs` | number | `300000` | Initial retry delay after clone, pull, or index failure. |
| `retryMaxDelayMs` | number | `21600000` | Maximum exponential backoff retry delay. |
| `retryMaxAttempts` | number | `3` | Maximum automatic retry attempts after a failed sync. |
| `includeRawOutputInToolResult` | boolean | `true` | Include raw CodeGraph output in tool results. |
| `gitDepth` | number | `1` | Git clone/fetch depth. |
| `notificationWebhookUrl` | string | unset | Full group robot webhook URL. |
| `notificationDingtalkAccessToken` | string | unset | DingTalk custom robot access token, used when `notificationWebhookUrl` is unset. |
| `notificationDingtalkSecret` | string | unset | DingTalk robot `SEC` secret for signed webhook requests. |
| `notificationDingtalkActionCardBtnTitle` | string | `通过` | DingTalk ActionCard single-button title. |
| `notificationDingtalkActionCardBtnUrl` | string | empty | DingTalk ActionCard button URL read directly from config; no query parameters are appended. |
| `notificationDocumentUploadUrl` | string | `/api/cos/upload` | COS upload endpoint for generated markdown documents. |
| `notificationDocumentUploadPrefix` | string | empty | Optional COS object prefix sent as multipart field `prefix` only when non-empty. |
| `notificationRobotType` | string | `generic` | Robot payload format: `generic`, `wecom`, `dingtalk`, or `feishu`. |
| `notificationMaxOutputChars` | number | `3000` | Compatibility setting retained for older configs; robot notifications no longer include full document bodies. |
| `notificationMinOutputChars` | number | `1` | Minimum generated document characters required before sending a notification. |

Each `repositories` item supports:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Stable repository id used by `code_to_wiki`. |
| `remoteUrl` | string | yes | Git repository URL. |
| `branch` | string | yes | Branch to clone, fetch, checkout, and index. |
| `localPath` | string | no | Checkout path. Relative paths resolve under `<dataDir>/repos`. |

Relative `notificationDocumentUploadUrl` values resolve against
`BYCLAW_WIKI_COS_UPLOAD_BASE_URL`; when it is unset, the local default base is
`http://localhost:3000`.

## Tool usage

Use `code_to_wiki` before answering source-code questions.

Common modes:

- `explore`: best default for architecture and "how does this work" questions.
- `query`: symbol search.
- `node`: read a file or symbol.
- `files`: inspect repository file structure.
- `callers`, `callees`, `impact`: focused graph navigation.
- `status`: check sync/index state.
- `notify_document`: send the operation document generated by OpenClaw to the
  configured group robot.

The intended flow is:

1. OpenClaw calls `code_to_wiki` with `mode: "explore"` to inspect code.
2. OpenClaw generates the user-facing operation document.
3. OpenClaw calls `code_to_wiki` with `mode: "notify_document"` and
   `documentMarkdown` to send that generated document to the group robot for
   review.

Configure `notificationWebhookUrl` in `openclaw.json`. For DingTalk custom
robots, you can also configure `notificationDingtalkAccessToken` instead of the
full webhook URL.

For DingTalk robots with signing enabled, also configure
`notificationDingtalkSecret`. The plugin computes `timestamp` and `sign` for
each request and appends them to the webhook URL.

DingTalk notifications are sent as a single-button ActionCard. The default
button is `通过`. Configure `notificationDingtalkActionCardBtnUrl` only when
the ActionCard button should jump to a specific page; otherwise it remains
blank. The plugin no longer discovers backend URLs from Redis or appends
dataset document parameters to the button URL.

Before sending a robot notification, byclaw-wiki uploads the generated
`documentMarkdown` as a `.md` file to `notificationDocumentUploadUrl` using
`multipart/form-data` field `files`. When `notificationDocumentUploadPrefix` is
non-empty, it is sent as the optional `prefix` field. Relative upload URLs such
as `/api/cos/upload` resolve against `BYCLAW_WIKI_COS_UPLOAD_BASE_URL`; when
unset, the local default is `http://localhost:3000`. The returned COS `key` is
included in the tool result.

The DingTalk robot message body is intentionally concise:

```text
有新文档需要审核：

用户问：《用户的问题》

百应平台赋能助手 已生成文档，点击去审核是否更新到知识库
```

Supported `notificationRobotType` values:

- `generic`: JSON payload with `type` and `markdown`.
- `wecom`: Enterprise WeChat `markdown` message.
- `dingtalk`: DingTalk single-button `actionCard` message.
- `feishu`: Feishu text message.

## HTTP route

The Gateway route defaults to `/plugins/byclaw-wiki`.

- `GET /plugins/byclaw-wiki`: repository status and schedule.
- `POST /plugins/byclaw-wiki`: sync all repositories.
- `POST /plugins/byclaw-wiki` with `{ "repositoryId": "byclaw" }`: sync one repository.
