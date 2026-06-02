---
name: bykc-ecosystem-collector
description: >
  ByKC 生态知识采集与入库。用于用户在 OpenClaw 对话中要求采集网页、OpenCLI manifest 支持的平台、邮箱等外部生态知识，并沉淀到个人默认知识库或指定知识库。支持多轮补齐来源链接、采集范围、业务信号和知识库目标，再调用 ByClaw 生态采集 API 启动任务。
allowed-tools: read exec process
metadata:
  openclaw:
    requires:
      bins:
        - node
      tools:
        - read
        - exec
        - process
    primaryEnv: BE_SERVER_PORT
---

# ByKC 生态采集技能

这个技能负责在 OpenClaw 对话里承接用户的生态采集意图，补齐必要参数，并调用 ByClaw 后端启动真实采集任务。OpenClaw 负责理解、追问和编排；ByClaw 后端负责连接器运行、MinIO 原始文件落地、Markdown 转换、知识库导入、任务审计和状态记录。

不要直接绕过 ByClaw 后端写 MinIO、写库表或调用底层采集执行器。普通用户侧应感知为“生态采集”“平台采集执行器”或“ByClaw Browser Bridge”。

本技能走本地脚本路线，不通过 `baiying_call` 调用技能本身。`baiying_call` 是百应后端资源调用桥，只有当生态采集被注册成 TOOL/TOOLKIT/MCP 资源时才使用。

本技能需要数字员工启用这些工具：

- `read`：OpenClaw 用它加载完整 `SKILL.md`。
- `exec`：执行本技能目录下的采集脚本。
- `process`：长任务或异步状态轮询时使用。

不要调用 `read` 去读取网页内容。`read` 只用于加载技能文件；网页、知乎、公众号等来源的读取、转换、入库都由 ByClaw 后端和平台采集执行器完成。

如果当前数字员工没有可用的 `read` 或 `exec` 工具，不要反复尝试其他工具；请直接告诉用户：当前数字员工未启用生态采集技能所需工具，需要在数字员工工具权限里加入 `read`、`exec`、`process`，或改从门户“生态采集”页面发起。

必须通过 `node skills/bykc-ecosystem-collector/scripts/bykc-ecosystem-collect.mjs ...` 执行采集计划、启动和查询。不要自己拼 `curl`、`fetch` 或其它 HTTP 请求直接访问 `/ecosystemCollection/**`，因为脚本负责 Redis 服务发现、门户会话读取、防重放签名和错误诊断。如果当前工作目录已经是本技能目录，也可以使用 `node scripts/bykc-ecosystem-collect.mjs ...`。

如果脚本返回 HTTP 4xx/5xx 或 `ok=false`，不要改用 `web_fetch`、浏览器抓取、`curl` 抓网页、复制网页正文等旁路方式继续采集。应该把脚本返回的 `error`、`backend.source`、`backend.baseUrl`、`backend.serviceName`、`backend.redisKey` 和 `auth` 摘要报告给用户，说明生态采集后端链路未打通，并停止本次采集。

如果 `plan` 成功但对 QQ 邮箱返回 `UNSUPPORTED_RUNTIME`、旧本机采集端动作名，或要求 `CONNECTION/IMAP`，不要直接断言“只能去门户生态采集”。这通常表示实际命中的 ByClaw 后端不是支持邮箱 Browser Bridge 的新版本。请把脚本输出里的 `backend.source`、`backend.baseUrl`、`backend.serviceName`、`backend.redisKey`、`plan.plannerVersion`、`plan.collectMode`、`plan.authType`、`plan.missingActions` 原样摘要给用户，并提示需要重启/部署对应 ByClaw 后端或修正服务发现。

## 触发场景

当用户表达这些意图时使用本技能：

- 采集这个知乎链接到我的知识库
- 把这篇网页保存到个人记忆
- 采集 OpenCLI 已支持平台上的搜索结果或内容
- 采集需要浏览器登录态的平台内容
- 把客户 A 的邮件需求沉淀到个人知识库
- 同步最近 7 天收件箱里的客户需求邮件

当前真实运行范围以 ByClaw 后端为准。ByClaw 后端会动态读取内置 OpenCLI 的 manifest（`opencli list -f json`），OpenCLI 支持的可读采集命令会作为运行时虚拟生态能力开放；不再使用 `bykc_ec_connector` 表维护能力目录。需要浏览器登录态的能力走 ByClaw Browser Bridge，公开/API/本地 CLI/IMAP 类能力走平台内置 OpenCLI。QQ 邮箱网页版是 ByClaw Browser Bridge 的邮箱采集动作和运行时虚拟 `mail` 能力，不要表述成 DB 连接器，也不要表述成 OpenCLI 内置 QQ 邮箱 adapter。

## 参数心智

优先补齐这些信息：

- 来源：网页、OpenCLI manifest 支持的平台、邮箱等。
- 链接或范围：网页通常必须提供 `sourceUrl`；OpenCLI manifest 平台按具体命令可能需要链接、关键词、用户/内容 ID 或范围；邮箱通常需要时间范围、文件夹和关键词。
- 入库目标：默认进入个人默认知识库；用户可以指定知识库。
- 业务信号：项目、产品、客户、领域、标签，用于后续检索、聚合、技能沉淀和企业记忆候选识别。

邮箱规则：

- 不要在对话中索要或输出邮箱授权码、密码、Token。
- 用户提到 QQ 邮箱或普通网页邮箱采集时，优先走 ByClaw Browser Bridge：用户需要在浏览器插件里完成绑定，并在浏览器登录邮箱；不需要用户本地安装 OpenCLI。
- 只有用户明确选择 IMAP/授权码方式，或后端计划返回 `authType=IMAP` 时，才引导用户去门户保存 IMAP 连接配置。
- 如果 `missingActions` 包含 `BROWSER_BRIDGE`，请引导用户安装/启用 ByClaw Browser Bridge，并在本地浏览器打开目标网站完成登录，然后回到对话继续。QQ 邮箱示例中目标网站是 `https://mail.qq.com/`。若后端返回旧本机采集端动作名，也按 Browser Bridge 处理。
- 如果 `missingActions` 包含 `CONNECTION`，请根据计划中的 `authType` 判断：`IMAP` 才引导用户到“知识中心 -> 生态采集 -> 邮箱”保存邮箱账号、IMAP 服务器和授权码；`BROWSER` 则优先引导连接 Browser Bridge。
- 用户说“最近一周/最近 7 天/今天/某客户/某关键词”时，把这类条件放到 `scope` 或原始文本里，由 ByClaw 后端生成任务范围；Browser Bridge 模式下邮箱文件夹如 `INBOX/收件箱` 放到 `scope`，不要构造 `imaps://...` 作为 `sourceUrl`，只有用户明确选择 IMAP/授权码方式时才使用 IMAP 相关参数。

隐私规则：

- 默认只进入个人记忆或个人知识库。
- 不要自动进入企业记忆。
- 只有用户明确确认“沉淀为企业资产/企业知识/企业技能”时，才进入企业记忆相关流程。

## 工作流

1. 先调用 `plan` 生成采集计划。

```bash
node skills/bykc-ecosystem-collector/scripts/bykc-ecosystem-collect.mjs plan --text "采集这个知乎链接到个人知识库" --source-url "https://www.zhihu.com/question/..."
```

执行命令时，优先从 OpenClaw 工作空间根使用 `skills/bykc-ecosystem-collector/scripts/bykc-ecosystem-collect.mjs`；如果工具需要绝对路径，使用技能上下文中的 `baseDir` 或 `location` 所在目录拼接到本技能脚本。

2. 如果返回 `ready=false`，根据 `missingActions` 追问用户。不要把 `missingActions` 的内部编码直接展示给用户，必须翻译成用户能理解的操作指引。

- `SOURCE_URL`：请用户提供要采集的链接。
- `BROWSER_BRIDGE`：请用户安装/启用 ByClaw Browser Bridge，并在本地浏览器完成目标网站登录。QQ 邮箱网页版采集走这条链路。兼容旧本机采集端动作名时，也请转述为 Browser Bridge 未连接，不要展示旧编码。
- `SITE_LOGIN`：Browser Bridge 已连接，但目标网站登录态未就绪；请用户在本地 Chrome 打开目标网站并登录后重试。例如 QQ 邮箱要打开 `https://mail.qq.com/` 并完成登录。
- `CONNECTION`：请用户先完成对应来源授权；邮箱仅在 `authType=IMAP` 时才要求保存 IMAP 连接配置，不要在对话里接收邮箱密码或授权码。
- `UNSUPPORTED_RUNTIME`：说明当前 ByClaw 内置 OpenCLI manifest 没发现该来源的可读采集命令，或当前部署尚未更新到动态 manifest 版本。

3. 如果返回 `ready=true`，先向用户展示摘要并等待确认，不要静默启动。

摘要至少包括：来源、采集范围、入库目标、业务信号、采集模式，以及是否需要浏览器登录态。

4. 用户确认后调用 `start`。

```bash
node skills/bykc-ecosystem-collector/scripts/bykc-ecosystem-collect.mjs start --plan-json '{"connectorCode":"zhihu","sourceUrl":"https://www.zhihu.com/question/..."}'
```

也可以把 plan JSON 通过 stdin 传入：

```bash
echo '{"plan":{"connectorCode":"web","sourceUrl":"https://example.com"}}' | node skills/bykc-ecosystem-collector/scripts/bykc-ecosystem-collect.mjs start
```

5. 启动成功后，向用户说明任务已经进入 ByClaw 生态采集流水线，并给出任务号、运行号、当前状态和入库目标。后续可以引导用户“查看知识、开始问答、生成总结”。

## 脚本

使用 `scripts/bykc-ecosystem-collect.mjs` 调用 ByClaw 后端：

- `plan`：调用 `/ecosystemCollection/skill/plan`
- `start`：调用 `/ecosystemCollection/skill/start`
- `run`：调用 `/ecosystemCollection/runs/detail?runId=...`

脚本优先使用 Redis 服务发现查找 ByClaw 后端地址：读取 `BE_DOMAINNAME`（默认 `ByaiService`），查询 `byai_gateway:sd:instances:${BE_DOMAINNAME}`，再用实例里的 `host`、`port`、`path_prefix` 拼出后端 API 地址。`HOST`、`BE_SERVER_PORT` 只作为服务发现不可用时的本地调试兜底。认证信息优先使用 OpenClaw/百应运行环境已有会话，不要在对话中输出 token、cookie 或私密请求头。

启动真实采集时需要 ByClaw 门户会话认证和前端同款防重放签名。`BAIYING_AGENT_AUTH` 不是门户会话 token，不能单独用于 `/ecosystemCollection/skill/start`。

脚本会自动从当前 OpenClaw/百应运行态读取身份信息：

- `BAIYING_SESSION`：沙箱启动时注入的当前门户 `SESSION`。
- `BEYOND_TOKEN`：沙箱启动时注入的当前门户 `Beyond-Token`。
- `USER_CODE`：沙箱启动时注入的当前门户用户编码，用于生成 `x-signature-*`。
- `OPENCLAW_STATE_DIR/identity/by_user_info.json`：OpenClaw identity 文件兜底来源。
- `~/.openclaw/workspace/baiying-session.json`：本地调试认证文件兜底来源。

`BYCLAW_ECOSYSTEM_SESSION`、`BYCLAW_ECOSYSTEM_USER_CODE`、`BYCLAW_ECOSYSTEM_BEYOND_TOKEN` 只允许作为本地临时调试兜底，不要配置到 ByClaw 共用 `.env`，也不要要求用户在对话中提供。脚本会自动补齐 `Cookie: SESSION=...; PORTAL-SESSION=...`、`x-signature-sessionId` 和 `x-signature-*`。这些值属于运行期敏感信息，只能从当前登录态注入，不要写入技能文件或对话回复。
