# hot_discovery 闭环加固设计

日期：2026-08-22

## 目标

修复 `middleware/openclaw/skills/online_search/references/hot_discovery/scripts/hot_discovery.mjs` 的四个已确认问题，并重新审查从 `search` 到 `merge` 的完整数据闭环：

1. `merge` 不得透传 hot-file 候选中的未知字段。
2. 单条 malformed bycli 结果不得中断整次搜索。
3. CLI 数值参数必须在入口校验，非法值明确失败。
4. OS 级命令超时必须与普通命令失败区分并可观测。

不改变适配器清单、热度排序语义、URL 规范化规则、登录策略或正文获取边界；不引入第三方依赖。

## 设计

### 1. 输入边界

新增小型纯函数，分别处理：

- 正整数参数解析及上限检查；
- hot-file 候选白名单重建；
- bycli 行形状校验；
- 命令执行结果的超时分类。

hot-file 候选只允许输出既有 schema 中的字段：`url`、`title`、最多 100 个 UTF-16 码元的 `titleContext`、`discoveredBy`、`relevance`、`popularity` 和固定为 `null` 的 `acquisitionRoute`。未知字段不透传；结构无效的候选被丢弃并形成 merge warning。`popularity` 与 `relevance` 也按已知子字段重建，避免在嵌套层继续透传任意数据。

### 2. search 故障隔离

`extractCandidate` 在读取字段前验证每一行必须是非空、非数组对象。异常行记录专用计数并跳过。适配器调用外层保留兜底：即使解析或提取发生未预期异常，也只将当前适配器标记为失败，不让 Tier 1 的 `Promise.all` 或 Tier 2/3 串行流程丢失其他来源的结果。

### 3. 参数约束

`--limit`、`--group-limit`、`--searxng-limit` 必须是有限整数，并设置明确范围：

- `limit`: 1–100；
- `group-limit`: 1–100；
- `searxng-limit`: 1–1000。

缺省值保持 20、5、20。0、负数、小数、`NaN` 和 Infinity 均通过现有 CLI 错误出口明确拒绝。

### 4. 超时可观测性

命令执行包装保留原始错误码，并显式产生 `timedOut`。适配器状态优先记录 `timeout`，同时保留 `killed`；普通非零退出仍沿用现有业务错误码分类。不会新增重试，因为技能明确规定失败后跳过。

### 5. merge 可测试性

把 merge 的纯数据归并部分导出为函数，文件读取和 CLI 参数解析继续留在 `cmdMerge`。这样测试可以直接覆盖：

- 三通道同 URL 去重及 `bothChannels`；
- hot-file 未知字段和嵌套未知字段被删除；
- 超长 `titleContext` 被截断；
- malformed hot candidate 被丢弃并告警；
- 分组上限和缺失 searxng warning。

## 测试策略

严格按 Red-Green-Refactor 逐项进行：先加入最小失败测试并确认失败原因，再实现最小修复。除现有 35 个测试外，新增四组回归测试：hot-file 白名单、malformed bycli 行、参数解析、超时分类，并补 merge 闭环测试。

完成后运行：

```bash
node --test middleware/openclaw/skills/online_search/references/hot_discovery/scripts/hot_discovery.test.mjs
```

随后重新审查 `search → snapshot → merge → groups/warnings` 数据流；若发现影响边界、正确性或故障隔离的新问题，继续以同样的测试先行方式修复。最后检查 diff，确保只修改目标脚本、测试及本设计文档。

## 兼容性与风险

- 正常 `search` 产生的快照 schema 不变。
- 手工或旧版本生成的快照若携带未知字段，这些字段将被删除；这是预期的安全收紧。
- 以前被静默接受的非法数值参数将改为明确失败。
- 超时状态从 `command_failed` 改为 `timeout`，可能影响读取 `adapterStats.status` 的消费者；这是有意的可观测性修正，文档和测试需同步。
- 不改变 `searxngContent` 的既有保留规则，但 merge 仍只从 searxng 转换函数产生该字段，hot-file 不得注入它。
