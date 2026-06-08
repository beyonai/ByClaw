
DELETE FROM "byai"."byai_system_config" WHERE "param_code" = 'OPENCLAW_BUNDLED_SKILLS'；
INSERT INTO "byai"."byai_system_config" ("param_id", "param_type", "param_code", "param_name", "param_en_name", "param_value", "param_desc") VALUES (11865554, 'text', 'OPENCLAW_BUNDLED_SKILLS', 'OpenClaw内置Skill清单', 'OPENCLAW_BUNDLED_SKILLS', '[
  {
    "skillName": "1password",
    "skillCode": "1password",
    "skillDescZh": "使用 1Password CLI 完成登录、与桌面端集成，以及读取或注入密钥。",
    "skillDescEn": "Set up and use 1Password CLI for sign-in, desktop integration, and reading or injecting secrets."
  },
  {
    "skillName": "apple-notes",
    "skillCode": "apple-notes",
    "skillDescZh": "在 macOS 上通过 memo CLI 创建、查看、编辑、删除、搜索、移动或导出 Apple 备忘录。",
    "skillDescEn": "Create, view, edit, delete, search, move, or export Apple Notes via the memo CLI on macOS."
  },
  {
    "skillName": "apple-reminders",
    "skillCode": "apple-reminders",
    "skillDescZh": "通过 remindctl 列出、添加、编辑、完成或删除 Apple 提醒事项与提醒列表。",
    "skillDescEn": "List, add, edit, complete, or delete Apple Reminders and reminder lists via remindctl."
  },
  {
    "skillName": "bear-notes",
    "skillCode": "bear-notes",
    "skillDescZh": "通过 grizzly CLI 创建、搜索与管理 Bear 笔记。",
    "skillDescEn": "Create, search, and manage Bear notes via grizzly CLI."
  },
  {
    "skillName": "blogwatcher",
    "skillCode": "blogwatcher",
    "skillDescZh": "使用 blogwatcher CLI 监控博客与 RSS/Atom 订阅更新。",
    "skillDescEn": "Monitor blogs and RSS/Atom feeds for updates using the blogwatcher CLI."
  },
  {
    "skillName": "blucli",
    "skillCode": "blucli",
    "skillDescZh": "BluOS 命令行工具 blu：设备发现、播放、分组与音量。",
    "skillDescEn": "BluOS CLI (blu) for discovery, playback, grouping, and volume."
  },
  {
    "skillName": "camsnap",
    "skillCode": "camsnap",
    "skillDescZh": "从 RTSP/ONVIF 摄像头截取画面或短片。",
    "skillDescEn": "Capture frames or clips from RTSP/ONVIF cameras."
  },
  {
    "skillName": "canvas",
    "skillCode": "canvas",
    "skillDescZh": "通过 canvas 工具在已连接的 OpenClaw 节点（Mac 应用、iOS、Android）上展示 HTML 内容。",
    "skillDescEn": "Display HTML content on connected OpenClaw nodes (Mac app, iOS, Android) via the canvas tool."
  },
  {
    "skillName": "clawhub",
    "skillCode": "clawhub",
    "skillDescZh": "使用 ClawHub CLI 与注册表搜索、安装、更新、同步或发布 Agent 技能。",
    "skillDescEn": "Search, install, update, sync, or publish agent skills with the ClawHub CLI and registry."
  },
  {
    "skillName": "coding-agent",
    "skillCode": "coding-agent",
    "skillDescZh": "通过立即后台进程将编码任务委托给 Codex、Claude Code、OpenCode 或 Pi。适用于：(1) 构建功能/应用；(2) 在临时克隆或 worktree 中审查 PR；(3) 大规模重构；(4) 需要浏览文件的迭代开发。不适用于：一行级小改（直接编辑）、仅读代码（使用读文件工具）、聊天中线程绑定的 ACP 请求（使用 sessions_spawn 且 runtime 为 acp）、或在 ~/clawd 工作区中的任何 spawn。所有 coding-agent 运行须立即以 background:true 启动。Claude Code：使用 --print --permission-mode bypassPermissions（无 PTY）。Codex/Pi/OpenCode：须 pty:true。完成通知须使用 openclaw message send，勿用系统事件或心跳。",
    "skillDescEn": "Delegate coding tasks to Codex, Claude Code, OpenCode, or Pi agents via immediate background processes. Use when: (1) building or creating features/apps, (2) reviewing PRs in a temp clone/worktree, (3) refactoring large codebases, (4) iterative coding that needs file exploration. NOT for: simple one-line fixes (just edit), reading code (use read tool), thread-bound ACP harness requests in chat (use sessions_spawn with runtime:\"acp\"), or any work in ~/clawd workspace (never spawn agents here). All coding-agent runs start with background:true immediately. Claude Code: use --print --permission-mode bypassPermissions (no PTY). Codex/Pi/OpenCode: pty:true required. Completion notification must use openclaw message send, not system event/heartbeat."
  },
  {
    "skillName": "discord",
    "skillCode": "discord",
    "skillDescZh": "通过消息工具执行 Discord 操作（channel=discord）。",
    "skillDescEn": "Discord ops via the message tool (channel=discord)."
  },
  {
    "skillName": "eightctl",
    "skillCode": "eightctl",
    "skillDescZh": "控制 Eight Sleep 智能床罩（状态、温度、闹钟、日程）。",
    "skillDescEn": "Control Eight Sleep pods (status, temperature, alarms, schedules)."
  },
  {
    "skillName": "gemini",
    "skillCode": "gemini",
    "skillDescZh": "Gemini CLI：一次性问答、摘要与生成。",
    "skillDescEn": "Gemini CLI for one-shot Q&A, summaries, and generation."
  },
  {
    "skillName": "gh-issues",
    "skillCode": "gh-issues",
    "skillDescZh": "获取 GitHub Issue、委托子代理修复、开启 PR、关注评审或执行 /gh-issues 工作流。",
    "skillDescEn": "Fetch GitHub issues, delegate fixes to subagents, open PRs, watch reviews, or run /gh-issues workflows."
  },
  {
    "skillName": "gifgrep",
    "skillCode": "gifgrep",
    "skillDescZh": "使用 CLI/TUI 搜索 GIF 提供商、下载结果并提取静帧或拼贴图。",
    "skillDescEn": "Search GIF providers with CLI/TUI, download results, and extract stills/sheets."
  },
  {
    "skillName": "github",
    "skillCode": "github",
    "skillDescZh": "使用 gh 处理 GitHub Issue、PR 状态、CI/日志、评论、评审、发布与 API 查询。",
    "skillDescEn": "Use gh for GitHub issues, PR status, CI/logs, comments, reviews, releases, and API queries."
  },
  {
    "skillName": "gog",
    "skillCode": "gog",
    "skillDescZh": "Google Workspace CLI：Gmail、日历、云端硬盘、通讯录、表格与文档。",
    "skillDescEn": "Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs."
  },
  {
    "skillName": "goplaces",
    "skillCode": "goplaces",
    "skillDescZh": "通过 goplaces 查询 Google Places：文本搜索、地点详情、解析、评论或可脚本化 JSON。",
    "skillDescEn": "Query Google Places for text search, place details, resolve, reviews, or scriptable JSON via goplaces."
  },
  {
    "skillName": "healthcheck",
    "skillCode": "healthcheck",
    "skillDescZh": "审计并加固运行 OpenClaw 的主机：SSH、防火墙、更新、暴露面、cron 检查与风险态势。",
    "skillDescEn": "Audit and harden hosts running OpenClaw for SSH, firewall, updates, exposure, cron checks, and risk posture."
  },
  {
    "skillName": "himalaya",
    "skillCode": "himalaya",
    "skillDescZh": "使用 himalaya 列出、阅读、搜索、撰写、回复、转发并整理 IMAP/SMTP 邮件。",
    "skillDescEn": "Use himalaya to list, read, search, compose, reply, forward, and organize IMAP/SMTP email."
  },
  {
    "skillName": "imsg",
    "skillCode": "imsg",
    "skillDescZh": "iMessage/SMS CLI：列出聊天与历史，并通过「信息」应用发送消息。",
    "skillDescEn": "iMessage/SMS CLI for listing chats, history, and sending messages via Messages.app."
  },
  {
    "skillName": "mcporter",
    "skillCode": "mcporter",
    "skillDescZh": "通过 HTTP 或 stdio 使用 mcporter 列出、配置、鉴权、调用并检查 MCP 服务器与工具。",
    "skillDescEn": "List, configure, authenticate, call, and inspect MCP servers/tools with mcporter over HTTP or stdio."
  },
  {
    "skillName": "model-usage",
    "skillCode": "model-usage",
    "skillDescZh": "按模型汇总 Codex 或 Claude 的 CodexBar 本地费用日志，含当前或完整明细。",
    "skillDescEn": "Summarize CodexBar local cost logs by model for Codex or Claude, including current or full breakdowns."
  },
  {
    "skillName": "nano-pdf",
    "skillCode": "nano-pdf",
    "skillDescZh": "使用 nano-pdf CLI，用自然语言指令编辑 PDF。",
    "skillDescEn": "Edit PDFs with natural-language instructions using the nano-pdf CLI."
  },
  {
    "skillName": "node-connect",
    "skillCode": "node-connect",
    "skillDescZh": "诊断 OpenClaw Android、iOS 或 macOS 节点的配对、二维码/安装码、路由、鉴权与连接故障。",
    "skillDescEn": "Diagnose OpenClaw Android, iOS, or macOS node pairing, QR/setup code, route, auth, and connection failures."
  },
  {
    "skillName": "notion",
    "skillCode": "notion",
    "skillDescZh": "Notion API：创建与管理页面、数据库与块。",
    "skillDescEn": "Notion API for creating and managing pages, databases, and blocks."
  },
  {
    "skillName": "obsidian",
    "skillCode": "obsidian",
    "skillDescZh": "处理 Obsidian 库（纯 Markdown 笔记）并通过 obsidian-cli 自动化。",
    "skillDescEn": "Work with Obsidian vaults (plain Markdown notes) and automate via obsidian-cli."
  },
  {
    "skillName": "openai-whisper",
    "skillCode": "openai-whisper",
    "skillDescZh": "使用 Whisper CLI 在本地语音转文字（无需 API 密钥）。",
    "skillDescEn": "Local speech-to-text with the Whisper CLI (no API key)."
  },
  {
    "skillName": "openai-whisper-api",
    "skillCode": "openai-whisper-api",
    "skillDescZh": "通过 OpenAI 语音转写 API（Whisper）转录音频。",
    "skillDescEn": "Transcribe audio via OpenAI Audio Transcriptions API (Whisper)."
  },
  {
    "skillName": "openhue",
    "skillCode": "openhue",
    "skillDescZh": "通过 OpenHue CLI 控制飞利浦 Hue 灯光与场景。",
    "skillDescEn": "Control Philips Hue lights and scenes via the OpenHue CLI."
  },
  {
    "skillName": "oracle",
    "skillCode": "oracle",
    "skillDescZh": "使用 oracle CLI 打包提示词与文件，供第二模型进行调试、重构、设计或评审检查。",
    "skillDescEn": "Use oracle CLI to bundle prompts and files for second-model debugging, refactor, design, or review checks."
  },
  {
    "skillName": "ordercli",
    "skillCode": "ordercli",
    "skillDescZh": "仅支持 Foodora：查询历史订单与进行中的订单状态（Deliveroo 开发中）。",
    "skillDescEn": "Foodora-only CLI for checking past orders and active order status (Deliveroo WIP)."
  },
  {
    "skillName": "peekaboo",
    "skillCode": "peekaboo",
    "skillDescZh": "使用 Peekaboo CLI 截取并自动化 macOS 界面。",
    "skillDescEn": "Capture and automate macOS UI with the Peekaboo CLI."
  },
  {
    "skillName": "sag",
    "skillCode": "sag",
    "skillDescZh": "ElevenLabs 文字转语音，类 macOS say 的交互体验。",
    "skillDescEn": "ElevenLabs text-to-speech with mac-style say UX."
  },
  {
    "skillName": "session-logs",
    "skillCode": "session-logs",
    "skillDescZh": "使用 jq 搜索并分析本会话日志（较早或父级对话）。",
    "skillDescEn": "Search and analyze your own session logs (older/parent conversations) using jq."
  },
  {
    "skillName": "sherpa-onnx-tts",
    "skillCode": "sherpa-onnx-tts",
    "skillDescZh": "通过 sherpa-onnx 在本地文字转语音（离线、无云）。",
    "skillDescEn": "Local text-to-speech via sherpa-onnx (offline, no cloud)"
  },
  {
    "skillName": "skill-creator",
    "skillCode": "skill-creator",
    "skillDescZh": "创建、编辑、改进、整理、评审、审计或重构 AgentSkills 与 SKILL.md 文件。",
    "skillDescEn": "Create, edit, improve, tidy, review, audit, or restructure AgentSkills and SKILL.md files."
  },
  {
    "skillName": "slack",
    "skillCode": "slack",
    "skillDescZh": "使用 Slack 工具进行反应、置顶/取消置顶、发送、编辑、删除消息或获取成员信息。",
    "skillDescEn": "Use the Slack tool to react, pin/unpin, send, edit, delete messages, or fetch Slack member info."
  },
  {
    "skillName": "songsee",
    "skillCode": "songsee",
    "skillDescZh": "使用 songsee CLI 从音频生成频谱图与特征面板可视化。",
    "skillDescEn": "Generate spectrograms and feature-panel visualizations from audio with the songsee CLI."
  },
  {
    "skillName": "sonoscli",
    "skillCode": "sonoscli",
    "skillDescZh": "控制 Sonos 音箱：发现、状态、播放、音量、分组。",
    "skillDescEn": "Control Sonos speakers (discover/status/play/volume/group)."
  },
  {
    "skillName": "spotify-player",
    "skillCode": "spotify-player",
    "skillDescZh": "在终端通过 spogo（优先）或 spotify_player 进行 Spotify 播放与搜索。",
    "skillDescEn": "Terminal Spotify playback/search via spogo (preferred) or spotify_player."
  },
  {
    "skillName": "summarize",
    "skillCode": "summarize",
    "skillDescZh": "总结或转写 URL、YouTube/视频、播客、文章、字幕、PDF 与本地文件。",
    "skillDescEn": "Summarize or transcribe URLs, YouTube/videos, podcasts, articles, transcripts, PDFs, and local files."
  },
  {
    "skillName": "taskflow",
    "skillCode": "taskflow",
    "skillDescZh": "将多步离线任务协调为单一持久 TaskFlow 作业，含负责人上下文、状态、等待与子任务。",
    "skillDescEn": "Coordinate multi-step detached tasks as one durable TaskFlow job with owner context, state, waits, and child tasks."
  },
  {
    "skillName": "taskflow-inbox-triage",
    "skillCode": "taskflow-inbox-triage",
    "skillDescZh": "TaskFlow 示例模式：收件箱分流、意图路由、等待回复与后续摘要。",
    "skillDescEn": "Example TaskFlow pattern for inbox triage, intent routing, waiting on replies, and later summaries."
  },
  {
    "skillName": "things-mac",
    "skillCode": "things-mac",
    "skillDescZh": "在 macOS 上添加、更新、列出、搜索或查看 Things 3 待办、收件箱、今天、项目、区域与标签。",
    "skillDescEn": "Add, update, list, search, or inspect Things 3 todos, inbox, today, projects, areas, and tags on macOS."
  },
  {
    "skillName": "tmux",
    "skillCode": "tmux",
    "skillDescZh": "通过发送按键与抓取窗格输出远程控制 tmux 会话，以驱动交互式 CLI。",
    "skillDescEn": "Remote-control tmux sessions for interactive CLIs by sending keystrokes and scraping pane output."
  },
  {
    "skillName": "trello",
    "skillCode": "trello",
    "skillDescZh": "通过 Trello REST API 管理看板、列表与卡片。",
    "skillDescEn": "Manage Trello boards, lists, and cards via the Trello REST API."
  },
  {
    "skillName": "video-frames",
    "skillCode": "video-frames",
    "skillDescZh": "使用 ffmpeg 从视频提取帧或短视频片段。",
    "skillDescEn": "Extract frames or short clips from videos using ffmpeg."
  },
  {
    "skillName": "voice-call",
    "skillCode": "voice-call",
    "skillDescZh": "通过 OpenClaw voice-call 插件发起语音通话。",
    "skillDescEn": "Start voice calls via the OpenClaw voice-call plugin."
  },
  {
    "skillName": "wacli",
    "skillCode": "wacli",
    "skillDescZh": "通过 wacli 发送第三方 WhatsApp 消息或同步/搜索聊天记录（非日常活跃会话）。",
    "skillDescEn": "Send third-party WhatsApp messages or sync/search WhatsApp history via wacli, not normal active chats."
  },
  {
    "skillName": "weather",
    "skillCode": "weather",
    "skillDescZh": "获取指定地点或出行规划的当前天气、降雨、温度与预报。",
    "skillDescEn": "Get current weather, rain, temperature, and forecasts for locations or travel planning."
  },
  {
    "skillName": "xurl",
    "skillCode": "xurl",
    "skillDescZh": "使用 xurl 进行已认证的 X API 发帖、回复、搜索、私信、媒体上传、关注者或原始 v2 调用。",
    "skillDescEn": "Use xurl for authenticated X API posts, replies, search, DMs, media upload, followers, or raw v2 calls."
  },
  {
    "skillName": "dws",
    "skillCode": "dws",
    "skillDescZh": "仅通过 dws CLI 操作钉钉产品：AI 表格、日历、通讯录、群与机器人、待办、OA 审批、考勤、日志、DING、开放文档、钉钉文档、云盘、AI 听记、邮箱等；始终使用 --format json；参数以 dws schema 与 --help 为准；鉴权异常时执行 dws auth login --device。",
    "skillDescEn": "Use dws for DingTalk product operations via CLI only: AI tables, calendar, contacts, groups and bots, todos, OA approval, attendance, reports, DING, dev docs, DingTalk docs, drive, AI minutes, mail; always --format json, use dws schema/--help for params, and on auth errors run dws auth login --device."
  },
  {
    "skillName": "iwhalehub",
    "skillCode": "iwhalehub",
    "skillDescZh": "在iWhaleHub市场中查找并安装匹配的资源，包括技能和未来资源类型。每当用户要求从iWhaleHub搜索、比较、验证或安装平台资源时，即可使用。",
    "skillDescEn": "Find and install matching resources in the iWhale Hub marketplace, including skills and future resource types. Use whenever the user asks to search, compare, validate, or install platform resources from iWhale Hub."
  }
]', 'OpenClaw 仓库 skills/ 目录下内置（随安装分发）的 Agent Skill 元数据 JSON 数组');
