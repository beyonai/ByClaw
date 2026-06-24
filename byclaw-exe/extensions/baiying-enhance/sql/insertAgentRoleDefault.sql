INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865556, 'text', 'OPENCLAW_AGENT_ROLE_TEMPLATE_SUPER_ASSISTANT', 'OpenClaw Agent角色模板-超级助手', 'OPENCLAW_AGENT_ROLE_TEMPLATE_SUPER_ASSISTANT', '{
  "schemaVersion": 1,
  "templateType": "agentRole",
  "agentRole": "superAssistant",
  "roleNameZh": "超级助手",
  "roleNameEn": "Super Assistant",
  "roleDescZh": "主控、调度、会话管理、任务拆解、Agent 分派与结果汇总。",
  "fieldComments": {
    "agentRole": "Agent 角色标识。超级助手固定为 superAssistant。",
    "relSkills": "关联 OpenClaw 内置 skills，映射到 openclaw.json 的 agents.list[].skills。字段存在时以缓存或 agent.json 配置为准。",
    "relTools": "关联 OpenClaw 内置 tools，映射到 openclaw.json 的 agents.list[].tools.allow。超级助手默认只开放主控所需工具。",
    "relPrompt": "关联 Agent Workspace 下的 Markdown 文件，key 为文件名，value 为该文件的生成配置。",
    "priorityPrompt": "最高优先级 Prompt，非空时优先用于目标 Markdown 文件。",
    "sourceFields": "当前 Markdown 文件按现有生成逻辑回退时读取的 agent.json 字段说明。数组元素格式为单字段对象。"
  },
  "relPromptMergeOrder": [
    "如果 relPrompt.<filename>.priorityPrompt 非空，优先使用该内容生成或替换目标 Markdown 文件。",
    "如果 priorityPrompt 为空，但存在文档插件原有属性，按文档插件原规则生成。",
    "如果文档插件未生成内容，则按 sourceFields 标注字段回退到当前 workspace-seed.ts 生成逻辑。"
  ],
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
}', '超级助手 Agent 角色配置模板，默认不绑定 skill，只开放主控、调度、会话、计划、读取、执行和进程相关工具。');

INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865557, 'text', 'OPENCLAW_AGENT_ROLE_TEMPLATE_PERSONAL_ASSISTANT', 'OpenClaw Agent角色模板-个人助理', 'OPENCLAW_AGENT_ROLE_TEMPLATE_PERSONAL_ASSISTANT', '{
  "schemaVersion": 1,
  "templateType": "agentRole",
  "agentRole": "personalAssistant",
  "roleNameZh": "个人助理",
  "roleNameEn": "Personal Assistant",
  "roleDescZh": "面向个人知识库、DWS、日常事务与用户个人工作流。",
  "fieldComments": {
    "agentRole": "Agent 角色标识。个人助理固定为 personalAssistant。",
    "relSkills": "关联 OpenClaw 内置 skills，映射到 openclaw.json 的 agents.list[].skills。个人助理默认开启 dws。",
    "relTools": "关联 OpenClaw 内置 tools，映射到 openclaw.json 的 agents.list[].tools.allow。配置 [\"*\"] 表示允许全部工具。",
    "relPrompt": "关联 Agent Workspace 下的 Markdown 文件，key 为文件名，value 为该文件的生成配置。",
    "priorityPrompt": "最高优先级 Prompt，非空时优先用于目标 Markdown 文件。",
    "sourceFields": "当前 Markdown 文件按现有生成逻辑回退时读取的 agent.json 字段说明。数组元素格式为单字段对象。"
  },
  "relPromptMergeOrder": [
    "如果 relPrompt.<filename>.priorityPrompt 非空，优先使用该内容生成或替换目标 Markdown 文件。",
    "如果 priorityPrompt 为空，但存在文档插件原有属性，按文档插件原规则生成。",
    "如果文档插件未生成内容，则按 sourceFields 标注字段回退到当前 workspace-seed.ts 生成逻辑。"
  ],
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
        { "relResourceList": "生成非 SKILL 的 Associated resources" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格或指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE 或 A2A 时追加 baiying_call 工具引导" }
      ]
    },
    "BYAI_BUSINESS_EXTENSIONS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "解析 JSON 拓展数组，生成 name、value、key 明细" }
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
        { "relResourceList": "生成非 SKILL 的 Available resources" },
        { "resourceName": "生成资源展示名称" },
        { "resourceBizType": "生成资源类型，优先于 resourceType" },
        { "resourceType": "生成资源类型兜底" },
        { "resourceCode": "生成资源 code" },
        { "resourceDesc": "生成资源描述" }
      ]
    }
  }
}', '个人助理 Agent 角色配置模板，默认绑定 dws skill，并通过 relTools 的 [\"*\"] 允许 OpenClaw 全部工具。');

INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865558, 'text', 'OPENCLAW_AGENT_ROLE_TEMPLATE_DIGITAL_EMPLOYEE', 'OpenClaw Agent角色模板-数字员工', 'OPENCLAW_AGENT_ROLE_TEMPLATE_DIGITAL_EMPLOYEE', '{
  "schemaVersion": 1,
  "templateType": "agentRole",
  "agentRole": "digitalEmployee",
  "roleNameZh": "数字员工",
  "roleNameEn": "Digital Employee",
  "roleDescZh": "面向具体业务能力、知识库、工具调用和业务流程执行。",
  "fieldComments": {
    "agentRole": "Agent 角色标识。数字员工固定为 digitalEmployee。",
    "relSkills": "关联 OpenClaw 内置 skills，映射到 openclaw.json 的 agents.list[].skills。数字员工默认不绑定 skill。",
    "relTools": "关联 OpenClaw 内置 tools，映射到 openclaw.json 的 agents.list[].tools.allow。配置 [\"*\"] 表示允许全部工具。",
    "relPrompt": "关联 Agent Workspace 下的 Markdown 文件，key 为文件名，value 为该文件的生成配置。",
    "priorityPrompt": "最高优先级 Prompt，非空时优先用于目标 Markdown 文件。",
    "sourceFields": "当前 Markdown 文件按现有生成逻辑回退时读取的 agent.json 字段说明。数组元素格式为单字段对象。"
  },
  "relPromptMergeOrder": [
    "如果 relPrompt.<filename>.priorityPrompt 非空，优先使用该内容生成或替换目标 Markdown 文件。",
    "如果 priorityPrompt 为空，但存在文档插件原有属性，按文档插件原规则生成。",
    "如果文档插件未生成内容，则按 sourceFields 标注字段回退到当前 workspace-seed.ts 生成逻辑。"
  ],
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
        { "relResourceList": "生成非 SKILL 的 Associated resources" }
      ]
    },
    "SOUL.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "优先生成核心人格；JSON 拓展数组时转入业务拓展文件" },
        { "instructions": "agent_list 格式下的人格或指令兜底" },
        { "roleAttributes": "详情格式下拼接为 instructions" },
        { "processingFlow": "详情格式下拼接为 instructions" },
        { "ability": "详情格式下拼接为 instructions" },
        { "constraints": "详情格式下拼接为 instructions" },
        { "personalityDimensions": "详情格式下拼接为 instructions" },
        { "wordPreferences": "详情格式下拼接为 instructions" },
        { "sentenceAndTone": "详情格式下拼接为 instructions" },
        { "faqs": "详情格式下拼接为 instructions" },
        { "integrationType": "INTERFACE 或 A2A 时追加 baiying_call 工具引导" }
      ]
    },
    "BYAI_BUSINESS_EXTENSIONS.md": {
      "priorityPrompt": "",
      "sourceFields": [
        { "corePersonaDefinition": "解析 JSON 拓展数组，生成 name、value、key 明细" }
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
        { "relResourceList": "生成非 SKILL 的 Available resources" },
        { "resourceName": "生成资源展示名称" },
        { "resourceBizType": "生成资源类型，优先于 resourceType" },
        { "resourceType": "生成资源类型兜底" },
        { "resourceCode": "生成资源 code" },
        { "resourceDesc": "生成资源描述" }
      ]
    }
  }
}', '数字员工 Agent 角色配置模板，默认不绑定 skill，并通过 relTools 的 [\"*\"] 允许 OpenClaw 全部工具。');
