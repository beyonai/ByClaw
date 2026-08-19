# Research Methodology(深化研究方法论)

本文档是知识采集技能的「研究深化」部分,继承自 Deep Research 方法论:
递归树状研究 —— 从宽问题出发,拆成若干子问题,逐个子问题完整研究,再用发现与 follow-up 深入一层,
直到达到配置深度,最后聚合为带引用的报告。

研究判断(搜什么、什么相关、学到什么、怎么写报告)全部由 Agent 负责;
本技能只提供流程纪律与持久状态。所有状态写入 <session-dir>/session.json,
由 `scripts/knowledge-collection.mjs` 统一管理(研究维度: init / plan / branch / aggregate / report)。

## 触发场景

- 用户要求“深度研究”“详细调研”“写综述”“多轮检索”或“带引用报告”。
- 问题复杂、多面,单次检索明显不够。
- 用户希望得到结构化、可追溯、带引用来源的长期报告。
- 用户没有明确说“deep research”,但需求明显需要多轮调查和综合。

## 强制执行边界(严禁)

- 编造来源 URL、引用、日期或研究结果。
- 在未实际执行检索/抓取的情况下声称已经检索。
- 跳过递归步骤,直接凭已有知识写最终报告。
- 丢弃 learnings、citations、visitedUrls 或 context 状态。
- 在某一层全部失败后,继续凭空生成 follow-up 或最终内容。
- 绕过 `scripts/knowledge-collection.mjs` 直接修改 session.json。
- 跳过脚本命令,直接声称某一步已完成。
- 直接抓取网页内容:任何一次取内容都必须先经 [agent-reach.md](agent-reach.md) 路由,再委派其选中的来源执行器,
  不得使用 `web_fetch`、`curl`、`wget`、`requests` 或其他直接 HTTP 客户端。

所有结论必须能回溯到已登记来源(collection inventory 的 `itemId`)。无法确认的信息必须明确标注为“未确认”或“缺口”。

## 前置条件

开始前必须确认或建立:

- 当前日期/时间(用于时间敏感研究的锚点;`init` 缺省会把 `startedAt` 设为当前 ISO 时间)。
- `breadth`: 每层子问题数量,默认 3。
- `depth`: 最大递归层数,默认 2。
- `concurrency`: 同一层并行研究上限,默认 2。
- `maxContextWords`: 最终上下文词数上限,默认 25000;中文按 `Intl.Segmenter` 分词统计。
- `deadlineMinutes`: 可选时间预算;超时后 `branch` 只允许登记 `failed` 分支。
- `maxBranches` / `maxSourcesPerBranch` / `maxSearchRounds`: 可选分支/来源/检索轮预算。
- 会话目录与 `session.json`(由 `init --mode research` 创建)。

如果用户没有指定参数,使用默认值,并在最终报告中说明所用参数。研究类会话必须显式使用 `--mode research`;
默认 `--mode collection` 用于单步采集,不强制 report 后才能清理。

## 分步流程

### Step 1: 框架与初始定位(init / plan)

1. 用 `init --mode research --session-dir <dir> --query "..." [--breadth N] [--depth N]
   [--deadline-minutes M] [--max-branches N] [--max-sources-per-branch N] [--max-search-rounds N]` 创建会话。
2. 做一次初步检索,覆盖多个角度,委派**双信源互补检索**:
   - 内置路由层([agent-reach.md](agent-reach.md)): Exa 搜索、gh、RSS、站内搜索等渠道;
   - `online_search`(searxng 多引擎技能): 时间窗(`--time-range day/week/month/year`)、
     中文引擎(baidu/sogou/360search)、学术类别(`--category science`,含 arxiv/crossref/pubmed/openalex)。
3. 基于初步结果生成若干澄清问题或研究方面;用户没有回答时,记录合理假设继续。
4. 用 `plan` 记录初始检索、follow-up 与合并起始查询(`--initial-search` / `--followups` 传 JSON 数组,`--combined-query` 传文本)。

### Step 2: 递归研究(branch × 层级)

对每一层每个分支:

1. 生成子问题并附带 `researchGoal`,说明该检索要解决什么问题。
2. 完整子研究: 多源检索(内置路由层渠道与 `online_search` 技能,分工见下方
   「检索源分工」节)→ 读取全文(经 [agent-reach.md](agent-reach.md) 路由并委派其选中的来源执行器)
   → 过滤 → 登记采集产物。
3. 采集产物登记: 执行器写出的 `collection-result.json` + raw/markdown/sanitized 产物,
   经 `collect --item-json-file` 登记并物化;`sourceSkill + sourceUrl` 去重,learnings/citations 引用 `itemId`。
4. 用 `branch --level N --query "..." --research-goal "..." --learnings "[...]" --citations "{...}"
   --followups "[...]" --sources "[...]" --search-queries "[...]" --context "[...]" --status done|pending|failed [--reason ...]`
   登记该分支,并说明失败原因。
   - `sources` 必须已经出现在 collection inventory 的 `sourceUrl` 或此前的 `visitedUrls` 中;
   - `citations` 的 value 必须是 inventory `itemId` 或已登记 `sourceUrl`,否则脚本拒绝登记;
   - `status=done` 至少要求一条 learning、一条 citation 和一个 source;`failed` 必须给 `--reason`;
   - 可选 `--search-queries` 记录每次检索的 query/skill/engine/resultCount/status,用于研究树审计。
5. 如果当前 `depth > 1`: 对成功分支用 `researchGoal + followUpQuestions` 构造下一层 query,
   `new_breadth = max(2, breadth // 2)`,递归进入下一层。
6. 某一层所有分支都失败: 停止递归,在报告中写明停止原因。

### 检索源分工(内置路由层 × online_search × hot_discovery)

三个检索信源互补并行,发现结果统一进入 learnings/citations;**取内容一律经 [agent-reach.md](agent-reach.md) 路由后委派来源执行器**,
online_search 只负责发现 URL,不得直接抓取网页:

- **时间敏感**(周报/新闻/最新动态): 优先 `online_search --category news|general --time-range week|day`
  (时间窗过滤一步到位,baidu/bing/sogou 支持);
- **学术/标准**: 优先 `online_search --category science`(arxiv/crossref/pubmed/openalex),
  不带 `--time-range`(science 引擎不支持时间窗,传了会过滤为空);
- **英文技术/代码**: 优先内置路由层的 Exa(擅长英文技术文档与代码上下文)与 `gh`(搜 GitHub);
- **热度优先**(需要「相关且高热」而非仅相关): 与 searxng **并行**跑
  `online_search/references/hot_discovery`(子技能),它经 bycli 适配器取平台原生热度字段
  (`citations`/`downloads`/`stars`/`score`),再用其 `merge` 子命令归并两个通道。
  归并输出的 `groups.bothChannels` 是双通道命中,优先级最高。
  **覆盖边界**: 热度集中在 packages/science/it/q&a/repos/apps/books/movies 9 个维度;
  images/videos/music/files/dictionaries/translate/map/lyrics/radio/weather/icons 这 11 个维度
  **无免登录热度源**,不要对它们调用。中文 general 主题是弱项(免登录只有虎扑,偏体育娱乐)。
  **措辞纪律**: 33 个适配器里 30 个需本地重排,对外只能称「相关结果中较热」,不得称「平台最热」;
  热度是时点观测,引用时须给出 `observedAt`;不造统一热度分(`downloads` 与 `citations` 不可比)。
  **时序**: `init` 必须先于任何发现通道——`init` 拒绝非空目录,而快照目录由 `init` 自己创建。
- **通用发现**: 三个信源各跑一次,同一 query 多引擎交叉验证;
- **取内容**: 一律先经 [agent-reach.md](agent-reach.md) 路由,由其路由表按目标选定执行器后委派;
  首选执行器失败时只允许路由表明确给出的一次兜底,之后停止并报告,不得自行替换执行器;
  企业来源(钉钉/飞书/企微)按 SKILL.md「来源路由」节加载对应技能,不走公共互联网路由器。

### Step 3: 聚合去重(aggregate)

用 `aggregate --session-dir <dir>` 合并 learnings、去重 insights 与 URL、
把 context 裁剪到 `maxContextWords`。

### Step 4: 输出报告(report)

1. 基于 learnings/context 写最终报告(写入会话目录 `report.md`,默认路径)。
2. 每个事实性结论尽量带引用(引用 inventory `itemId`,并可回溯 `sourceUrl`)。
3. 没有可靠来源时明确写“未找到/缺口”。
4. 用 `report --report-path <dir>/report.md` 标记完成;脚本自动生成 `research-tree.md`(递归轨迹,Agent 不得手工编辑)。
   - 零 branch 时禁止 report;未达到配置 `depth` 时必须提供 `--stop-reason` 或 `--allow-incomplete`;
   - report 文件必须在会话目录内、非空且不能是符号链接。

最终报告结构(用户未指定结构时):

```markdown
# [Title]

## Executive Summary
## Key Findings
## Detailed Analysis
## Open Questions / Limitations
## References
```

## 研究树日志

`research-tree.md` 由 `report` 命令自动生成,验证递归是否真实执行:

```markdown
# Research Tree

## Level 1
- Query: ...
  - researchGoal: ...
  - Citations: key -> itemId/sourceUrl
  - followUpQuestions: ...
  - sources: ...
  - searchQueries: skill: query (resultCount)
  - status: done|pending|failed
  - reason: ...(失败时)
```

如果某层没有继续递归,必须写明停止原因(`--stop-reason` 或脚本按配置深度自动生成)。

## 失败与恢复

- 单个分支失败: `branch --status failed` 记录失败原因,继续其他分支。
- 某一层全部失败: 停止递归,并在报告中说明。
- 命令/工具失败: 如实报告,不伪造成功。
- 恢复时: 读取 `session.json`(用 `status` 查看;所有命令支持 `<command> --help`),从失败分支继续,不重复已完成分支。
- 如果 session.json 损坏或未初始化,重新 `init` 或从备份恢复,禁止手工修补 JSON。

## 交付物

完成时必须交付:

```text
<session-dir>/
├── session.json        # 唯一状态(task + research + collection)
├── report.md           # 最终研究报告
└── research-tree.md    # 递归研究轨迹(由 report 命令生成)
```

状态文件只能通过 `scripts/knowledge-collection.mjs` 命令修改。

## 通用性说明

本方法论与领域无关:不硬编码任何行业、产品、来源清单或厂商列表。任何新领域都使用同一套递归循环:
初始定位 → 生成带 researchGoal 的子问题 → 完整子研究(检索 + 抓取 + 登记)→ 提取 learnings/citations/follow-ups → 递归 → 聚合 → 写报告。
