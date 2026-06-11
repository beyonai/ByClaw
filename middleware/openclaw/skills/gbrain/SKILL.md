---
name: gbrain
description: 使用 gbrain CLI 接管 agent 记忆管理：先查脑、写入/维护第二大脑、导入 Markdown、向量检索、图谱/时间线、embed/sync/dream/onboard。用户要求记忆、brain-first 查询、知识库维护时使用；不要替代实时网页搜索或其它专用业务 skill。
---

# GBrain Agent 调用手册（OpenClaw）

> **读者**：大模型 / AI Agent。  
> **用途**：根据本手册决定**何时**、**如何**调用 gbrain。  
> **调用优先级**：**① Shell CLI（`gbrain` 命令）→ ② MCP 工具（仅当无 shell 执行权时）**  
> **关联文档**：本 skill 下的 `references/` 目录（上游 gbrain skillpack 快照）。写入前读 `references/_brain-filing-rules.md`；匹配子 skill 时读 `references/<name>/SKILL.md` 全文；路由表见 `references/RESOLVER.md`。

### references 根路径

OpenClaw 容器内 skill 通常位于 `/app/skills/gbrain`；本地开发以实际挂载为准：

```bash
GBRAIN_REF="${OPENCLAW_SKILL_GBRAIN_DIR:-/app/skills/gbrain}/references"
# 例：cat "${GBRAIN_REF}/query/SKILL.md"
```

| 文件/目录 | 作用 |
|-----------|------|
| `references/_AGENT_README.md` | 冷启动契约：路由、frontmatter triggers |
| `references/_brain-filing-rules.md` | 写入前必读：页面归档规则 |
| `references/_output-rules.md` | 输出质量标准 |
| `references/_friction-protocol.md` | 摩擦日志协议 |
| `references/RESOLVER.md` | 意图 → 子 skill 路由表 |
| `references/manifest.json` | skillpack 清单（名称、路径、版本） |
| `references/conventions/` | 跨 skill 约定（brain-first、search-modes 等） |
| `references/<skill-name>/SKILL.md` | 各子 skill 完整工作流 |
| `references/migrations/` | 版本迁移说明 |

## 记忆接管规则

- 回答涉及用户、项目背景、历史决策、长期偏好时，先用 `gbrain query` / `gbrain search` / `gbrain get` 查脑。
- 值得长期保存的信息用 gbrain 写入/导入；命令不确定先 `gbrain --help`。
- 外部 Markdown 知识库：确认路径后 `gbrain import <path>`，必要时 `gbrain embed --stale`。
- 定期维护：`gbrain onboard --check --json`、`gbrain embed --stale`、`gbrain dream`、`gbrain doctor --json`。
- 不把临时推理、敏感密钥、一次性命令输出写入 gbrain，除非用户明确要求。

---

## 0. 你的角色

你是用户的 **brain 操作员**。人物/公司/会议/项目信息**必须**从 gbrain 读取，不得用训练数据或随意上网替代。

**默认做法**：通过 **shell** 执行 `gbrain` 子命令，解析终端输出（建议加 `--json`）。

```bash
gbrain sources current --json               # 操作前确认 source
gbrain query "用户的问题" --json
gbrain get people/alice-example
gbrain think "会前需要了解什么？"
```

**仅当**你没有 shell（纯 MCP 客户端、无 `exec`）时，才改用 MCP 工具（见 §8）。

---

## 1. 硬性规则（违反即错）

1. **CLI 优先**：有终端就用 `gbrain <cmd>`，不要默认走 MCP。
2. **Query 优先**：除「已知 slug 直接 get」外，**默认第一步用 `gbrain query`**；只有 query 薄/空、或明确只要关键词命中且要省 embedding 时才用 `search`。
3. **Brain-first**：先走 §4 检索链，再考虑外网。
4. **禁止用 session memory 查实体**：不用 MEMORY.md / `memory_search` 代替 brain。
5. **禁止幻觉**：答案必须来自命令输出；没有则说「brain 中没有关于 X 的信息」。
6. **必须引用**：`[Source: people/alice-example, compiled truth]`。
7. **写入后 sync**：`put` / `capture` / 改仓库文件后执行 `gbrain sync`，必要时 `gbrain embed`。
8. **关系问题用图**：`gbrain graph-query`，不要只靠 `gbrain query`。
9. **匹配 skill 读 SKILL.md**：复杂流程不即兴发挥。
10. **操作前确认环境**：`gbrain sources current` + `gbrain stats`（怀疑连错库时）。

---

## 2. 环境变量与全局参数

每次新会话或换目录前：

```bash
export GBRAIN_HOME="${GBRAIN_HOME:-/by/.openclaw/gbrain}"   # brain 根；数据在 $GBRAIN_HOME/.gbrain/
export GBRAIN_SOURCE=wiki                  # 可选；不设则走 7 层 source 解析
```

| 全局 flag | 用途 |
|-----------|------|
| `--json` | **Agent 解析输出时必加** |
| `--source <id>` | 单次命令指定 source（优先级最高） |
| `--brain <id>` | 多 brain 挂载时指定库 |
| `--quiet` | 少废话；与 `--json` 合用 |

```bash
gbrain --source wiki query "问题" --json
gbrain sources current --json              # 查看当前解析到哪一层
```

---

## 3. 意图 → CLI 命令（决策表）

| 用户意图 | 第一步 | 不够时 | 需要全文 | 禁止 |
|----------|--------|--------|----------|------|
| 已知 slug | `gbrain get <slug>` | — | — | 不要先 query/search |
| 专名/关键词 | `gbrain query "<词或短问>"` | `gbrain search`（省 embedding） | `gbrain get` | 不要先上网；不要默认 search |
| 自然语言问题 | `gbrain query "<问题>"` | `gbrain get` | 介绍类必 get | 不要只用 search |
| 要合成答案+缺口 | `gbrain think "<问题>"` | — | — | 不要只贴片段 |
| 人物关系 | `gbrain graph-query ...` | `gbrain query` | `gbrain get` | 不要纯向量搜关系 |
| 时间线 | `gbrain timeline <slug>` | `gbrain query` | `gbrain get` | — |
| 保存想法 | `gbrain capture "..."` | — | — | 不要只写聊天 |
| 写/改页面 | `gbrain put <slug>` + sync | — | — | 不要乱路径 |
| 会议/链接/媒体入库 | 读 ingest 类 skill（§7） | — | — | — |
| 核验论文 | 读 academic-verify skill | — | — | — |
| 健康/维护 | `gbrain doctor` / `gbrain dream` | — | — | — |

### 3.1 `query` vs `search` vs `think`（默认 query）

| 命令 | 何时用 |
|------|--------|
| `gbrain query` | **默认首选**：专名、关键词、自然语言问题一律先 query（混合检索 + 可选 expand） |
| `gbrain search` | **备用**：query 薄/空、或明确只要 FTS 且要省 embedding 时 |
| `gbrain think` | 要一段完整答复 + 引用 + 缺口说明（query 不够合成时） |

```bash
gbrain query "alice-example" --json
gbrain query "alice-example 最近进展" --json
gbrain query "问题" --no-expand --json          # 关闭多查询扩展，更快更省
gbrain search "alice-example" --json            # 仅 query 不够或要省 embedding 时
gbrain think "会前需要了解 alice-example 什么？" --json
```

本地 CLI 可指定搜索模式（MCP 不行）：

```bash
gbrain query "问题" --mode balanced --json
gbrain search modes --json
```

---

## 4. 标准检索工作流（CLI 版，每次问答必走）

**原则：先 `query`，再按需降级或加深。**

```bash
# Step 0（可选）确认环境
gbrain stats --json
gbrain sources current --json

# Step 1 混合检索（默认，专名/关键词/自然语言都用 query）
gbrain query "<用户问题或专名>" --json
# → 有结果且够用 → Step 3
# → 薄/空 → Step 2

# Step 2 备用：纯关键词 FTS（省 embedding，或 query 对专名零命中）
gbrain search "<专名或关键词>" --json
# → 仍空 → 告知用户 brain 无此信息；经同意再外网
# → 有结果 → Step 3

# Step 3 读全文（需要时）
gbrain get people/alice-example
# 或从 query 结果里取 slug

# Step 4 回答用户（在对话中）
# → 每句带 [Source: slug, section]
# → 写明缺口
```

### 4.1 何时 `gbrain get` 整页

- **要**：「介绍一下 X」「完整背景」「会前准备」
- **不要整页**：「有没有人提到过 Y」→ `query` 片段即可（必要时再 `search`）

### 4.2 来源优先级（冲突时）

用户陈述 > compiled truth > timeline > 外部 enrichment。冲突时**引用双方**。

---

## 5. CLI 命令参考（Agent 常用）

### 5.1 检索与阅读

```bash
gbrain query "<question>" [--no-expand] [--mode MODE] [--json] [--source ID]   # 默认首选
gbrain ask "<question>"                              # query 别名
gbrain search "<query>" [--json] [--source ID]       # 备用：纯 FTS，省 embedding
gbrain think "<question>" [--json] [--since 30d]
gbrain get <slug> [--json]
gbrain list [--type person] [--tag X] [-n 20] [--json]
gbrain backlinks <slug> [--json]
gbrain timeline <slug> [--json]
gbrain timeline-add <slug> <YYYY-MM-DD> "<text>"
```

### 5.2 图谱

```bash
gbrain graph <slug> [--depth N] [--json]
gbrain graph-query <slug> --type works_at --direction in [--depth N] [--json]
gbrain link <from> <to> [--type works_at]
gbrain unlink <from> <to>
```

| `--type` | 含义 |
|----------|------|
| `works_at` | 就职 |
| `attended` | 参加 |
| `invested_in` | 投资 |
| `founded` | 创立 |
| `advises` | 顾问 |
| `mentions` | 提及 |

示例：

```bash
gbrain graph-query companies/acme-example --type works_at --direction in --json
gbrain graph-query people/alice-example --type attended --depth 2 --json
```

### 5.3 写入与捕获

```bash
gbrain capture "用户原话或摘要"
gbrain capture --file /path/to/note.md
gbrain capture --stdin < note.md
gbrain put people/alice-example < page.md
gbrain delete <slug>
```

写入后**必须**：

```bash
gbrain sync --repo /path/to/brain-git    # 或 gbrain sync（已配置 repo 时）
gbrain embed --stale                      # 需要检索到新内容时
```

写前确认目录：`people/` `companies/` `meetings/` `concepts/`（见 §7.3）。

### 5.4 导入与同步

```bash
gbrain import /path/to/markdown --no-embed    # 大批量先不嵌入
gbrain sync [--repo PATH] [--source ID]
gbrain sync --all
gbrain embed [--all | --stale | <slug>]
gbrain export --dir ./out/
```

### 5.5 维护与诊断

```bash
gbrain doctor [--json] [--fix]
gbrain stats --json
gbrain health --json
gbrain extract all                          # 抽取链接+时间线
gbrain dream [--dry-run] [--json]           # 隔夜维护一轮
gbrain orphans --json
gbrain lint <dir> [--fix]
gbrain search modes --json
gbrain features --json
```

### 5.6 Source 与配置

```bash
gbrain sources list --json
gbrain sources current --json
gbrain sources add wiki --path /path/to/wiki
gbrain config get search.mode
gbrain config set search.mode balanced
gbrain config set provider_base_urls.openai "https://dashscope.aliyuncs.com/compatible-mode/v1"
```

### 5.7 程序化调用（trusted 本地）

与 MCP 等价、但走 CLI 信任边界（可传 `mode`）：

```bash
gbrain call query '{"query":"问题","mode":"balanced"}'
gbrain call get_page '{"slug":"people/alice-example"}'
```

### 5.8 后台任务

```bash
gbrain jobs submit <handler> --params '{"key":"val"}' [--follow]
gbrain jobs list --json
gbrain agent run ...                          # LLM 子 agent
```

### 5.9 MCP 服务（运维启动，不是 Agent 日常首选）

```bash
gbrain serve                                  # stdio MCP（给 IDE 用）
gbrain serve --http --port 3131               # 远程 HTTP
```

Agent **自己**不要优先 `gbrain serve`；应直接调子命令。

---

## 6. 解析 CLI 输出（Agent 必读）

1. **加 `--json`**：便于解析 `slug`、`score`、chunks。
2. **看退出码**：非 0 即失败，读 stderr，不要编造成功结果。
3. **`gbrain query --json`**：返回 ranked chunks；**不是**整页。要全文再 `gbrain get`。
4. **`gbrain think --json`**：含综合答案与元数据；优先用于「直接答用户」。
5. **`gbrain stats --json`**：`page_count`/`chunk_count` 极少 → 可能连错库或未 sync。

---

## 7. Skill 路由（复杂任务）

用户消息匹配 `triggers` 时，读完整 `references/<name>/SKILL.md`（路径相对 `${GBRAIN_REF}`）并按阶段执行；**skill 内指定的命令仍优先用 CLI**。路由 discovery 规则见 `references/_AGENT_README.md`（解析各 SKILL.md frontmatter 的 `triggers:`，**不要**依赖 RESOLVER 内已废弃的 managed-block 表）。

### 7.1 高频 Skill

下表「Skill」列对应 `references/<name>/SKILL.md`：

| 触发意图 | Skill | 典型 CLI |
|----------|-------|----------|
| 查一下 / who is / 背景 | `query` | `gbrain query` → `gbrain get` |
| remember this / 保存 | `capture` | `gbrain capture` |
| ingest / 入库 | `ingest` | `gbrain sync` + skill 流程 |
| 会议 transcript | `meeting-ingestion` | `put` + `extract` + sync |
| 链接/文章 | `idea-ingest` | skill 流程 |
| 视频/PDF | `media-ingest` | skill 流程 |
| enrich 人物公司 | `enrich` | `gbrain enrich <slug>` |
| fix citations | `citation-fixer` | skill 流程 |
| daily briefing | `briefing` | `query` + `get` + 编译 |
| 核验论文 | `academic-verify` | skill + 外网 |
| web research | `perplexity-research` | brain 上下文 + 外网 |
| brain health / dream | `maintain` | `gbrain doctor` / `dream` / `extract` |
| 后台任务 | `minion-orchestrator` | `gbrain jobs submit` |
| 首次安装 | `setup` | `gbrain init` + `doctor` |

完整表：`references/RESOLVER.md`（或 `${GBRAIN_REF}/RESOLVER.md`）。

### 7.2 始终生效

- `references/signal-detector/SKILL.md` — 并行捕捉实体信号
- `references/brain-ops/SKILL.md` — 所有 brain 操作遵守本手册

### 7.3 写入目录

| 主语 | 目录 |
|------|------|
| 人 | `people/` |
| 公司 | `companies/` |
| 会议 | `meetings/` |
| 概念 | `concepts/` |
| 仅批量原始数据 | `sources/` |

---

## 8. MCP 备选（仅无 shell 时）

当环境**只有** MCP 工具、无法 `exec gbrain` 时，按下表映射 CLI：

| CLI 命令 | MCP 工具 | 备注 |
|----------|----------|------|
| `gbrain query` | `query` | **默认首选**；expand 开；**勿传 `mode`** |
| `gbrain search` | `search` | 备用；无 expand |
| `gbrain get` | `get_page` | |
| `gbrain think` | `think` | 远程可能禁 save |
| `gbrain stats` | `get_stats` | |
| `gbrain list` | `list_pages` | |
| `gbrain backlinks` | `get_backlinks` | |
| `gbrain timeline` | `get_timeline` | |
| `gbrain graph` | `traverse_graph` | |
| `gbrain put` | `put_page` | 写后仍需 sync（若工具有 `sync_brain`） |

OpenClaw 工具名可能带前缀 `gbrain__query`，以工具列表为准。

MCP 仅认 `GBRAIN_SOURCE` 环境变量作 source；CLI 还有 `--source`、`.gbrain-source` 等。**结果不一致时以 CLI 为准排查。**

---

## 9. 回答格式（给用户）

1. **直接回答**（不要贴原始 JSON）
2. **引用**：`According to [Source: people/alice-example, compiled truth]...`
3. **缺口**：`brain 中没有自 … 以来关于 X 的记录`
4. **冲突**：列出两方来源

---

## 10. 故障恢复

| 现象 | CLI 侧操作 |
|------|------------|
| query 薄/空、search 有 | 用 search 补一轮；并检查 embedding 是否缺失（`gbrain doctor`） |
| 都空但应有数据 | `gbrain stats --json`；`gbrain sources current --json`；检查 `GBRAIN_HOME`；`gbrain sync` |
| 写入后搜不到 | `gbrain sync` + `gbrain embed --stale` |
| 检索差 | `gbrain doctor --json`；试 `--mode balanced`；必要时 `think` 合成 |
| MCP 与 CLI 不一致 | 以 CLI 为准；查 source 与 `GBRAIN_HOME` |

---

## 11. 反模式

| ❌ 不要 | ✅ 应该 |
|--------|--------|
| 有 shell 却只用 MCP | `gbrain query` / `gbrain get` |
| 凭模型知识答「X 是谁」 | `gbrain query` → `gbrain get` |
| 一上来就用 `search` | 先 `gbrain query`；query 不够再 `search` |
| 复杂问题只用 `search` | `gbrain query` 或 `think` |
| 把 query 的 chunk 当全文 | `gbrain get <slug>` |
| put/capture 后不 sync | `gbrain sync` + `embed` |
| 会议只写 meetings/ | 更新 `people/` `companies/` |
| 跳过 skill 即兴流程 | 读 SKILL.md |

---

## 12. 冷启动（新会话）

```bash
export GBRAIN_HOME="${GBRAIN_HOME:-/by/.openclaw/gbrain}"
GBRAIN_REF="${OPENCLAW_SKILL_GBRAIN_DIR:-/app/skills/gbrain}/references"
gbrain stats --json
gbrain sources current --json
# 首次使用或不确定路由时：读 ${GBRAIN_REF}/_AGENT_README.md
```

然后按 §4 工作流处理用户问题。

---

## 13. 关联文档（references/）

复杂任务**必须**先读对应 `references/<skill>/SKILL.md`，不要即兴发挥。目录索引以 `references/manifest.json` 为准（当前 skillpack 版本见其中 `version` 字段）。

### 13.1 始终生效 / 冷启动

| 文件 | 何时读 |
|------|--------|
| `references/_AGENT_README.md` | 新会话冷启动 |
| `references/_brain-filing-rules.md` | 任何写入前 |
| `references/_output-rules.md` | 生成面向用户的正文 |
| `references/brain-ops/SKILL.md` | 任意 brain 读/写/引用 |
| `references/signal-detector/SKILL.md` | 每条消息并行捕捉实体信号 |
| `references/RESOLVER.md` | 不确定该用哪个子 skill |

### 13.2 检索与问答

| 文件 | 何时读 |
|------|--------|
| `references/query/SKILL.md` | 复杂问答、专名/关系检索 |
| `references/conventions/brain-first.md` | 检索链与 brain-first 原则 |
| `references/conventions/brain-routing.md` | 多 brain / source 解析 |
| `references/conventions/search-modes.md` | conservative / balanced / tokenmax |
| `references/conventions/model-routing.md` | 模型路由约定 |
| `references/perplexity-research/SKILL.md` | brain 上下文 + 外网研究 |
| `references/academic-verify/SKILL.md` | 论文/引用核验 |

### 13.3 写入与入库

| 文件 | 何时读 |
|------|--------|
| `references/capture/SKILL.md` | remember this / 保存想法 |
| `references/ingest/SKILL.md` | 通用 ingest 路由 |
| `references/idea-ingest/SKILL.md` | 链接、文章、推文 |
| `references/media-ingest/SKILL.md` | 视频、PDF、播客 |
| `references/meeting-ingestion/SKILL.md` | 会议 transcript |
| `references/voice-note-ingest/SKILL.md` | 语音笔记 |
| `references/enrich/SKILL.md` | 人物/公司页 enrichment |
| `references/brain-taxonomist/SKILL.md` | 写入前归档路径 |
| `references/eiirp/SKILL.md` | 批量整理、归档研究线程 |
| `references/frontmatter-guard/SKILL.md` | frontmatter 校验修复 |
| `references/citation-fixer/SKILL.md` | 引用格式修复 |

### 13.4 运维与生命周期

| 文件 | 何时读 |
|------|--------|
| `references/setup/SKILL.md` | 首次安装 / init |
| `references/maintain/SKILL.md` | doctor / dream / 健康巡检 |
| `references/migrate/SKILL.md` | 从 Obsidian/Notion 等迁移 |
| `references/gbrain-upgrade/SKILL.md` | 版本升级 |
| `references/skillpack-check/SKILL.md` | 晨检 / cron 健康 JSON |
| `references/smoke-test/SKILL.md` | 容器重启后冒烟 |
| `references/minion-orchestrator/SKILL.md` | 后台 jobs / 子 agent |
| `references/migrations/*.md` | 特定版本 schema 变更 |

### 13.5 其它高频子 skill

| 文件 | 何时读 |
|------|--------|
| `references/briefing/SKILL.md` | 每日简报 |
| `references/daily-task-manager/SKILL.md` | 任务增删改 |
| `references/daily-task-prep/SKILL.md` | 晨间准备 |
| `references/cold-start/SKILL.md` | 空 brain 冷启动导入 |
| `references/publish/SKILL.md` | 分享 brain 页面 |
| `references/ask-user/SKILL.md` | 需要用户二选一/多选时 |

完整 skill 列表（40+）见 `references/manifest.json` 的 `skills[]` 数组；`RESOLVER.md` 按触发意图分组。

---

*CLI 优先 + Query 优先：能跑 `gbrain` 就用 `gbrain`；检索默认 `query`；MCP 是退路。子 skill 细则以 `references/` 为准；行为以当前 gbrain CLI 版本为准。*
