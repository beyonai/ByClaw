# WeCom wecom-cli 采集桥接

企微采集意图由 `knowledge-collection` 统一编排。命中本桥接后，先声明“委派采集模式”，再加载并遵循
`wecomcli` skill 及匹配的子 Skill。`knowledge-collection` 负责采集目录、`raw/`、`markdown/`、
`sanitized/items/`、`sanitized/metadata.json`、`collection-result.json`、预览和唯一后处理选择；
`wecomcli` / `wecom-cli` 只负责企微 URL 或产品路由、只读命令、认证、权限、真实 ID、导出轮询和分页。

## 来源路由

| 输入 | 委派能力 |
|---|---|
| `doc.weixin.qq.com/doc/*` | `wecomcli-doc` |
| `doc.weixin.qq.com/sheet/*` | `wecomcli-sheet` |
| `doc.weixin.qq.com/smartsheet/*` | `wecomcli-smartsheet` |
| `doc.weixin.qq.com/smartpage/*` | `wecomcli-smartpage` |
| 会话、消息历史或附件 | `wecomcli-msg` |
| 通讯录、会议、日程或待办数据 | 匹配的 `wecomcli-*` 子 Skill |

仅允许读取、搜索、导出、下载和采集。发送消息、创建、编辑、取消或删除企微资源属于直接业务操作，不能进入本采集桥接。

企微采集不得通过浏览器、curl、直接 HTTP/API 或通用网页抓取降级。`wecom-cli` 不可用或明确不支持时，报告该
后端结果并停止；不得编造替代数据或绕过用户权限。

## 执行与认证

1. 加载并遵循 `wecomcli` skill，再按 URL 或产品意图加载匹配的子 Skill。
2. 所有命令、参数、分页、轮询、附件和危险操作规则以子 Skill 与 `wecom-cli --help` 为准；不得猜测。
3. `wecom-cli 0.1.9` 可能返回 JSON-RPC 外层响应，业务 JSON 位于 `result.content[].text`。必须先解析外层 JSON-RPC，
   再解析该文本中的业务 JSON；不能只因外层 `isError=false` 或进程成功而判断成功，只有嵌套业务 `errcode == 0` 才能继续。
4. 认证、初始化或 MCP 配置错误遵循 `wecomcli` 的当前认证流程；权限拒绝、无效 ID、文档类型不兼容或数据不存在
   直接报告，不得盲目重试认证。初始化返回的授权 URL 过期后，丢弃旧 URL 并开始新的允许轮次；不得复用旧 URL、
   轮询已经结束的进程，或在授权真正完成前宣称成功。
5. 不得在聊天、原始产物或规范化产物写入 token、Cookie、会话、授权缓存或任何凭据。

### 范围、分页与完整性

- 通讯录与会话仅代表机器人可见范围（`bot-visible`），不得称为个人或企业完整存档；通讯录子 Skill 每次最多处理 10 人。
- 不得编造 `chat_type`；消息历史的 7 天限制不得静默截断。记录用户请求窗口、实际窗口、cursor、已取数量、去重结果和
  `partial` 状态；中断时保留已成功页而非补造缺失页。
- 产物元数据记录非敏感的后端 CLI version、有效权限范围和任务 ID。只在成功解析后的实际字段上生成正文。

### Smartpage 导出

智能文档导出固定使用异步两步只读流程：

```bash
wecom-cli doc smartpage_export_task '{"url":"<smartpage-url>","content_type":1}'
wecom-cli doc smartpage_get_export_result '{"task_id":"<returned-task-id>"}'
```

首次命令返回真实 `task_id` 后轮询第二个命令，直到 `task_done=true`。未完成、超时或分页中断时保留成功响应，在
`sanitized/metadata.json` 设置 `collection.status: partial`，并把非敏感 task ID/失败位置写入 `sourceMetadata`；完成后只使用返回的 `content` 生成正文，
不得补造内容。
本地 enterprise runner 使用 `KNOWLEDGE_COLLECTION_MAX_WECOM_POLLS`、`KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS` 和输出大小上限；
轮询超时仍必须留下可由 `inspect` 续跑的 partial session，首次 CLI 失败留下 failed session，raw 写入前先完成秘密扫描。
`--output-dir` 必须是尚不存在的新目录，runner 不得覆盖或混用已有会话。

## 私有产物

采集根目录必须使用 `0700`，写入的 raw、markdown、sanitized 与 JSON 文件必须使用 `0600`。若工作区内的回退目录
没有被 gitignore，必须改用工作区外的私有目录并明确报告；不得暂存、提交或上传任何采集产物。保留 JSON-RPC 原始响应前
先做秘密扫描，规范化数据只保留必要的非敏感业务字段。

## 规范化产物

采集根目录遵循 [collection contract](../collection-contract.md)，至少写入：

```text
collection-result.json
raw/
  metadata.json
  <wecom-command>.json
markdown/
  <normalized-content>.md
sanitized/
  metadata.json
  items/
    <normalized-content>.md
```

- `raw/` 保存已秘密扫描的后端 JSON；`markdown/` 保存由真实内容转换的 Markdown；`sanitized/items/` 保存净化正文。
- `collection-result.json` 顶层只能使用主契约固定字段，`source` 写 `wecom`，`backend` 写 `wecom-cli`。
- 每个 `items[].fileName` 与 `items[].markdown` 必须是采集根目录内指向实际 `sanitized/items/*.md` 文件的相对路径。
- `sanitized/metadata.json` 按主契约写入完整 inventory。每项提供稳定 `itemId`、`sourceSkill: wecomcli`、来源对象 ID/URL、
  用户筛选、关联 `rawArtifacts` 和 materialization 状态；尚未生成正文的列表项仍进入 inventory，但不得进入
  `collection-result.json.items`。
- 来源执行器不得询问或执行 `入库 / 知识整理 / 跳过`；仅由 `knowledge-collection` 在采集后执行该选择。
## Knowledge collection enterprise search

Generic requests to collect articles, materials, or documents include WeCom in the default `enterprise search-all` coverage attempt, but the current connector has no knowledge-base or cloud-drive search capability. `enterprise search` and `enterprise search-all` must therefore record the explicit `unsupported_capability`; never claim that WeCom was actually searched. This status is isolated to WeCom and does not stop DWS, FWS, or public-internet collection. The enterprise runner still preserves WeCom document, sheet, and SmartPage resource export, and a partial resource task can be continued with `enterprise resume-resource --source wecom --session-dir ... --output-dir <new dir>`.
