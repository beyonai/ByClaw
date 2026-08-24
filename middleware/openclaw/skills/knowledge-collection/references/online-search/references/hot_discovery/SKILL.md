---
name: hot_discovery
description: 通过 bycli 适配器按关键词检索并按平台原生热度排序，产出高热候选 URL。与 online-search 的 searxng 相关性检索并行使用，只负责发现 URL 与热度字段，不取正文。热度覆盖集中在 packages/science/it 维度，images/videos/music/translate/map/lyrics/radio/files/dictionaries/weather/icons 等维度无免登录热度源。
allowed-tools: read, exec
---

# hot_discovery —— online-search 的热度发现通道

> **入口前提**：本会话若未读过本文，先完整通读再执行。本子技能**只发现 URL 与热度字段，
> 不取正文** —— 取内容一律回到 agent-reach 主路由表。

与 searxng 的相关性检索**并行**跑，产出「相关 + 高热」候选。两个通道汇入后由 `merge` 归并。

## 一句话边界

| 做 | 不做 |
| --- | --- |
| 调 `bycli <site> search`，取 URL / 标题 / 热度字段 | **取正文**（回 agent-reach） |
| 本地按热度重排，输出分组视图 | 写 `session.json`（只经 `knowledge-collection.mjs`） |
| URL 规范化 + 跨通道去重 | 调 searxng（`merge` 只**读**它的输出文件） |
| 读 `adapters.md` + `bycli list` 运行时校验 | 硬编码适配器清单 |
| 鉴权/限流时保留已完成候选并返回 `requiresUserAction` | **触发登录流程**、清理浏览器 session、启动未执行适配器 |
| — | 任何直接 HTTP（禁 `web_fetch` / `curl` / `requests`） |

## 时序：`init` 必须先于本通道

**这不是风格约定，是被两处代码夹死的硬约束**：

- `init` 要求目标目录**不存在或为空**，非空即抛错（`research-state.mjs:425-427`）
- 快照目录 `.post-processing-inputs/` 由 `ensureSessionSkeleton` 在 `init` **内部**以 0700 创建（`session.mjs:453-458`）

两者合起来：**快照没有任何合法位置可以先于 `init` 存在**。为了先跑发现而预建目录或写文件，
`init` 会因目录非空直接失败，整条链断在第一步。

固定顺序：**`init` → 三通道并行发现并分别写输入快照 → `merge` → 可选写 merged 快照**。
由 `knowledge-collection` 发起公共发现时，使用 `public-discover` 完成 SearXNG 与本通道的并行和归并，
不要手工单独运行本命令。

## 用法

```bash
SKILL=<...>/knowledge-collection/references/online-search/references/hot_discovery/scripts

# ① 发现（与 searxng 并行跑）
node $SKILL/hot_discovery.mjs search \
    --query "AI agent framework" \
    --dimensions "science,it,packages,repos" \
    --tiers 1 --limit 20 \
    --out <会话目录>/.post-processing-inputs/hot-discovery-$(date +%s).json

# ② searxng 通道（另一个进程，同时跑）
<技能目录>/scripts/.venv/bin/python searxng_cli.py "AI agent framework" \
    --category it --max-results 20 > /tmp/sx.json

# ③ 归并（两边都完成后）
node $SKILL/hot_discovery.mjs merge \
    --hot-file <快照路径> --searxng-file /tmp/sx.json \
    [--agent-reach-file <f>] [--group-limit 5] \
    [--agent-reach-limit 20] [--unverified-limit 20] [--unranked-hot-limit 20]
```

**快照命名须避开 `items.json` / `run.json` / `m.json`** —— 这些是 `collect --item-json-file`
的惯用名，撞名会被误传。`hot-discovery-<ts>.json` 是约定名。

### 参数

| 子命令 | 参数 | 说明 |
| --- | --- | --- |
| `search` | `--query` | 必填 |
| | `--dimensions` | 必填，逗号分隔。**多维度取并集，不择一** |
| | `--tiers` | 默认 `1,2,3`。只接受 1/2/3 的不重复逗号列表；只跑免登录纯 HTTP 就传 `1` |
| | `--limit` | 每个适配器取几条（1–100，默认 20），同时是 `searchWindowSize` |
| `merge` | `--hot-file` | `search` 的输出 |
| | `--searxng-file` | searxng 的输出（缺失时会在 `warnings` 标注「相关性通道缺失」） |
| | `--group-limit` | 每个热度来源展示几条（1–100，默认 5），避免高产来源淹没其他来源 |
| | `--searxng-limit` | `searxngTop` 最多展示几条（1–1000，默认 20） |
| | `--agent-reach-limit` | `agentReachTop` 最多展示几条（1–1000，默认 20） |
| | `--unverified-limit` | 缺 query、无法验证来源的候选最多展示几条（1–1000，默认 20） |
| | `--unranked-hot-limit` | hot 命中但没有可用热度值的降级候选最多展示几条（1–1000，默认 20） |
| 通用 | `--out` | 结果同时写入该文件 |

## 维度判定（通道入口条件）

**判定者**：编排层的 Agent —— 与选 searxng `--category` 是**同一次判断**，不新增步骤。

**多维度取并集，不择一。** 每次搜索都强制补充 `general` 维度；例如输入 `science,it` 时实际执行
`science,it,general`。因此「AI 发展」会同时命中 general + science + it，三套适配器都跑。
输出中的 `dimensions` 保留调用方请求，`effectiveDimensions` 记录实际执行维度。
理由是各维度的召回集本就不重叠（openalex 出论文、SO 出技术问答、虎扑出讨论帖），
择一等于人为砍掉召回。

**判错的反馈路径**：若维度在所选 tiers 中没有适配器，脚本直接返回空结果并在 `warnings`
报告「无热度适配器覆盖」；若适配器存在但全部返回 0 结果，**报告「热度通道无覆盖」并继续**，
**不自动改判维度重跑** —— 自动重判会掩盖那 11 个真实无覆盖的维度，把「本来就没有热度源」
误报成「判错了」。是否换维度交给 Agent 显式决定。

## 覆盖边界（必须先看，避免反复尝试）

### 有覆盖（9 个维度）

| 维度 | 适配器 | 指标 | 强度 |
| --- | --- | --- | --- |
| packages | npm / crates / rubygems / nuget / packagist / dockerhub | `downloads` / `stars` | **最强**，下载量客观难刷、官方注册中心直出 |
| science | openalex / google-scholar / baidu-scholar / wanfang | `citations` / `cited` | **最强**，引用数是学术界公认指标 |
| scientific publications | openalex | `citations` | 强（arxiv / dblp / openreview 的 search 均无热度列） |
| it | stackoverflow / hackernews / juejin / linux-do | `score` / `views` / `hot_index` | 强 |
| q&a | stackoverflow / zhihu | `score` / `votes` | 强 |
| repos | **github** / gitee / dockerhub | `stars` / `forks` | 强 |
| apps | flathub / steam | `installsLastMonth` / `metascore` | 中（flathub 限 Linux、steam 限游戏） |
| books | weread-official / douban | `rating` / `readingCount` | 中 |
| movies | tvmaze / steam / douban | `rating` / `metascore` | 弱（tvmaze 偏美剧） |

### 只有榜单、无关键词搜索（6 个维度，第 2 期）

news / blogs / currency / general / social media / software wikis —— 热度字段有，
但只能榜单 + 本地过滤。`general` 现在有 `hupu`、`toutiao` 等关键词入口；其余多数 general
适配器仍是普通相关性搜索或需要登录，不能一律视为平台热榜。

### 完全无免登录热度源（11 个维度，**在 SKILL 层面显式声明不支持**）

`images`（唯一源 Pixiv 需 cookie）、`videos`（YouTube / Bilibili / 抖音全需 cookie）、
`music`（spotify 无热度列）、`files`、`dictionaries`（概念不适用）、`translate`（bycli 无适配器）、
`map`、`lyrics`、`radio`、`weather`（概念不适用）、`icons`。

**对这些维度不要调用本通道。**

### 中文 general 主题仍需区分公开热榜与登录渠道

公开渠道现在包含虎扑和头条；知乎、微博、贴吧、小红书、即刻等还依赖登录态或浏览器环境。
`juejin` 补上了中文**技术**热度，但：

- **限技术领域** —— 「AI 发展」的政策、产业、社会面向命中不了
- **`hot_index` 是累积量** —— `--sort hottest` 实测排出 2023-2024 老文，对「当前热点」是反向的

知乎 `search`（`votes`）以及微博、贴吧等社区搜索需按运行时鉴权结果判断；搜索引擎的 `score`
仍是相关性分数，不能制造「有热度数据」的假象。

## 措辞纪律（写报告时必须遵守）

> **本通道对外只能称「相关结果中较热」，不得称「平台最热」。**

当前声明的 52 个适配器中有 7 个带原生热度排序（hupu / juejin / github / pixiv / twitter / reddit / youtube），
**其余 45 个必须本地重排或不提供热度字段**。
本地重排的样本是平台按相关性返回的前 N 条 —— 平台上真正最高热的那条**可能根本不在这 N 条里**。

因此 `sortedLocally: true` 是常态，`searchWindowSize` 不是边缘字段而是几乎每条候选都要带的
审计信息。只有 `sortedLocally: false` 时才可称平台权威热度排序。

**热度是时点观测**，`observedAt` 必须随报告一起给出。juejin 的 `hot_index` 例外 —— 它是累积量，
不随观测时间衰减，**不得称为「当前热度」**。

`popularity.metric` 保留**原始字段名**，不折算。看到 `metric:"downloads", value:8400000` 与
`metric:"citations", value:1284` 时能明确知道两者不可比 —— 这就是**不造统一热度分**的理由。

## 输出 schema

```jsonc
{
  "url": "https://rubygems.org/gems/activeagent",
  "title": "activeagent",                    // 取自声明的 titleColumn，取不到即丢弃该候选
  "titleContext": "The only agent-oriented AI framework designed for Rails, where Agents are Con",
  //   ★ 硬截断 100 字符（UTF-16 码元，非字节）
  //   ★ 禁止写入 collectionFilters / citations / 最终报告
  "searxngContent": "……searxng 引擎的 content 原样保留，不截断……",  // 仅 searxng 命中时存在
  "discoveredBy": ["bycli:crates", "searxng:crates.io"],   // 跨 channel 才是双通道命中
  "unverifiedDiscoveredBy": [],             // 输入缺 query 时存在；不得用于双通道判断
  "relevance": {"searxngScore": 12.34, "searxngRank": 3},
  "popularity": {
    "source": "rubygems",
    "metric": "downloads",        // 原始字段名，不翻译不折算
    "value": 141816,
    "allMetrics": {"downloads": 141816},
    "rankInSource": 1,            // 本地重排后的位次
    "sortedLocally": true,        // 该适配器无原生热度排序参数
    "searchWindowSize": 8,        // ★ 本地重排的样本量 = 平台按相关性返回的条数
    "secondary": {"version": "1.2.0", "license": "MIT"}
  },
  "popularities": [/* 同一 URL 命中多个 hot 来源时存在；按 source/metric 稳定排序 */],
  "acquisitionRoute": null        // 发现阶段一律 null
}
```

**schema 中不存在任何完整正文字段** —— 这是边界约束的实现点。

### 分组视图（`merge` 输出）

| 组 | 依据 |
| --- | --- |
| `bothChannels` | 有 `popularity`，且 `discoveredBy` 同时含 bycli 与 searxng/agent-reach —— **最高优先级** |
| `searxngTop` | 按 `searxngRank` |
| `agentReachTop` | agent-reach 单通道候选，保留输入顺序 |
| `hotBySource` | 按来源分组，每组按其 `metric` 独立排序，各取前 K |
| `hotWithoutPopularity` | bycli 已验证命中但热度列缺失的合法降级候选 |
| `unverified` | 所有来源都缺 query 的候选；只能人工复核，不得当作双通道命中 |

「双通道命中」是核心价值：一条 URL 既被多引擎相关性捞到、又在垂直平台高热，
**不需跨平台折算就能立住**。

`merge` 会把 `--hot-file` 视为不可信快照并重新执行完整 schema 白名单：候选与顶层
`adapterStats` / `warnings` / `query` / `observedAt` 都不直接透传；未知字段、正文、伪造的
`searxng:*` 来源与 `relevance` 一律删除。`popularity.source` 必须匹配 `discoveredBy` 中的
`bycli:<source>`，`rankInSource` / `searchWindowSize` 必须是相互一致的正整数。规范化 URL
只用于去重，原始 URL 不输出，避免凭据或敏感查询参数通过 `originalUrls` 回流。OAuth callback、
对象存储签名等能力参数按上下文从去重身份和公开 URL 同时删除，使轮换凭据仍归并到同一资源；
没有凭据上下文的普通业务参数必须保留。内部 `_dedupKey` 不得出现在输出中。

hot / searxng / agent-reach 快照的非空查询规范化后不一致时，后续不一致通道会被隔离；缺少
query 的通道可保留候选，但来源只进入 `unverifiedDiscoveredBy`，不得参与双通道命中。结构无效、候选行畸形、文件不可读或 JSON
损坏的输入只产生 warning 并隔离该行或该通道，不得让整个 merge 崩溃。同一 URL 命中多个
hot 来源时全部保留在 `popularities`，并在每个 `hotBySource` 组中使用对应来源的热度。

## 三层文本约束（改代码前必读）

发现通道最容易被滑成取内容通道。三层叠起来是：**长度上不可能是正文、命名上不邀请误用、
路径上到不了持久层。**

| 层 | 规则 | 性质 |
| --- | --- | --- |
| 1 长度 | 硬截断 100 字符，跨所有适配器同一规则，字符层截断不做语义处理 | 结构性 |
| 2 命名 | 叫 `titleContext`，**不叫** `snippet` / `summary` / `excerpt` | 结构性 |
| 3 路径 | 严禁写入 `collectionFilters` / `citations` / 最终报告 | **纯纪律，无程序拦截** |

第 2 层是这里唯一真正的防线：`snippet` 暗示「可展示的摘要」，后续会有人想「既然有摘要为什么不用」。

**第 3 层是本设计最薄弱处**，接受它的理由是失效后果被第 1 层压小一个量级 ——
泄漏的是残句而非全文。但这个「量级」对**短内容来源不成立**：一条虎扑帖、知乎问题描述或即刻短贴
可能整篇不足 100 字，第 1 层对它们**不提供保护**，只剩第 2、3 层撑着。

`searxngContent` 不受长度约束（理由见下节），但在**第 3 层上与 `titleContext` 同规则**，
且泄漏后果更大。

### 为什么两个通道的文本长度不对称（有意的）

searxng 的 `content` **全留不截断**。它是既有能力 —— 上一轮 42→7 的候选筛选正是靠它做的
（排除 `ai.ch` 这个仅域名含 `ai` 的瑞士州官网、两篇无关医学论文，都依赖 snippet 而非标题）。
截到 100 字符等于为了通道间对称去砍一个已在用的东西。

**这不违反白名单**：白名单约束的对象是 bycli 支路，理由是 bycli 适配器的正文列
（`selftext` / `content` / `abstract`）能让发现通道变成事实上的取内容通道。searxng 不存在这个
问题 —— 它本来就只返回引擎给的摘要，拿不到全文。**两个通道风险面不同，规则不必相同。**

**代价**：bycli 来源的筛选力度确实弱于 searxng 来源。同一份候选清单里两类记录的判断依据不等长，
Agent 筛选时容易系统性偏向信息更多的 searxng 候选。这是已知偏向，评估时应留意。

### 快照里的 `titleContext` 一经 `collect` 登记即作废

判定依据是 inventory 里已存在同 `sourceUrl` 的条目 —— **无论 `materialization` 是 `materialized`
还是 `pending`**。`pending` 也算：正文没物化不构成使用残句的理由，该走 rawArtifacts 重转或原执行器补采。

**消费方读快照时必须先查 inventory。** 已登记的 URL 只允许从快照取 `popularity` /
`discoveredBy` / `searxngRank`，`titleContext` 与 `searxngContent` 一律忽略。

**`cleanup` 不会替你清掉它**：只在「完整范围全部成功」时整个会话目录进 `.trash-*`；
**部分成功**场景下逐篇 `unlinkSync` 物化文件（`collection-state.mjs:1287`）而**不碰
`.post-processing-inputs/`**，快照长期留存且续跑还会重新读它。这是最常见的场景，
所以上面两条不是理论洁癖。

## popularity 必须随 `collect` 落盘

否则「这条 URL 当初为什么被选中」在最终产物里无法回溯 —— research-tree 能证明引用可追溯，
证明不了筛选依据。高热是选它的理由，理由本身却不留痕。

写进 inventory item 的 `collectionFilters`（自由 object，经 `sanitizeMetadataValue` 递归过滤）：

```jsonc
"collectionFilters": {
  "discoveredBy": ["searxng:crates.io", "bycli:crates"],
  "popularity": {"source":"crates","metric":"downloads","value":141816,
                 "rankInSource":1,"sortedLocally":true,"searchWindowSize":8},
  "popularities": [{"source":"crates","metric":"downloads","value":141816,
                    "rankInSource":1,"sortedLocally":true,"searchWindowSize":8}],
  "searxngRank": 3
}
```

四条纪律：

1. **只写发现元数据，不写正文。** `collectionFilters` 是自由 object，等于白名单之外的一个缺口。
   **`titleContext` 与 `searxngContent` 都不得写入** —— 上面示例刻意只有三项。
2. **`metric` 与 `value` 原样透传**，不折算。存在 `popularities` 时必须完整落盘；单数
   `popularity` 保留为兼容字段，等于 merged 候选的稳定主热度，不得用它替代复数数组。
3. `sanitizeMetadataValue` 会**静默丢弃**敏感键名，因此不得用 `token` / `cookie` / `secret`
   作键名，否则字段消失且无报错。
4. **写入口是 `collection-result.json` 的顶层 `filters`，不是 `collect` 的 payload。**
   `collection-state.mjs:1789` 取的是 `collectionResult.filters`，payload 里同名字段会被忽略。
   这意味着 **`filters` 是整批共享的，不是每条 item 各一份** —— 一次 `collect` 只能落一组
   `popularity` / `popularities`。不同来源/热度集合的候选必须**分批 `collect`**，每批之前更新
   `collection-result.json.filters`；混在一批会让所有条目共用第一条的热度值，
   且不报错（实测已验证：filters 原样进入 inventory 的 `collectionFilters`）。

`collect` 的 payload 形状与 `collection-result.json` **不同**，实测必需字段：

```jsonc
{"schemaVersion":"1.0","items":[{
  "itemId":"item-<sha256(url\ntitle) 前 16 位>",   // 缺失即报错，不会自动生成
  "canonicalItem":{"title":"…","url":"…","author":"","publishTime":"",
                   "markdown":"sanitized/…","fileName":"sanitized/…"},  // author/publishTime 必须存在，空串可以
  "markdownPath":"markdown/…","sanitizedPath":"sanitized/…",            // 两个都必填
  "status":"materialized"}]}
```

`backend` 也从 `collection-result.json` 顶层取（缺失则报
`inventory … sourceSkill 必须是非空字符串`）。先用 `--dry-run` 验一遍再落盘。

## 失败处置

**不兜底、不重试、不降级、不改参数。** 命中认证、CAPTCHA、环境验证或限流时，保留已完成候选，
在顶层返回 `requiresUserAction`，并停止所有尚未启动的适配器；不得触发登录或清理 session。

| exit | `error.code` | 记录 | 处置 |
| --- | --- | --- | --- |
| 77 | `AUTH_REQUIRED` | `auth_required` | 保留已完成候选，停止未启动适配器，**不触发登录** |
| 69 | `BROWSER_CONNECT` | `bridge_unavailable` | **整档**跳过 |
| 75 | `RATE_LIMITED` | `rate_limited` | 保留已完成候选，停止未启动适配器，不重试 |
| 75 | `TIMEOUT` | `login_timeout` | 跳过，**不触发登录、不清理 session** |
| 75 | *(缺失)* | `exit75_ambiguous` | 不猜 |
| 66 | `EMPTY_RESULT` | `empty_result` | **不改参数重试** |
| OS 超时 | — | `timeout` | 跳过并保留 `killed` / 原始错误码，不重试 |
| 其他非 0 | — | `command_failed` | 跳过 |
| **0** | — | **`ok_empty`** | 返回 0 行。**不得当作「已覆盖该平台」** |

**exit 75 同码两义** —— `RATE_LIMITED` 与 `TIMEOUT` 共用它。
**分派必须同时读 `error.code`**，只看码会把限流误判为「等待登录」而进入错误的等待分支。

设计文档把 `TIMEOUT` 归为「仅微信」，**实测不成立**：`cnki search` 在档 3 就产出 exit 75 + `TIMEOUT`。
所以 `login_timeout` 是本通道的常规分支而非死代码，处置与 `auth_required` 一致 ——
跳过即止，**不得**发起登录、导航、探测页面状态或清理该适配器的浏览器 session（页面可能正停在 SSO/MFA/验证码）。

**exit 0 也有两义** —— `ok_empty` 既可能是关键词确实无结果，也可能是 cookie session 已失效：
bycli 在 session 失效时只往 stderr 写 `⚠ Command returned an empty result.`，**退出码仍是 0、stdout 仍是 `[]`**，
两种情况在机器可读层面不可区分（实测 `douban search`）。因此本通道**不猜**，
统一记 `ok_empty` 并告警，交由人判断是否需要先恢复登录态。
把它和 `ok` 合并会造成最坏的一类误读：报告里显示「已覆盖豆瓣」，实际那一档从未产出任何数据。

**实测（v2.1.31）：错误以 YAML 写到 stderr，stdout 为空。** 不能 `JSON.parse(stdout)` 读
`error.code`（设计文档 §5.0 这一点与实测不符，已在 `adapters.md` 记为偏差 1）。

**跳过某适配器时不得顺手清理其浏览器 session** —— 页面可能停在 login/SSO/MFA/CAPTCHA 状态，
规定是不执行任何关闭、跳转、页面检查或重试。

### 运行时传输方式与访问档位

声明里的 tier 是**访问策略**：是否应在当前请求中选用该 adapter、是否可能需要凭据；它不再推断浏览器依赖。
每次执行均从 `bycli list -f json` 读取 `strategy` / `browser`：只有运行时要求浏览器传输的 adapter 才进入
桥接门禁。门禁固定为 `bycli doctor` 后立即 `bycli daemon status`；异常时按冷启动、一次 daemon restart、复检的
阶梯处理，仍异常则返回 `requiresUserAction.kind="bridge_unavailable"`。

### 两级字段告警（列名漂移的唯一防线）

`bycli list` 能校验站点与命令存在，**校验不了真实返回值**。某适配器把 `stars` 改名，
白名单取列会丢掉它，退化为「无 popularity 的普通候选」—— 看起来就像该适配器没搜到结果。

| 情况 | 记录 | 处置 |
| --- | --- | --- |
| exit 0 有结果行，但声明的**热度列全部缺失** | `metric_missing` + 告警 | 候选**保留**，降级 |
| 某行取不到声明的 **`titleColumn`** | `title_missing` + 告警 | **该条丢弃** |
| 某行取不到声明的 **`urlColumn`** | `url_missing` + 告警 | **该条丢弃** |
| 白名单内字段值是 object/array | `shape_unexpected` | **拒绝该字段，不展平** |

两级严重度不同：热度缺失只是降级（候选仍可用于相关性筛选），标题/URL 缺失则候选无意义 ——
落盘空标题会污染分组视图与审计链，无 URL 连去重的键都没有。**都不得静默降级。**

`metricColumns` 声明为**空数组**（cnki）是预期的无热度，不算漂移，不记 `metric_missing`。

## 已知缺口

- **等价路径变体不对齐**：`/tree/master` 与仓库根被算成两条候选。判定两路径是否同一资源需站点
  语义，无通用规则，且尝试对齐反有误合并风险（`/tree/v1` 与 `/tree/v2` 是不同内容）。
- **`github` 的 `watchers` 恒 null**：`--sort stars` / `--with-watchers` / `--sort watchers` 三种方式
  实测全为 null，且 `--sort watchers` 的输出顺序与 `--sort stars` 逐条相同（客户端重排未生效），
  与 `--help` 声称的行为不符。热度只用 `stars` / `forks`。
  **这是「`columns` 元数据不等于真实返回值」最直接的实例**：列存在、有 help 说明、但恒为空。
- **`github` 限流自控**：未认证 10 req/min，`--scan` 默认 30 且「one API call each」。本通道内
  **串行**跑、不传 `--scan`、不引入 `GITHUB_TOKEN`（凭据不进技能文件与命令参数）。
- **`juejin --period` 会返回 `EMPTY_RESULT`**：`--type article --sort hottest --period month3`
  实测 exit 66。即「用 `--period` 换近期热度」这个补救手段本身不可靠，默认不传。
- **`titleContext` 对短内容来源可能已接近全文**：见上文第 1 层的限定。
- **`weread-official` 需 `WEREAD_API_KEY`**，未设即 exit 77。本通道不设置该变量，恒 `auth_required`。
- **热度不等于质量**：高热可能是营销、争议或过时爆款。筛选标准（权威来源、时效、角度互补）仍须施加。
- **`choices` 常为空数组**：hupu / reddit / youtube 的合法值只在 help 文本里。
  **不得用 `choices` 校验参数** —— 会把全部合法值判为非法。

## 升级 bycli 后必须重跑核对

**一次「某能力不存在 / 某形状恒成立」的实跑核验，有效期只到下一次版本升级。** 已有两个实例：
「bycli 没有 github」在两天内失效；「所有 `columns` 都是扁平字符串」被 juejin 的嵌套 `extra` 推翻。

```bash
node scripts/hot_discovery.mjs search --query "probe" --dimensions "packages" --tiers 1 --limit 3
```

看 `warnings`：声明漂移（列名不在 `columns`、档位与 `strategy`/`browser` 不符）会在跑 search
**之前**就报出来。然后跑测试：

```bash
node --test scripts/hot_discovery.test.mjs
```

**这类断言必须写进代码做运行时校验，只写进文档等于没有** —— 脚本已实现声明预校验、
嵌套拒绝、quirk ID 白名单三处运行时断言。
