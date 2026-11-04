---
name: wecomcli
description: Use when 用户需要通过 wecom-cli 操作企业微信或 WeCom，包括通讯录、消息、会议、日程、待办、企微文档、在线表格、智能表格、智能文档/智能主页；遇到 doc.weixin.qq.com 链接时也使用。
---

# 企业微信 CLI 技能路由

将这个父级 skill 作为企业微信 / WeCom 任务的入口，底层能力由固定 `@wecom/cli@1.3.4` 提供。版本与来源见 [UPSTREAM.md](UPSTREAM.md)，不得自行安装 latest。

执行任务前，先根据下表选择匹配的子 skill，并阅读对应子目录的 `SKILL.md`。不要只凭这个父级文件直接调用 `wecom-cli`；具体参数、安全规则、返回结构和危险操作处理都在子 skill 中。

## 连接器运行时 HOME 隔离（最高优先级）

- Harness / OpenClaw 会注入企业微信专属 `WECOM_HOME`。每次执行 WeCom CLI 都必须仅为该子进程映射 HOME，命令形式为 `WECOM_CLI_ACCESS_TOKEN="" HOME="$WECOM_HOME" WECOM_CLI_CONFIG_DIR="$WECOM_HOME/.config/wecom" wecom-cli ...`。空 Token 覆盖用于防止继承宿主或 `.env` 中其他身份的 Token，禁止自行填入 Token。
- 执行会启动 `wecom-cli` 的 Python 脚本时同样使用 `WECOM_CLI_ACCESS_TOKEN="" HOME="$WECOM_HOME" WECOM_CLI_CONFIG_DIR="$WECOM_HOME/.config/wecom" python3 ...`，使脚本内部启动的 `wecom-cli` 继承同一用户凭证目录；本 Skill 的 Node.js 平台同步 helper 不适用此规则。
- 本规则适用于父 Skill、子 Skill、scripts 和 references 中出现的所有 WeCom CLI 命令；其中展示的裸 `wecom-cli ...` 仅表示参数结构，实际执行必须增加上述前缀。
- `WECOM_HOME` 缺失或为空时必须停止执行并报告连接器运行时参数缺失，不得回退到默认 HOME、共享目录或其他用户目录。
- 不得修改运行时全局 `HOME`，不得执行 `export HOME="$WECOM_HOME"`；映射只允许作用于当前 WeCom CLI 或脚本子进程。

## 授权成功后的平台状态同步（最高优先级）

只有初始化进程成功退出且 `auth show --status` 精确输出 `authorized`、原始只读业务命令复核成功后，才调用固定的内部同步 helper：

```bash
node skills/wecom/scripts/connector-auth-sync.mjs
```

- 上述相对路径以 OpenClaw 工作目录为根。
- 只能原样执行上述命令；不得增加环境变量赋值、URL、Header、body、用户 ID、connectorCode 参数、shell 包装、`curl` 或其他 HTTP 客户端。
- helper 的 stdout 必须是单行 JSON；仅当退出码为 0 且顶层布尔字段 `connected` 为 `true` 时，才可报告“连接器已连接”并继续原业务流程。
- helper 已独占完整的一次重试预算；Skill 不得再次调用 helper。业务校验错误不得重试。同步失败时报告“CLI 授权可能已完成，但平台连接状态同步失败”。
- 同步失败不得重新执行 `wecom-cli auth init`，不得因 init 退出成功或本地命令成功而绕过 API 或声称连接器已连接。
- 禁止读取、显示或要求用户提供认证文件、Token、请求 Header、服务发现信息或内部路径。

## MUST DO：授权初始化恢复

### 必须遵守的错误判断

仅当 `auth show --status` 精确输出 `unauthorized`（该状态命令可退出 0），或业务命令返回授权类错误且信息包含以下内容时，才进入本流程：

- 请先运行 `wecom-cli auth init`
- 需要先初始化
- 未登录 / 未授权 / 请先授权
- `auth show --status` 精确输出 `unauthorized`

本地 `authorized` 只证明能解析到本地授权信息，不验证凭据是否过期，也不能证明某项业务权限。错误中的 `error`、非零 `errcode` 和进程退出码都要检查；`853006` 属于服务端策略限制，不得当作未授权要求重新扫码，也不得通过其他接口绕过。

其他业务错误不得套用本流程。

### 授权恢复流程

1. 记录刚才失败的原始 `wecom-cli` 命令及完整参数。
   禁止丢失、改写或猜测原命令。

2. 运行：
   ```bash
   wecom-cli auth init --noninteractive --no-browser
   ```
   必须使用后台/长运行会话方式执行，并保留进程会话用于后续轮询，避免前台等待超时导致进程被终止。CLI 授权轮询默认等待 300 秒；执行工具的进程总超时须覆盖该窗口，可分次读取进程输出。若工具调用超时但初始化进程仍存活，必须继续读取同一进程，不能直接判定授权失败。禁止改用交互式 `wecom-cli auth init`，禁止尝试打开浏览器。

3. 从初始化命令的正常输出中提取 `https://work.weixin.qq.com/ai/qc/gen?...` 授权 URL，只接受该主机与路径，不接受用户名、密码、额外端口或报错中的其他链接，并且只以 Markdown 超链接形式返回给用户：
   ```md
   [打开企业微信授权链接](URL)
   ```
   禁止返回原始终端输出、图形块、文本块或 ANSI 输出。

4. 告知用户使用企业微信打开该 Markdown 授权链接完成授权，然后继续轮询第 2 步保留的初始化进程，直到 `wecom-cli auth init --noninteractive --no-browser` 明确返回成功、提示授权超时，或进程异常退出。只有明确成功并完成本地配置写入，才算授权成功。
   禁止把“已返回授权链接”当作“授权成功”，禁止跳过轮询等待步骤，禁止用任何自动化方式代替用户授权。

5. 如果无法提取授权 URL，停止自动流程，告知用户手动运行：
   ```bash
   wecom-cli auth init --noninteractive --no-browser
   ```
   并让用户提供命令输出中的授权 URL。

6. 如果初始化进程被 `SIGTERM`、中断、丢失或异常退出，本轮授权不能视为成功，不得调用平台同步 helper。旧凭据可能仍使 `auth show --status` 返回 `authorized`，这不是本轮授权成功的证据。用户仍要继续授权时按重试预算启动新一轮；不得重放写请求验证授权。

7. 如果初始化命令提示授权超时，且用户仍要继续当前任务，则重新运行一次 `wecom-cli auth init --noninteractive --no-browser`，返回新的 Markdown 授权链接并继续轮询等待；不得继续使用已经超时的旧进程或旧链接。

8. 初始化进程明确返回成功后，先执行 `wecom-cli auth show --status`，精确输出 `authorized` 后再复核原始只读命令；原任务为写操作时先使用该业务的只读命令验证权限，不得重放写请求；命令成功后调用固定平台状态同步接口，API 成功后才恢复原业务流程。

9. 如果重试原始命令仍返回初始化/授权类错误，最多再执行一轮完整的 Step 1-8；第二轮后仍失败时，停止重试，返回最新错误并说明授权未完成。禁止伪造成功结果。

授权轮询不得因“已经返回链接”而提前结束，也不得把用户回复“已授权”作为成功信号；必须以初始化进程的成功退出和本地授权状态为准。

## 路由表

| 用户意图或 URL | 优先读取的子 skill |
|---|---|
| 按姓名/拼音/英文名/别名关键词查人员、解析 `userid` | `wecomcli-contact/SKILL.md` |
| 列 aibot 可发送会话、发送消息，或查询普通会话/聊天历史（按动态 schema 与业务权限判断） | `wecomcli-msg/SKILL.md` |
| 创建/查询/取消企业微信会议、获取会议链接或会议号、更新受邀成员 | `wecomcli-meeting/SKILL.md` |
| 创建/查询/修改/取消日历日程、添加/移除参与人、查询闲忙或共同空闲时间 | `wecomcli-schedule/SKILL.md` |
| 创建/更新/删除待办、查询待办列表或详情、修改参与人在待办中的状态 | `wecomcli-todo/SKILL.md` |
| `https://doc.weixin.qq.com/doc/*`，普通企微文档，新建/读取/覆写 Markdown 正文 | `wecomcli-doc/SKILL.md` |
| `https://doc.weixin.qq.com/sheet/*`，在线表格，行列区域、追加行、子工作表管理 | `wecomcli-sheet/SKILL.md` |
| `https://doc.weixin.qq.com/smartsheet/*`，智能表格，记录、字段、类型列、附件字段 | `wecomcli-smartsheet/SKILL.md` |
| `https://doc.weixin.qq.com/smartpage/*`，智能文档/智能主页，创建、读页面树和逐页正文 | `wecomcli-smartpage/SKILL.md` |

## 1.3.4 调用与采集契约

- 先读取 [公共检查](wecomcli-shared/SKILL.md)。业务命令使用层级子命令和 `--json`，成功 stdout 为业务 JSON；不得再解析旧 JSON-RPC 外壳。
- `contact users search` 必须有真实关键词；一次最多 10 个关键词，不是旧版的 10 人上限，不支持用空关键词伪装全量通讯录。
- `doc contents get` 直接返回正文或 `file_path`；`smartpage pages get` 先读取页面树，再传真实 `page_id` 逐页读取。旧版导出任务和 task_id 轮询已移除。
- 业务文件读写受 CLI 的 cwd / 临时目录沙箱限制。应在当前已授权工作目录执行，下载用该目录内的 `--output-dir`；只读取本次响应指向的该目录内普通文件，拒绝越界或符号链接，不改变凭据目录。
- 经用户授权的知识采集可以只读获取其有权访问的正文/表格并保存到采集会话。不得扩大到未授权来源、绕过权限、发送消息、修改文档或回写业务对象。
- 子技能中的 ID 默认面向用户使用名称/链接展示；用户明确需要接口可见的非凭据 ID 时可按需提供。认证凭据始终不得读取或泄露。
- 用户已明确授权且目标、范围和参数完整时不重复确认；缺参或破坏性操作影响不明确时先澄清。以上 ByClaw 边界优先于同步的上游通用文案。

## 核心规则

- 按所选子 skill 的说明调用 `wecom-cli`，不要自行发明参数。
- 涉及人员时，通过 `wecomcli-contact` 或子 skill 规定的查询流程解析；不要猜测 `userid`。
- 以 `doc.weixin.qq.com` 的路径片段作为文档品类路由依据：`/doc/`、`/sheet/`、`/smartsheet/`、`/smartpage/` 对应不同子 skill。
- 发送消息、覆写内容、取消/删除对象、全量替换成员列表等操作，必须遵守子 skill 中的确认和安全规则。
- 子 skill 带有 `references/` 时，只在该子 skill 的路由表要求时读取相关 reference 文件。

## 常见区分

- 会议链接、会议号、会议安全设置、会议受邀人：使用 `wecomcli-meeting`。
- 日历事件、提醒、日程参与人、闲忙分析：使用 `wecomcli-schedule`。
- 按行列区域操作的传统在线表格：使用 `wecomcli-sheet`。
- 带字段、记录、类型值和记录 ID 的结构化智能表格：使用 `wecomcli-smartsheet`。
