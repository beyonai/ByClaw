# WeCom wecom-cli 采集桥接

企微采集意图由 `knowledge-collection` 统一编排。命中本桥接后，先声明“委派采集模式”，再加载并遵循
`wecomcli` skill 及匹配的子 Skill。`knowledge-collection` 负责采集目录、`raw/`、`markdown/`、
`sanitized/items/`、`sanitized/metadata.json`、`collection-result.json`、预览和采集交付；
`wecomcli` / `wecom-cli` 只负责企微 URL 或产品路由、只读命令、认证、权限、真实 ID 和分页。固定使用已发布的
`@wecom/cli@1.3.4`，上游来源见 [UPSTREAM.md](../../../wecom/UPSTREAM.md)。

## 来源路由

| 输入 | 委派能力 |
|---|---|
| `doc.weixin.qq.com/doc/*` | `wecomcli-doc` |
| `doc.weixin.qq.com/sheet/*` | `wecomcli-sheet` |
| `doc.weixin.qq.com/smartsheet/*` | `wecomcli-smartsheet` |
| `doc.weixin.qq.com/smartpage/*`、`page.weixin.qq.com/smartpage/*` | `wecomcli-smartpage` |
| 会话、消息历史或附件 | `wecomcli-msg` |
| 通讯录、会议、日程或待办数据 | 匹配的 `wecomcli-*` 子 Skill |

仅允许读取、搜索、导出、下载和采集。发送消息、创建、编辑、取消或删除企微资源属于直接业务操作，不能进入本采集桥接。

企微采集不得通过浏览器、curl、直接 HTTP/API 或通用网页抓取降级。`wecom-cli` 不可用或明确不支持时，报告该
后端结果并停止；不得编造替代数据或绕过用户权限。

## 执行与认证

1. 加载并遵循 `wecomcli` skill，再按 URL 或产品意图加载匹配的子 Skill。
2. 每个 CLI 子进程映射 `HOME="$WECOM_HOME"`、`WECOM_CLI_CONFIG_DIR="$WECOM_HOME/.config/wecom"` 和
   `WECOM_CLI_ACCESS_TOKEN=""`，缺少 `WECOM_HOME` 时停止。命令与参数以发布版子 Skill、动态 schema 和命令帮助为准。
3. 1.3.4 使用层级子命令和 `--json`，stdout 直接返回业务 JSON，不再解包旧 JSON-RPC。非零退出码、结构化 `error`、
   `isError=true` 或非零 `errcode` 均视为失败；进程退出 0 不能代替业务校验。
4. 未授权时遵循 `wecomcli` 的 `auth init --noninteractive --no-browser` 流程；`auth show --status` 的 `authorized`
   仅证明本地存在授权信息。权限拒绝（含 `853006`）、无效 ID、文档类型不兼容或数据不存在
   直接报告，不得盲目重试认证。初始化返回的授权 URL 过期后，丢弃旧 URL 并开始新的允许轮次；不得复用旧 URL、
   轮询已经结束的进程，或在授权真正完成前宣称成功。
5. 不得在聊天、原始产物或规范化产物写入 token、Cookie、会话、授权缓存或任何凭据。

### 范围、分页与完整性

- 通讯录与会话仅代表当前授权范围，不得称为个人或企业完整存档；人员搜索每次最多 10 个真实关键词，不是 10 人上限。
- aibot 会话列表不是历史消息；普通 `chat` 能力必须按动态 schema 与服务端权限判断。不得编造 `chat_type` 或时间限制。
  记录用户请求窗口、实际窗口、cursor、已取数量、去重结果和
  `partial` 状态；中断时保留已成功页而非补造缺失页。
- 产物元数据记录非敏感的后端 CLI version、有效权限范围和对象 ID。只在成功解析后的实际字段上生成正文。

### 1.3.4 文档与表格采集

以下展示参数结构，实际调用必须带上述环境隔离，并在当前采集会话目录内执行，使用会话内的 `--output-dir`：

```bash
wecom-cli doc contents get --json '{"docid":"<docid>","content_type":"markdown"}'
wecom-cli smartpage pages get --json '{"docid":"<docid>"}'
wecom-cli smartpage pages get --json '{"docid":"<docid>","page_id":"<returned-page-id>","content_type":"markdown"}'
wecom-cli sheet get --json '{"docid":"<docid>"}'
wecom-cli sheet ranges get --json '{"docid":"<docid>","sheet_id":"<returned-sheet-id>","mode":"csv"}'
```

普通文档读取 `content`；智能文档先取页面列表，再用返回的真实 `page_id` 逐页读 `pages[].content_file_inner`；
在线表格先取工作表列表，再读 CSV。智能表格按子 Skill 使用 `smartsheet sheets list`、`fields list`、`records list`，
完整翻页并记录截断。正文也可能通过 `file_path` 返回，只读取本次命令输出目录内的有界普通文件；拒绝符号链接、硬链接和越界路径。

旧版导出任务、`task_id` 及任务轮询已移除。未完成、超时或分页中断时保留成功页，在 `sanitized/metadata.json`
设置 `collection.status: partial`，并记录已读页数和失败位置，不得补造正文。1.3.4 partial 会话续采会在新目录重新只读获取
原 URL；旧版本的 task ID 不能续跑，需要重新采集原 URL。
enterprise runner 使用 `KNOWLEDGE_COLLECTION_MAX_WECOM_PAGES`、`KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS` 和输出大小上限；
首次 CLI 失败留下 failed session，raw 写入前先完成秘密扫描。
`--output-dir` 必须是尚不存在的新目录，runner 不得覆盖或混用已有会话。

## 私有产物

采集根目录必须使用 `0700`，写入的 raw、markdown、sanitized 与 JSON 文件必须使用 `0600`。若工作区内的回退目录
没有被 gitignore，必须改用工作区外的私有目录并明确报告；不得暂存、提交或上传任何采集产物。保留业务 JSON 响应前
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
- 来源执行器只返回采集结果；`knowledge-collection` 验证并交付 `sanitized/items/*.md` 后停止。
## Knowledge collection enterprise search

Only a user-named WeCom source or a clear internal-material request whose approved `sourceScope` includes WeCom may invoke enterprise search. Pass that initialized session as `--parent-session-dir`; the command rejects a missing or out-of-scope parent. Unsupported search capabilities must record the explicit `unsupported_capability`; never claim that WeCom was actually searched. This status is isolated to the selected WeCom source and does not stop other selected sources or public-internet collection. The enterprise runner still preserves WeCom document, sheet, and SmartPage resource export, and a partial resource task can be continued with `enterprise resume-resource --source wecom --session-dir ... --output-dir <new dir>`.
