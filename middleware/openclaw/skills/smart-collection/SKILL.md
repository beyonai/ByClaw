---
name: smart-collection
description: Use when the user asks to collect, crawl, batch-search, archive, ingest, or organize information from internet or enterprise sources, or wants existing collected files stored in a knowledge base.
---

# Smart Collection

这是面向用户的知识智采编排 Skill。采集编排器 `smart-collection` 判断采集意图、选择来源执行器，并衔接后处理；
路由器 `agent-reach` 负责公共互联网渠道选择，网站执行器 `bycli` 或其他来源执行器负责取得内容。

## 查询 vs 采集

- 显式采集意图优先于页面或条目数量。用户明确要求 collect、crawl、batch、批量搜索、多条目、archive、归档或 ingest 时，
  即使只有一个页面或一条结果，也进入采集流程。
- 只有不存在显式采集意图时，单个事实、单个页面、打开页面、登录或一次性操作才属于查询，不执行采集后处理。

## 来源路由

- 公共互联网：加载并遵循 `agent-reach` skill。
- `agent-reach` 选择 `bycli`，或用户显式要求 byCLI、浏览器或 Adapter 执行：加载并遵循 `bycli` skill。
- 钉钉/DingTalk：加载并遵循 `dws` skill，并遵循 [DingTalk DWS 采集桥接](references/sources/dingtalk-dws.md)。
- 飞书/Lark：加载并遵循 `fws` skill，并遵循 [Feishu 采集桥接](references/sources/feishu-fws.md)。
- 企业微信/WeCom：加载并遵循 `wecomcli` skill，并遵循 [WeCom 采集桥接](references/sources/wecom-wecomcli.md)。

Agent Reach 直接后端与 `bycli` 后端返回的结果必须统一进入同一套 collection contract，不得按执行后端分叉产物协议。

委派来源执行器时，采集编排器明确声明当前调用采用“委派采集模式”。该模式的契约是：

- 委派采集模式优先于来源执行器的通用采集后处理规则。
- 来源执行器只负责采集并返回结果，不得自行执行或询问后处理。
- 来源执行器不得询问 `入库 / 知识整理 / 跳过`。
- 来源执行器不得反向加载 `smart-collection`。

## 采集与后处理

进入完整采集流程时，加载并遵循 [collection-contract.md](references/collection-contract.md) 与
[post-processing.md](references/post-processing.md)。用户选择入库时，还必须加载并遵循
[knowledge-ingest.md](references/knowledge-ingest.md)。这些文件定义详细契约，本 Skill 不重复其流程。

采集结果只选择一种后处理：入库 / 知识整理 / 跳过。用户已明确指定外部消费时直接执行该任务，不再询问默认三选一。
每次后处理运行只能执行一种操作，不得自动串联入库、知识整理或外部消费；会话仍保留时，用户后续明确发起的其他操作创建新的运行；完整成功清理会话后该批次终止，后续操作必须重新采集。
