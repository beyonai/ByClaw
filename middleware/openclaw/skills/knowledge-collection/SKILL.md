---
name: knowledge-collection
description: Use when the goal is to COLLECT and keep material rather than just get an answer - collect, crawl, scrape, batch-search, archive, ingest, or organize content from internet or enterprise sources, or store already-collected files in a knowledge base. This is the collection orchestrator and owns collection artifacts, post-processing, and knowledge-base ingestion; prefer it whenever collection intent is explicit, even for a single page or result.
---

# Knowledge Collection

这是面向用户的默认知识采集编排 Skill。采集编排器 `knowledge-collection` 判断采集意图、编排深化研究、选择来源执行器，并衔接后处理；
内置公共互联网路由层 [references/agent-reach.md](references/agent-reach.md)（原 By-Reach 路由器）负责渠道选择，
网站执行器 `bycli` 或其他来源执行器负责取得内容。采集编排器自身永不取内容，任何一次取内容都必须先按下面的「来源路由」委派来源执行器。

## 查询 vs 采集

- 显式采集意图优先于页面或条目数量。用户明确要求 collect、crawl、batch、批量搜索、多条目、archive、归档或 ingest 时，
  即使只有一个页面或一条结果，也进入采集流程。
- 只有不存在显式采集意图时，单个事实、单个页面、打开页面、登录或一次性操作才属于查询，不执行采集后处理。

## 深化研究（默认模式）

本技能把「研究深化」与「采集执行」整合为一条链路。复杂、多面、需要多轮检索或带引用的任务，默认按
[references/research-methodology.md](references/research-methodology.md) 的递归研究流程执行：
先框架问题（breadth/depth/起始 query），逐层拆分为分支，每个分支完成一次「检索 → 抓取 → 登记 → 提炼」，再聚合去重、输出报告。
深化研究会话必须用 `init --mode research` 创建；`mode=research` 会强制 `report` 交付后才允许 `cleanup` 整体清理。

- 深化研究的每次「检索」：使用**三检索信源**确定哪些网页相关 —— 内置路由层的检索渠道（Exa 搜索、gh、RSS、站内搜索等，
  见 [references/agent-reach.md](references/agent-reach.md)）、`online_search`（SearXNG 元搜索 CLI，
  时间窗/学术/中文多引擎，见 [references/online-search.md](references/online-search.md)），
  以及 `online_search/references/hot_discovery`（**热度发现通道**子技能，经 bycli 适配器取平台原生热度
  `citations`/`downloads`/`stars`/`score`，与 searxng **并行**跑后用其 `merge` 归并；
  `groups.bothChannels` 双通道命中优先级最高）；
  信源分工见 [references/research-methodology.md](references/research-methodology.md)「检索源分工」节；
- **热度通道的三条硬边界**（调用前须通读其 SKILL.md）：① 只发现 URL 与热度字段，**不取正文** ——
  取内容仍一律经下方「来源路由」；② 覆盖集中在 packages/science/it/q&a/repos/apps/books/movies 9 个维度，
  images/videos/music/files/dictionaries/translate/map/lyrics/radio/weather/icons 这 11 个维度**无免登录热度源**；
  ③ 30/33 个适配器需本地重排，对外只能称「相关结果中较热」，不得称「平台最热」；
- **检索信源入口（强制）**：执行任何检索前，必须先通读 [references/agent-reach.md](references/agent-reach.md)
  （路由表与 bycli 铁律），并打开通读 `online_search` 技能的 SKILL.md（若本会话尚未加载过它）：
  `online_search` 位于 `skills/online_search/SKILL.md`（源码版 searxng CLI，参数/输出/实测引擎可用性见其正文与
  [references/online-search.md](references/online-search.md)）。
  **技能不是平台工具**：不得把技能名当作工具名调用（如 `online_search` 工具调用会报 "Tool not found"）；
  必须按其 SKILL.md 中的实际命令面（searxng_cli.py / exec / bycli 等）执行。未通读检索文档就执行检索视为违规；
- **时序不可交换**：`init` 必须先于任何发现通道 —— `init` 要求目标目录不存在或为空，
  而热度通道的发现快照目录 `.post-processing-inputs/` 由 `init` 自己以 0700 创建。
  「先跑发现、后建会话」这个看似自然的顺序**必然失败**；
- 深化研究的每次「抓取」：按下方「来源路由」委派来源执行器取得内容（公共网页一律 `bycli`）；
- 每轮分支产物经 `collect` 登记为 inventory（`sourceSkill + sourceUrl` 去重），learnings/citations 引用
-   inventory 的 `itemId`，杜绝「只抓 snippet 就当证据」与重复抓取；
- **发现依据须随 `collect` 落盘**：热度通道命中的条目，把 `discoveredBy` / `popularity` / `searxngRank`
  写进 item 的 `collectionFilters`，否则「这条 URL 当初为什么被选中」在最终产物里无法回溯。
  **只写这三项** —— `titleContext` 与 `searxngContent` 严禁写入（会随 inventory 持久化，等于绕过物化登记）；
  键名不得含 `token`/`cookie`/`secret`（`sanitizeMetadataValue` 会静默丢弃且无报错）；
- 报告完成与后处理全部结束后才清理会话（见 [references/post-processing.md](references/post-processing.md)）。

用户只需要单步采集时，同一链路退化为单分支（depth=1）：框架 → 检索 → 抓取 → 登记 → 后处理。

### 分支登记的硬前置

`branch --status done` 有四项前置，缺任一项都会被拒绝。一次准备齐全，不要靠逐次报错试出来：

- `--research-goal`：非空；
- `--learnings`：JSON 字符串数组，**至少一条**；
- `--sources`：JSON 数组，其中每个 URL **必须已经过 `collect` 登记进 inventory**；未登记会报
  `source 未登记在 inventory: <url>。请先经 collect 登记该来源`；
- `--citations`：JSON 对象，**至少一条**，value 必须是 inventory 的 `itemId` 或已登记 `sourceUrl`。

顺序含义：**先 `collect` 再 `branch`**。没有已登记的正文，就不存在"这一层研究成功了"这回事——
这条约束正是用来阻止「只抓 snippet 就当证据」的，不要试图绕过它去先登记分支。

### 抓取失败必须登记为 failed 分支

抓取失败（超时、反爬、登录态失效、执行器报错、`--max-pages` 截断）时，**唯一的登记通道**是：

```bash
node scripts/knowledge-collection.mjs branch --session-dir <dir> \
  --level <N> --query "<失败的调查方向>" --status failed --reason "<具体原因>"
```

`--reason` 在 `status=failed` 时强制必填，脚本不接受空原因。`failed` 分支不要求 learnings/sources/citations，
所以**没有任何理由跳过登记**。

失败后的正确动作是登记 failed 分支并继续其他分支，**不是**换用 `web_fetch` / `curl` 重试，也**不是**
当作没发生过。抓取失败是研究结论的一部分；未登记的失败等于伪造了覆盖面。

站点爬取的页面级失败走 `crawl-mark --status failed`（同样强制 `reason`），不必为每个失败页面单独建分支。

### 报告正文必须披露失败

`report` **不校验**正文内容，也不检查是否存在 failed 分支——它只校验分支数非零、深度达标、报告文件存在且非空。
一份完全不提失败的报告能被正常放行。因此披露是**规范义务，不是脚本保障**：

- `report.md` 正文必须有**独立章节**披露失败与覆盖范围限制。章节标题可以是「覆盖缺口」「数据局限」「研究限制」
  或其他语义等价表述，不要求字面匹配，但必须单独成章（不得只在结论段落里一笔带过）。
- 该章节必须列出**全部** failed 分支的调查方向与 `reason`，并说明缺口对结论的影响。
- `--max-pages` 放弃的页数与 `crawl-mark` 的 `failed` 页面也必须写入该章节。
- 一次失败都没有时，明确写"本次研究无覆盖缺口"或"无数据局限"，不要省略该章节。

`research-tree.md` 由脚本渲染，会逐层输出每个分支的 `status` 与 `reason`（含中间层）。但用户读的是
`report.md`——**tree 里有不等于报告里有**。不得让部分覆盖读起来像全面覆盖。

## 统一状态与命令

会话的唯一状态文件是 `<session-dir>/session.json`（schemaVersion 2.0，task + research + collection 一体化），
由脚本 `scripts/knowledge-collection.mjs` 统一读写：

- 研究维度：`init` / `plan` / `branch` / `aggregate` / `report`；
- 采集维度：`collect`（登记执行器抓取结果并物化，inventory 缺失自动补登）/ `inspect` / `run` / `cleanup` /
  `unlock-stale` / `set-retention` / `rewrite-image-links` / `export-views`；
- 爬取维度：`crawl-seed` / `crawl-next` / `crawl-mark` / `crawl-status`（站点级 frontier，本身不取内容）；
- 平台维度：`list-kb` / `upload-doc` / `upload-images` / `upload-resource` / `normalize` / `ingest`(`store` 已废弃)；
- 汇总：`status`。

所有命令都支持 `<command> --help` 查看参数、示例与 payload 说明；`help` 显示分组总览。
平台命令不要求 `--session-dir`(门面会直接委派 `ingest.mjs`)。

**`normalize` 的真实角色**：它是 `ingest` 的 dry-run 预检，与 `ingest` 共用 payload 构建逻辑，只校验不请求后端，
结果写入 stdout、**不落盘任何文件**。它的 `payloads.collectionResult.items[].markdown` 是正文字符串（用于 ingest 上传），
而 `collect` 要的是相对路径（指向已物化的 `.md` 文件），两者结构不兼容。因此 `normalize` **不是采集环节**，
它的输出无法喂给 `collect`。登记采集产物一律直接用 `collect`，不要把 `normalize` 误当作前置步骤。

### 状态文件关系与读写时序

系统同时存在三个 JSON 文件，各有不同角色：

1. **`session.json`（权威状态，schemaVersion 2.0）**
   - 由 `knowledge-collection.mjs` 统一读写，包含 task + research + collection 完整状态
   - 所有命令（`init`/`branch`/`collect`/`run`/`cleanup` 等）的修改都直接作用于它
   - 禁止手工编辑

2. **`collection-result.json`（双重角色）**
   - **作为执行器产物输入契约**：来源执行器（bycli/dws/fws 等）抓取完成后写入，供 `init --collection-result-input-file` 或 `collect` 读取
   - **作为导出视图**：`export-views` 从 session.json 重新生成，供外部消费者读取
   - `collect` 成功后会更新它（同步 canonical view）

3. **`sanitized/metadata.json`（纯导出视图）**
   - 由 `export-views` 从 session.json 生成，供 fileBrowser 预览与旧消费者使用
   - 包含完整 inventory、物化状态、保留策略、后处理运行历史
   - 不作为任何命令的输入

**时序**：执行器写 collection-result.json → `init`/`collect` 读取并更新 session.json → `export-views` 生成两个视图文件。
旧会话（仅有后两者）首次读写自动迁移为 session.json，不删除旧文件。
完整契约见 [references/collection-contract.md](references/collection-contract.md)。

## 来源路由

- 公共互联网：按内置路由层 [references/agent-reach.md](references/agent-reach.md) 选定执行器。公开网页、
  微信公众号文章、静态页面或 raw URL 均走这条路径，不得因「一个链接」「内容公开可读」「直接抓更快」跳过路由。
- 微信公众号后台（例如“我的公众号”的发表记录、后台数据或数据明细 Excel）：这是登录态归属账号采集，不要求公众号名称或原始 ID。
  直接加载并遵循 `bycli` skill，以委派采集模式先用 `published` 命令的 `--limit <N>` 返回最近 N 条发表记录及运营指标，再对每条返回记录的精确 URL 用
  `download-publish-data` 下载数据明细 Excel。不得询问公众号名称、原始 ID 或“数据明细”的含义；仅在登录、验证码或环境验证时按 byCLI 微信规则停下等待用户。
- 路由层选中 `bycli`，或用户显式要求 byCLI、浏览器或 Adapter 执行：加载并遵循 `bycli` skill。
- 钉钉/DingTalk：加载并遵循 `dws` skill，并遵循 [DingTalk DWS 采集桥接](references/sources/dingtalk-dws.md)。
- 飞书/Lark：加载并遵循 `fws` skill，并遵循 [Feishu 采集桥接](references/sources/feishu-fws.md)。
- 企业微信/WeCom：加载并遵循 `wecomcli` skill，并遵循 [WeCom 采集桥接](references/sources/wecom-wecomcli.md)。

采集编排器自身不取内容，取内容一律委派来源执行器：不得使用 `web_fetch`、`curl`、`wget`、`requests` 或其他直接 HTTP 客户端绕过来源执行器。
公开可读、静态页面、raw URL、纯文本或 Markdown 内容均不是例外。

路由表首选执行器与 `bycli` 兜底返回的结果必须统一进入同一套 collection contract，不得按执行后端分叉产物协议。

### 委派采集模式

委派来源执行器时，采集编排器在**自然语言指令中明确声明**当前调用采用”委派采集模式”（例如”加载并遵循 bycli skill，以委派采集模式先用 `published` 命令...”）。
该声明不通过环境变量或 CLI 参数传递，而是作为调用上下文的一部分——执行器读取调用者的意图描述即可识别。

**契约内容**：

- 委派采集模式优先于来源执行器的通用采集后处理规则
- 来源执行器只负责采集并返回结构化结果（写入 `collection-result.json` + 正文文件），**不得**自行执行或询问后处理
- 来源执行器**不得**询问 `入库 / 知识整理 / 跳过`
- 来源执行器**不得**反向加载 `knowledge-collection`
- 委派模式不改变执行器的命令、授权、浏览器生命周期或 Adapter 验证规则（例如 byCLI 的微信登录流程不因委派而简化）

统一持久化、产物协议、后处理、入库或知识整理均由 `knowledge-collection` 负责。

## 站点爬取（多页文档）

目标是**一个站点或一批文档**（"爬这个产品的文档"、"整理这个产品的功能说明"、"生成产品解读报告"）时，
加载并遵循 [references/site-crawl/SKILL.md](references/site-crawl/SKILL.md)：先用 sitemap.xml / llms.txt 发现全站 URL，
再用 `crawl-seed` / `crawl-next` / `crawl-mark` 维护 frontier，取内容仍按「来源路由」委派 `bycli web read`。

站点爬取是**抓取战术，不是独立链路**：用户给产品名而非文档站 URL（"分析 xxx 这个产品"）时，
入口仍是上面的深化研究默认模式，文档站域名由 `plan` 的双信源初检查出，不得凭产品名猜域名；
frontier 流程只用在"通读官方文档站"这类分支的抓取环节。
用户已直接给出文档站 URL 且只要"爬完这个站"时，才用 `--mode collection` 单独跑。

目标是**单个已知 URL** 时不需要 frontier，直接按常规采集链路执行。

`references/` 下的文档与子 skill 索引见 [references/manifest.json](references/manifest.json)：
`skills[]` 是子 skill（`<name>/SKILL.md`，带 `triggers`，命中时读完整文件后按其流程执行），
`references[]` 是按需加载的说明文档。子 skill 是本技能内部的战术单元，不可独立于采集编排器调用。

`crawl-*` 命令只管覆盖面与续跑，不取内容、不产出正文；`--max-pages` 放弃的页数与 `failed` 页面必须写入报告的
「覆盖缺口」章节，不得让部分覆盖读起来像全站覆盖。

## 采集与后处理

进入完整采集流程时，加载并遵循 [collection-contract.md](references/collection-contract.md) 与
[post-processing.md](references/post-processing.md)。用户选择入库时，还必须加载并遵循
[knowledge-ingest.md](references/knowledge-ingest.md)。这些文件定义详细契约，本 Skill 不重复其流程。

## 闭环执行顺序

1. **建立或加载会话**
   
   来源执行器返回结果（`collection-result.json` + 正文文件）后，决策路径：
   
   - **新采集任务**：调用 `init --mode collection --collection-result-input-file <执行器产物>`。
     **关键**：必须在 `--collection-result-input-file` 指向的 JSON 里声明 `backend`（例如 `"backend":"bycli"`），
     它决定后续每个条目的 `sourceSkill`，**init 之后无法补声明**。
   
   - **已有会话，追加正文**：把新正文拷进会话目录（`markdown/` 和 `sanitized/items/`），
     然后直接调用 `collect --item-json-file <payload>`。
   
   **`collect` 的自动补登机制**（[collection-state.mjs:1782-1806](scripts/collection-state.mjs#L1782-L1806)）：
   - 触发条件：inventory 中**不存在**该 `itemId`
   - 补登来源：从 payload 的 `canonicalItem.url` 提取 `sourceUrl`，从**会话已有的** `collectionResult.backend` 推导 `sourceSkill`
   - 初始状态：`materialization.status='pending'`，脚本随后按文件存在性更新为 `materialized`
   - **不触发的情况**：inventory 已存在该 `itemId`（无论当前状态是 `materialized`/`pending`/`failed`），
     此时 `collect` 更新已有条目的 `materialization`，不创建新条目
   
   **禁止手工伪造**：不得手写 `sanitized/metadata.json` 的 inventory，也不得手工伪造 `collection-result.json`——
   后者有两个角色（执行器产物 vs `export-views` 导出视图），只有前者可以手写，后者是生成的。
   完整步骤见 [collection-contract.md](references/collection-contract.md)「已抓好一批正文后登记会话」。

2. **登记采集产物**
   
   每层深化研究的抓取结果经 `collect` 登记并物化。未物化正文缺失时，按 inventory 的恢复描述（`sourceSkill` + `sourceUrl` + `rawArtifacts`）
   重新物化，并通过 `collect` 重新登记。`collect` 成功后脚本删除 `.post-processing-inputs/` 中的输入 payload，失败时保留。
3. 一次只执行一种后处理。入库只采用 ingest 返回的顶层 `itemResults`；知识整理和外部消费也必须生成可按 `itemId` 验证的逐篇结果。
4. 将本次选择、目标、逐篇结果和运行级状态通过 `run` 原子回写。无法证明的结果记为 `unknown`，不得猜测成功。
5. 仅在 run 已成功记录后调用 `cleanup`。partial、failed、unknown、跳过或保留策略生效时，按后处理契约保留会话并从 `inspect` 续跑。
   `cleanup` 默认只读计划可用 `--dry-run` 预览；研究模式未 `report` 时清理会安全保留会话并返回 `reason=research-report-pending`。

采集结果只选择一种后处理：入库 / 知识整理 / 跳过。用户已明确指定外部消费时直接执行该任务，不再询问默认三选一。
每次后处理运行只能执行一种操作，不得自动串联入库、知识整理或外部消费；会话仍保留时，用户后续明确发起的其他操作创建新的运行；完整成功清理会话后该批次终止，后续操作必须重新采集。
