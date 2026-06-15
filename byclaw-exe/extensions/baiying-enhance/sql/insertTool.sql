INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865555, 'text', 'OPENCLAW_BUNDLED_TOOLS', 'OpenClaw内置Tool清单', 'OPENCLAW_BUNDLED_TOOLS', '[
  {
    "toolName": "全部工具",
    "toolCode": "*",
    "toolDescZh": "relTools 专用通配符，表示允许 OpenClaw 全部工具。",
    "toolDescEn": "Wildcard for relTools, allowing all OpenClaw tools.",
    "toolGroup": "wildcard",
    "toolGroupName": "通配符",
    "profiles": ["full"],
    "isWildcard": true
  },
  {
    "toolName": "read",
    "toolCode": "read",
    "toolDescZh": "读取文件内容。",
    "toolDescEn": "Read file contents.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "write",
    "toolCode": "write",
    "toolDescZh": "创建或覆盖文件。",
    "toolDescEn": "Create or overwrite files.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "edit",
    "toolCode": "edit",
    "toolDescZh": "对文件进行精确编辑。",
    "toolDescEn": "Make precise edits.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "apply_patch",
    "toolCode": "apply_patch",
    "toolDescZh": "以 patch 方式修改文件。",
    "toolDescEn": "Patch files.",
    "toolGroup": "fs",
    "toolGroupName": "文件系统",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "exec",
    "toolCode": "exec",
    "toolDescZh": "运行立即启动的 Shell 命令。",
    "toolDescEn": "Run shell commands that start now.",
    "toolGroup": "runtime",
    "toolGroupName": "运行时",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "process",
    "toolCode": "process",
    "toolDescZh": "查看和控制正在运行的 exec 会话。",
    "toolDescEn": "Inspect and control running exec sessions.",
    "toolGroup": "runtime",
    "toolGroupName": "运行时",
    "profiles": ["coding"],
    "includeInOpenClawGroup": false
  },
  {
    "toolName": "code_execution",
    "toolCode": "code_execution",
    "toolDescZh": "运行沙箱化远程分析。",
    "toolDescEn": "Run sandboxed remote analysis.",
    "toolGroup": "runtime",
    "toolGroupName": "运行时",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "web_search",
    "toolCode": "web_search",
    "toolDescZh": "搜索 Web 内容。",
    "toolDescEn": "Search the web.",
    "toolGroup": "web",
    "toolGroupName": "Web",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "web_fetch",
    "toolCode": "web_fetch",
    "toolDescZh": "抓取 Web 内容。",
    "toolDescEn": "Fetch web content.",
    "toolGroup": "web",
    "toolGroupName": "Web",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "x_search",
    "toolCode": "x_search",
    "toolDescZh": "搜索 X 帖子。",
    "toolDescEn": "Search X posts.",
    "toolGroup": "web",
    "toolGroupName": "Web",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "memory_search",
    "toolCode": "memory_search",
    "toolDescZh": "进行语义记忆搜索。",
    "toolDescEn": "Semantic search.",
    "toolGroup": "memory",
    "toolGroupName": "记忆",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "memory_get",
    "toolCode": "memory_get",
    "toolDescZh": "读取记忆文件。",
    "toolDescEn": "Read memory files.",
    "toolGroup": "memory",
    "toolGroupName": "记忆",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_list",
    "toolCode": "sessions_list",
    "toolDescZh": "列出可见会话及可选的最近消息。",
    "toolDescEn": "List visible sessions and optional recent messages.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_history",
    "toolCode": "sessions_history",
    "toolDescZh": "读取可见会话的脱敏消息历史。",
    "toolDescEn": "Read sanitized message history for a visible session.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_send",
    "toolCode": "sessions_send",
    "toolDescZh": "向另一个可见会话发送消息。",
    "toolDescEn": "Send a message to another visible session.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_spawn",
    "toolCode": "sessions_spawn",
    "toolDescZh": "创建子 Agent 或 ACP 会话。",
    "toolDescEn": "Spawn sub-agent or ACP sessions.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "sessions_yield",
    "toolCode": "sessions_yield",
    "toolDescZh": "结束当前回合以接收子 Agent 结果。",
    "toolDescEn": "End turn to receive sub-agent results.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "subagents",
    "toolCode": "subagents",
    "toolDescZh": "管理子 Agent。",
    "toolDescEn": "Manage sub-agents.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "session_status",
    "toolCode": "session_status",
    "toolDescZh": "查看会话状态、用量和模型状态。",
    "toolDescEn": "Show session status, usage, and model state.",
    "toolGroup": "sessions",
    "toolGroupName": "会话",
    "profiles": ["minimal", "coding", "messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "browser",
    "toolCode": "browser",
    "toolDescZh": "控制 Web 浏览器。",
    "toolDescEn": "Control web browser.",
    "toolGroup": "ui",
    "toolGroupName": "界面",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "canvas",
    "toolCode": "canvas",
    "toolDescZh": "控制画布。",
    "toolDescEn": "Control canvases.",
    "toolGroup": "ui",
    "toolGroupName": "界面",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "message",
    "toolCode": "message",
    "toolDescZh": "发送消息。",
    "toolDescEn": "Send messages.",
    "toolGroup": "messaging",
    "toolGroupName": "消息",
    "profiles": ["messaging"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "cron",
    "toolCode": "cron",
    "toolDescZh": "管理定时任务与自动化。",
    "toolDescEn": "Manage scheduled jobs and automations.",
    "toolGroup": "automation",
    "toolGroupName": "自动化",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "gateway",
    "toolCode": "gateway",
    "toolDescZh": "控制 Gateway。",
    "toolDescEn": "Gateway control.",
    "toolGroup": "automation",
    "toolGroupName": "自动化",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "nodes",
    "toolCode": "nodes",
    "toolDescZh": "管理节点与设备。",
    "toolDescEn": "Nodes and devices.",
    "toolGroup": "nodes",
    "toolGroupName": "节点",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "agents_list",
    "toolCode": "agents_list",
    "toolDescZh": "列出 Agent。",
    "toolDescEn": "List agents.",
    "toolGroup": "agents",
    "toolGroupName": "Agent",
    "profiles": [],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "update_plan",
    "toolCode": "update_plan",
    "toolDescZh": "更新任务计划。",
    "toolDescEn": "Update task plan.",
    "toolGroup": "agents",
    "toolGroupName": "Agent",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "image",
    "toolCode": "image",
    "toolDescZh": "图片理解。",
    "toolDescEn": "Image understanding.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "image_generate",
    "toolCode": "image_generate",
    "toolDescZh": "图片生成。",
    "toolDescEn": "Image generation.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "music_generate",
    "toolCode": "music_generate",
    "toolDescZh": "音乐生成。",
    "toolDescEn": "Music generation.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "video_generate",
    "toolCode": "video_generate",
    "toolDescZh": "视频生成。",
    "toolDescEn": "Video generation.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": ["coding"],
    "includeInOpenClawGroup": true
  },
  {
    "toolName": "tts",
    "toolCode": "tts",
    "toolDescZh": "文本转语音。",
    "toolDescEn": "Text-to-speech conversion.",
    "toolGroup": "media",
    "toolGroupName": "媒体",
    "profiles": [],
    "includeInOpenClawGroup": true
  }
]', 'OpenClaw 内置 Tools 清单，供 baiying-enhance 的 agent.json relTools 配置和角色默认配置引用。');
