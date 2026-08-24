---
name: site-crawl
description: >
  Use when the user asks to crawl a product documentation site or a batch of pages for a product report.
  Do not use for one known URL; use the normal single-page collection route instead.
triggers:
  - "爬这个产品的文档"
  - "整理这个产品的功能说明"
  - "生成产品解读报告"
  - "通读官方文档站"
  - "爬完这个站"
mutating: true
---

# 站点爬取与产品解读

本文档覆盖「爬取一个产品的文档站/功能说明，产出产品解读报告」这条链路。
爬取只负责**扩大覆盖面**，取内容仍然一律委派来源执行器（公共网页 `bycli web read`），
frontier 状态由 `scripts/crawl-state.mjs` 管理并落在 `session.json` 的 `crawl` 子树。
本文中的 `scripts/` 路径都相对 **knowledge-collection 技能根**，不是相对本子 skill 目录。

## 与单页采集的分界

- 目标是**一个已知 URL**（单页、单篇文章）→ 不需要 frontier，直接 `bycli web read` → `collect`。
- 目标是**一个站点/一批文档**（"爬这个产品的文档"、"整理这个产品的功能说明"）→ 走本文档的 frontier 流程。

## 与深化研究的关系

本文档是一种**抓取战术**，不是与深化研究并列的另一条链路。

### 模式判据：报告由谁写

`--mode` 按**最终报告的归属**选，不按输入形态（给产品名还是给 URL）选。
输入形态只决定要不要多花一步查域名，不决定模式：

| 报告由谁写 | mode | 链路 |
| --- | --- | --- |
| 由本 Agent 写 | `research` | `init` → 三信源初检 → `plan` → 逐层 `branch` → `aggregate` → `report` |
| 由下游写（外部消费） | `collection` | `init` → 三信源初检定域名 → sitemap + frontier → `collect` → 外部消费 run |

按输入形态判据会错判一类真实场景：用户只给产品名、但报告由下游写。
此时 `research` 模式的 `report` 前置永远等不到那份报告，`cleanup` 只会返回
`retention=true, reason=research-report-pending`。判据落在归属上才收得住。

用户给的是产品名而非文档站 URL 时（"分析 xxx 这个产品"），无论哪种 mode，
文档站域名都由三信源初检查出（内置路由层 + `online_search` + `hot_discovery`），**不得凭产品名猜域名**。
`research` 模式下这步发生在 `plan` 之前；`collection` 模式下它是独立的一次发现，不需要 `plan`。

`research` 模式里，"通读官方文档站"这一类分支的抓取环节才使用本文档的 sitemap + frontier 流程，
产物照常经 `collect` 登记进同一份 inventory，`report` 引用 `itemId` 不变。

### 只要筛过的文章、报告归下游

下游写报告，但希望拿到**经过筛选**的文章（而不是 frontier 全量），仍用 `--mode collection`：
筛选是 Agent 判断，不是脚本能力，`plan` / `branch` 只是把研究轨迹持久化下来给引用用。
报告归下游时那条轨迹没有消费方，所以照常跑筛选判断，但不必调 `plan` / `branch`：

- 框架问题、定域名、按主题切面 → 照做，只是不写进 `task.initialSearch`；
- 逐条判断哪些页值得取全文 → 照做，被筛掉的页 `crawl-mark --status skipped`；
- 选中理由随 `collect` 落盘到 `collectionFilters`（`discoveredBy` / `popularity` / `searxngRank`），
  下游按 `itemId` 就能看出每篇为什么入选；
- 不需要 `--learnings` / `--citations` —— 结论由下游得出，本 Agent 不产出结论。

**交付时必须一并说明筛选口径与放弃量**：`skipped` 页数、`overCap` 放弃页数、`failed` 页数。
下游拿到的是抽样，不说明就会被当成全量，这与报告里的「覆盖缺口」章节是同一个义务。

需要研究轨迹本身也交付时（下游要看"为什么这么筛"的完整链条），才值得用 `research` 模式，
并接受 `report` 是 `cleanup` 的硬前置 —— 此时那份 `report.md` 写成交接说明即可，不必是成品解读。

## Step 1：发现全站 URL（优先 sitemap，不要靠搜索引擎）

文档站的深层页面（`/docs/api/xxx`）搜索引擎大量不收录，`online_search` 的覆盖率不足以支撑「完整解读」。
优先按以下顺序尝试，**取这些文件本身仍走 `bycli`**，不构成直连例外：

```bash
bycli web read --url https://docs.example.com/sitemap.xml --stdout > /tmp/sitemap.md
bycli web read --url https://docs.example.com/llms.txt   --stdout > /tmp/llms.md
```

`web read` 走正文提取，**侧边栏导航会被剥掉**，所以不要指望从首页正文抽全站链接
（实测 uv 文档站首页正文只抽到 13 个链接，sitemap 一次拿到 84 个）。
sitemap 与 llms.txt 都不存在时，退到 `bycli browser find --css a` 读导航区，再把结果写成 URL 清单文件。

`web read` 输出的 Markdown 链接**已绝对化**，可直接入队，不需要自己做相对路径 resolve。

## Step 2：建立 frontier

```bash
node scripts/knowledge-collection.mjs crawl-seed \
  --session-dir <dir> --urls-file /tmp/sitemap.md \
  --scope-prefix https://docs.example.com/ --max-pages 40
```

- `--scope-prefix` 是同域/同路径白名单，超出范围记为 `outOfScope` 丢弃；
- `--max-pages` 是 frontier 容量，超出部分记为 `overCap`，**如实返回而非静默截断**；
  上限收紧时必须向用户说明放弃了多少页（不得让"只抓了 12 页"读起来像"覆盖了全站"）；
- URL 规范化后去重：去 fragment、去 `index.html`、统一尾斜杠、query 排序，
  所以 `?a=1&b=2` 与 `?b=2&a=1` 只入队一次；
- 重复 seed 是幂等的，已 `fetched` 的条目不会被重置回 `pending`。

**规模判断**（实测 mkdocs-material 站点，单页 ~2.3 秒、平均 30 KB）：

| frontier 规模 | 串行耗时 | 正文体量 | 建议 |
|---|---|---|---|
| ≤ 20 页 | ~45 秒 | ~600 KB | 直接全量 |
| 20–80 页 | 1–3 分钟 | 0.6–2.4 MB | 全量抓取，但按主题分批读 |
| > 80 页 | > 3 分钟 | > 2.4 MB | **必须先按 sitemap 路径结构筛选**，不要全量 |

真正的瓶颈不是抓取时间而是上下文：80 页正文远超单次上下文容量。
大站按 URL 路径前缀分层取样（每个 `/concepts/`、`/reference/` 各取代表页），而不是无脑拉满。

## Step 3：取内容并登记

```bash
node scripts/knowledge-collection.mjs crawl-next --session-dir <dir> --limit 5
# 对返回的每个 URL 执行（本脚本不取内容）：
bycli web read --url <URL> --stdout > <dir>/markdown/<name>.md
```

抓完写 mark payload 到 `.post-processing-inputs/`，再登记：

```jsonc
{"results": [
  {"url": "https://docs.example.com/a/", "status": "fetched"},
  {"url": "https://docs.example.com/b/", "status": "failed", "reason": "登录墙，146 bytes"}
]}
```

```bash
node scripts/knowledge-collection.mjs crawl-mark --session-dir <dir> \
  --mark-json-file <dir>/.post-processing-inputs/mark.json
```

- `status` 取 `pending` / `fetched` / `failed` / `skipped`；`failed` 必须给 `reason`；
- 未 `crawl-seed` 过的 URL 拒绝登记，避免"抓了范围外的页还记成成功"；
- 登记成功后脚本删除 payload，失败时保留以便修正重试。

`fetched` 的正文直接 `collect` 登记进 inventory，**中间没有 `normalize` 这一步**：
`normalize` 是 `ingest` 的 dry-run 预检，只写 stdout、不落盘，其 `items[].markdown` 是正文字符串而
`collect` 要的是相对路径，两者结构不兼容（见 [../../SKILL.md](../../SKILL.md)「`normalize` 的真实角色」）。

`collect` 要求 `markdownPath`（`markdown/` 下）与 `sanitizedPath`（`sanitized/items/` 下）**两个文件都已存在**，
否则报 `必须指向普通文件`。所以抓完后自己把正文写到这两个位置（净化副本可与原文同内容），再 `collect`：

```bash
bycli web read --url <URL> --stdout > <dir>/markdown/<itemId>.md
cp <dir>/markdown/<itemId>.md <dir>/sanitized/items/<itemId>.md
node scripts/knowledge-collection.mjs collect --session-dir <dir> \
  --item-json-file <dir>/.post-processing-inputs/batch.json
```

frontier 只管覆盖面，inventory 仍是唯一的证据来源，报告引用 `itemId` 不变。

批量登记注意：inventory 身份是 `sourceSkill + sourceUrl`，每条 `canonicalItem.url` 必须是该页自己的 URL
（`bycli web read` 在正文头部写的 `> 原文链接: <URL>`），**不要**让多篇共用同一个 URL，否则会撞成同一条身份。
`canonicalItem.markdown` 与 `fileName` 必须都等于 `sanitizedPath` 的完整相对路径，不是 basename。

已经抓好一批正文再建会话时（物化状态只在 `init` 时推导一次，事后不补算），照抄
[../collection-contract.md](../collection-contract.md) 的「已抓好一批正文后登记会话」，
不要凭报错逐字段试。

## Step 4：登录态与失败处理

generic webpage 在 [../agent-reach.md](../agent-reach.md) 路由表里**没有兜底执行器**，`bycli` 失败即停止并报告。
SaaS 控制台内的功能说明页常见 146 bytes 级别的登录墙响应，这类页面：

1. 记 `status=failed` 并写明 `reason`，不要重试其他工具；
2. 在报告里标注该功能区未覆盖，不得用产品官网宣传页的说法补齐；
3. 用户明确提供登录态时，按 `bycli` skill 的认证规则处理，不在本流程内自行登录。

## Step 5：产品解读报告

产品解读与通用研究报告的结构不同，用户未指定时按下面的骨架写，
每个事实结论引用 inventory `itemId`，无来源的一律标注为缺口：

```markdown
# [产品名] 产品解读

## 采集范围
说明文档站范围、来源范围、frontier 上限与筛选口径。

## 采集成果
说明来源记录、重复内容组、已物化、pending 和 failed 数量。

### 一句话定位
### 功能矩阵          <- 模块 → 能力 → 覆盖来源 itemId
### 核心机制          <- 它靠什么做到的（架构/算法/数据流）
### 集成与生态        <- API、SDK、CI、第三方集成
### 定价与限制        <- 有明确来源才写，无则标注未覆盖
### 适用场景          <- 场景 → 推荐/不推荐

## 来源与追溯
列出 `itemId → sourceUrl` 映射与 canonical 代表。

## 覆盖缺口与局限
登录墙、未抓取路径、`overCap` 放弃页数、failed 与 pending 项及其影响。
```

`## 覆盖缺口与局限` 是必填章节。frontier 里任何 `failed`、`skipped` 或 `overCap` 的数量都必须出现在这里，
让读者能判断这份解读的完整度。
