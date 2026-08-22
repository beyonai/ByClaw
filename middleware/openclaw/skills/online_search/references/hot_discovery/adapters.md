# hot_discovery 适配器声明表

> **本文件是 `hot_discovery.mjs` 的唯一配置来源。** 下方 `ADAPTER-DECLARATIONS` 块是机器可读的，
> 脚本启动时解析它，**不在代码里硬编码任何适配器**。改适配器只改本文件。
>
> **声明只是建议，不是事实。** 站点与命令是否存在、列名是否还在，一律以运行时
> `bycli list -f json` 校验为准（见 SKILL.md §预校验）。声明过期的后果是**被拦下并告警**，
> 不是崩溃、也不是静默出错。

## 基线版本

| 项 | 值 |
| --- | --- |
| 核对时的 bycli 版本 | **2.1.38** |
| 命令总数 | **922**（`bycli list -f json` 全量提取；命令数会双向漂移） |
| 核对日期 | 2026-08-22（逐字段、限量参数与运行时传输方式比对） |

**升级 bycli 后必须重跑本表的核对**，方法见 SKILL.md 末节。

## 与设计文档（design-hot-discovery-channel-20260817.md v3.1）的 4 处实测偏差

设计文档基于 v2.1.28/v2.1.29 写成，本表基于 v2.1.31 实跑。四处不一致，**以实测为准**：

| # | 设计文档记载 | v2.1.31 实测 | 影响 |
| --- | --- | --- | --- |
| 1 | 失败时 stdout 输出 JSON，读 `error.code` | 错误走 **stderr 的 YAML**（`ok: false` / `code: X` / `exitCode: N`），**stdout 为空** | §5.0 的按 `error.code` 分派必须解析 stderr YAML，不能 `JSON.parse(stdout)` |
| 2 | `weread-official` 是免登录档（档 1） | 需 `WEREAD_API_KEY`，实测 **exit 77 `AUTH_REQUIRED`**；v2.1.38 目录为 `strategy=public,browser=false` | 归入档 3 的**访问策略**，但运行时不走浏览器门禁 |
| 3 | 全部适配器输出 `url` 列 | `weread-official` 的 URL 列是 **`link`** | URL 列同样是开放集合，须逐适配器声明 `urlColumn`（详见下节） |
| 4 | `medium` 无 public 变体 | `medium tag` 是 `strategy=public browser=false`，但**无热度列**（`columns` 无 `claps`） | 结论不变：medium 仍只能走 cookie 档的 `search` |
| 5 | 全部适配器接受 `--limit` | `weread-official search` 只有 `--count`（另有 `--scope` / `--max-idx`），**无 `--limit`** | 须逐适配器声明 `limitFlag`；硬编码 `--limit` 会让它以 `exit 1 unknown option` 失败，**把 `auth_required` 掩盖成 `command_failed`** |

| 6 | `TIMEOUT` 是微信登录专属错误码 | `cnki search` 实测 exit 75 + `TIMEOUT` | `login_timeout` 是常规分支，不是死代码 |
| 7 | 成功即有数据 | `douban search`（cookie 档）**exit 0 + `[]`**，仅 stderr 提示 empty result | 新增 `ok_empty` 状态，与 `ok` 分开，否则报告会声称「已覆盖豆瓣」而实际零产出 |

### 偏差 5 的危害是「掩盖真实状态」，不是「少拿几条」

`weread-official` 早先直接探测是 exit 77 `AUTH_REQUIRED`，但经本通道调用却报 `command_failed`。
原因是未知选项在 bycli 触及 API key 校验**之前**就让进程退出，于是 §5.0 的失败分派拿到了错误的输入。

因此校验不通过时必须**整条跳过并告警**，不能「照发试试」——照发只会再生产一次假的 `command_failed`。
`bycli list -f json` 的 `args[].name`（裸名，不带 `--`）就是权威来源，无需额外 `--help` 调用。

### 偏差 3 和 5 是设计文档 §1.1.2 的第三、四次复现

§1.1.2 发现「标题列是开放集合」（10 个适配器没有 `title`），§6.3 发现「查询参数是开放集合」，
偏差 3 发现「URL 列是开放集合」（`weread-official` 用 `link`），
偏差 5 发现「**限量参数名也是开放集合**」（`weread-official` 用 `--count`）。

四者的失败方向不同，必须分开记：

| 开放集合 | 漏一个的后果 | 是否静默 |
| --- | --- | --- |
| 正文列（黑名单侧） | 少一个字段 | 静默，但无害 |
| 标题列 | **整条候选作废** | **静默** —— 已由 `title_missing` 告警堵住 |
| **URL 列** | **整条候选作废，且无法去重** | **静默** —— 本表新增 `url_missing` 告警堵住 |
| 查询参数 | 丢一次双通道命中 | 静默，且**低估**核心指标 |
| **限量参数名** | **整个适配器失败，且失败原因被伪装** | **不静默但会误导** —— 由 `limit_flag_missing` 预校验堵住 |

`urlColumn` 的处置与 `titleColumn` 同级：取不到即丢弃该条并记 `url_missing`。理由更强 ——
无 URL 的候选连去重的键都没有，比无标题更彻底地不可用。

## 三档划分（访问策略；运行时浏览器传输另行判定）

| 档 | 条件 | 数量 | 调度 |
| --- | --- | --- | --- |
| **1** | 无凭据直连优先 | **14** | 顺序执行；认证/限流即停止后续 adapter |
| **2** | 公开浏览器候选 | **18** | 若运行时需浏览器，先完成桥接健康检查 |
| **3** | 凭据或高风险候选 | **20** | 运行时按 `strategy/browser` 决定直连或浏览器；鉴权失败即停止后续 adapter |

## 原生热度排序：当前声明中只有 7 个带原生排序参数

| 适配器 | 参数 | 热度值 | `choices` 是否可信 |
| --- | --- | --- | --- |
| hupu | `--sort` | `light` / `reply` | **否** —— `choices` 为空数组，合法值只在 help 文本里 |
| juejin | `--sort` | `hottest` | 是（`relevance\|newest\|hottest`） |
| github | `--sort` | `stars` / `forks` | 是 |

cookie 档另有 4 个：`pixiv --order popular_d`（`choices` 完整）、`twitter --top-by-engagement N`、
`reddit --sort hot\|top`（`choices` 空）、`youtube --sort views`（`choices` 空）。

**实现不得用 `choices` 做参数校验** —— hupu / reddit / youtube 三个的 `choices` 是空数组，
用它校验会把全部合法值判为非法。只能传值后按退出码判断。

## 其余 45 个必须本地重排或不提供热度字段

`sortedLocally: true` 是常态。本通道对外只能称「**相关结果中较热**」，不得称「平台最热」——
重排样本是平台按相关性返回的前 N 条，`searchWindowSize` 必须如实填写。

## 正文类列（白名单必须拦住的 17 个）

免登录档 12 个：crates / dockerhub / npm / nuget / packagist / gitee 的 `description`、
rubygems 的 `info`、flathub 与 tvmaze 的 `summary`、github 的 `description`、
juejin 的 `extra.brief` 与 `extra.summary`（**嵌套**，见 quirks）。
cookie 档 5 个：reddit `selftext`、twitter `text` 与 `bio`、jike `content`、douban `abstract`、
weread-official `intro`。

`info` / `summary` / `intro` / `bio` 都不含 `desc`/`text`/`content` 词根，juejin 的两个根本不在
`columns` 顶层 —— **任何子串黑名单都拦不住**。这是白名单的实证依据。

白名单还须拦住 URL 类字段：twitter 的 `media_urls` / `card` / `quoted_tweet`、
reddit 的 `preview_image_url` / `gallery_urls` / `url_overridden_by_dest`、
weread-official 的 `cover`、rednote 的 `author_url`。它们不是正文，但放行会诱使下游把发现结果
当成可直接取内容的资源清单，绕过 agent-reach 路由。

## 机器可读声明

`hot_discovery.mjs` 解析下面这个 fenced block（语言标记 `ADAPTER-DECLARATIONS`）。
格式是 JSON，字段含义见其后的说明表。

```ADAPTER-DECLARATIONS
{
  "tier1": {
    "openalex":       {"cmd":"search","dimensions":["science","scientific publications"],"urlColumn":"url","titleColumn":"title","metricColumns":["citations"],"secondaryColumns":["year","venue","openAccess"],"titleContextFrom":[],"nativeSort":null},
    "stackoverflow":  {"cmd":"search","dimensions":["it","q&a"],"urlColumn":"url","titleColumn":"title","metricColumns":["score","views","answers"],"secondaryColumns":["is_answered","tags"],"titleContextFrom":[],"nativeSort":null},
    "hackernews":     {"cmd":"search","dimensions":["it"],"urlColumn":"url","titleColumn":"title","metricColumns":["score","comments"],"secondaryColumns":[],"titleContextFrom":[],"nativeSort":null},
    "npm":            {"cmd":"search","dimensions":["packages"],"urlColumn":"url","titleColumn":"name","metricColumns":["weeklyDownloads","dependents"],"secondaryColumns":["version","license"],"titleContextFrom":["description"],"nativeSort":null},
    "crates":         {"cmd":"search","dimensions":["packages"],"urlColumn":"url","titleColumn":"name","metricColumns":["downloads","recentDownloads"],"secondaryColumns":["latestVersion"],"titleContextFrom":["description"],"nativeSort":null},
    "rubygems":       {"cmd":"search","dimensions":["packages"],"urlColumn":"url","titleColumn":"gem","metricColumns":["downloads"],"secondaryColumns":["version","license"],"titleContextFrom":["info"],"nativeSort":null},
    "nuget":          {"cmd":"search","dimensions":["packages"],"urlColumn":"url","titleColumn":"title","metricColumns":["totalDownloads"],"secondaryColumns":["version","verified"],"titleContextFrom":["description"],"nativeSort":null},
    "packagist":      {"cmd":"search","dimensions":["packages"],"urlColumn":"url","titleColumn":"package","metricColumns":["downloads","favers"],"secondaryColumns":[],"titleContextFrom":["description"],"nativeSort":null},
    "dockerhub":      {"cmd":"search","dimensions":["packages","repos"],"urlColumn":"url","titleColumn":"image","metricColumns":["stars","pulls"],"secondaryColumns":["official"],"titleContextFrom":["description"],"nativeSort":null},
    "flathub":        {"cmd":"search","dimensions":["apps"],"urlColumn":"url","titleColumn":"name","metricColumns":["installsLastMonth"],"secondaryColumns":["developer","mainCategories","updatedAt"],"titleContextFrom":["summary"],"nativeSort":null},
    "steam":          {"cmd":"search","dimensions":["apps","movies"],"urlColumn":"url","titleColumn":"name","metricColumns":["metascore"],"secondaryColumns":["price","platforms"],"titleContextFrom":[],"nativeSort":null},
    "tvmaze":         {"cmd":"search","dimensions":["movies"],"urlColumn":"url","titleColumn":"name","metricColumns":["rating"],"secondaryColumns":["premiered","network","status","genres"],"titleContextFrom":["summary"],"nativeSort":null},
    "juejin":         {"cmd":"search","dimensions":["it","blogs"],"urlColumn":"url","titleColumn":"title","metricColumns":["hot_index","views","likes","comments"],"secondaryColumns":["published_at","kind"],"titleContextFrom":[],"nativeSort":{"flag":"--sort","value":"hottest"},"extraArgs":["--type","article"],"quirks":["juejin-kind-dispatch","juejin-nested-extra","juejin-cumulative-hotness","juejin-period-empty"]},
    "github":         {"cmd":"search","dimensions":["repos"],"urlColumn":"url","titleColumn":"full_name","metricColumns":["stars","forks"],"secondaryColumns":["language","license","topics","pushed"],"titleContextFrom":["description"],"nativeSort":{"flag":"--sort","value":"stars"},"quirks":["github-rate-limit","github-watchers-dead"]}
  },
  "tier2": {
    "gitee":          {"cmd":"search","dimensions":["repos"],"urlColumn":"url","titleColumn":"name","metricColumns":["stars"],"secondaryColumns":["language"],"titleContextFrom":["description"],"nativeSort":null},
    "36kr":           {"cmd":"search","dimensions":["it","news"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":["date"],"titleContextFrom":[],"nativeSort":null},
    "baidu":          {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "bing":           {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "brave":          {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "duckduckgo":     {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "google":         {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "yahoo":          {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "toutiao":        {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":["like_count","comment_count","share_count","read_count"],"secondaryColumns":["source","publish_time","type"],"titleContextFrom":["summary"],"nativeSort":null},
    "weixin":         {"cmd":"sougousearch","dimensions":["general","blogs"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":["account","publish_time"],"titleContextFrom":["summary"],"nativeSort":null},
    "yandex":         {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "so":             {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "sogou":          {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "52pojie":        {"cmd":"search","dimensions":["general","it"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "hupu":           {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":["lights","replies"],"secondaryColumns":["forum","author"],"titleContextFrom":[],"nativeSort":{"flag":"--sort","value":"light"},"quirks":["choices-empty-untrusted"]},
    "google-scholar": {"cmd":"search","dimensions":["science","scientific publications"],"urlColumn":"url","titleColumn":"title","metricColumns":["cited"],"secondaryColumns":["year","source"],"titleContextFrom":[],"nativeSort":null},
    "baidu-scholar":  {"cmd":"search","dimensions":["science","scientific publications"],"urlColumn":"url","titleColumn":"title","metricColumns":["cited"],"secondaryColumns":["year","journal"],"titleContextFrom":[],"nativeSort":null},
    "wanfang":        {"cmd":"search","dimensions":["science","scientific publications"],"urlColumn":"url","titleColumn":"title","metricColumns":["cited"],"secondaryColumns":["year","source","type"],"titleContextFrom":[],"nativeSort":null}
  },
  "tier3": {
    "reuters":        {"cmd":"search","dimensions":["news"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":["date","section","authors"],"titleContextFrom":[],"nativeSort":null},
    "zhihu":          {"cmd":"search","dimensions":["general","q&a"],"urlColumn":"url","titleColumn":"title","metricColumns":["votes"],"secondaryColumns":["type","author"],"titleContextFrom":[],"nativeSort":null},
    "gitlab":         {"cmd":"search","dimensions":["repos"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "csdn":           {"cmd":"search","dimensions":["it","blogs"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "threads":        {"cmd":"search","dimensions":["social media"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":[],"titleContextFrom":["snippet"],"nativeSort":null},
    "weread-official":{"cmd":"search","dimensions":["books"],"urlColumn":"link","titleColumn":"title","metricColumns":["rating","readingCount"],"secondaryColumns":["author","category"],"titleContextFrom":["intro"],"nativeSort":null,"limitFlag":"--count","quirks":["weread-api-key"]},
    "medium":         {"cmd":"search","dimensions":["blogs"],"urlColumn":"url","titleColumn":"title","metricColumns":["claps"],"secondaryColumns":["date","readTime"],"titleContextFrom":[],"nativeSort":null},
    "linux-do":       {"cmd":"search","dimensions":["it"],"urlColumn":"url","titleColumn":"title","metricColumns":["views","likes","replies"],"secondaryColumns":[],"titleContextFrom":[],"nativeSort":null},
    "twitter":        {"cmd":"search","dimensions":["social media"],"urlColumn":"url","titleColumn":null,"titleFrom":["text"],"metricColumns":["likes","views"],"secondaryColumns":["created_at","author"],"titleContextFrom":[],"nativeSort":{"flag":"--top-by-engagement","value":"30"},"quirks":["twitter-no-title-column"]},
    "reddit":         {"cmd":"search","dimensions":["social media"],"urlColumn":"url","titleColumn":"title","metricColumns":["score","comments"],"secondaryColumns":["subreddit","created_utc"],"titleContextFrom":[],"nativeSort":{"flag":"--sort","value":"top"},"quirks":["choices-empty-untrusted"]},
    "jike":           {"cmd":"search","dimensions":["social media"],"urlColumn":"url","titleColumn":null,"titleFrom":["content"],"metricColumns":["likes","comments"],"secondaryColumns":["time","author"],"titleContextFrom":[],"nativeSort":null,"quirks":["jike-no-title-column"]},
    "tieba":          {"cmd":"search","dimensions":["general","social media"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":["forum","author","time"],"titleContextFrom":[],"nativeSort":null},
    "weibo":          {"cmd":"search","dimensions":["general","social media"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":["author","time"],"titleContextFrom":[],"nativeSort":null},
    "xiaohongshu":    {"cmd":"search","dimensions":["general","social media"],"urlColumn":"url","titleColumn":"title","metricColumns":["likes"],"secondaryColumns":["published_at","author"],"titleContextFrom":[],"nativeSort":null},
    "rednote":        {"cmd":"search","dimensions":["general","social media"],"urlColumn":"url","titleColumn":"title","metricColumns":["likes"],"secondaryColumns":["published_at","author"],"titleContextFrom":[],"nativeSort":null},
    "1point3acres":   {"cmd":"search","dimensions":["general"],"urlColumn":"url","titleColumn":"title","metricColumns":["views","replies"],"secondaryColumns":["forum","postTime"],"titleContextFrom":[],"nativeSort":null},
    "pixiv":          {"cmd":"search","dimensions":["images"],"urlColumn":"url","titleColumn":"title","metricColumns":["bookmarks"],"secondaryColumns":["pages","tags"],"titleContextFrom":[],"nativeSort":{"flag":"--order","value":"popular_d"}},
    "youtube":        {"cmd":"search","dimensions":["videos"],"urlColumn":"url","titleColumn":"title","metricColumns":["views"],"secondaryColumns":["channel","duration","published"],"titleContextFrom":[],"nativeSort":{"flag":"--sort","value":"views"},"quirks":["choices-empty-untrusted"]},
    "douban":         {"cmd":"search","dimensions":["books","movies"],"urlColumn":"url","titleColumn":"title","metricColumns":["rating"],"secondaryColumns":[],"titleContextFrom":["abstract"],"nativeSort":null},
    "cnki":           {"cmd":"search","dimensions":["science"],"urlColumn":"url","titleColumn":"title","metricColumns":[],"secondaryColumns":["year","journal","authors"],"titleContextFrom":[],"nativeSort":null,"quirks":["cnki-no-metric"]}
  },
  "queryParamAllowlist": {
    "youtube.com": ["v"],
    "www.youtube.com": ["v"],
    "youtu.be": [],
    "arxiv.org": [],
    "openalex.org": [],
    "stackoverflow.com": [],
    "github.com": [],
    "juejin.cn": [],
    "npmjs.com": [],
    "hub.docker.com": [],
    "flathub.org": [],
    "store.steampowered.com": ["appid"],
    "zhihu.com": [],
    "reddit.com": [],
    "douban.com": [],
    "*": []
  },
  "mobileSubdomainAllowlist": ["m.juejin.cn", "m.zhihu.com", "m.douban.com", "m.baidu.com", "mobile.twitter.com", "m.weibo.cn"]
}
```

### 声明字段说明

| 字段 | 用途 | 缺失/取不到时 |
| --- | --- | --- |
| `cmd` | 子命令名，运行时校验其存在 | 校验失败即整个适配器跳过并告警 |
| `dimensions` | 维度路由建议（§4.4 取并集，不择一） | — |
| `urlColumn` | 白名单放行的 URL 列。**不可假定为 `url`**（`weread-official` 是 `link`） | 该条候选**丢弃** + `url_missing` |
| `titleColumn` | 白名单放行的标题列。**不可假定为 `title`**（14 个免登录里 6 个不是） | 该条候选**丢弃** + `title_missing` |
| `titleFrom` | 无标题列的适配器（twitter / jike）从正文列**截 60 字符**当标题 | 见 quirks `*-no-title-column` |
| `metricColumns` | 白名单放行的热度列，按顺序作为本地重排的主键 | 全部缺失 → 候选**保留**，降级 + `metric_missing` |
| `secondaryColumns` | 进 `popularity.secondary`，仅标量 | 静默忽略 |
| `titleContextFrom` | 正文列名，取其值**硬截断 100 字符**填 `titleContext`。原字段绝不透传 | 无则该候选无 `titleContext` |
| `nativeSort` | 原生热度排序参数，`null` 表示需本地重排 | `null` → `sortedLocally: true` |
| `extraArgs` | 固定附加参数 | — |
| `quirks` | 逐适配器特例 ID，见下节 | 未识别的 ID 启动即报错 |

**`metricColumns` 为空数组是合法声明**（cnki），表示该适配器无热度列，候选恒为无 `popularity`
的普通候选，且**不记 `metric_missing`** —— 声明为空即预期如此，不是漂移。

### quirks 清单

| ID | 处置 |
| --- | --- |
| `juejin-kind-dispatch` | `kind=course` 行的 `likes`/`comments` 恒 null。取热度按 `kind` 分派，不假定列存在即有值 |
| `juejin-nested-extra` | `extra` 是嵌套对象且键随 `kind` 变。按规则 1 **拒绝该字段并记 `shape_unexpected`**，不展平（展平会把 `brief`/`summary` 提到顶层绕过白名单）。热度无损失：顶层已有四个指标 |
| `juejin-cumulative-hotness` | `hot_index` 是**累积量**，`--sort hottest` 系统性偏向老文。措辞不得称「当前热度」 |
| `juejin-period-empty` | `--period` 与 `--type` 组合会返回 `EMPTY_RESULT`(66)。**默认不传 `--period`**，命中 66 不改参数重试 |
| `github-rate-limit` | 未认证 10 req/min，`--scan` 默认 30 且「one API call each」。**通道内串行 + 单次会话最多 1 次调用**，不与档 1 其余适配器并发。命中 exit 75 + `RATE_LIMITED` 即跳过。不引入 `GITHUB_TOKEN` |
| `github-watchers-dead` | `watchers` 三种方式实测恒 null，`--sort watchers` 客户端重排未生效。热度只用 `stars`/`forks`，`watchers` **不进 metricColumns** |
| `choices-empty-untrusted` | `--sort`/`--order` 的 `choices` 是空数组，合法值只在 help 文本里。**不得用 `choices` 校验**，传值后按退出码判断 |
| `weread-api-key` | 需 `WEREAD_API_KEY` 环境变量，未设即 exit 77 `AUTH_REQUIRED`。**本通道不设置该变量**（凭据不进技能文件），记 `auth_required` 跳过 |
| `twitter-no-title-column` | `columns` 无标题列，唯一文本是 `text`（正文类）。从 `text` 截 **60 字符**作标题，**不再另填 `titleContext`** —— 同一来源不给两份文本 |
| `jike-no-title-column` | 同上，源列是 `content` |
| `cnki-no-metric` | 无任何热度列。`metricColumns: []`，候选恒无 `popularity`，**不记 `metric_missing`** |

### twitter / jike 的标题处置为何是 60 而非 100

设计文档 §1.1.2 只处理「标题列名不是 `title`」，没处理「**根本没有标题列**」。twitter 与 jike 的
`columns` 里唯一的文本字段就是正文（`text` / `content`）—— 按 `title_missing` 规则这两个适配器会
100% 丢弃，等于白跑。

采用的处置是从正文列截 **60 字符**当标题，且**不再另填 `titleContext`**。两点理由：

1. **60 < 100 是刻意的**。标题位天然会被展示与传播（进分组视图、进 Agent 判断），比 `titleContext`
   暴露面更大，因此额度更紧。
2. **不给两份文本**。若既截 60 当标题、又截 100 当 `titleContext`，同一条短贴等于泄漏 100 字符两次，
   §1.1.1 第 1 层的「必然不完整」在短内容上本就不成立（设计文档已记为已知代价），不该再叠加。

**这是白名单在标题项上的第三种失败模式**（§1.1.2 记了两种：列名开放、静默作废）：列**不存在**。
声明用 `titleColumn: null` + `titleFrom` 显式表达，而非留空让运行时猜。

### 查询参数白名单（§6.3 第三条规则）

`queryParamAllowlist` 按 host 声明**已确认可安全保留**的身份参数；只有精确命中 host 时才启用。
未声明的站点默认保留业务参数，只删除 `utm_*` / `fbclid` / `gclid` 等明确追踪参数和敏感参数。
历史 `"*"` 项不作为兜底使用，保留仅为兼容已有声明格式。

敏感参数按上下文识别：对象存储签名、OAuth callback 等已确认的能力参数同时从去重身份和
公开 URL 删除，因此轮换签名仍能归并到同一资源；普通 `policy=privacy` / `policy=terms`
没有签名上下文，必须作为业务身份参数保留，不能误合并。

失败方向与正文列白名单**相反**，必须记准：

- 正文列白名单漏一个 → 少一个字段（安全侧）
- 多留一个参数 → 少一次合并，退化为两条候选（安全侧）
- 误删一个业务参数 → 把两个不同资源合并，制造**伪双通道命中**（危险侧）

因此未知站点必须默认保留业务参数；只有已确认站点才按白名单收敛。

### 移动子域白名单（§6.3 第二条规则）

`mobileSubdomainAllowlist` 列出**确认与主域同内容**的移动子域，只有列出的才归一。
**不用 `m.*` 通配** —— 个别站点的 `m.` 是独立内容，通配会误合并。
