# agent.json（百应导出）与托管 Workspace 下 `.md` 文件的字段对应关系

本文档说明 **baiying-enhance** 插件在种子化托管 Agent 工作区时，如何把源 JSON 里的字段写入各 Markdown 文件。

实现位置：`src/workspace-seed.ts`（函数 `seedManagedAgentWorkspace`）。`corePersonaDefinition` 的 JSON 数组形态由 `src/core-persona-definition.ts` 解析。

## 源 JSON 如何解析

插件按顺序尝试两种结构（取第一个可用的 Agent 条目）：

1. **`agent_list` 数组**：使用 **`agent_list[0]`** 作为条目（字段名与下文「条目字段」一致）。关联资源字段：优先 `relResourceInfoList`；若缺失且存在 **`relResourceList`**，则在读取阶段视为同一列表（与 `src/agent-adapter.ts` 对详情 JSON 的处理一致）。
2. **百应详情根对象**：根上同时存在 **`resourceId`** 与 **`resourceName`**（字符串）时，视为详情格式；部分字段会从 JSON 字符串再解析（如 `prologue`、`coreCompetencies`）。

若两种方式都得不到有效条目：

- **`SOUL.md`**：可能退化为 OpenClaw 适配后的 **`systemPrompt`**（不含百应扩展字段时）。
- **`TOOLS.md`**：若文件缺失会写入仅占位内容的版本（`(none)`）。

写入策略：首访创建工作区并生成文件；之后仅当某 `.md` **文件首行**为托管标记 `<!-- baiying-enhance: managed seed -->` 时才会被插件覆盖更新，用户手动编辑过的文件不会被覆盖。

---

## 同步到 OpenClaw 配置：`agents.list[].skills` / `tools`（非工作区 `.md`）

工作区 Markdown 由 `workspace-seed.ts` 负责；而 **`openclaw.json`（或当前生效网关配置）** 里托管 agent 的列表项由 **`src/agent-adapter.ts`** 的 `adaptAgentJson` / `normalizeAgentListSkills` 生成，并在 `workspaceSkillAutoEnable` 默认开启时由 **`src/workspace-skills.ts`** 合并用户上传 skill，最后经 `mergeManagedAgentsIntoConfig` 合并写盘。

### `agents.list[].skills`

| 规则 | 说明 |
|------|------|
| 始终写出 `skills` | 每个托管子 agent（`baiying-agent-*`）在 **`agents.list[]`** 中都带有 **`skills`** 字段，不再依赖「有值才出现」。 |
| 默认空数组 | 无可用配置时为 **`[]`**。 |
| **`relSkills`（优先）** | JSON **根**上为非空字符串数组时（如数字员工详情里的 `["dws","clawhub"]`），**`agents.list[].skills`** 即为该数组（元素 `trim`，去掉空串）。 |
| **`skills`（兼容）** | 若无有效 **`relSkills`**，则读取根级 **`skills`**（旧版「原生简化」JSON）；仍无则为 **`[]`**。 |
| **Workspace 上传 skill** | 默认扫描 `skills/<skillName>/SKILL.md`：只把当前 agent workspace 下的 skill 并入该 agent，不读取其它 agent workspace；main workspace (`workspace/skills`) 下的 skill 仅在 `workspaceSkillIncludeMainShared: true` 时作为共享 skill 并入托管子 agent。 |

适用结构：百应详情根对象、`agent_list` 与首条目同文件根上的字段、以及原生根对象——均从**根对象**读取 `relSkills` / `skills`。Workspace skill 只识别一层目录下的 `SKILL.md`，不会采纳更深层级文件。该配置写回默认走 `agents` hot reload；插件会同步更新禁用的内部 `skills.entries.__baiying_enhance_reload` 标记，促使 OpenClaw 刷新 skills/tools 快照，不需要重启 OpenClaw。对 rclone/FUSE 等网盘挂载，插件不只依赖 `fs.watch`，还会用周期扫描兜底；当目录类型上报为 unknown 时会通过 `stat()` 再确认。

### `agents.list[].tools`

| 规则 | 说明 |
|------|------|
| 默认保留 `baiying_call` | 百应详情 / 数字员工格式的托管子 agent 始终保留 **`baiying_call`**，用于调用百应关联资源桥接工具。 |
| **`relTools`** | 百应详情 / 数字员工格式的 JSON **根**上为非空字符串数组时，写入 **`agents.list[].tools.allow`**（元素 `trim`，去掉空串），并把 `baiying_call` 合并进同一个 `allow`。 |
| 无 `relTools` | 没有有效 `relTools` 时，写出 **`tools.alsoAllow: ["baiying_call"]`**。 |
| 通配符 | `relTools: ["*"]` 表示允许全部 OpenClaw tools。 |
| 热同步 | 源 JSON 中 `relTools` 变化会改变内容 hash；Redis Pub/Sub 或显式 flush 触发重新扫描后会写回当前生效配置，并更新禁用的内部 `skills.entries.__baiying_enhance_reload` 标记以刷新 OpenClaw tools 快照。 |

---

## 生成的 Workspace 文件清单

默认工作区目录：与 `resolveAgentWorkspaceDir` / `resolveDefaultManagedWorkspacePath` 一致——一般为 `<stateDir>/workspace-<agentId>/`；若 agent id 为 `main` 且未在配置中覆盖 `workspace`，则为 `<stateDir>/workspace/`（与 OpenClaw 默认主工作区布局一致）。托管体 id 形如 `baiying-agent-<数字>`，故目录多为 `workspace-baiying-agent-...`。

| 文件名 | 作用简述 |
|--------|----------|
| `SOUL.md` | 核心人格 / 系统指令（对齐 OpenClaw 人设） |
| `BYAI_BUSINESS_EXTENSIONS.md` | 百应「拓展属性」：`corePersonaDefinition` 为 JSON 数组（`name`/`value`/`key`）时写入；否则不生成 |
| `AGENTS.md` | 问候语、能力概览、核心能力、百应业务拓展摘要、关联资源说明 |
| `IDENTITY.md` | 名称与头像路径 |
| `USER.md` | 建议开场问题 |
| `TOOLS.md` | `baiying_call` 使用说明与可用资源列表 |

---

## 按文件拆解：`agent.json` 字段 → `.md` 内容

### `SOUL.md`

| 条目字段（`agent_list[0]`） | 详情根字段（百应详情格式） | 写入 `SOUL.md` 的方式 |
|----------------------------|---------------------------|----------------------|
| `corePersonaDefinition` | `corePersonaDefinition` | **长文本**：正文主体优先使用；非空则作为 SOUL 主体。**JSON 数组**（对象含 `name`/`value`/`key` 的拓展项）：不把原始 JSON 写入 SOUL；正文使用与下方 `instructions` 相同的散装字段拼接结果，并追加一句指向 `BYAI_BUSINESS_EXTENSIONS.md` |
| `instructions` | 由下列字段拼接：`roleAttributes`、`processingFlow`、`ability`、`constraints`、`personalityDimensions`、`wordPreferences`、`sentenceAndTone`、`faqs`（仅非空片段，`\n\n` 连接） | 当 `corePersonaDefinition` 为空或仅为 JSON 拓展数组时，作为 SOUL 正文主体（或与其组合见上表） |
| `integrationType` | `integrationType` | 若为 **`INTERFACE`** 或 **`A2A`**，在正文前追加固定的「Tool usage / `baiying_call`」引导段落 |

二者皆空时正文默认为：`You are a helpful assistant.`  

**无百应条目时**：使用适配结果里的 **`systemPrompt`** 作为 `SOUL.md` 正文（仍带托管标记）。

---

### `BYAI_BUSINESS_EXTENSIONS.md`

| 条目字段 | 详情根字段 | 写入方式 |
|---------|-----------|---------|
| `corePersonaDefinition` | `corePersonaDefinition` | 若能解析为非空 JSON **对象**数组且每项至少含 `name` 或 `value`：按条目生成 `###` 标题（`name` 或 `key`）、正文 `value`、可选「平台 key」行；否则**不创建/不更新**该文件 |

---

### `AGENTS.md`

| 条目字段 | 详情根字段 / 来源 | 对应章节 |
|---------|------------------|---------|
| `descText` | `prologue` 解析后的 `descText` | `## Greeting` |
| `intro` | `resourceDesc` | `## Capabilities overview` |
| `coreCompetencies`（数组） | `coreCompetencies`（JSON 字符串解析为数组） | `## Core competencies`，每项包含：`coreCompetency`、`description`、`acceptBoundary`、`rejectBoundary`、`example` |
| `corePersonaDefinition`（JSON 拓展数组） | 同上 | `## 百应业务拓展属性`：列表摘要 `name`→`value`，并提示详见 `BYAI_BUSINESS_EXTENSIONS.md` |
| `relResourceInfoList` | `relResourceInfoList`，若无则用 `relResourceList` | `## Associated resources`（列出名称、类型、`resourceDesc`） |

---

### `IDENTITY.md`

| 条目字段 | 详情根字段 | 对应章节 |
|---------|-----------|---------|
| `name` | `resourceName` | `## Name` |
| `avatar` | `avatar` | `## Avatar (source system path)`（仅非空时） |

---

### `USER.md`

| 条目字段 | 详情根字段 / 来源 | 对应章节 |
|---------|------------------|---------|
| `openingQuestion` | `prologue` 里的 `openingQuestion` | `## Suggested opening questions` |

`openingQuestion` 若为合法 JSON **数组**，则展开为多行列表；否则整段作为单个列表项。

---

### `TOOLS.md`

| 来源 | 作用 |
|------|------|
| `relResourceInfoList` 或 `relResourceList` | `## Available resources`：资源名、`resourceId`、`resourceBizType` 或 `resourceType`、`resourceCode`、`resourceDesc` |
| 条目 `resourceId` + 适配层 **`sourceKey`**（作为 fallback） | 对 DOC 类资源（见下）在列表项中补充说明 **`agent_id`** 取值 |

DOC 类资源类型（用于决定是否展示 `agent_id`）：`DOC`、`ATOM`、`KG_DOC`、`KG_DB`、`KG_QA`。

其余段落为插件内置的 `baiying_call` 参数说明与注意事项（不来自 JSON）。

**无百应条目且文件不存在时**：写入极简 `# Tools` + `(none)`。

---

## 详情格式专有字段一览（便于对照导出 JSON）

若你的文件是百应「详情」根对象，除上表已列字段外，还可能包含：`integrationType`、`agentSseUrl` 等；其中 **`integrationType`** 参与 **`SOUL.md`** 是否追加工具引导；**`agentSseUrl`** 等不参与上述 `.md` 种子内容（可能用于 Agent 运行连接，见 `agent-adapter.ts`）。

---

## 快速对照表（条目级）

| `.md` 文件 | 主要依赖的 JSON 概念 |
|-----------|---------------------|
| `SOUL.md` | 人格长文或 JSON 拓展时的散装指令 / `integrationType` |
| `BYAI_BUSINESS_EXTENSIONS.md` | `corePersonaDefinition`（仅 JSON 拓展数组形态） |
| `AGENTS.md` | `prologue`、`resourceDesc`、`coreCompetencies`、`corePersonaDefinition`（摘要）、关联资源列表 |
| `IDENTITY.md` | `resourceName`、`avatar` |
| `USER.md` | `prologue.openingQuestion` |
| `TOOLS.md` | 关联资源列表 + `resourceId`（及适配层 id 兜底） |

如需确认行为是否与当前代码一致，请以 `src/workspace-seed.ts` 中 `buildSoul`、`buildByaiBusinessExtensionsMd`、`buildAgentsMd`、`buildIdentityMd`、`buildUserMd`、`buildToolsMd` 及 `src/core-persona-definition.ts` 为准；**网关配置中的 `agents.list[].skills`** 以 `src/agent-adapter.ts`（`normalizeAgentListSkills`）与 `src/workspace-skills.ts` 为准。
