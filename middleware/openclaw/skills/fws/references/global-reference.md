# 全局参考

## 安装与初始化

```bash
# 安装官方 CLI
npx @larksuite/cli@latest install

# 初始化应用配置；会输出授权/配置链接
lark-cli config init --new

# OpenClaw/Hermes/Lark Channel 环境优先绑定 Agent 已配置的应用
lark-cli config bind --source openclaw --identity user-default

# 人工场景可用推荐授权；OpenClaw agent 场景必须使用下方 --domain/--scope split-flow
lark-cli auth login --recommend
lark-cli auth login --domain docs --no-wait --json
lark-cli auth login --scope "calendar:calendar:readonly" --no-wait --json
lark-cli auth login --device-code <device_code> --json
lark-cli auth status --json --verify
lark-cli whoami
lark-cli auth logout --json
```

不要把 App Secret、token、cookie 或本地凭证写入 skill、代码仓库或回复。OpenClaw 场景优先绑定 `channels.feishu`，不要默认新建一个与 OpenClaw 脱钩的本机 app。

### OpenClaw 渠道配置与绑定顺序

OpenClaw 里有三层配置，顺序不能反：

1. OpenClaw 渠道配置：`openclaw.json` 必须存在 `channels.feishu`，至少包含 `appId`、`appSecret`、`domain`。
2. lark-cli 工作区绑定：用 `lark-cli config bind --source openclaw --identity ...` 把 OpenClaw 渠道同步到当前 lark-cli workspace。
3. user 身份授权：访问个人通讯录、日历、邮箱、个人云空间等 user 资源时，再用 `auth login --scope/--domain --no-wait --json`。

当提示“当前 OpenClaw 配置中未检测到飞书（Feishu）渠道”、`openclaw.json missing channels.feishu section` 或 `configure Feishu in OpenClaw first` 时：

- 这是渠道缺失，不是用户授权缺失；不要让用户“确认授权”，不要执行 `auth login`。
- 如果 agent 能执行命令并回传输出，先执行 `lark-cli config init --new --force-init`，从本次输出提取 `https://open.feishu.cn/page/cli?...` 配置链接，再执行 `python3 scripts/qrcode_data_uri.py "<config_url>" --alt "飞书应用配置二维码"` 生成 data URI 二维码。
- 将配置链接和 data URI 二维码返回给管理员，并说明这只是创建/获取飞书应用入口，完成后仍需把 App ID 和 App Secret 安全写入 OpenClaw 的 `channels.feishu`；二维码生成失败时只返回可点击链接和失败原因，不能返回破图占位。
- 如果 agent 不能执行命令或没有拿到配置链接，再返回手工配置指引：用户/管理员需要先在 OpenClaw 后台或 `openclaw.json` 中配置 `channels.feishu`。
- 不要在回复里展示 App Secret；可展示配置字段名和示例占位符。

用户回复“配置成功了”后，不要重复要求配置 `channels.feishu`，先检查当前 lark-cli workspace：

```bash
lark-cli config show
lark-cli auth status --json --verify
```

- 如果 `config show` 能看到 `appId`，说明 `config init --new --force-init` 已经把飞书应用写入当前 lark-cli 本地配置；可先继续 user 授权和本次业务查询。
- 如果仍提示未配置 app，重新生成配置链接或让管理员检查当前 agent 与生成链接时是否同一个 workspace。
- 即使用本地配置跑通，也要提醒管理员后续把同一个应用凭证同步进 OpenClaw `channels.feishu`，否则新会话、新沙箱或 `config bind --source openclaw` 仍可能失败。

OpenClaw 渠道存在后，按场景绑定：

```bash
# 个人通讯录、日历、邮箱、个人云空间等用户资源
lark-cli config bind --source openclaw --identity user-default

# 机器人发消息、群通知、应用身份场景
lark-cli config bind --source openclaw --identity bot-only
```

如果 `config bind` 提示从 `bot-only` 切到 `user-default` 有风险，必须先向用户说明“AI 将以用户飞书身份访问个人资源”，用户确认后才可加 `--force` 重跑。

### 本机应用初始化 split-flow

仅在本机非 OpenClaw 场景，或管理员明确要创建飞书应用用于填入 OpenClaw 渠道时，才使用 `config init`：

1. 非 Agent 本机场景执行 `lark-cli config init --new`；OpenClaw/Hermes 环境下如管理员明确要新建独立应用，才执行 `lark-cli config init --new --force-init`。
2. 立即读取本次输出，只从本次输出提取配置链接，通常是 `https://open.feishu.cn/page/cli?...`。
3. 执行 `python3 scripts/qrcode_data_uri.py "<url>" --alt "飞书应用配置二维码"`，从 JSON 输出读取 `markdownImage`。
4. 将 URL 原样嵌入 Markdown 超链接返回给管理员，格式为 `[点击打开飞书应用配置](<url>)`，并在下一行返回 `markdownImage` 二维码；不要修改、拼接或重新编码 URL，禁止输出裸长链接。
5. 禁止返回本地图片路径。ByClaw/OpenClaw 聊天页无法访问 agent 本地生成的相对路径图片，`![飞书应用配置二维码](relative.png)` 会显示成破图；二维码脚本失败时只返回可点击链接和失败原因。

## 身份类型

| 身份 | 参数 | Token | 适用场景 |
|------|------|-------|----------|
| 用户身份 | `--as user` | user access token | 用户个人资源：日历、邮箱、个人云空间、用户可见的文档/表格/Wiki |
| 应用/机器人身份 | `--as bot` | tenant access token | 机器人发消息、应用自有资源、后台服务视角 |
| 自动 | `--as auto` | CLI 自动选择 | 仅在你明确理解 CLI 行为时使用；agent 场景更推荐显式指定 |

身份选择规则：
- 查用户日历、邮箱、Drive/Wiki/Slides/Docs 等个人资源时，默认显式 `--as user`。
- 机器人向群或用户发消息时，通常用 `--as bot`。
- bot 缺少权限时，在飞书开发者后台开通 scope；不要对 bot 执行 `auth login`。
- user 缺少权限时，使用 `auth login --scope` 或 `--domain` 增量授权。

## Agent 授权 split-flow

当命令返回缺少 user scope、401/403、登录态失效，或者用户要求登录/授权时，必须立即中断当前业务命令并执行 split-flow：

```bash
# 当前轮只发起授权，立即返回 JSON
lark-cli auth login --scope "<missing_scope>" --no-wait --json

# 没有单个明确 scope，但能判断业务域时使用 domain；--domain 可重复
lark-cli auth login --domain docs --domain drive --no-wait --json

# 用户完成授权后，在后续轮用本次返回的 device_code 完成登录
lark-cli auth login --device-code <device_code> --json
```

执行要求：
- 第一轮必须通过 OpenClaw `exec` 发起授权，并立即通过 `process` 读取本次返回。
- 第一轮从本次 JSON 中提取 `verification_url` 和 `device_code`；必要时用 `verification_uri_complete` 兜底授权 URL。
- 执行 `python3 scripts/qrcode_data_uri.py "<verification_url>" --alt "飞书授权二维码"`，从 JSON 输出读取 `markdownImage`。
- 把 `verification_url` 原样放入 Markdown 超链接返回给用户，推荐格式：`[点击打开飞书授权](<verification_url>)`，并在下一行返回 `markdownImage` 二维码。
- 配置应用链接同样必须可点击，推荐格式：`[点击打开飞书应用配置](<config_url>)`。
- 禁止输出 `授权链接：https://...`、`配置链接：https://...` 这类裸 URL；裸长链接在聊天 UI 中容易换行且不可点。
- 禁止返回本地图片路径、`file://...` 或相对路径二维码；本地相对路径图片在聊天页会破图。二维码脚本失败时，只返回可点击授权链接和失败原因，不要返回 `![飞书授权二维码](relative.png)` 这类破图占位。
- 返回时明确提示“授权完成后回复我，我会继续完成登录”。
- 不要修改、拼接、编码/解码授权 URL。
- 不要在同一轮展示 URL 后立刻阻塞轮询 `--device-code`；用户看不到 URL 会导致流程卡住。
- 不要复用历史 `verification_url` 或 `device_code`；每次重新授权都重新生成。`device_code` 只允许用于本次授权会话的后续确认轮。
- 用户回复已授权后，由 agent 执行 `lark-cli auth login --device-code <device_code> --json`，成功后再用 `lark-cli auth status --json --verify` 确认登录态。
- bot 身份缺少 scope 时禁止执行 `auth login`；直接返回错误 envelope 中的 `console_url`，让管理员在飞书开放平台开通权限并发布/生效。

## 全局 flags

| Flag | 说明 |
|------|------|
| `--format json` | 业务命令机器可读输出；本 skill 默认要求显式加上 |
| `--json` | 部分 auth/config 命令使用的 JSON 输出开关 |
| `--as user|bot|auto` | 指定调用身份 |
| `--dry-run` | 预览请求，不执行写入 |
| `--yes` | 高风险写操作确认后执行 |
| `--page-all` | 自动翻页读取全部结果 |
| `--page-limit <n>` | 限制最多读取页数 |
| `-q` / `--jq` | 按 CLI 支持情况过滤 JSON 输出；不确定时先查 `--help` |

为减少更新提示干扰机器解析，可在命令前设置：

```bash
LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1 lark-cli <command> --format json
```

## JSON 输出契约

`--format json` 下：

成功写 stdout，退出码为 0：

```json
{ "ok": true, "identity": "user", "data": {}, "meta": {} }
```

失败写 stderr，退出码非 0：

```json
{ "ok": false, "identity": "user", "error": { "type": "api", "subtype": "...", "code": 99991679, "message": "...", "hint": "..." } }
```

判断成功必须看退出码或 `ok == true`。不要用 `code == 0` 判断；成功 envelope 没有顶层 `code`。

## 命令层级

`lark-cli` 有三层调用方式：

1. Shortcut：`lark-cli <service> +<shortcut>`，优先使用，参数更适合 agent。
2. API Commands：`lark-cli <service> <resource> <method>`，调用前查 `schema`。
3. Raw API：`lark-cli api METHOD /open-apis/...`，只在现有命令不覆盖时使用。

原生 API 调用前必须确认 schema：

```bash
lark-cli schema calendar.events.instance_view --format json
lark-cli calendar events instance_view --params '{"calendar_id":"primary"}' --format json
```

## 高风险确认门禁

高风险命令不带 `--yes` 时可能返回 exit 10 和：

```json
{
  "ok": false,
  "error": {
    "type": "confirmation_required",
    "hint": "add --yes to confirm",
    "risk": { "level": "high-risk-write", "action": "drive +delete" }
  }
}
```

处理流程：
1. 展示 `risk.action`、目标对象和影响范围。
2. 等待用户明确同意。
3. 在原命令末尾追加 `--yes` 后重试。

不要静默加 `--yes`，不要把确认门禁当普通失败。

## 环境变量

| 变量 | 说明 |
|------|------|
| `LARKSUITE_CLI_CONFIG_DIR` | 覆盖 CLI 配置目录，隔离不同 OpenClaw/租户环境 |
| `LARKSUITE_CLI_NO_UPDATE_NOTIFIER` | 设为 `1` 时关闭更新提示，避免污染 JSON 解析 |
| `LARKSUITE_CLI_NO_SKILLS_NOTIFIER` | 设为 `1` 时关闭 skills 提示，避免污染 JSON 解析 |

凭证目录和 keychain 由 `lark-cli` 管理。不要手写 token 文件；除非用户明确要求重置本机配置，否则不要删除配置目录。
