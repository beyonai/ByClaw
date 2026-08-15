---
name: knowledge-collection
description: Use when the goal is to COLLECT and keep material rather than just get an answer - collect, crawl, scrape, batch-search, archive, ingest, or organize content from internet or enterprise sources, or store already-collected files in a knowledge base. This is the collection orchestrator and owns collection artifacts, post-processing, and knowledge-base ingestion; prefer it over By-Reach whenever collection intent is explicit, even for a single page or result.
---

# Knowledge Collection

这是面向用户的默认知识采集编排 Skill。采集编排器 `knowledge-collection` 判断采集意图、编排深化研究、选择来源执行器，并衔接后处理；
路由器 `agent-reach`（By-Reach）负责公共互联网渠道选择，网站执行器 `bycli` 或其他来源执行器负责取得内容。

**取内容前先读这一条**：采集编排器自身永不取内容。任何一次取内容都必须先按下面的「来源路由」委派来源执行器，
不得使用 `web_fetch`、`curl`、`wget`、`requests` 或其他直接 HTTP 客户端自行抓取。已经用直连拿到内容时，
该结果作废，按规范流程重新采集，不得据此产出采集产物。

## 查询 vs 采集

- 显式采集意图优先于页面或条目数量。用户明确要求 collect、crawl、batch、批量搜索、多条目、archive、归档或 ingest 时，
  即使只有一个页面或一条结果，也进入采集流程。
- 只有不存在显式采集意图时，单个事实、单个页面、打开页面、登录或一次性操作才属于查询，不执行采集后处理。

## 深化研究（默认模式）

本技能把「研究深化」与「采集执行」整合为一条链路。复杂、多面、需要多轮检索或带引用的任务，默认按
[references/research-methodology.md](references/research-methodology.md) 的递归研究流程执行：
先框架问题（breadth/depth/起始 query），逐层拆分为分支，每个分支完成一次「检索 → 抓取 → 登记 → 提炼」，再聚合去重、输出报告。

- 深化研究的每次「检索」：委派**双检索信源**确定哪些网页相关 —— 路由器 `agent-reach`（Exa 搜索、gh、RSS、站内搜索等渠道）
  与 `online_search`（SearXNG 元搜索 CLI，时间窗/学术/中文多引擎，见 [references/online-search.md](references/online-search.md)）；
  信源分工见 [references/research-methodology.md](references/research-methodology.md)「检索源分工」节；
- **检索信源入口（强制）**：执行任何检索前，必须先打开并通读 `online_search` 与 `agent-reach` 两个技能的 SKILL.md
  （若本会话尚未加载过它们）：`online_search` 位于 `skills/online_search/SKILL.md`（源码版 searxng CLI，
  参数/输出/实测引擎可用性见其正文与 [references/online-search.md](references/online-search.md)）；
  `agent-reach` 位于 `skills/agent-reach/SKILL.md`（By-Reach 路由表与 bycli 铁律）。
  **技能不是平台工具**：不得把技能名当作工具名调用（如 `online_search` 工具调用会报 "Tool not found"）；
  必须按其 SKILL.md 中的实际命令面（searxng_cli.py / exec / bycli 等）执行。未通读技能文档就执行检索视为违规；
- 深化研究的每次「抓取」：按下方「来源路由」委派来源执行器取得内容（公共网页一律 `bycli`）；
- 每轮分支产物经 `collect` 登记为 inventory（`sourceSkill + sourceUrl` 去重），learnings/citations 引用
-   inventory 的 `itemId`，杜绝「只抓 snippet 就当证据」与重复抓取；
- 报告完成与后处理全部结束后才清理会话（见 [references/post-processing.md](references/post-processing.md)）。

用户只需要单步采集时，同一链路退化为单分支（depth=1）：框架 → 检索 → 抓取 → 登记 → 后处理。

## 统一状态与命令

会话的唯一状态文件是 `<session-dir>/session.json`（schemaVersion 2.0，task + research + collection 一体化），
由脚本 `scripts/knowledge-collection.mjs` 统一读写：

- 研究维度：`init` / `plan` / `branch` / `aggregate` / `report`；
- 采集维度：`collect`（登记执行器抓取结果并物化，inventory 缺失自动补登）/ `inspect` / `run` / `cleanup` /
  `unlock-stale` / `set-retention` / `rewrite-image-links` / `export-views`；
- 平台维度：`list-kb` / `upload-doc` / `upload-images` / `upload-resource` / `normalize` / `store`；
- 汇总：`status`。

`collection-result.json` 与 `sanitized/metadata.json` 由 `export-views` 生成的兼容导出视图；旧会话（仅有
collection-result.json + sanitized/metadata.json）首次读写自动迁移为 session.json。
脚本与产物契约见 [references/collection-contract.md](references/collection-contract.md)。

## 来源路由

- 公共互联网：加载并遵循 `agent-reach` skill（By-Reach）。公开网页、微信公众号文章、静态页面或 raw URL 均走这条路径，
  不得因「一个链接」「内容公开可读」「直接抓更快」跳过路由。
- 微信公众号后台（例如“我的公众号”的发表记录、后台数据或数据明细 Excel）：这是登录态归属账号采集，不要求公众号名称或原始 ID。
  直接加载并遵循 `bycli` skill，以委派采集模式先用 `published` 命令的 `--limit <N>` 返回最近 N 条发表记录及运营指标，再对每条返回记录的精确 URL 用
  `download-publish-data` 下载数据明细 Excel。不得询问公众号名称、原始 ID 或“数据明细”的含义；仅在登录、验证码或环境验证时按 byCLI 微信规则停下等待用户。
- By-Reach 选择 `bycli`，或用户显式要求 byCLI、浏览器或 Adapter 执行：加载并遵循 `bycli` skill。
- 钉钉/DingTalk：加载并遵循 `dws` skill，并遵循 [DingTalk DWS 采集桥接](references/sources/dingtalk-dws.md)。
- 飞书/Lark：加载并遵循 `fws` skill，并遵循 [Feishu 采集桥接](references/sources/feishu-fws.md)。
- 企业微信/WeCom：加载并遵循 `wecomcli` skill，并遵循 [WeCom 采集桥接](references/sources/wecom-wecomcli.md)。

采集编排器自身不取内容，取内容一律委派来源执行器：不得使用 `web_fetch`、`curl`、`wget`、`requests` 或其他直接 HTTP 客户端绕过来源执行器。
公开可读、静态页面、raw URL、纯文本或 Markdown 内容均不是例外。

By-Reach 的首选执行器与 `bycli` 兜底返回的结果必须统一进入同一套 collection contract，不得按执行后端分叉产物协议。

委派来源执行器时，采集编排器明确声明当前调用采用“委派采集模式”。该模式的契约是：

- 委派采集模式优先于来源执行器的通用采集后处理规则。
- 来源执行器只负责采集并返回结果，不得自行执行或询问后处理。
- 来源执行器不得询问 `入库 / 知识整理 / 跳过`。
- 来源执行器不得反向加载 `knowledge-collection`。

## 采集与后处理

进入完整采集流程时，加载并遵循 [collection-contract.md](references/collection-contract.md) 与
[post-processing.md](references/post-processing.md)。用户选择入库时，还必须加载并遵循
[knowledge-ingest.md](references/knowledge-ingest.md)。这些文件定义详细契约，本 Skill 不重复其流程。

## 闭环执行顺序

1. 来源执行器返回结果后，先建立或加载正式会话。没有自带受测会话 writer 时必须调用 `init`；不得直接修改正式 metadata。
2. 每层深化研究的抓取结果经 `collect` 登记并物化；未物化正文缺失时，按 inventory 恢复描述重新物化，并通过 `collect` 重新登记。
3. 一次只执行一种后处理。入库只采用 ingest 返回的顶层 `itemResults`；知识整理和外部消费也必须生成可按 `itemId` 验证的逐篇结果。
4. 将本次选择、目标、逐篇结果和运行级状态通过 `run` 原子回写。无法证明的结果记为 `unknown`，不得猜测成功。
5. 仅在 run 已成功记录后调用 `cleanup`。partial、failed、unknown、跳过或保留策略生效时，按后处理契约保留会话并从 `inspect` 续跑。

采集结果只选择一种后处理：入库 / 知识整理 / 跳过。用户已明确指定外部消费时直接执行该任务，不再询问默认三选一。
每次后处理运行只能执行一种操作，不得自动串联入库、知识整理或外部消费；会话仍保留时，用户后续明确发起的其他操作创建新的运行；完整成功清理会话后该批次终止，后续操作必须重新采集。
