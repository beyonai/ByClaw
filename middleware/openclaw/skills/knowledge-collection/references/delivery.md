# 采集交付边界

本文件定义采集编排器 `knowledge-collection` 的终点。采集完成后停止；根 Agent 或其他下游 Agent 决定是否继续执行其他任务。

## 内部校验输入

`status.downstreamInput.files` 是发布前的唯一权威正文清单。每个文件必须同时满足：

- 位于当前会话的 `sanitized/items/` 目录内；
- 扩展名为 `.md`；
- 是可读、非空的普通文件；
- 已由 `scripts/collection-state.mjs` 根据 inventory 和实际文件状态验证。

`raw/`、`markdown/`、`collection-result.json`、`sanitized/metadata.json`、候选摘要和不存在的路径都不是正文输入。任何 Agent 都不得自行从这些位置补选正文。

`status.downstreamInput` 使用稳定结构：

```json
{
  "schemaVersion": "1.0",
  "directory": "/absolute/session/path/sanitized/items",
  "files": [
    "/absolute/session/path/sanitized/items/article.md"
  ]
}
```

`directory` 始终指向当前会话的 `sanitized/items/`。`files` 只包含验证通过的 materialized Markdown；pending 或 failed 项不得进入该数组。没有有效正文时，`files` 是空数组，采集状态及失败原因仍需照常交付。

`status.collection.deliveryComplete` 是唯一完成判定。collection 为 `partial`/`failed` 时始终为 `false`；`selected` 和 `all` 至少包含一个条目，还要求正文没有 pending/failed，且已有 crawl 时没有 pending/failed 或 fetched-but-unmaterialized 页面；`all` 另外要求 `status.crawl.coverage.overCap` 为 0。`candidates` 可以交付空正文数组，但发现阶段本身不得失败。用户明确要求完整正文时，初始化必须使用 `--required-content-granularity full-text`，每个交付条目都必须为 `full-text`；摘要或节选不能满足全文要求。

## 用户指定目录的发布

用户提供的保存路径是交付目录，不是采集会话目录。根 Agent 必须把内部会话初始化在当前 Session Root 的
`.collection-runs/<run-id>/`，并在 `init` 传 `--delivery-requested true`。没有显式保存路径时必须改用
`collections/<task-name>/`，两种目录布局互斥。完成采集并确认 `status.collection.deliveryComplete=true` 后执行：

```bash
node scripts/knowledge-collection.mjs publish --session-dir <dir> --delivery-dir <path>
```

只有根 Agent 可以调用 `publish`。委派来源执行器时只传内部 `session-dir` 及其 `raw/` 子路径，不得把用户交付目录传给被委派 Agent。
publish 之前不得创建、探测或操作用户交付目录，并将该路径视为 opaque 值：不得对其执行 `mkdir`、`ls`、`find`、写入、删除、清空、移动或复制，不得做存在性或空目录检查，也不得用临时文件探测或要求被委派 Agent 操作它。采集失败时只保留内部会话和审计证据，目标目录原本不存在就必须继续不存在。
当 `status.collection.deliveryComplete=false` 时不得执行 `publish`；应报告空结果、未满足的全文粒度或其他覆盖缺口，不能把已存在的摘要、节选或内部文件当成交付成功。

在正式调用 `publish` 之前，任何工具调用的参数或 shell 命令文本都不得包含 `requestedDeliveryDir`；第一次允许包含该路径的工具调用必须是正式的 `publish`。不得把该路径赋给 shell 变量，也不得 `echo`、记录或打印该路径。禁止用 `mkdir`、`ls`、`find`、`stat`、`test`、`realpath`、`readlink` 或任何等价命令访问它；“检查残留目录”、“确认目录不存在”和“只做只读检查”都不是例外。每次调用工具前先检查：如果参数或命令含有该路径且当前调用不是已经通过交付校验后的 `publish`，删除该路径并改为只操作内部 `session-dir`。当 `status.collection.deliveryComplete=false` 时，该路径不得出现在后续任何工具调用中，只能在最终答复中说明未发布。

```bash
# 错误：不可用变量保存交付路径后再做只读检查
REQUESTED_DELIVERY_DIR=/by/example-output
ls "$REQUESTED_DELIVERY_DIR"

# 正确：交付路径第一次进入工具调用就是通过校验后的 publish
node scripts/knowledge-collection.mjs publish --session-dir "$SESSION_DIR" --delivery-dir /by/example-output
```

相对路径同时传 `--session-root <Session Root>`，绝对路径按原值使用。发布器只复制经验证的 Markdown 及其引用的本地图片，
并按交付布局改写相对图片链接。根级 `post-01.md` 与 `post-01-images/` 保持伴随布局；
`<item>/index.md` 与 `<item>/assets/` 发布为 `<item>.md` 与 `<item>-assets/`。

目标不存在或为空时直接发布到该目录；目标非空时创建带任务短名和 run 标识的独立子目录。不得覆盖或删除目标目录中已有的未知内容。
再次发布前必须验证上次目标的完整文件集合和哈希；用户修改、增加或删除目标内容后应返回漂移错误，而不是覆盖或另建一个含义不明的目录。

成功响应中的 `deliveryInput` 是跨 Agent 的稳定交接对象：

```json
{
  "schemaVersion": "1.0",
  "directory": "/absolute/user/delivery/path",
  "files": [
    "/absolute/user/delivery/path/article.md"
  ]
}
```

当用户在同一个请求中还要求继续消费已保存文件时，根 Agent 必须把原样的 `deliveryInput` 传给下游 Agent，下游只能读取
`deliveryInput.files`，图片从 Markdown 相对链接解析。不得扫描或猜测交付目录。独立启动且没有对话上下文的 Agent 若未收到
`deliveryInput` 或内部 `session-dir`，无法可靠知道先前路径，必须向上游索取明确交接对象。

成功执行 `publish` 后，首次最终答复必须同时报告 `delivery.actualDirectory`，并在 JSON 代码块中原样回显 `deliveryInput`；不得只报告路径、改写字段、遗漏 `files`，或等用户追问后再补交。

## 交付内容

运行 `status`，并向主 Agent 返回：

- 内部会话目录和 `status.downstreamInput`；若执行过发布，还要返回 `delivery.actualDirectory` 与 `deliveryInput`；
- 有效来源范围与物化目标；
- 来源记录、重复组、已物化、pending、failed 数量；
- 来源链接、失败来源、权限限制和覆盖缺口；
- 来源执行器返回的 `adapterCandidate`（如有）。它只是非阻塞建议，由直接查询所有者（根 Agent）判断是否另行询问或委派；采集编排器不得增加第二次提问。

可点击预览必须引用已知来源 URL；预览不改变下游文件边界，也不能把候选元数据升级为正文。

## 终止规则

采集交付本身不得主动询问 `入库 / 知识整理 / 跳过`，也不得根据下游结果回写 run、清理会话、改写图片链接或改变保留策略。

采集阶段结束后，由根 Agent 根据用户已经表达的意图决定是否调用 `project-cloud-knowledge`、`knowledge-organizer` 或其他下游 Skill，无需为了这三个选项再次询问用户。没有显式保存路径时，根 Agent 可以把 `status.downstreamInput` 原样交给下游 Agent；显式保存路径发布成功后，必须改传原样的 `deliveryInput`。后续 Agent 自行加载自己的 Skill、执行确认并维护自己的状态，不得要求采集编排器承担下游生命周期。
