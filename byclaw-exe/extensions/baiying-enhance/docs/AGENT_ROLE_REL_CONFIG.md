# 三类 Agent 与 `agent.json` 关联配置说明

本文档说明 `baiying-enhance` 中三类 Agent 的目标配置结构，以及 `agent.json` 中 `agentRole`、`relSkills`、`relTools`、`relPrompt` 与 OpenClaw 配置、Agent Workspace Markdown 文件之间的映射关系。

> 说明：`relSkills` 当前已由 `src/agent-adapter.ts` 映射到 `openclaw.json` 的 `agents.list[].skills`。`relPrompt` 是本次角色拆分需求中的目标配置层；当前 Workspace 下各 `.md` 文件的实际生成字段来自 `src/workspace-seed.ts`，下文已按现有代码逐项列出。

---

## 1. 总体结构

`agent.json` 根节点建议统一使用以下结构：

```jsonc
{
  // Agent 角色。缺省建议按 digitalEmployee 处理，以兼容现有百应数字员工导出。
  "agentRole": "superAssistant",

  // 关联 OpenClaw 内置 skills。
  // 映射到 openclaw.json -> agents.list[].skills。
  // 字段存在时以该字段为准，包括空数组。
  "relSkills": [],

  // 关联 OpenClaw 内置 tools。
  // 映射到 openclaw.json -> agents.list[].tools.allow。
  // ["*"] 表示 OpenClaw 全部工具。
  "relTools": [
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "sessions_yield",
    "session_status",
    "agents_list",
    "update_plan",
    "read",
    "exec",
    "process"
  ],

  // 关联 Agent Workspace 下的 Markdown 文件。
  // key 为文件名，例如 AGENTS.md、SOUL.md、TOOLS.md。
  "relPrompt": {
    "AGENTS.md": {
      // 最高优先级 Prompt。存在时优先替换/覆盖该 Markdown 文件的主体内容。
      "priorityPrompt": "",
      // 当前文件按现有 workspace-seed.ts 回退生成时读取的 agent.json 字段。
      // 数组每项为 { "字段路径": "用途说明" }。
      "sourceFields": [
        { "prologue.descText": "生成 Greeting" },
        { "resourceDesc": "生成 Capabilities overview" },
        { "coreCompetencies": "生成 Core competencies" },
        { "corePersonaDefinition": "生成百应业务拓展摘要" },
        { "relResourceInfoList": "生成 Associated resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格/指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE/A2A 时追加 baiying_call 工具引导" }
      ]
    },
    "BYAI_BUSINESS_EXTENSIONS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "解析 JSON 拓展数组，生成 name/value/key 明细" }
      ]
    },
    "IDENTITY.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceName": "详情格式下生成 Name" },
        { "name": "agent_list 格式下生成 Name" },
        { "avatar": "生成 Avatar source system path" }
      ]
    },
    "USER.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.openingQuestion": "详情格式下生成 Suggested opening questions" },
        { "openingQuestion": "agent_list 格式下生成 Suggested opening questions" }
      ]
    },
    "TOOLS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceId": "生成 DOC 类资源调用所需 agent_id 兜底" },
        { "relResourceInfoList": "生成 Available resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为资源列表兜底" },
        { "resourceName": "生成资源展示名称" },
        { "resourceBizType": "生成资源类型，优先于 resourceType" },
        { "resourceType": "生成资源类型兜底" },
        { "resourceCode": "生成资源 code" },
        { "resourceDesc": "生成资源描述" }
      ]
    }
  }
}
```

字段优先级：

```text
agent.json 显式 rel* 配置 > agentRole 角色默认值 > 现有插件生成规则
```

字段“存在”即表示缓存/人工配置已生效。例如 `relSkills: []` 表示明确配置为空，不再套用角色默认 skill。

---

## 2. `agentRole`

```ts
type AgentRole = "superAssistant" | "personalAssistant" | "digitalEmployee";
```

| 值 | 中文角色 | 定位 |
|----|----------|------|
| `superAssistant` | 超级助手 | 主控、调度、会话管理、任务拆解、Agent 分派与结果汇总 |
| `personalAssistant` | 个人助理 | 面向个人知识库、DWS、日常事务与个人工作流 |
| `digitalEmployee` | 数字员工 | 面向具体业务能力、知识库、工具、流程执行 |

缺省建议：

```json
{
  "agentRole": "digitalEmployee"
}
```

原因：现有百应导出的托管 Agent 多数天然属于数字员工，按数字员工兜底对历史数据最兼容。

---

## 3. `relSkills`

### 3.1 字段定义

```ts
relSkills?: string[];
```

### 3.2 字段含义

`relSkills` 控制 OpenClaw 中对应 Agent 的 `skills` 字段：

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "baiying-agent-10001",
        "skills": ["dws"]
      }
    ]
  }
}
```

### 3.3 属性注释

| 属性 | 类型 | 说明 |
|------|------|------|
| `relSkills` | `string[]` | OpenClaw 内置 skill 名称列表，例如 `["dws"]`。 |
| 数组元素 | `string` | 单个 skill 名称。实现时应 `trim` 并丢弃空字符串。 |

### 3.4 解析规则

| 场景 | 结果 |
|------|------|
| `agent.json` 存在 `relSkills` | 使用 `relSkills`，包括空数组 |
| `agent.json` 不存在 `relSkills` | 使用 `agentRole` 对应默认值 |
| `relSkills: []` | 明确无内置 skill |
| `relSkills: ["dws"]` | 映射为 `agents.list[].skills = ["dws"]` |

当前兼容逻辑：如果无有效 `relSkills`，现有代码还会读取根级 `skills` 作为旧格式兜底。

---

## 4. `relTools`

### 4.1 字段定义

```ts
relTools?: string[];
```

### 4.2 字段含义

`relTools` 控制 OpenClaw 中对应 Agent 的工具 allowlist：

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "baiying-agent-10001",
        "tools": {
          "allow": ["read", "exec"]
        }
      }
    ]
  }
}
```

### 4.3 属性注释

| 属性 | 类型 | 说明 |
|------|------|------|
| `relTools` | `string[]` | OpenClaw 内置工具名称列表，例如 `["read", "exec"]`；`["*"]` 表示全部工具。 |
| 数组元素 | `string` | 单个工具名。实现时应 `trim` 并丢弃空字符串。 |

### 4.4 解析规则

| 场景 | 结果 |
|------|------|
| `agent.json` 存在 `relTools` | 写入 `agents.list[].tools.allow = relTools + baiying_call` |
| `relTools: ["*"]` | 明确允许 OpenClaw 全部工具 |
| `relTools: []` | 明确 allowlist 为空 |
| `relTools: ["exec"]` | 只允许 `exec` 这类 allow 工具与 `baiying_call` |

注意：

- `relTools` 对应 OpenClaw 内置工具。
- “OpenClaw 全部工具”统一通过 `relTools: ["*"]` 表达。
- 百应详情 / 数字员工格式会始终保留 `baiying_call`；当 `relTools` 非空时并入 `tools.allow`，否则写入 `tools.alsoAllow`。
- `relTools` 或 workspace skill 热同步时，插件会写入禁用的内部 `skills.entries.__baiying_enhance_reload` 标记，用于触发 OpenClaw 刷新 skills/tools 快照，无需重启网关。

---

## 5. `relPrompt`

### 5.1 字段定义

```ts
type RelPrompt = {
  [filename: string]: RelPromptFileConfig;
};

type RelPromptFileConfig = {
  priorityPrompt?: string;
  sourceFields?: Array<Record<string, string>>;
  [key: string]: unknown;
};
```

### 5.2 字段含义

`relPrompt` 用于控制 Agent Workspace 下各 Markdown 文件的生成内容。key 是目标文件名，value 是该文件的生成配置。

```jsonc
{
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "你是用户的个人助理，优先围绕用户知识库提供帮助。",
      "sourceFields": [
        { "prologue.descText": "生成 Greeting" },
        { "resourceDesc": "生成 Capabilities overview" },
        { "coreCompetencies": "生成 Core competencies" },
        { "corePersonaDefinition": "生成百应业务拓展摘要" },
        { "relResourceInfoList": "生成 Associated resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "你需要保持专业、准确、简洁。",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格/指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE/A2A 时追加 baiying_call 工具引导" }
      ]
    }
  }
}
```

### 5.3 属性注释

| 属性 | 类型 | 说明 |
|------|------|------|
| `relPrompt` | `Record<string, RelPromptFileConfig>` | Markdown 文件生成配置。key 为文件名。 |
| `relPrompt["AGENTS.md"]` | `RelPromptFileConfig` | 控制 Workspace 下 `AGENTS.md` 的生成。 |
| `relPrompt["SOUL.md"]` | `RelPromptFileConfig` | 控制 Workspace 下 `SOUL.md` 的生成。 |
| `relPrompt["BYAI_BUSINESS_EXTENSIONS.md"]` | `RelPromptFileConfig` | 控制百应业务拓展属性文件的生成。 |
| `relPrompt["IDENTITY.md"]` | `RelPromptFileConfig` | 控制身份文件的生成。 |
| `relPrompt["USER.md"]` | `RelPromptFileConfig` | 控制建议开场问题文件的生成。 |
| `relPrompt["TOOLS.md"]` | `RelPromptFileConfig` | 控制工具说明文件的生成。 |
| `priorityPrompt` | `string` | 最高优先级 Prompt。存在且非空时，优先用于目标 Markdown 文件。 |
| `sourceFields` | `Array<Record<string, string>>` | 当前文件按现有 `workspace-seed.ts` 逻辑回退生成时读取的字段说明。每项只有一个 key，key 为字段路径，value 为用途说明。 |
| `sourceFields[].<字段路径>` | `string` | 字段用途说明，例如 `{ "resourceName": "详情格式下生成 Name" }`。 |
| 其它属性 | `unknown` | 保留给文档插件原有规则或后续扩展。当前 `baiying-enhance` 代码未对这些属性做强类型解析。 |

### 5.4 解析规则

| 场景 | 结果 |
|------|------|
| `priorityPrompt` 非空 | 优先使用 `priorityPrompt` 生成/替换目标文件内容 |
| `priorityPrompt` 为空，但存在其它文档插件属性 | 按文档插件原规则读取其它属性 |
| 文档插件没有生成内容，但存在 `sourceFields` | 按 `sourceFields` 标注的字段回退到现有 `workspace-seed.ts` 生成逻辑 |
| `relPrompt.<filename>` 不存在 | 使用该角色默认 Prompt 规则，再回退到现有 `workspace-seed.ts` 的生成逻辑 |

---

## 6. 三类 Agent 默认配置

### 6.1 超级助手 `superAssistant`

超级助手是主控 Agent，用于理解用户目标、拆解任务、管理会话、调用/分派其它 Agent，并汇总最终结果。

默认数据：

```jsonc
{
  "agentRole": "superAssistant",
  "relSkills": [],
  "relTools": [
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "sessions_yield",
    "session_status",
    "agents_list",
    "update_plan",
    "read",
    "exec",
    "process"
  ],
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "templates/main-agents.md": "超级助手主 AGENTS.md 默认模板" },
        { "relPrompt.AGENTS.md.priorityPrompt": "配置后替换主 Prompt 内容" }
      ]
    }
  }
}
```

默认规则：

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `relSkills` | `[]` | 超级助手默认不绑定 `dws`。 |
| `relTools` | 主控工具列表 | 只开放会话、Agent 管理、计划更新、读文件、执行命令、进程相关工具。 |
| `relPrompt.AGENTS.md` | `templates/main-agents.md` | 默认读取主控模板；若配置 `priorityPrompt`，则用它替换主 Prompt 内容。 |

### 6.2 个人助理 `personalAssistant`

个人助理面向个人知识库、DWS、日常事务与用户个人工作流。

默认数据：

```jsonc
{
  "agentRole": "personalAssistant",
  "relSkills": ["dws"],
  "relTools": ["*"],
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.descText": "生成 Greeting" },
        { "resourceDesc": "生成 Capabilities overview" },
        { "coreCompetencies": "生成 Core competencies" },
        { "corePersonaDefinition": "生成百应业务拓展摘要" },
        { "relResourceInfoList": "生成 Associated resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格/指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE/A2A 时追加 baiying_call 工具引导" }
      ]
    },
    "BYAI_BUSINESS_EXTENSIONS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "解析 JSON 拓展数组，生成 name/value/key 明细" }
      ]
    },
    "IDENTITY.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceName": "详情格式下生成 Name" },
        { "name": "agent_list 格式下生成 Name" },
        { "avatar": "生成 Avatar source system path" }
      ]
    },
    "USER.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.openingQuestion": "详情格式下生成 Suggested opening questions" },
        { "openingQuestion": "agent_list 格式下生成 Suggested opening questions" }
      ]
    },
    "TOOLS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceId": "生成 DOC 类资源调用所需 agent_id 兜底" },
        { "relResourceInfoList": "生成 Available resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为资源列表兜底" },
        { "resourceName": "生成资源展示名称" },
        { "resourceBizType": "生成资源类型，优先于 resourceType" },
        { "resourceType": "生成资源类型兜底" },
        { "resourceCode": "生成资源 code" },
        { "resourceDesc": "生成资源描述" }
      ]
    }
  }
}
```

默认规则：

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `relSkills` | `["dws"]` | 默认开启 DWS 相关 skill。 |
| `relTools` | `["*"]` | 默认拥有 OpenClaw 全部工具。 |
| `relPrompt` | Workspace `.md` 生成规则 | 优先看 `priorityPrompt`；不存在时按文档插件原规则；再回退到当前 `workspace-seed.ts` 规则。 |

### 6.3 数字员工 `digitalEmployee`

数字员工面向具体业务能力、知识库、工具调用和业务流程执行。

默认数据：

```jsonc
{
  "agentRole": "digitalEmployee",
  "relSkills": [],
  "relTools": ["*"],
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.descText": "生成 Greeting" },
        { "resourceDesc": "生成 Capabilities overview" },
        { "coreCompetencies": "生成 Core competencies" },
        { "corePersonaDefinition": "生成百应业务拓展摘要" },
        { "relResourceInfoList": "生成 Associated resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格/指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE/A2A 时追加 baiying_call 工具引导" }
      ]
    },
    "BYAI_BUSINESS_EXTENSIONS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "解析 JSON 拓展数组，生成 name/value/key 明细" }
      ]
    },
    "IDENTITY.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceName": "详情格式下生成 Name" },
        { "name": "agent_list 格式下生成 Name" },
        { "avatar": "生成 Avatar source system path" }
      ]
    },
    "USER.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "prologue.openingQuestion": "详情格式下生成 Suggested opening questions" },
        { "openingQuestion": "agent_list 格式下生成 Suggested opening questions" }
      ]
    },
    "TOOLS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "resourceId": "生成 DOC 类资源调用所需 agent_id 兜底" },
        { "relResourceInfoList": "生成 Available resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为资源列表兜底" },
        { "resourceName": "生成资源展示名称" },
        { "resourceBizType": "生成资源类型，优先于 resourceType" },
        { "resourceType": "生成资源类型兜底" },
        { "resourceCode": "生成资源 code" },
        { "resourceDesc": "生成资源描述" }
      ]
    }
  }
}
```

默认规则：

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `relSkills` | `[]` | 默认不绑定 OpenClaw 内置 skill。 |
| `relTools` | `["*"]` | 默认拥有 OpenClaw 全部工具。 |
| `relPrompt` | Workspace `.md` 生成规则 | 优先看 `priorityPrompt`；不存在时按文档插件原规则；再回退到当前 `workspace-seed.ts` 规则。 |

### 6.4 角色对照表

| 角色 | `agentRole` | 默认 `relSkills` | 默认 `relTools` | 默认 `relPrompt` |
|------|-------------|-------------------|------------------|-------------------|
| 超级助手 | `superAssistant` | `[]` | 固定主控工具列表 | 默认读取 `templates/main-agents.md`，可由 `relPrompt.AGENTS.md.priorityPrompt` 覆盖 |
| 个人助理 | `personalAssistant` | `["dws"]` | `["*"]` | 读取 Workspace `.md`；无 `priorityPrompt` 时走文档插件原规则和现有生成规则 |
| 数字员工 | `digitalEmployee` | `[]` | `["*"]` | 读取 Workspace `.md`；无 `priorityPrompt` 时走文档插件原规则和现有生成规则 |

---

## 7. 当前 Workspace Markdown 生成逻辑

当前代码位置：`src/workspace-seed.ts`。

写入策略：

- 首次创建 Agent Workspace 时生成 `.md` 文件。
- 后续仅覆盖首行带有托管标记 `<!-- baiying-enhance: managed seed -->` 的文件。
- 用户手动编辑并移除/改变托管标记的文件不会被覆盖。
- 若无法解析出百应条目，`SOUL.md` 可能退化为适配层 `systemPrompt`，`TOOLS.md` 会补一个极简占位版本。

源 JSON 解析顺序：

1. 若存在 `agent_list` 数组，取 `agent_list[0]`。
2. 否则若根对象同时存在字符串 `resourceId` 与 `resourceName`，按百应详情根对象解析。

### 7.1 `SOUL.md`

用途：核心人格 / 系统指令。

| 来源字段 | `agent_list[0]` | 百应详情根对象 | 生成逻辑 |
|----------|-----------------|----------------|----------|
| 核心人格 | `corePersonaDefinition` | `corePersonaDefinition` | 若是普通长文本，优先作为 `SOUL.md` 主体。 |
| 百应业务拓展属性 | `corePersonaDefinition` | `corePersonaDefinition` | 若可解析为 JSON 拓展数组，不把原 JSON 放入 `SOUL.md`；改用 instructions 兜底，并追加“详见 `BYAI_BUSINESS_EXTENSIONS.md`”。 |
| 指令兜底 | `instructions` | 由 `roleAttributes`、`processingFlow`、`ability`、`constraints`、`personalityDimensions`、`wordPreferences`、`sentenceAndTone`、`faqs` 拼接 | 当核心人格为空，或核心人格是 JSON 拓展数组时使用。 |
| 集成类型 | `integrationType` | `integrationType` | 若为 `INTERFACE` 或 `A2A`，在正文前追加 `baiying_call` 工具使用引导。 |

默认兜底正文：

```text
You are a helpful assistant.
```

### 7.2 `BYAI_BUSINESS_EXTENSIONS.md`

用途：存放百应 `corePersonaDefinition` 中的结构化拓展属性。

| 来源字段 | `agent_list[0]` | 百应详情根对象 | 生成逻辑 |
|----------|-----------------|----------------|----------|
| 拓展属性 | `corePersonaDefinition` | `corePersonaDefinition` | 若能解析为非空 JSON 对象数组，且条目含 `name` 或 `value`，则生成该文件。 |
| 标题 | `corePersonaDefinition[].name` / `key` | 同左 | 每个拓展项生成一个 `###` 标题。 |
| 正文 | `corePersonaDefinition[].value` | 同左 | 作为拓展项正文。 |
| 平台 key | `corePersonaDefinition[].key` | 同左 | 非空时追加 `- 平台 key: ...`。 |

若无结构化拓展属性：

- 不创建该文件。
- 如果旧文件是插件托管生成的，则删除旧文件，避免残留过期内容。

### 7.3 `AGENTS.md`

用途：Agent 可读的能力说明、问候语、核心能力、资源列表。

| 来源字段 | `agent_list[0]` | 百应详情根对象 | 生成章节 |
|----------|-----------------|----------------|----------|
| 问候语 | `descText` | `prologue.descText` | `## Greeting` |
| 能力概览 | `intro` | `resourceDesc` | `## Capabilities overview` |
| 核心能力 | `coreCompetencies` 数组 | `coreCompetencies` JSON 字符串解析后的数组 | `## Core competencies` |
| 核心能力名称 | `coreCompetencies[].coreCompetency` | 同左 | 每项生成 `### <coreCompetency>` |
| 核心能力描述 | `coreCompetencies[].description` | 同左 | 写入能力描述正文 |
| 接受边界 | `coreCompetencies[].acceptBoundary` | 同左 | `**In scope:**` 列表 |
| 拒绝边界 | `coreCompetencies[].rejectBoundary` | 同左 | `**Out of scope:**` 列表 |
| 示例 | `coreCompetencies[].example` | 同左 | `**Examples:**` 列表 |
| 百应业务拓展摘要 | `corePersonaDefinition` JSON 拓展数组 | 同左 | `## 百应业务拓展属性`，以列表摘要展示 |
| 关联资源 | `relResourceInfoList`，缺失时用 `relResourceList` | 同左 | `## Associated resources` |

关联资源展示字段：

| 字段 | 说明 |
|------|------|
| `resourceName` | 资源名称；缺失时使用 `resourceId`。 |
| `resourceBizType` / `resourceType` | 资源类型展示；优先 `resourceBizType`。 |
| `resourceDesc` | 资源描述，非空时追加在资源后。 |

### 7.4 `IDENTITY.md`

用途：Agent 身份信息。

| 来源字段 | `agent_list[0]` | 百应详情根对象 | 生成章节 |
|----------|-----------------|----------------|----------|
| 名称 | `name` | `resourceName` | `## Name` |
| 头像 | `avatar` | `avatar` | `## Avatar (source system path)` |

名称缺省时使用：

```text
Agent
```

头像字段为空时不生成头像章节。

### 7.5 `USER.md`

用途：建议开场问题。

| 来源字段 | `agent_list[0]` | 百应详情根对象 | 生成章节 |
|----------|-----------------|----------------|----------|
| 开场问题 | `openingQuestion` | `prologue.openingQuestion` | `## Suggested opening questions` |

解析规则：

- `openingQuestion` 是 JSON 数组字符串时，展开为多条列表。
- 不是 JSON 数组时，作为单个问题写入。
- 为空时写入 `(none extracted from JSON)`。

### 7.6 `TOOLS.md`

用途：说明 `baiying_call` 工具用法及可用资源。

固定生成内容：

- `# Tools`
- `## baiying_call`
- `Suggested parameters`
- `## Available resources`
- `## Notes`

`Suggested parameters` 固定包含：

| 参数 | 说明 |
|------|------|
| `query` | 自然语言任务摘要。 |
| `agent_id` | DOC 类资源执行器需要；缺省时插件可从当前 `agent.json.resourceId` 自动填充。 |
| `resource_id` | 目标父资源 ID。 |
| `resource_type` | 可选资源类型提示，例如 `TOOLKIT`、`TOOL`、`MCP`、`OBJECT`、`VIEW`、`KG_DOC`。 |
| `action` | `TOOLKIT` 或 `MCP` 资源暴露多个子工具时需要。 |
| `arguments` | 结构化后端参数。 |

可用资源来自：

| 来源字段 | `agent_list[0]` | 百应详情根对象 | 说明 |
|----------|-----------------|----------------|------|
| 资源列表 | `relResourceInfoList`，缺失时用 `relResourceList` | 同左 | 生成 `## Available resources`。 |
| Agent ID | 条目 `resourceId`，缺失时用适配层 `sourceKey` | 根 `resourceId`，缺失时用适配层 `sourceKey` | DOC 类资源展示 `agent_id`。 |

资源项展示字段：

| 字段 | 说明 |
|------|------|
| `resourceName` | 资源名称；缺失时使用 `resourceId`。 |
| `resourceId` | 资源 ID。 |
| `resourceBizType` / `resourceType` | 资源类型；优先 `resourceBizType`。 |
| `resourceCode` | 资源 code，非空时展示。 |
| `resourceDesc` | 资源描述，非空时展示。 |

DOC 类资源类型：

```text
DOC
ATOM
KG_DOC
KG_DB
KG_QA
```

当资源类型属于上述类型，且能解析出 Agent ID 时，资源行会额外展示 `agent_id`。

---

## 8. `relPrompt` 内置合并规则属性

`relPrompt` 的每个文件节点只保留一层结构：`priorityPrompt` 和 `sourceFields` 同级。

```jsonc
{
  "relPrompt": {
    "AGENTS.md": {
      "priorityPrompt": "最高优先级内容",
      "sourceFields": [
        { "prologue.descText": "生成 Greeting" },
        { "resourceDesc": "生成 Capabilities overview" },
        { "coreCompetencies": "生成 Core competencies" },
        { "corePersonaDefinition": "生成百应业务拓展摘要" },
        { "relResourceInfoList": "生成 Associated resources" },
        { "relResourceList": "relResourceInfoList 缺失时作为关联资源兜底" }
      ]
    }
  }
}
```

执行含义：

| 顺序 | 依据 | 行为 |
|------|------|------|
| 1 | `priorityPrompt` | 如果同级 `priorityPrompt` 非空，直接使用它作为该 `.md` 文件的最高优先级内容。 |
| 2 | 其它文档插件属性 | 如果没有 `priorityPrompt`，使用文档插件原有属性生成规则。 |
| 3 | `sourceFields` | 如果文档插件没有生成内容，按 `sourceFields` 标注的字段回退到当前 `workspace-seed.ts` 生成逻辑。 |

三类角色的完整默认 JSON 已在第 6 节分别列出。超级助手默认只维护主工作区 `AGENTS.md`；个人助理和数字员工补齐了当前托管 Workspace 会生成的全部 `.md` 文件。

---

## 9. 最终映射关系

```text
agent.json.agentRole
  -> 决定角色默认值

agent.json.relSkills
  -> openclaw.json agents.list[].skills

agent.json.relTools
  -> openclaw.json agents.list[].tools.allow

agent.json.relPrompt["AGENTS.md"]
  -> <agent workspace>/AGENTS.md

agent.json.relPrompt["SOUL.md"]
  -> <agent workspace>/SOUL.md

agent.json.relPrompt["BYAI_BUSINESS_EXTENSIONS.md"]
  -> <agent workspace>/BYAI_BUSINESS_EXTENSIONS.md

agent.json.relPrompt["IDENTITY.md"]
  -> <agent workspace>/IDENTITY.md

agent.json.relPrompt["USER.md"]
  -> <agent workspace>/USER.md

agent.json.relPrompt["TOOLS.md"]
  -> <agent workspace>/TOOLS.md
```
