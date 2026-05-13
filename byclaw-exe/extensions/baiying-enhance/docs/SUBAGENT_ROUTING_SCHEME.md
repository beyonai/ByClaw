# SUBAGENT_ROUTING 改造方案说明（baiying-enhance）

本文档描述「一呼百应」主 agent 意图路由增强的设计背景、已实现能力与使用方式。实现代码位于扩展包 `baiying-enhance` 内，与百应导出的数字员工 JSON 及 OpenClaw `agents.list` 协同工作。

---

## 1. 背景与问题

### 1.1 编排链路

主会话（通常为 `main`）在 [`templates/main-agents.md`](../templates/main-agents.md) 中被定义为 **Orchestrator**：对复杂任务应分解并通过 `sessions_spawn` 委托子 agent。模板要求在同一轮对话中 **先调用 `agents_list`**，再依据返回的 `agentId` 白名单进行 spawn。

### 1.2 信息密度不足

合并进 OpenClaw 配置的 `agents.list` 条目（`AgentListEntry`）在 [`src/agent-adapter.ts`](../src/agent-adapter.ts) 中主要携带 **`id`、`name`、`identity`** 等字段；百应详情里的 **`resourceDesc`、`coreCompetencies`、关联资源** 等高密度信息虽在适配结果 `AdaptedManagedAgent` 与磁盘 JSON 中存在，但 **未进入** `agents_list` 工具返回的列表形态。

因此模型在「选谁干活」阶段容易仅凭名称做模糊匹配，**意图路由偏差**。

### 1.3 已有能力未进入主会话上下文

子 agent 工作区种子化（[`src/workspace-seed.ts`](../src/workspace-seed.ts)）会为每个托管体生成丰富的 `AGENTS.md` / `TOOLS.md` 等，但 **main 默认不会自动读取** 各 `workspace-baiying-agent-*` 下的文件；主会话主要依赖启动上下文 + 工具返回的稀疏列表。

---

## 2. 目标与原则

| 目标 | 说明 |
|------|------|
| 高密度先验 | 在 main 工作区提供一份 **随注册表更新** 的只读路由摘要，便于模型在分解任务前对齐「子任务 → 候选 `agentId`」。 |
| 不替代 `agents_list` | `SUBAGENT_ROUTING.md` 仅为 **提示**；**允许目标与 id 仍以 `agents_list` 返回为准**，避免与 OpenClaw 真值冲突。 |
| 与主 `AGENTS.md` 策略一致 | 使用同一套 `mainAgentsMdMode` / `mainWorkspaceAgentsAutoSeed` 闸门；路由文件带独立托管标记，避免覆盖用户手写内容。 |

---

## 3. 已实现方案概要

### 3.1 产物与路径

| 产物 | 路径（运行时） | 说明 |
|------|----------------|------|
| `SUBAGENT_ROUTING.md` | `resolveAgentWorkspaceDir(api, mainParentAgentId)` 与 `AGENTS.md` 同级 | 由插件在每次 agent 目录 flush 并成功写入主 `AGENTS.md` 的策略分支后，按 **并行策略** 写入或跳过。 |
| 托管标记 | 首行 `<!-- baiying-enhance: subagent routing seed -->` | 与主 `AGENTS.md` 的 `MAIN_AGENTS_MARKER` 思路一致。 |

### 3.2 核心模块

| 文件 | 职责 |
|------|------|
| [`src/subagent-routing-seed.ts`](../src/subagent-routing-seed.ts) | `buildSubagentRoutingMarkdown(managed)`：从 `AdaptedManagedAgent[]` 生成 Markdown；可选读 `sourceFilePath` 取百应详情 `resourceDesc` 或 `agent_list[0].instructions`；总输出上限与 `MAX_TOTAL_CHARS` 一致（当前 **9000** 字符）。 |
| [`src/main-workspace-seed.ts`](../src/main-workspace-seed.ts) | `seedMainAgentAgentsMd({ ..., managedAgents })`：写主 `AGENTS.md` 后调用 `writeSubagentRoutingWithPolicy`（`if_missing` / `if_managed_marker` / `always` 与主文件对齐）。 |
| [`src/agent-watchdog.ts`](../src/agent-watchdog.ts) | `trySeedMainAgentsMd` 传入 `managedAgents: filteredManaged`，保证路由表与 **当前可见托管集合** 同步。 |
| [`index.ts`](../index.ts) | 注册时 `managedAgents: []`（尚无扫描结果时写空表说明）。 |

### 3.3 模板与行为约定

[`templates/main-agents.md`](../templates/main-agents.md) 已更新：

- **Session Startup** 中列出 `SUBAGENT_ROUTING.md`，并增加 **编排例外**：为 `sessions_spawn` 可先读该文件。
- **Hard gate** 顺序：**（可选）读 `SUBAGENT_ROUTING.md` → `agents_list` → 分解与 spawn**。

构建时模板内联进 `dist/index.js`（`npm run build`）。

---

## 4. 路由表内容结构（精简卡片）

每个 `baiying-agent-*` 仅占少量行，优先 **可扫读的区分度**，完整人设仍在各子 agent 工作区 `AGENTS.md` / `SOUL.md`。

| 行 / 字段 | 含义与上限 |
|-----------|------------|
| `## 展示名` | `listEntry.name` |
| 一行三要素 | `` `agentId` ``、`integrationType`、路由形态（`LLM` 或 `BACKEND:INTERFACE` / `A2A` / `PAGE`，后者表示子会话内多依赖 `baiying_call`） |
| **role** | `resourceDesc` 或 `systemPrompt` / `instructions` 截断（约 220 字内） |
| **scope**（可选） | 从 `coreCompetencies` 各取至多 **2** 条 accept / reject，单条约 44 字，合并为 `in: … \| out: …` |
| **ex**（可选） | 至多 **2** 条示例短语 |

全文总预算约 **9000** 字符，超出则尾部截断并附提示。关联资源（OBJECT/VIEW 等）不在此表展示，请需要时查看各子 agent 工作区 `TOOLS.md` 或导出 JSON。

更细的 JSON → 子 agent 各 `.md` 映射见 [AGENT_JSON_WORKSPACE_MD_MAPPING.md](./AGENT_JSON_WORKSPACE_MD_MAPPING.md)。

---

## 5. 离线生成路由表示例（可选）

历史上曾计划在扩展内提供 `scripts/generate-subagent-routing-from-resources.ts` 与 `docs/SUBAGENT_ROUTING.md` 样例输出；**当前本仓库扩展目录下未必包含该脚本或生成文件**。需要审阅路由表形态时，可：

- 启动网关并完成一次 agent flush 后，查看主工作区（默认 `main`）目录下的 **`SUBAGENT_ROUTING.md`**；或  
- 在本地调用 `buildSubagentRoutingMarkdown`（`src/subagent-routing-seed.ts`）对一组 `AdaptedManagedAgent` 做离线生成。

若后续补回脚本，可再在本节恢复具体命令与路径说明。

运行时 main 工作区中的 **`SUBAGENT_ROUTING.md` 仍仅由插件** 在 agent 配置目录同步后写入；勿将任意离线草稿当作生产唯一来源。

---

## 6. 配置项（与主种子共用）

| 配置 | 作用 |
|------|------|
| `mainAgentsMdMode` | `off` / `if_missing` / `if_managed_marker` / `always`，同时约束主 `AGENTS.md` 与 `SUBAGENT_ROUTING.md` 的写入策略。 |
| `mainWorkspaceAgentsAutoSeed` | 为 `false` 时跳过主工作区种子（含路由表）。 |
| `mainParentAgentId` | 决定写入哪个 agent 的工作区目录（默认 `main`）。 |

详见 [`openclaw.plugin.json`](../openclaw.plugin.json) 中字段说明。

---

## 7. 风险与验收建议

| 风险 | 缓解 |
|------|------|
| 路由表与配置短暂不一致 | 文案与模板反复强调以 `agents_list` 为准；agent sync 在 `writeConfigFile` 之后调用 `seedMainAgentAgentsMd`。 |
| Token 膨胀 | 实现层总长度上限 + 各列表截断。 |
| 用户自定义 `mainAgentsMdPath` | 需在自定义模板中自行补充对 `SUBAGENT_ROUTING.md` 的说明（内置模板已包含）。 |

**验收建议**：注册多个异构子 agent（NONE / INTERFACE、有/无能力边界与关联资源），检查 main 工作区 `SUBAGENT_ROUTING.md`；删除一个 JSON 后 flush，确认对应卡片消失；回归 `mergeAllowSpawnForMain` 与子 agent workspace 种子行为无回归。

---

## 8. 可选后续（未实现）

- 若 OpenClaw `AgentListEntry` 与 `agents_list` 工具支持透传自定义摘要字段，可在配置中增加「一行摘要」双轨提示。
- HTTP [`src/http-routes.ts`](../src/http-routes.ts) `/plugins/baiying-enhance/agents` 可扩展为运维诊断返回截断摘要（不作为模型主路径）。
