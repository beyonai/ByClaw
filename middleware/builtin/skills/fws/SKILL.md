---
name: fws
description: 管理飞书/Lark 产品能力（IM消息/群聊/机器人/卡片、通讯录、日历、Base多维表格、云文档、云空间、电子表格、任务、邮箱、审批、考勤、会议纪要/妙记、知识库、开放平台原生接口等）。当用户需要通过官方 lark-cli 查询、创建、修改、删除或发送飞书资源，处理飞书权限/身份，或实现飞书连接器自动化时使用。
byclaw_managed: true
---

# 飞书全产品 Skill

通过官方 `lark-cli` 命令管理飞书/Lark 产品能力。本 skill 是 ByClaw 各运行时共享的聚合入口，结构参考 `dws`，但底层只走 `lark-cli`。

## 连接器运行时 HOME 隔离（最高优先级）

- 运行时会注入飞书专属 `LARK_HOME`。每次执行 Lark CLI 都必须仅为该子进程映射 HOME，命令形式为 `HOME="$LARK_HOME" lark-cli ...`。
- 执行会启动 `lark-cli` 的 Python 脚本时同样使用 `HOME="$LARK_HOME" python3 ...`，使脚本内部启动的 `lark-cli` 继承同一用户凭证目录；本 Skill 的 Node.js 平台同步 helper 不适用此规则。
- 本规则适用于父 Skill、子 Skill、scripts 和 references 中出现的所有 Lark CLI 命令；其中展示的裸 `lark-cli ...` 仅表示参数结构，实际执行必须增加上述前缀。
- `LARK_HOME` 缺失或为空时必须停止执行并报告连接器运行时参数缺失，不得回退到默认 HOME、共享目录或其他用户目录。
- 不得修改运行时全局 `HOME`，不得执行 `export HOME="$LARK_HOME"`；映射只允许作用于当前 Lark CLI 或脚本子进程。
- 配置检查、初始化、登录和验证必须使用同一 `LARK_HOME`、同一 CLI workspace 和同一运行时环境。不得清空或改写用于配置发现的环境信号，不得切换 profile、workspace 或配置来源来寻找另一份配置；已有绑定和凭证必须保留。
- 本 Skill 及 references 中的 `scripts/...` 均相对已加载的 `SKILL.md` 所在目录定位，并将解析后的脚本绝对路径交给执行工具。保持当前执行工作目录，不为寻找脚本切换 CLI workspace；不得假定镜像布局或固定的 `skills/fws` 路径。

## 授权成功后的平台状态同步（最高优先级）

只有 `lark-cli auth status --json --verify` 明确返回已验证的 user 登录态后，才调用固定的内部同步 helper：

```bash
node scripts/connector-auth-sync.mjs
```

- 按上面的 Skill 目录规则解析 helper 路径，除此之外只能原样执行上述命令；不得增加环境变量赋值、URL、Header、body、用户 ID、connectorCode 参数、shell 包装、`curl` 或其他 HTTP 客户端。
- helper 的 stdout 必须是单行 JSON；仅当退出码为 0 且顶层布尔字段 `connected` 为 `true` 时，才可报告“连接器已连接”并恢复原业务命令。
- helper 已独占完整的一次重试预算；Skill 不得再次调用 helper。业务校验错误不得重试。同步失败时报告“CLI 授权可能已完成，但平台连接状态同步失败”。
- 同步失败不得重新启动 Device Flow，不得复用旧 `device_code`，不得因本地 status 成功而绕过 API 或继续业务命令。
- 禁止读取、显示或要求用户提供认证文件、Token、请求 Header、服务发现信息或内部路径。

## 业务懒刷新后的平台元数据回写（最高优先级）

user 身份业务命令前，先在同一个隔离 HOME 执行 `HOME="$LARK_HOME" lark-cli auth status --json`，只读取本地
`identities.user.tokenStatus`；该预检不得增加 `--verify`，不得把短期 access token 到期误判为授权失效。

- 仅当预检明确返回 `needs_refresh` 或 `refresh_needed`，并且随后 user 身份业务命令成功后，才原样执行一次
  `node scripts/connector-auth-sync.mjs`（按上述 Skill 目录规则定位），让后端从同一 native-home 回读并保存刷新后的生命周期元数据。
- 业务命令未成功、预检状态为 `valid` 或未知时不执行该业务后回写；未知状态继续按现有错误处理流程判断，禁止猜测。
- 回写成功以 helper 退出码为 0 且 `connected=true` 为准。回写失败不得改变已经成功的飞书业务结果，不得重试业务
  命令、重新授权或再次调用 helper；应保留业务结果，并补充说明“业务已完成，但平台连接状态同步暂时失败”。
- bot 身份不使用 user refresh token，因此不执行该业务后回写，也不为此增加 `auth status` 预检。
- 本节是 fws 对 Lark CLI 懒刷新行为的显式 opt-in；不得把该流程扩展到 DWS、WeCom 或未来新增连接器。其他连接器
  只有在自身 Skill 明确声明同类能力和回写契约后才能接入。

## 严格禁止 (NEVER DO)

- 不要使用 `lark-cli` 以外的方式操作飞书资源；禁止自行 `curl`、手写 HTTP 客户端、浏览器点 UI。
- 不要编造 `open_id`、`chat_id`、`message_id`、`base_token`、`table_id`、`event_id`、`task_id` 等标识符，必须从命令返回中提取。
- 不要猜测 flag、JSON 字段、scope 或身份类型；不确定时先查 `--help` 或 `lark-cli schema`。
- 不要把 App Secret、access token、refresh token、session、cookie 写入技能文件、命令参数或回复。
- 不要把 `--as bot` 当作访问用户个人资源的兜底；日历、邮箱、个人云空间、用户自己的 Wiki/Slides/Docs 通常优先 `--as user`。
- 不要在用户未确认时追加 `--yes`、`--confirm-send` 或执行删除/撤回/移除成员/拒绝审批/发送邮件等高影响操作。

## 严格要求 (MUST DO)

- 凡是飞书相关操作必须调用本 `fws` skill；不得绕过 skill 直接走其他通道。
- 所有业务命令显式加 `--format json`，认证 split-flow 命令按官方要求用 `--json`。
- 判断命令成功时看进程退出码或 JSON 顶层 `ok == true`，不要按 OpenAPI 原始响应里的 `code == 0` 判断。
- 优先使用 `lark-cli <service> +<shortcut>`；没有 shortcut 时再用 `lark-cli <service> <resource> <method>`；仍不满足时才用 `lark-cli api METHOD /open-apis/...`。
- 使用原生 API 命令或 `lark-cli api` 前必须先查 `lark-cli schema <service>.<resource>.<method> --format json` 或官方文档，确认 `--params` / `--data` 结构。
- 危险操作先展示操作摘要并取得用户明确同意；如果 CLI 返回 `confirmation_required`/exit 10，再在原命令末尾追加 `--yes` 重试。
- 批量写操作先控制规模：单批默认不超过 30 个业务对象，产品 reference 或 schema 给出更小上限时按更小上限执行。
- 提示应用未配置或 `not_configured` 时，立即中断业务命令并走下方 CLI 应用配置检查；只有满足下方全部首次配置门槛时才初始化，不能仅凭 subtype、缺少 appId 或登录错误重建应用。
- 一旦出现 user 身份鉴权异常（401/403、登录态失效、缺少 user scope、`missing_scope`、`permission_violations`），必须立即中断当前业务命令并进入飞书授权 split-flow：使用当前运行时的命令执行工具运行 `lark-cli auth login --scope "<missing_scope>" --no-wait --json` 或 `lark-cli auth login --domain <domain> --no-wait --json`，读取本次进程输出，从 JSON 提取本次授权生成的 `verification_url` 和 `device_code`，用 `scripts/qrcode_data_uri.py` 生成二维码 data URI，返回 `[点击打开飞书授权](<verification_url>)` 和二维码并结束本轮；禁止输出裸授权 URL、本地图片路径，禁止同轮执行 `--device-code`、继续业务命令或复用历史授权信息。用户回复“已授权”不等于登录成功，必须在后续轮执行 `--device-code` 并通过 `auth status --json --verify` 验证。

## 产品总览

| 产品 | 用途 | 参考文件 |
|------|------|----------|
| `im` | 飞书消息、群聊、机器人、消息卡片、群成员、消息搜索、附件下载 | [im.md](./references/products/im.md) |
| `contact` | 通讯录：人员搜索、open_id 解析、用户资料、可见性排查 | [contact.md](./references/products/contact.md) |
| `calendar` | 日历：日程、参会人、会议室、忙闲、推荐时间 | [calendar.md](./references/products/calendar.md) |
| `base` | 多维表格：Base、表、字段、记录、视图、表单、仪表盘、workflow | [base.md](./references/products/base.md) |
| `docs` | 云文档：创建、读取、更新文档内容、文档素材 | [doc.md](./references/products/doc.md) |
| `drive` | 云空间：搜索、上传下载、导入导出、文件夹、权限、评论 | [drive.md](./references/products/drive.md) |
| `sheets` | 电子表格：工作簿、单元格、公式、样式、图表、透视表 | [sheets.md](./references/products/sheets.md) |
| `task` | 飞书任务：任务、清单、子任务、负责人、提醒 | [task.md](./references/products/task.md) |
| `mail` | 邮箱：查信、写信、草稿、回复、转发、规则、模板 | [mail.md](./references/products/mail.md) |
| `approval` | 审批：待办、已办、审批实例、同意、拒绝、转交、撤回 | [approval.md](./references/products/approval.md) |
| `attendance` | 考勤：个人打卡记录、考勤任务查询 | [attendance.md](./references/products/attendance.md) |
| `vc/minutes` | 视频会议、会议纪要、妙记、逐字稿、录制产物 | [vc.md](./references/products/vc.md) |
| `wiki` | 知识库：知识空间、节点、成员、文档组织 | [wiki.md](./references/products/wiki.md) |
| `slides` | 幻灯片：创建、读取、页面编辑、截图、素材 | [slides.md](./references/products/slides.md) |
| `openapi` | 现有命令无法覆盖时，探索并调用原生 OpenAPI | [openapi.md](./references/products/openapi.md) |

## 意图判断决策树

用户提到"发消息/群聊/机器人/卡片/聊天记录/群成员/附件" -> `im`
用户提到"找人/同事/open_id/手机号/邮箱/通讯录/可见范围" -> `contact`
用户提到"日程/会议安排/会议室/忙闲/约时间" -> `calendar`
用户提到"多维表格/Base/bitable/记录/字段/视图/表单/仪表盘" -> `base`
用户提到"文档/docx/读取文档/编辑文档/插入内容" -> `docs`
用户提到"云盘/云空间/上传/下载/导入/导出/评论/权限/文件夹" -> `drive`
用户提到"电子表格/sheet/单元格/公式/图表/透视表" -> `sheets`
用户提到"任务/待办/任务清单/子任务/提醒/负责人" -> `task`
用户提到"邮件/邮箱/草稿/回复/转发/收信规则" -> `mail`
用户提到"审批/审批单/同意/拒绝/转交/撤回/加签/抄送" -> `approval`
用户提到"考勤/打卡" -> `attendance`
用户提到"视频会议/会议记录/妙记/逐字稿/录制/会议纪要" -> `vc/minutes`
用户提到"知识库/wiki/知识空间/节点/空间成员" -> `wiki`
用户提到"PPT/幻灯片/slides/演示文稿" -> `slides`
用户需求现有产品 reference 不覆盖，且明确是飞书开放平台 API -> `openapi`

关键区分：
- `approval` 审批待办 vs `task` 普通任务待办。
- `calendar` 未来日程/会议安排 vs `vc` 已结束会议记录/会议产物。
- `docs` 文档正文内容 vs `drive` 文件、权限、评论、导入导出。
- `base` 多维表格 vs `sheets` 电子表格。
- `im` 机器人/群聊消息 vs `mail` 邮件。
- `minutes +todo` 妙记 AI 待办 vs `task` 飞书任务。

更多易混淆场景见 [intent-guide.md](./references/intent-guide.md)。

## 危险操作确认

以下操作必须先向用户展示操作摘要并获得明确同意。若 CLI 返回 `confirmation_required`，按错误 envelope 中的 `error.risk.action` 和关键参数复述影响范围，同意后追加 `--yes`。

| 产品 | 操作示例 | 说明 |
|------|----------|------|
| `im` | 撤回/删除消息、移除群成员、修改群管理配置 | 影响会话和成员可见性 |
| `calendar` | 删除日程、移除参会人/会议室、改期 | 会同步影响参会人 |
| `base` | 删除 Base/表/字段/记录/视图、批量更新 | 数据不可恢复或影响多人 |
| `docs/drive/sheets/slides/wiki` | 删除、移动、覆盖、权限收紧/放开、版本回滚 | 影响文档资产 |
| `task` | 删除任务/清单、批量改负责人/完成状态 | 影响协作任务 |
| `mail` | 真实发送邮件、删除邮件、取消定时、撤回邮件、修改收信规则 | 可能不可逆或对外发送 |
| `approval` | 同意、拒绝、转交、退回、撤回、加签 | 审批流程动作 |
| `minutes` | 替换全文、删除妙记待办、批量替换说话人/关键词 | 改变会议产物 |

确认流程：

```text
Step 1 -> 展示操作摘要（动作 + 目标对象 + 影响范围）
Step 2 -> 等用户明确回复确认
Step 3 -> 执行命令；如需要确认门禁，在原 argv 末尾追加 --yes
```

## 核心流程

1. 意图分类：先看用户真正要做的动作，再匹配产品。
2. 身份选择：明确使用 `--as user` 还是 `--as bot`；默认用户个人资源走 `--as user`，机器人/应用通知可走 `--as bot`。
3. 查参考：读取对应产品 reference；复杂或原生 API 再查 `lark-cli ... --help` / `lark-cli schema`。
4. 获取真实 ID：从搜索、列表、URL resolve 或详情返回中提取 ID；多候选时让用户选择。
5. 执行命令：业务命令加 `--format json`；写操作必要时先 `--dry-run`。
6. 解释结果：基于 `ok == true` 和 `data` 输出用户可理解的信息，保留可点击 URL、名称、ID 和必要状态。

## 命令发现（flag / 参数以 binary 为准）

产品参考文件用于路由和高频规则，实际参数以 `lark-cli` 输出为准：

```bash
# 查看服务和 shortcut
lark-cli <service> --help
lark-cli <service> +<shortcut> --help

# 查看原生 API 命令
lark-cli <service> <resource> --help
lark-cli <service> <resource> <method> --help

# 查看 schema：参数、请求体、响应、身份、scope、风险等级
lark-cli schema
lark-cli schema <service>.<resource>.<method> --format json
```

如果 reference、`--help`、`schema` 冲突，以当前本机 `lark-cli --help` / `lark-cli schema` 为准。

## 错误处理

1. 先解析 stderr/stdout 中的 JSON envelope：`ok:false`、`error.type`、`error.subtype`、`error.code`、`error.message`、`error.hint`。
2. 参数缺失或字段格式错误：查 `--help` / `schema` 后修正一次。
3. `confirmation_required` 或 exit 10：进入危险操作确认流程，不当作普通失败。
4. CLI 应用配置缺失：必须先走下方应用配置流程，不得误走 user 授权。
5. user 身份鉴权失败或缺少 scope：必须走下方鉴权异常强制策略。
6. bot 身份缺少 scope：不要 `auth login`；把错误中的 `console_url` 原样给用户去开发者后台开权限。
7. 权限/可见范围/资源不存在：停止盲目重试，报告原始错误和可执行的下一步。
8. 更多见 [error-codes.md](./references/error-codes.md)。

### CLI 应用配置流程（高于用户授权）

- 触发条件：CLI 返回应用配置缺失、`not_configured`，或历史外部配置来源不可用。先停止业务命令，在同一环境执行 `lark-cli config show`。它只检查应用元数据；退出码为 0 且有 `appId` 不代表密钥引用有效。
- 已有配置：复用当前 CLI 应用，不重新初始化、不切换配置来源；需要 user 身份时继续下方授权流程。若 `auth login` 返回 `not_configured`，但配置检查已有 `appId` 或其他应用元数据，应报告应用配置或密钥引用错误，保留原应用、绑定和凭证，不得重新初始化。历史外部渠道提示不能取代本次检查。
- 首次配置门槛：只有 `config show` 本身明确返回 `not_configured`，且没有既有应用元数据，同时错误为 `error.type=config`、`error.subtype=not_configured`、没有 `error.field`，错误消息明确表示缺少应用配置，才允许初始化。不能仅凭 subtype 或缺少 appId 推断应用不存在。
- 配置错误分流：`error.field` 为 `--profile`、`LARKSUITE_CLI_PROFILE` 或 `currentApp` 表示 profile 选择错误，先修正既有 profile 选择并保留配置；仅针对报错指明的选择确认原应用，不试切其他 profile、HOME、workspace 或来源。无活动 profile、`invalid_config`、未知错误消息或密钥错误均须停止并报告，不得初始化。
- 确认首次配置：满足上述全部门槛后，才执行 `lark-cli config init --new --force-init`。读取本次配置链接，再用 `python3 scripts/qrcode_data_uri.py "<config_url>" --alt "飞书应用配置二维码"` 生成 data URI 二维码。
- 返回 `[点击打开飞书应用配置](<config_url>)` 和脚本的 `markdownImage`，请管理员打开链接或用飞书扫码完成当前 CLI 应用配置后回复。不得展示 App Secret；无法取得链接时报告本次错误，二维码失败时只返回可点击链接和原因。
- 后续确认：用户回复后，在同一环境再次执行 `lark-cli config show`；读取到 `appId` 仅确认应用元数据已写入，随后仍须完成 user 登录和 `auth status --json --verify`。密钥引用或登录失败时保留应用并报告，不继续业务命令、不重复初始化。不要把元数据写入说成凭证有效或用户已授权。
- 外部配置导入仅是管理员明确选择的可选操作，应先查当前 CLI 的 `config bind --help` 并确认来源和身份策略；它不是本流程的前置，也不要求配置任何聊天渠道。
- 配置与用户凭证都应保存在该用户的持久化 `LARK_HOME`。不得为修复配置提示而删除凭证目录、换用默认 HOME 或其他用户目录。

### 鉴权异常强制策略（最高优先级）

- 触发条件：任一 `lark-cli` 命令返回 401/403、登录态失效、`error.subtype=missing_scope`、`permission_violations`、`error.hint` 含 `auth login`，且当前身份为 `user` 或目标资源必须使用 user 身份。
- 业务中断：触发后必须立即停止当前业务命令；完成授权前不得继续查询、创建、修改、删除或发送。
- scope 选择：优先使用错误 envelope 中的缺失 scope；没有明确 scope 但可判断业务域时使用 `--domain <domain>`；无法判断最小授权范围时，向用户说明缺少 scope 信息，不要猜测。
- 发起授权：使用当前运行时的命令执行工具运行 `lark-cli auth login --scope "<missing_scope>" --no-wait --json` 或 `lark-cli auth login --domain <domain> --no-wait --json`，并立即读取本次进程输出；返回后台进程句柄时，使用对应进程工具读取输出。
- 链接提取：只允许从本次进程返回的 JSON 中提取 `verification_url` 和 `device_code`；必要时 `verification_uri_complete` 可作为授权 URL 兜底；不得拼接、改写、编码/解码 URL。
- 二维码：必须用 `python3 scripts/qrcode_data_uri.py "<verification_url>" --alt "飞书授权二维码"` 把二维码转成 `data:image/png;base64,...`，并把脚本返回的 `markdownImage` 嵌入回复。ByClaw 聊天页不能访问 agent 本地相对路径图片，所以禁止返回 `![飞书授权二维码](relative.png)`、`file://...` 或任意本地路径；二维码脚本失败时只返回可点击授权链接和失败原因，不得返回破图占位。
- 返回规范：本轮必须用 Markdown 超链接返回授权入口，格式为 `[点击打开飞书授权](<verification_url>)`，并在下面返回 data URI 二维码；配置应用入口格式为 `[点击打开飞书应用配置](<config_url>)`。禁止输出 `授权链接：https://...`、`配置链接：https://...` 这类裸 URL；禁止提示“扫描下方二维码”但返回本地图片路径。返回后提示“授权完成后回复我，我会继续完成登录”；禁止在同一轮执行 `lark-cli auth login --device-code <device_code>`。
- 后续确认：用户回复已授权后，才可执行 `lark-cli auth login --device-code <device_code> --json`，成功后再执行 `lark-cli auth status --json --verify`；确认登录态有效后必须完成固定平台状态同步，API 成功后才可恢复原业务命令。
- 授权码生命周期：`device_code`、`verification_url` 和二维码只属于本次授权会话；用户回复过晚、`device_code` 过期、已使用、无效或 `--device-code` 返回授权失败时，必须丢弃整组旧凭证，重新执行 `auth login --scope/--domain --no-wait --json` 生成新的链接和 `device_code`，禁止重试旧 `device_code`。
- 重试上限：单个业务请求最多执行两轮完整授权流程（生成新链接 → 用户授权 → `--device-code` → `auth status --json --verify`）；第二轮仍失败时停止自动重试，报告最新错误并要求用户重新发起授权。不得在未确认登录态有效前恢复原业务命令。
- bot 分流：当前身份为 `bot` 或错误说明 bot scope 不足时，禁止执行 `auth login`；必须返回错误中的 `console_url`，让管理员在飞书开放平台开通权限并发布/生效。
- 禁止事项：禁止交互式 `lark-cli auth login`、禁止复用历史 `verification_url`/`device_code`、禁止使用非 `lark-cli` 通道补救、禁止同轮阻塞轮询授权状态。

## 详细参考 (按需读取)

- [references/global-reference.md](./references/global-reference.md) - 安装、认证、身份、全局 flags、JSON envelope。
- [references/intent-guide.md](./references/intent-guide.md) - 易混淆意图和跨产品工作流。
- [references/error-codes.md](./references/error-codes.md) - 错误分类、权限恢复、确认门禁。
- [references/products/](./references/products/) - 各产品路由、命令入口和注意事项。
- [scripts/qrcode_data_uri.py](./scripts/qrcode_data_uri.py) - 将 `lark-cli auth qrcode` 生成的本地 PNG 转为 Markdown 可直接渲染的 data URI 二维码。
