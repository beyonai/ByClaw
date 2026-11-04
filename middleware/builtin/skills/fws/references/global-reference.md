# 全局参考

## 安装与初始化

所有 CLI 命令遵守父 Skill 的 HOME 隔离：仅对子进程使用 `HOME="$LARK_HOME"`，缺少 `LARK_HOME` 时停止。
检查、初始化、登录和验证须使用同一 `LARK_HOME`、同一 CLI workspace 和同一运行时环境；不得清空或改写用于配置发现的环境信号，不得切换 profile、workspace 或来源寻找另一份配置，保留已有绑定和凭证。
本文的 `scripts/...` 相对已加载的 `SKILL.md` 所在目录定位；执行时使用解析后的脚本绝对路径，保持当前执行工作目录，不切换 CLI workspace。

```bash
# 安装官方 CLI
npx @larksuite/cli@latest install

# 先检查同一 LARK_HOME 的应用元数据；已有应用直接复用，另行验证凭证
lark-cli config show

# 仅满足下方全部首次配置门槛时初始化；profile、损坏配置或未知错误禁止初始化
lark-cli config init --new --force-init

# 人工场景可用推荐授权；Agent 场景必须使用下方 --domain/--scope split-flow
lark-cli auth login --recommend
lark-cli auth login --domain docs --no-wait --json
lark-cli auth login --scope "calendar:calendar:readonly" --no-wait --json
lark-cli auth login --device-code <device_code> --json
lark-cli auth status --json --verify
lark-cli whoami
lark-cli auth logout --json
```

不要把 App Secret、token、cookie 或本地凭证写入 skill、代码仓库或回复。应用配置和个人凭证都保留在当前用户持久化的 `LARK_HOME` 中。

### CLI 应用配置与用户授权顺序

1. 先执行 `lark-cli config show` 检查同一 `LARK_HOME` 的应用元数据。已有应用时直接复用，不重新初始化或切换配置来源；退出码为 0 且有 `appId` 也不证明密钥引用有效。
2. 首次配置门槛：只有 `config show` 本身明确返回 `not_configured`，且没有既有应用元数据，同时错误为 `error.type=config`、`error.subtype=not_configured`、没有 `error.field`，错误消息明确表示缺少应用配置，才允许初始化。不能仅凭 subtype 或缺少 appId 推断应用不存在。
3. 已有应用需要访问个人资源时执行 `auth login --scope/--domain --no-wait --json`。若 `auth login` 返回 `not_configured`，但已有 `appId` 或其他应用元数据，应报告应用配置或密钥引用错误并保留绑定和凭证，不得重新初始化。

`error.field` 为 `--profile`、`LARKSUITE_CLI_PROFILE` 或 `currentApp` 表示 profile 选择错误，先修正既有 profile 选择并保留配置；仅针对报错指明的选择确认原应用，不试切其他 profile、HOME、workspace 或来源。无活动 profile、`invalid_config`、未知错误消息或密钥错误均须停止并报告，不得初始化。

不要求任何聊天渠道配置。历史外部配置来源报错时，先检查当前 CLI 应用元数据；已有应用时继续其凭证检查，不因历史提示重复配置或换来源。
外部应用配置导入只是管理员明确选择的可选操作，先查 `lark-cli config bind --help` 确认当前 CLI 支持的来源与身份策略。
如果导入会从 `bot-only` 切到 `user-default`，须说明 AI 将访问用户个人资源并取得确认；不自动增加 `--force`。

### 本地应用初始化 split-flow

1. 只有满足上述全部首次配置门槛，才执行 `lark-cli config init --new --force-init`；已有应用、profile 选择错误或检查出现其他错误时不得运行初始化命令。
2. 使用当前运行时的命令执行工具读取本次进程输出，只从本次输出提取配置链接，通常是 `https://open.feishu.cn/page/cli?...`；后台进程用对应进程工具读取。
3. 执行 `python3 scripts/qrcode_data_uri.py "<url>" --alt "飞书应用配置二维码"`，从 JSON 输出读取 `markdownImage`。
4. 将 URL 原样嵌入 Markdown 超链接返回给管理员，格式为 `[点击打开飞书应用配置](<url>)`，并在下一行返回 `markdownImage` 二维码；不要修改、拼接或重新编码 URL，禁止输出裸长链接。
5. 禁止返回本地图片路径。ByClaw 聊天页无法访问 agent 本地生成的相对路径图片，`![飞书应用配置二维码](relative.png)` 会显示成破图；二维码脚本失败时只返回可点击链接和失败原因。
6. 管理员回复完成后，在同一环境再执行 `lark-cli config show`。读取到 `appId` 仅确认元数据写入，随后仍需用户登录和 `auth status --json --verify`；密钥引用或登录失败时报告错误，保留应用与凭证，不换 HOME、不重新初始化。

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
- 第一轮使用当前运行时的命令执行工具发起授权，并立即读取本次进程输出；后台进程用对应进程工具读取。
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
- 用户回复已授权后，由 agent 执行 `lark-cli auth login --device-code <device_code> --json`，成功后再用 `lark-cli auth status --json --verify` 确认登录态，并按父 Skill 完成平台状态同步后恢复业务；用户回复“已授权”本身不代表登录成功。
- `verification_url`、二维码和 `device_code` 只属于本次授权会话。若 `device_code` 已过期、已使用、无效或登录命令失败，必须丢弃旧授权信息，重新执行 `auth login --scope/--domain --no-wait --json` 生成全新的链接和 `device_code`，禁止重试旧值。
- 单个业务请求最多执行两轮完整授权流程；第二轮仍失败时停止自动重试，报告最新错误并要求用户重新发起授权。未通过 `auth status --json --verify` 前不得恢复原业务命令。
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
| `LARK_HOME` | 运行时注入的当前用户凭证目录，仅对子进程映射为 `HOME` |
| `LARKSUITE_CLI_CONFIG_DIR` | CLI 配置目录覆盖项；不得指向共享目录或绕过当前用户的 HOME 隔离 |
| `LARKSUITE_CLI_NO_UPDATE_NOTIFIER` | 设为 `1` 时关闭更新提示，避免污染 JSON 解析 |
| `LARKSUITE_CLI_NO_SKILLS_NOTIFIER` | 设为 `1` 时关闭 skills 提示，避免污染 JSON 解析 |

凭证目录和 keychain 由 `lark-cli` 管理。不要手写 token 文件；除非用户明确要求重置本机配置，否则不要删除配置目录。
