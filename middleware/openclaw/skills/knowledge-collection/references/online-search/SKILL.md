---
name: online-search
description: 源码版 SearXNG 元搜索 CLI，一次调用聚合 40+ 搜索引擎结果并输出结构化 JSON。适合需要真实网页搜索结果、多引擎交叉验证、时间窗过滤（最近一天/周/月/年）、学术类别（arxiv/crossref/pubmed/openalex）或中文搜索（baidu/sogou/360search）的场景。基于 SearXNG 249 引擎元搜索内核，Python 3.12 + venv 运行，无需常驻服务。
---

# Online Search（SearXNG 元搜索 CLI）

> **入口与使用前提（必读）**：被调用时，若本会话尚未读过本文件，**必须先打开完整通读本文**
> （含参数表、输出格式、实测引擎可用性），再按其中命令面执行；禁止把技能名当作平台工具名调用
> （如直接调 `online-search` 工具会报 "Tool not found"），禁止凭名称猜测 CLI 用法。
> 本技能只负责**发现 URL**，取内容一律委派来源执行器（公共网页 `bycli`）。通过
> `knowledge-collection` 采集公共 URL 时，必须使用 `public-discover`，该命令会与 SearXNG
> 并行运行 `hot_discovery`；直接运行本 CLI 仅用于独立调试。

基于 SearXNG（249 引擎元搜索内核）的**进程内搜索 CLI（源码版）**：每次调用起一个进程，完成搜索后向 stdout 输出单个 JSON 对象并退出。**不启动 Web 服务、不监听端口、不写缓存**。

## 目录结构

```text
online-search/
├── SKILL.md                     # 本技能
├── references/
│   └── hot_discovery/           # ★ 热度发现子技能（与 searxng 并行，见下节）
│       ├── SKILL.md
│       ├── adapters.md          # 逐适配器字段声明（机器可读，脚本唯一配置来源）
│       └── scripts/
│           ├── hot_discovery.mjs
│           └── hot_discovery.test.mjs
└── scripts/
    ├── searxng_cli.py           # ★ 搜索 CLI 入口（进程内调用 SearXNG 核心）
    ├── searxng_pack_settings.yml # 引擎白名单/超时/代理配置
    ├── requirements.txt         # Python 依赖清单
    └── searx/                   # ★ SearXNG 核心源码包（249 引擎模块，勿改）
```

## 安装（首次使用，目标机器需 Python 3.12）

```bash
cd <技能目录>/scripts
./bootstrap-venv.sh
```

安装后调用方式（**不要直接使用系统 python，用 venv 内的**）：

```bash
.venv/bin/python searxng_cli.py "查询词" [参数...]
```

`bootstrap-venv.sh` 要求 Python 3.12 或更高版本，会创建 `.venv`、安装 `requirements.txt`
中的锁定依赖并验证关键模块。`.venv` 是本机生成物，已被 Git 忽略，不能提交。

如需手工排查，可执行与脚本等价的命令：

```bash
python3.12 -m venv .venv                  # 或满足版本要求的 python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `query` | 搜索关键词（位置参数，必填） | - |
| `--engines` | 逗号分隔的引擎白名单，如 `bing,brave,baidu` | 按类别全量 |
| `--category` | 搜索类别：`general` / `images` / `videos` / `news` / `science` / `it` / `files` / `social media` 等 | `general` |
| `--language` | 语言，如 `zh-CN`、`en`、`all` | `all` |
| `--safesearch` | 安全搜索级别 `0`/`1`/`2` | `0` |
| `--time-range` | 时间范围过滤：`day` / `week` / `month` / `year`（仅支持该功能的引擎生效，如 baidu/bing） | 不限 |
| `--pageno` | 结果页码（配合 `--max-results` 翻页，如 `--pageno 2` 取第 2 页） | `1` |
| `--max-results` | 最多返回的结果条数 | `20` |
| `--timeout` | 单次搜索超时上限（秒） | `15` |
| `--list-engines` | 列出全部可用引擎（按类别分组）后退出 | - |

## 示例

```bash
# 默认 general 类别：自动使用内置直连白名单（23 个引擎），无需指定引擎
.venv/bin/python searxng_cli.py "deep learning" --max-results 10

# 时间窗过滤：最近一周的新闻（周报/实时动态场景首选）
.venv/bin/python searxng_cli.py "AI" --category news --time-range week --max-results 5

# 学术检索：science 类别含 arxiv/crossref/pubmed/openalex 等学术引擎
.venv/bin/python searxng_cli.py "ontology engineering" --category science --max-results 5

# 中文搜索（general 白名单已含 baidu/sogou/360search 等中文引擎）
.venv/bin/python searxng_cli.py "量子计算" --language zh-CN --max-results 5

# 翻页取第 2 页结果
.venv/bin/python searxng_cli.py "量子计算" --category general --pageno 2 --max-results 5

# 查看可用引擎（全量，不受白名单限制）
.venv/bin/python searxng_cli.py --list-engines
```

**引擎选择机制**：
- **默认**：不传 `--engines` 时，按 `--category` 使用内置直连白名单（配置在 `scripts/searxng_pack_settings.yml` 的 `cli.default_engines` 段，共 120 个直连可用引擎、14 个类别），避免全量引擎带来的超时拖累
- **全量**：想用某类别全部引擎，删除配置中对应类别的白名单条目即可
- **手动指定**：传 `--engines` 可覆盖白名单（如需要海外引擎时配合代理使用）

## 输出格式

stdout 输出**单个 JSON 对象**（`ensure_ascii=False`，中文原样保留）：

```json
{
  "query": "deep learning",
  "results": [
    {
      "url": "https://en.wikipedia.org/wiki/Deep_learning",
      "title": "Deep learning - Wikipedia",
      "content": "Deep learning is a subset of machine learning...",
      "engine": "brave",
      "score": 12.3456
    }
  ],
  "engine_stats": {
    "bing":     {"elapsed_sec": 0.44,  "error": null},
    "mojeek":   {"elapsed_sec": null,  "error": "timeout"}
  },
  "elapsed_sec": 3.21,
  "result_count": 10,
  "suggestions": ["..."]      // 可选：引擎建议词
}
```

字段说明：

- `results[]`：去重、按相关性排序后的主结果；`engine` 为来源引擎（多引擎合并时逗号分隔）
- `engine_stats`：每个参与引擎的耗时与错误（`error: null` 表示成功；常见错误值见下）
- `elapsed_sec`：搜索耗时（不含进程冷启动）
- `result_count`：本批返回条数（受 `--max-results` 限制）

错误时：stderr 输出人类可读错误与堆栈，stdout 输出 `{"error": "原因", "exit_code": 1}`，退出码非 0。

## 子技能：hot_discovery（热度发现通道）

searxng 给的是**相关性**排序，拿不到平台原生热度。需要「相关 **且** 高热」时，
与本技能**并行**调用子技能 [references/hot_discovery/SKILL.md](references/hot_discovery/SKILL.md)——
它经 bycli 适配器按关键词检索，取平台原生热度字段（`citations` / `downloads` / `stars` / `score` …），
再由其 `merge` 子命令归并两个通道的结果。

**两个通道的分工**：

| | searxng（本技能） | hot_discovery（子技能） |
| --- | --- | --- |
| 排序依据 | 多引擎相关性 | 平台原生热度字段 |
| 覆盖面 | 249 引擎，几乎所有类别 | 33 个适配器，热度集中在 packages/science/it |
| 摘要 | `content` 全留，不截断 | `titleContext` 硬截断 100 字符 |
| 取内容 | 不做（委派来源执行器） | 不做（回 agent-reach 主路由表） |

**何时并行调用**：主题落在 packages / science / it / q&a / repos / apps / books / movies 这 9 个维度，
且需要按热度而非仅相关性筛选时。

**何时不要调用**：images / videos / music / files / dictionaries / translate / map / lyrics /
radio / weather / icons —— 这 11 个维度**没有免登录热度源**，调用只是白跑。

**独立调试时的并行方式**：两个进程同时起，各自输出 JSON 文件，再交给 `hot_discovery.mjs merge`。
在 `knowledge-collection` 中不要手工拆开这三步，改用 `public-discover`：

```bash
node scripts/knowledge-collection.mjs public-discover \
  --session-dir <会话目录> --query "AI agent framework" --category it
```

该命令把 `it` 传给热度发现，后者会补充 `general`；一条发现通道失败时仍保留另一条的结果。

手工调试命令如下：

```bash
# 通道 1（本技能）
.venv/bin/python searxng_cli.py "AI agent framework" --category it --max-results 20 > /tmp/sx.json

# 通道 2（子技能，同时跑）
node references/hot_discovery/scripts/hot_discovery.mjs search \
    --query "AI agent framework" --dimensions "it,packages,repos" --tiers 1 --out /tmp/hot.json

# 归并（两边都完成后；merge 只读文件，不执行 searxng）
node references/hot_discovery/scripts/hot_discovery.mjs merge \
    --hot-file /tmp/hot.json --searxng-file /tmp/sx.json
```

归并输出的 `groups.bothChannels` 是**双通道命中**——一条 URL 既被多引擎相关性捞到、又在垂直平台
高热，是最高优先级的候选。

**调用前必须通读子技能的 SKILL.md**：它有若干不可从命令面推出的约束（措辞纪律、
`titleContext` 三层约束、失败不兜底、`init` 必须先于发现通道）。

## 给 Agent 的调用指引

1. **解析**：直接 `json.loads(stdout)`；不要解析 stderr（那里只有日志）
2. **默认路径**：不传 `--engines` 时走 `--category` 对应的内置直连白名单（默认 general 23 个引擎），速度快、0 超时拖累；想换类别直接改 `--category`，无需指定引擎
3. **手动指定**：需要精确控制时用 `--engines baidu,bing` 覆盖白名单；海外引擎需配合代理（见注意事项）
4. **容错**：上游引擎偶发失效属正常——`engine_stats` 中 `error` 非空的引擎跳过即可，`results` 仍有效；个别引擎被目标站点风控（403/CAPTCHA）时会进入 180s 挂起，下一次调用不受影响（进程级状态，不跨调用）
5. **退出码**：`0` = 成功（即使 `result_count: 0` 也算成功返回）；非 `0` = 参数/初始化错误，读 `stdout.error`
6. **性能**：冷启动约 1.5s，之后每次调用总耗时 ≈ 冷启动 + `elapsed_sec`；建议批量查询时一次传多关键词分开调用，而不是加大 `--timeout`

## 注意事项

- **默认直连，内置白名单**：上游引擎请求直连互联网，默认按类别使用 120 个实测直连可用引擎（配置见 `scripts/searxng_pack_settings.yml` 的 `cli.default_engines` 段）；海外引擎（google、duckduckgo、wikipedia、brave 等）在无代理环境会超时/被拒，属预期行为，其余引擎自动降级不影响结果
- **可选代理**：如需访问被墙的海外引擎，编辑 `scripts/searxng_pack_settings.yml`，在 `outgoing:` 下加入 `proxies: {all://: [http://127.0.0.1:7890]}` 后重新运行即可（CLI 每次调用读取该配置，改完即生效）；SearXNG 使用自定义网络层，**不读取系统环境变量代理**
- **运行环境**：需要 Python 3.12 + venv（见「安装」节）；SearXNG 使用自定义网络层，venv 安装一次后即可重复使用
- 本 CLI 不启动 Flask 服务、不监听端口、不写缓存（valkey/redis 已禁用为内存模式）
- 首次启动约 1.5s（加载全部引擎）；搜索本身耗时见 `elapsed_sec`，上限受 `--timeout` 约束

## 常见错误值（engine_stats.error）

| 错误 | 含义 | 建议 |
|---|---|---|
| `SearxEngineAccessDeniedException` | 引擎返回 403，被目标站拒绝 | 换引擎或稍后再试 |
| `SearxEngineCaptchaException` | 目标站要求人机验证 | 换引擎（如 duckduckgo 常触发） |
| `timeout` | 引擎响应超时 | 属正常波动，重试或忽略 |
| `json.decoder.JSONDecodeError` | 上游返回了非预期内容 | 忽略该引擎 |
