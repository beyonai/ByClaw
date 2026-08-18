# 站点爬取与产品解读

本文档覆盖「爬取一个产品的文档站/功能说明，产出产品解读报告」这条链路。
爬取只负责**扩大覆盖面**，取内容仍然一律委派来源执行器（公共网页 `bycli web read`），
frontier 状态由 `scripts/crawl-state.mjs` 管理并落在 `session.json` 的 `crawl` 子树。

## 与单页采集的分界

- 目标是**一个已知 URL**（单页、单篇文章）→ 不需要 frontier，直接 `bycli web read` → `normalize` → `collect`。
- 目标是**一个站点/一批文档**（"爬这个产品的文档"、"整理这个产品的功能说明"）→ 走本文档的 frontier 流程。

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

`fetched` 的正文经 `normalize` 生成 `sanitized/items/*.md`，再按既有契约 `collect` 登记 inventory。
frontier 只管覆盖面，inventory 仍是唯一的证据来源，报告引用 `itemId` 不变。

批量导入注意两点（实测踩过）：

- `normalize --markdown-dir` 逐篇从正文头部 `> 原文链接: <URL>` 取各自的 `sourceUrl`；inventory 身份是
  `sourceSkill + sourceUrl`，所以**不要**用一个 `--source-url` 覆盖整个目录，否则多篇会撞成同一条身份。
- 物化状态只在 `init` 建会话时按文件存在性推导一次，事后 `export-views` 不会补算。已经抓好一批正文再建会话时，
  用 `init --collection-result-input-file` 配合 `--metadata-input-file` 预声明
  `materialization: {status:"materialized", markdownPath, sanitizedPath, pendingArtifactCleanup: [], reason: null}`；
  `collectionResult.backend` 决定 `sourceSkill`，缺失会导致 `collect` 报 “sourceSkill 必须是非空字符串”。

## Step 4：登录态与失败处理

generic webpage 在 [source-routing.md](source-routing.md) 路由表里**没有兜底执行器**，`bycli` 失败即停止并报告。
SaaS 控制台内的功能说明页常见 146 bytes 级别的登录墙响应，这类页面：

1. 记 `status=failed` 并写明 `reason`，不要重试其他工具；
2. 在报告里标注该功能区未覆盖，不得用产品官网宣传页的说法补齐；
3. 用户明确提供登录态时，按 `bycli` skill 的认证规则处理，不在本流程内自行登录。

## Step 5：产品解读报告

产品解读与通用研究报告的结构不同，用户未指定时按下面的骨架写，
每个事实结论引用 inventory `itemId`，无来源的一律标注为缺口：

```markdown
# [产品名] 产品解读

## 一句话定位
## 功能矩阵          <- 模块 → 能力 → 覆盖来源 itemId
## 核心机制          <- 它靠什么做到的（架构/算法/数据流）
## 集成与生态        <- API、SDK、CI、第三方集成
## 定价与限制        <- 有明确来源才写，无则标注未覆盖
## 适用场景          <- 场景 → 推荐/不推荐
## 覆盖缺口          <- 登录墙、未抓取的路径、overCap 放弃的页数
## References        <- itemId → sourceUrl
```

`## 覆盖缺口` 是必填章节。frontier 里任何 `failed`、`skipped` 或 `overCap` 的数量都必须出现在这里，
让读者能判断这份解读的完整度。
