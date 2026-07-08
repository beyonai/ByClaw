# 全局参考

## 安装与初始化

```bash
# 安装官方 CLI
npx @larksuite/cli@latest install

# 初始化应用配置；会输出授权/配置链接
lark-cli config init --new

# 用户授权；推荐先按业务域或缺失 scope 授权
lark-cli auth login --recommend
lark-cli auth status --json --verify
```

不要把 App Secret、token、cookie 或本地凭证写入 skill、代码仓库或回复。需要配置凭证时，引导用户走 `lark-cli config init --new`。

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

当命令返回缺少 user scope，或者用户要求登录/授权时：

```bash
# 当前轮只发起授权，立即返回 JSON
lark-cli auth login --scope "<missing_scope>" --no-wait --json

# 用户完成授权后，在后续轮用本次返回的 device_code 完成登录
lark-cli auth login --device-code <device_code> --json
```

执行要求：
- 第一轮从 JSON 中提取 `verification_url` 和 `device_code`，把 `verification_url` 原样返回给用户。
- 不要修改、拼接、编码/解码授权 URL。
- 不要在同一轮展示 URL 后立刻阻塞轮询 `--device-code`；用户看不到 URL 会导致流程卡住。
- 不要复用历史 `verification_url` 或 `device_code`；每次重新授权都重新生成。

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
