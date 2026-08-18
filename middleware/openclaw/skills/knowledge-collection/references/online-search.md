# Online Search 检索信源（SearXNG 元搜索）

`online_search` 是知识采集技能的第二检索信源（与内置路由层 [source-routing.md](source-routing.md) 并列），封装 SearXNG 249 引擎元搜索内核。
技能本体位于 `skills/online_search/`（与 `knowledge-collection` 同级），源码版运行（Python 3.12 + venv），
一次调用聚合多引擎结果并输出单个 JSON。**只负责发现 URL，不得直接抓取网页；取内容一律委派来源执行器（公共网页 `bycli`）。**



## 调用方式

```bash
cd skills/online_search/scripts
.venv/bin/python searxng_cli.py "查询词" [--category <类别>] [--engines a,b] [--time-range week] [--language zh-CN] [--max-results N] [--timeout 15]
```

- 默认按 `--category` 使用内置直连白名单（`searxng_pack_settings.yml` 的 `cli.default_engines`，120 个直连可用引擎），避免超时拖累；
- 白名单外的海外头部引擎（google/duckduckgo/wikipedia/brave 等）在无代理直连环境下不可用（2026-08-15 复测：50 个跳过引擎 47 个不可用，
  3 个可用者已在白名单），属预期行为，无需逐个重试；
- 输出 stdout 单个 JSON：`results[]`（url/title/content/engine/score）+ `engine_stats`（逐引擎耗时与错误）+ `elapsed_sec`；
- 错误时 stdout 输出 `{"error": "...", "exit_code": 1}`，退出码非 0；单引擎失败不影响主结果。

## 关键参数

| 参数 | 说明 |
|---|---|
| `--category` | general / news / science / it / images / videos / files / social media 等；science 含 arxiv/crossref/pubmed/openalex |
| `--time-range` | day / week / month / year；**仅 baidu/bing/sogou 等支持**；science 引擎不支持（传了会过滤为空） |
| `--engines` | 逗号分隔引擎白名单覆盖；海外引擎在无代理时不可用，勿依赖 |
| `--language` | zh-CN / en / all |
| `--pageno` / `--max-results` | 翻页 / 条数 |

## 检索源分工（与内置路由层）

- **时间敏感**（周报/新闻/最新动态）：优先 `online_search --category news|general --time-range week|day`；
- **学术/标准**：优先 `online_search --category science`（不带 time-range）；
- **英文技术/代码**：优先内置路由层的 Exa（擅长英文技术文档与代码上下文）与 `gh`（搜 GitHub）；
- **通用发现**：两个信源各跑一次，同一 query 多引擎交叉验证；
- **取内容**：一律委派来源执行器，公共网页按 [source-routing.md](source-routing.md) → `bycli web read --url <URL> --stdout`。

## 实测引擎可用性（2026-08-15 直连探测）

- 白名单内 121 实例：可用且有结果 30 / 可用但 0 结果 71 / 失败 20（timeout×13、KeyError×4、captcha×1、403×1、ConnectError×1）；
- science 全 7 引擎零失败（arxiv/crossref/openalex/pubmed 均命中）——学术检索首选；
- baidu 触发 captcha、pexels 403（上游风控，换词或稍后再试即可）；
- 4 个 KeyError（discuss.python/hackernews/radio browser/pkg.go.dev）为 SearXNG 解析层异常，非网络问题。
