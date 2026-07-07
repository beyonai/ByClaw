---
name: fws
description: 管理飞书/Lark 产品能力（IM消息/群聊/机器人/卡片、通讯录、日历、Base多维表格、云文档、云空间、电子表格、任务、邮箱、审批、考勤、会议纪要/妙记、知识库、开放平台原生接口等）。当用户需要通过官方 lark-cli 查询、创建、修改、删除或发送飞书资源，处理飞书权限/身份，或实现飞书连接器自动化时使用。
---

# 飞书全产品 Skill

通过官方 `lark-cli` 命令管理飞书/Lark 产品能力。本 skill 是 ByClaw/OpenClaw 里的聚合入口，结构参考 `dws`，但底层只走 `lark-cli`。

## 严格禁止 (NEVER DO)

- 不要使用 `lark-cli` 以外的方式操作飞书资源；禁止自行 `curl`、手写 HTTP 客户端、浏览器点 UI。
- 不要编造 `open_id`、`chat_id`、`message_id`、`base_token`、`table_id`、`event_id`、`task_id` 等标识符，必须从命令返回中提取。
- 不要猜测 flag、JSON 字段、scope 或身份类型；不确定时先查 `--help` 或 `lark-cli schema`。
- 不要把 App Secret、access token、refresh token、session、cookie 写入技能文件、命令参数或回复。
- 不要把 `--as bot` 当作访问用户个人资源的兜底；日历、邮箱、个人云空间、用户自己的 Wiki/Slides/Docs 通常优先 `--as user`。
- 不要在用户未确认时追加 `--yes`、`--confirm-send` 或执行删除/撤回/移除成员/拒绝审批/发送邮件等高影响操作。

## 严格要求 (MUST DO)

- 在 OpenClaw 场景下，凡是飞书相关操作必须调用本 `fws` skill；不得绕过 skill 直接走其他通道。
- 所有业务命令显式加 `--format json`，认证 split-flow 命令按官方要求用 `--json`。
- 判断命令成功时看进程退出码或 JSON 顶层 `ok == true`，不要按 OpenAPI 原始响应里的 `code == 0` 判断。
- 优先使用 `lark-cli <service> +<shortcut>`；没有 shortcut 时再用 `lark-cli <service> <resource> <method>`；仍不满足时才用 `lark-cli api METHOD /open-apis/...`。
- 使用原生 API 命令或 `lark-cli api` 前必须先查 `lark-cli schema <service>.<resource>.<method> --format json` 或官方文档，确认 `--params` / `--data` 结构。
- 危险操作先展示操作摘要并取得用户明确同意；如果 CLI 返回 `confirmation_required`/exit 10，再在原命令末尾追加 `--yes` 重试。
- 批量写操作先控制规模：单批默认不超过 30 个业务对象，产品 reference 或 schema 给出更小上限时按更小上限执行。

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
4. user 身份缺少 scope：用 split-flow 发起 `lark-cli auth login --scope "<missing_scope>" --no-wait --json`。
5. bot 身份缺少 scope：不要 `auth login`；把错误中的 `console_url` 原样给用户去开发者后台开权限。
6. 权限/可见范围/资源不存在：停止盲目重试，报告原始错误和可执行的下一步。
7. 更多见 [error-codes.md](./references/error-codes.md)。

## 详细参考 (按需读取)

- [references/global-reference.md](./references/global-reference.md) - 安装、认证、身份、全局 flags、JSON envelope。
- [references/intent-guide.md](./references/intent-guide.md) - 易混淆意图和跨产品工作流。
- [references/error-codes.md](./references/error-codes.md) - 错误分类、权限恢复、确认门禁。
- [references/products/](./references/products/) - 各产品路由、命令入口和注意事项。
