# 采集交付边界

本文件定义采集编排器 `knowledge-collection` 的终点。采集完成后停止；根 Agent 或其他下游 Agent 决定是否继续执行其他任务。

## 唯一下游正文输入

下游 Agent 只能接收 `status.downstreamInput.files` 列出的文件。每个文件必须同时满足：

- 位于当前会话的 `sanitized/items/` 目录内；
- 扩展名为 `.md`；
- 是可读、非空的普通文件；
- 已由 `scripts/collection-state.mjs` 根据 inventory 和实际文件状态验证。

`raw/`、`markdown/`、`collection-result.json`、`sanitized/metadata.json`、候选摘要和不存在的路径都不是下游正文输入。下游不得自行从这些位置补选正文。

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

`status.collection.deliveryComplete` 是唯一完成判定。collection 为 `partial`/`failed` 时始终为 `false`；`selected`/`all` 还要求正文没有 pending/failed，且已有 crawl 时没有 pending/failed 或 fetched-but-unmaterialized 页面；`all` 另外要求 `status.crawl.coverage.overCap` 为 0。`candidates` 可以交付空正文数组，但发现阶段本身不得失败。

## 交付内容

运行 `status`，并向主 Agent 返回：

- 会话目录和 `status.downstreamInput`；
- 有效来源范围与物化目标；
- 来源记录、重复组、已物化、pending、failed 数量；
- 来源链接、失败来源、权限限制和覆盖缺口；
- 来源执行器返回的 `adapterCandidate`（如有）。它只是非阻塞建议，由直接查询所有者（根 Agent）判断是否另行询问或委派；采集编排器不得增加第二次提问。

可点击预览必须引用已知来源 URL；预览不改变下游文件边界，也不能把候选元数据升级为正文。

## 终止规则

采集交付本身不得主动询问 `入库 / 知识整理 / 跳过`，也不得根据下游结果回写 run、清理会话、改写图片链接或改变保留策略。

采集阶段结束后，由根 Agent 根据用户已经表达的意图决定是否调用 `project-cloud-knowledge`、`knowledge-organizer` 或其他下游 Skill，无需为了这三个选项再次询问用户。根 Agent 可以把 `status.downstreamInput.files` 原样交给 B 子 Agent 或其他 Agent；后续 Agent 自行加载自己的 Skill、执行确认并维护自己的状态，不得要求采集编排器承担下游生命周期。
