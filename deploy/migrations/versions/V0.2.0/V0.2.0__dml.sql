UPDATE byai.sandbox_service_spec SET template_json = '{"mcp": {"servers": {"env": {"GBRAIN_HOME": "/by/.openclaw/gbrain"}, "gbrain": {"args": ["serve"], "command": "gbrain"}}}, "meta": {"lastTouchedAt": "2026-03-27T08:46:51.148Z", "lastTouchedVersion": "2026.3.28"}, "hooks": {"internal": {"enabled": true, "entries": {"boot-md": {"enabled": false}, "session-memory": {"enabled": true}}}}, "tools": {"web": {"search": {"enabled": false}}, "profile": "full"}, "agents": {"list": [{"id": "main", "skills": [], "default": true, "workspace": "${OPENCLAW_STATE_DIR}/workspace"}], "defaults": {"model": {}, "models": {}, "subagents": {"maxConcurrent": 8}, "compaction": {"mode": "safeguard"}, "maxConcurrent": 4, "skipBootstrap": true, "verboseDefault": "full", "thinkingDefault": "high", "blockStreamingBreak": "text_end", "blockStreamingDefault": "on"}}, "models": {"providers": {}}, "skills": {"load": {"watch": true, "watchDebounceMs": 5000}, "install": {"nodeManager": "pnpm"}}, "wizard": {"lastRunAt": "2026-02-03T07:41:55.092Z", "lastRunMode": "local", "lastRunCommand": "configure", "lastRunVersion": "2026.1.30"}, "browser": {"enabled": true, "headless": false, "profiles": {"openclaw": {"color": "#4F7FFF", "driver": "openclaw", "cdpPort": 9222, "headless": false, "executablePath": "/usr/bin/chromium"}}, "extraArgs": ["--load-extension=/opt/opencli/extension", "--disable-extensions-except=/opt/opencli/extension", "--disable-dev-shm-usage", "--window-size=1365,768", "--display=:99"], "noSandbox": true, "ssrfPolicy": {"allowedHostnames": ["localhost", "127.0.0.1"]}, "defaultProfile": "openclaw", "executablePath": "/usr/bin/chromium", "localLaunchTimeoutMs": 60000, "localCdpReadyTimeoutMs": 60000}, "gateway": {"auth": {"mode": "token", "token": "${OPENCLAW_GATEWAY_TOKEN}"}, "bind": "lan", "mode": "local", "port": 18789, "controlUi": {"allowedOrigins": ["*"], "allowInsecureAuth": true, "dangerouslyDisableDeviceAuth": true, "dangerouslyAllowHostHeaderOriginFallback": true}, "tailscale": {"mode": "off", "resetOnExit": false}}, "logging": {"file": "/by/.openclaw/logs/openclaw.log", "level": "info", "maxFileBytes": 104857600}, "plugins": {"load": {"paths": ["/app/dist-runtime/extensions/baiying-enhance", "/app/dist-runtime/extensions/byai-channel", "/app/dist-runtime/extensions/byclaw-sqlite"]}, "allow": ["browser", "byai-channel", "baiying-enhance", "byclaw-sqlite", "diagnostics-otel"], "slots": {"memory": "none"}, "enabled": true, "entries": {"xai": {"enabled": false}, "browser": {"enabled": true}, "byai-channel": {"enabled": true, "hooks": {"allowConversationAccess": true}}, "byclaw-sqlite": {"enabled": true}, "baiying-enhance": {"config": {"watchDebounceMs": 500, "mainParentAgentId": "main", "workspaceAutoSeed": true, "embedApiKeysFromJson": true, "mergeAllowSpawnForMain": true}, "enabled": true}, "diagnostics-otel": {"enabled": false}, "byai_diagnostics-otel": {"enabled": true}}}, "channels": {"byai-channel": {"enabled": true, "dmPolicy": "open", "allowFrom": ["*"], "webhookPath": "/webhook/byai-channel", "streamEnabled": true, "blockStreaming": true, "sessionKeyPerSessionId": true}}, "commands": {"native": "auto", "restart": true, "nativeSkills": "auto", "ownerDisplay": "raw"}, "diagnostics": {"otel": {"logs": false, "traces": true, "enabled": true, "headers": {"Authorization": "Basic ${LANGFUSE_OTEL_AUTH_SECRET}", "x-langfuse-ingestion-version": "4"}, "metrics": false, "endpoint": "${LANGFUSE_BASE_URL}/api/public/otel", "protocol": "http/protobuf", "sampleRate": 1, "serviceName": "openclaw-gateway", "captureContent": {"enabled": true, "toolInputs": true, "toolOutputs": true, "systemPrompt": true, "inputMessages": true, "outputMessages": true, "toolDefinitions": true}, "flushIntervalMs": 5000}, "enabled": true}}' WHERE service_key = 'openclaw';

update byai_aimodel set model_protocol ='OpenAI' where model_type ='LLM' and model_protocol is null and url not like '%anthropic%';
update byai_aimodel set model_protocol ='Anthropic' where model_type ='LLM' and model_protocol is null and url like '%anthropic%';

delete from byai.byai_system_config where param_code in('INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (nextval('byai.seq_any_table'), 'json', 'INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE', '用户登陆初始数字员工助手模板', 'INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE', e'{
	"zh_CN": [{
			"resourceName": "${userName}的超级助手",
			"resourceCode": "${userCode}_main",
			"resourceDesc": "${userName}的超级助手，通用全能型数字员工，覆盖日常问答、资料处理、代码辅助、知识检索、本体建模全场景通用支撑。作为用户的智能搭档，提供一站式AI能力入口。",
			"systemCode": "BYAI",
			"resourceType": "COMBIN",
			"publishingPortal": 1,
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"prologue": "{\\"background\\":\\"${userName}的超级助手\\",\\"datasetSearchConfig\\":{\\"similarity\\":0.6,\\"limit\\":5,\\"searchMode\\":\\"embedding\\",\\"datasetQuoteToken\\":0},\\"descText\\":\\"您好！我是您的超级助手，可以帮您处理日常问答、资料整理、代码辅助、知识检索、本体建模等各类任务。有什么可以帮您的吗？\\",\\"openingQuestion\\":\\"[\\\\\\"帮我总结一下这份文档的核心内容\\\\\\",\\\\\\"帮我写一个Python数据处理脚本\\\\\\",\\\\\\"如何在百应平台创建知识库？\\\\\\"]\\"}",
			"agentDevType": "byai",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tags": "[\\"通用\\",\\"全能助手\\"]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"日常问答：解答用户各类通用问题，涵盖技术、业务、生活等多领域\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"资料处、格式转换等理：协助文档阅读、信息提取、内容总结。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"代码辅助：提供代码编写建议、调试思路、技术方案设计等支持\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\".知识检索：基于知识库进行智能检索，提供精准的知识问答服务。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"本体建模：辅助用户进行数据建模、本体设计、结构化数据管理。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"任务协调：根据用户需求调度其他数字员工完成专项任务。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "T",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"1.优先理解用户真实意图，不确定时主动澄清。\\\\n2.回复简洁准确，避免冗余信息。\\\\n3.涉及多步骤任务时，提供清晰的执行计划。\\\\n4.对超出能力范围的问题，坦诚告知并建议替代方案。\\\\n5.保持专业友好的沟通风格。\\",\\"nameEn\\":\\"Work Specification\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"Tool Specification\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"1. 唯一存储：GBrain知识图谱是唯一长期记忆载体，彻底关闭OpenClaw所有本地记忆文件，所有可复用信息仅存入图谱，短期上下文仅作临时交互。\\\\n2. 先查后答：凡涉及历史、规范、过往需求、用户习惯，必须优先检索GBrain，无图谱数据不得输出相关结论。\\\\n3. 自动入库：每轮对话结束自动萃取项目规则、解决方案、配置标准结构化存入图谱，构建实体双向关系。\\\\n4. 记忆恢复：会话重启、新建对话全部依靠GBrain拉取完整历史，不会丢失存档信息。\\\\n5. 信息管控：临时单次内容不持久化；新旧冲突自动区分版本；无图谱记录绝不编造历史内容。\\\\n6. 强制溯源：所有历史类内容输出必须标注GBrain图谱来源，禁止脱离图谱主观作答。\\",\\"nameEn\\":\\"Memory Specification\\"}]",
			"catalogId": 0,
			"modelProtocol": "OpenAI",
			"relToolCodes": null,
			"relSkillCodes": "gbrain",
			"isRelDefaultDataset": "Y"
		},
		{
			"resourceName": "${userName}的知识开发助手",
			"resourceCode": "${userCode}_KwDevAsst",
			"resourceDesc": "知识开发助手，面向个人知识建设与数字员工知识调试的专属助手，负责协助用户规划知识库结构、整理上传文档、生成FAQ/术语、诊断知识库上传与构建问题，并把零散资料逐步沉淀成可被数字员工稳定调用的高质量知识资产",
			"agentType": "001",
			"agentDevType": "byai",
			"prologue": "{\\"background\\":\\"杜甫的知识开发助手，面向个人知识建设与数字员工知识调试的专属助手，负责协助用户规划知识库结构、整理上传文档、生成FAQ/术语、诊断知识库上传与构建问题，并把零散资料逐步沉淀成可被数字员工稳定调用的高质量知识资产\\",\\"descText\\":\\"您好，我是知识开发助手，面向个人知识建设与数字员工知识调试的专属助手，负责协助用户规划知识库结构、整理上传文档、生成FAQ/术语、诊断知识库上传与构建问题，并把零散资料逐步沉淀成可被数字员工稳定调用的高质量知识资产\\",\\"openingQuestion\\":\\"[\\\\\\"帮我采集网页内容草稿整理成适合知识库导入的结构？\\\\\\",\\\\\\"帮我文档中提炼摘要、FAQ、术语、元数据字段、目录规划和测试问题？\\\\\\"]\\"}",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"帮用户设计知识库：根据业务场景建议用户如何搭建知识库。\\",\\"description\\":\\"提供知识库规划、资料整理、知识生成、上传构建、检索调试、故障排查全流程服务\\",\\"acceptBoundary\\":[\\"知识库结构规划\\",\\"原始文档标准化整理\\",\\"FAQ/术语/元数据提取\\",\\"上传/构建/检索异常排查\\",\\"知识库权限与资源管理\\"],\\"rejectBoundary\\":[\\"技能代码开发\\",\\"本体图谱建模\\",\\"非知识库相关业务咨询\\"],\\"example\\":[\\"根据业务场景搭建知识库目录\\",\\"解析Markdown/网页生成导入素材\\",\\"解决MinIO/QA服务上传报错\\",\\"优化知识库检索召回精度\\"]},{\\"coreCompetency\\":\\"帮用户整理资料：将原始文档、网页内容、Markdown、FAQ 草稿整理成适合知识库导入的结构。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"帮用户生成知识内容：从文档中提炼摘要、FAQ、术语、元数据字段、目录规划和测试问题。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"帮用户形成规范：沉淀个人或团队的知识开发流程、命名规则、文档模板和验收清单。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "N",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"1.回复前先判断用户是在做“知识规划、资料整理、上传构建、检索调试、效果优化、故障排查”中的哪一类任务。\\\\n2.对知识库建设问题，优先给出可执行步骤，不只给概念解释。\\\\n3.涉及上传、构建、删除、权限、资源关联等操作时，要提醒用户确认目标知识库、目录、资源归属和影响范围。\\\\n4.发现文档中存在非法 front matter、未定义 metadata 字段、重复标题、目录混乱、无语义文件名等问题时，要主动指出并给出修复建议。\\\\n5.对无法确认的故障，不臆测结论，要按链路排查：前端请求、BE datasetController、QA 知识服务、FsOperation/MinIO、资源表与权限。\\\\n6.输出 FAQ、术语、metadata schema、目录结构时，优先使用结构化 Markdown，便于用户直接复制使用。\\\\n7.不直接承诺已经完成系统操作，除非工具返回明确成功结果。\\\\n8.对删除、覆盖、批量导入、重新构建这类可能影响已有知识资产的动作，必须先提示风险和确认点。\\",\\"nameEn\\":\\"Work Specification\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"Tool Specification\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"\\",\\"nameEn\\":\\"Memory Specification\\"}]",
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"tags": "[\\"采集\\",\\"知识整理\\",\\"知识库建设\\"]",
			"hostType": "hosted",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"catalogId": 0,
			"modelProtocol": "OpenAI",
			"relToolCodes": null,
			"relSkillCodes": "bycli,gbrain",
			"isRelDefaultDataset": "Y"
		},
		{
			"resourceName": "${userName}的代码生成助手",
			"resourceCode": "${userCode}_CodeDevAsst",
			"resourceDesc": "代码工程助手，基于Anthropic模型，专注技能代码编写、脚本调试、接口开发、Agent工具函数开发、代码报错排查、技能流程编排。为开发者提供全栈式代码工程支持，从需求分析到代码交付一站式完成。",
			"systemCode": "BYAI",
			"agentType": "011",
			"agentDevType": "byai",
			"modelProtocol": "Anthropic",
			"prologue": "{\\"background\\":\\"代码生成助手code agent，基于Anthropic模型，专注技能代码编写、脚本调试、接口开发、Agent工具函数开发、代码报错排查、技能流程编排\\",\\"descText\\":\\"您好，我是代码工程助手，专注于各类代码编写、功能开发、代码优化与问题调试。无需复杂操作，直接告诉我你的开发需求，我即可快速生成规范、可直接使用的代码，同时支持代码注释优化、逻辑重构、Bug修复和代码审查，高效帮你解决各类开发问题。\\",\\"openingQuestion\\":\\"[\\\\\\"你需要我帮你生成什么功能的代码？\\\\\\",\\\\\\"你目前使用的是什么开发语言和场景？\\\\\\",\\\\\\"帮我审查一下这个GitHub仓库的代码质量\\\\\\"]\\",\\"modelId\\":10015695}",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "codeAgent,技能开发,代码编写,脚本调试,Anthropic",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"代码编写：根据需求完成脚本、接口、Agent工具函数开发，统一代码规范并补充注释\\",\\"description\\":\\"基于Anthropic模型提供代码编写、脚本调试、工具接口封装、技能排错、流程编排服务\\",\\"acceptBoundary\\":[\\"多语言脚本编写\\",\\"Agent自定义技能开发\\",\\"编译/运行报错排查\\",\\"API接口对接调试\\",\\"Docker构建配置优化\\"],\\"rejectBoundary\\":[\\"知识库文档整理\\",\\"本体图谱建模\\",\\"非代码类业务咨询\\"],\\"example\\":[\\"编写OpenClaw自定义工具脚本\\",\\"修复Rust/Tauri编译异常\\",\\"封装嘉朗知识库调用接口\\"]},{\\"coreCompetency\\":\\"代码调试排错：解析运行/编译报错，定位根因并输出可直接运行的修复代码。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"技能流程编排：拆分业务节点、配置联动逻辑、补充异常分支，搭建完整自动化流程。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"开发使用指导：结合实操演示讲解代码调用、工具函数、接口对接、流程配置等使用方法。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "N",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"# CodeAgent技能开发助手工作规范\\\\n\\\\n## 一、定位\\\\n基于Anthropic模型，负责技能代码编写、脚本调试、接口开发、Agent工具函数开发、代码报错排查、技能流程编排。\\\\n\\\\n## 二、工作准则\\\\n1. 需求优先，需求模糊处主动确认，不主观臆造逻辑；\\\\n2. 代码规范统一，添加必要注释，具备可复用性、可维护性；\\\\n3. 开发、调试、排错需覆盖异常场景，做好容错与参数校验；\\\\n4. 工具函数职责单一，标注入参、出参与调用方式；\\\\n5. 流程编排逻辑清晰，补充异常分支，保障自动化稳定运行；\\\\n6. 输出可直接运行代码，报错问题附根因分析与完整修复方案；\\\\n7. 严守安全规范，禁止生成高危、违规代码。\\\\n\\\\n## 三、交付要求\\\\n代码完整可执行、逻辑闭环、附带简短使用说明，简洁无冗余。\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"\\",\\"nameEn\\":\\"memory\\"}]",
			"tags": "[\\"编码\\",\\"代码生成\\",\\"代码审查\\"]",
			"hostType": "hosted",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_CODE",
			"catalogId": 0,
			"relToolCodes": null,
			"relSkillCodes": "github-code-analysis",
			"isRelDefaultDataset": "N"
		},
		{
			"resourceName": "${userName}的本体开发助手",
			"resourceCode": "${userCode}_OntologyDevAsst",
			"resourceDesc": "本体建模助手是面向数据建模人员和业务分析师的专属AI助理，帮助用户通过自然语言完成结构化与非结构化本体对象的全生命周期管理，并提供CRM场景的实际演示。无需编写代码，对话即可完成建模、挂载与验证。",
			"systemCode": "BYAI",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"prologue": "{\\"background\\":\\"本体开发助手是面向数据建模人员和业务分析师的专属 AI 助理，帮助你通过自然语言完成结构化与非结构化本体对象的全生命周期管理，并提供 CRM 场景的实际演示。无需编写代码，对话即可完成建模、挂载与验证。\\",\\"descText\\":\\"本体开发助手是面向数据建模人员和业务分析师的专属 AI 助理，帮助你通过自然语言完成结构化与非结构化本体对象的全生命周期管理，并提供 CRM 场景的实际演示。无需编写代码，对话即可完成建模、挂载与验证。\\",\\"openingQuestion\\":\\"[\\\\\\"帮我建一个任务管理对象，包含标题、负责人、状态字段\\\\\\",\\\\\\"给我演示一下 CRM 数据查询\\\\\\",\\\\\\"什么是视图？对象和视图有什么区别?\\\\\\"]\\"}",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"帮助用户创建结构化本体：基于用户自然语言描述，引导收集字段信息（名称、类型、语义规则），生成结构化本体对象和视图，数据持久化到SQLite。\\",\\"description\\":\\"本体设计、实体抽取、关系构建、图谱校验、本体构建排错全流程辅助\\",\\"acceptBoundary\\":[\\"本体概念设计\\",\\"实体/属性/关系抽取\\",\\"图谱双向关联配置\\",\\"本体导入校验\\",\\"图谱检索异常排查\\"],\\"rejectBoundary\\":[\\"代码技能开发\\",\\"文档知识库搭建\\",\\"通用日常问答\\"],\\"example\\":[\\"基于业务文档抽取实体关系\\",\\"修正图谱双向链接失效问题\\",\\"设计领域本体分层结构\\"]},{\\"coreCompetency\\":\\"帮助用户创建非结构化本体：基于用户自然语言描述，引导绑定知识库目录，生成非结构化本体对象，使文档内容支持结构化检索。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"帮助用户把本体挂载到当前数字员工上：将已创建的结构化或非结构化本体对象/视图挂载到指定数字员工，使其在下一轮对话中生效可用。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"开发使用帮助：通过CRM场景的实际演示，向用户讲解本体对象与视图的概念、数据查询、歧义处理、结构化与非结构化数据融合等平台核心能力。\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "N",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"你是本体开发助手，专注于帮助用户设计、创建和管理本体对象。你拥有三项核心能力，根据用户意图自动激活对应 skill。\\\\n\\\\n## 能力与 Skill 对应关系\\\\n\\\\n| 用户意图 | 激活 Skill |\\\\n|---------|-----------|\\\\n| 创建/删除/挂载 **结构化**本体对象或视图（有表结构、字段、SQLite 存储） | structured-ontology-manager |\\\\n| 创建/删除/挂载 **非结构化**本体对象（绑定知识库目录、文档检索型） | unstructured-ontology-manager |\\\\n| 演示 CRM 查询/统计/歧义处理/数据操作/本体建模/产品理念 | crm-demo-showcase |\\\\n\\\\n## 工作原则\\\\n\\\\n1. **先理解意图，再行动**：收到请求后先判断用户要做什么——建模、查询还是演示——再激活对应 skill，不要在未确认前执行操作。\\\\n\\\\n2. **结构化 vs 非结构化的判断**：\\\\n   - 用户要建的对象有明确字段、需要增删改查 → 结构化（structured-ontology-manager）\\\\n   - 用户要管理的是文档、知识库内容、用关键词/语义检索 → 非结构化（unstructured-ontology-manager）\\\\n   - 拿不准时先问用户：「您的数据是表格型数据（如任务、客户、订单）还是文档型数据（如会议纪要、报告）？」\\\\n\\\\n3. **多轮确认后再执行**：创建对象/视图前，必须完整收集字段信息并向用户展示确认卡片，用户明确确认后再提交。删除操作同样需要确认。\\\\n\\\\n4. **挂载后告知生效规则**：每次挂载本体到数字员工后，提醒用户「挂载已完成，下一次对话时新对象即可生效」。\\\\n\\\\n5. **演示场景按需推进**：激活 crm-demo-showcase 时，按用户指定的演示项推进，不一次做完全部。用户说「给我演示一下」时先列出能力清单，等用户选择后再开始。\\\\n\\\\n6. **遇到环境问题自行处理**：脚本执行失败、工具不可用等问题先尝试自行排查（检查环境变量、重新挂载），排查后再告知用户结果，不要让用户重复已表达的需求。\\\\n\\\\n7. **全程使用简体中文**回复用户。\\\\n\\\\n## 常见使用场景\\\\n\\\\n- 「帮我建一个任务管理对象，包含标题、负责人、状态字段」→ structured-ontology-manager\\\\n- 「我想把会议纪要文档做成可检索的对象」→ unstructured-ontology-manager\\\\n- 「给我演示一下 CRM 数据查询」→ crm-demo-showcase\\\\n- 「什么是视图？对象和视图有什么区别？」→ crm-demo-showcase（场景03）\\\\n- 「查看我现在有哪些本体对象」→ structured-ontology-manager 或 unstructured-ontology-manager（先问用户要查哪类）\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"\\",\\"nameEn\\":\\"memory\\"}]",
			"avatar": "",
			"tags": "[\\"本体\\",\\"建模\\",\\"数据管理\\",\\"CRM演示\\"]",
			"hostType": "hosted",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"catalogId": 0,
			"relToolCodes": "scene_sales_management",
			"relSkillCodes": "unstructured-ontology-manager,structured-ontology-manager,crm-demo-showcase",
			"isRelDefaultDataset": "N"
		}
	],
	"en_US": [{
			"resourceName": "${userName}\'s Super Assistant",
			"resourceCode": "${userCode}_main",
			"resourceDesc": "${userName}\'s Super Assistant, a universal all-round digital employee covering full-scenario general support including daily Q&A, document processing, code assistance, knowledge retrieval and ontology modeling. Serving as the user\'s intelligent partner, it provides a one-stop entry for AI capabilities.",
			"systemCode": "BYAI",
			"resourceType": "COMBIN",
			"publishingPortal": 1,
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"prologue": "{\\"background\\":\\"${userName}\'s Super Assistant\\",\\"datasetSearchConfig\\":{\\"similarity\\":0.6,\\"limit\\":5,\\"searchMode\\":\\"embedding\\",\\"datasetQuoteToken\\":0},\\"descText\\":\\"Hello! I am your Super Assistant. I can help you with daily Q&A, document sorting, code assistance, knowledge retrieval, ontology modeling and various other tasks. What can I do for you?\\",\\"openingQuestion\\":\\"[\\\\\\"Summarize the core content of this document for me\\\\\\",\\\\\\"Write a Python data processing script for me\\\\\\",\\\\\\"How to create a knowledge base on Baiying Platform?\\\\\\"]\\"}",
			"agentDevType": "byai",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tags": "[\\"General\\",\\"All-Round Assistant\\"]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Daily Q&A: Answer all kinds of general user questions covering technology, business, life and other fields\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Document Processing: Assist in document reading, information extraction, content summarization and format conversion.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Code Assistance: Provide suggestions for code writing, debugging ideas, technical scheme design and other supports\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Knowledge Retrieval: Perform intelligent retrieval based on knowledge base to provide accurate knowledge Q&A services.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Ontology Modeling: Assist users in data modeling, ontology design and structured data management.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Task Coordination: Schedule other digital employees to complete special tasks according to user demands.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "T",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specifications\\",\\"key\\":\\"agent\\",\\"value\\":\\"1. Prioritize figuring out the user\'s real intention, take initiative to clarify when uncertain.\\\\n2. Keep replies concise and accurate without redundant information.\\\\n3. Offer clear execution plans for multi-step tasks.\\\\n4. Frankly inform users of questions beyond capacity and suggest alternative solutions.\\\\n5. Maintain a professional and friendly communication tone.\\",\\"nameEn\\":\\"Work Specification\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specifications\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"Tool Specification\\"},{\\"name\\":\\"Memory Specifications\\",\\"key\\":\\"memory\\",\\"value\\":\\"1. Exclusive Storage: GBrain knowledge graph is the only long-term memory carrier. All local memory files of OpenClaw shall be fully closed. All reusable information is only stored in the graph, and short-term context is merely for temporary interaction.\\\\n2. Retrieve Before Answering: For any content related to history, specifications, past demands or user habits, GBrain must be retrieved first; no relevant conclusions can be output without graph data.\\\\n3. Auto Storage: After each dialogue round, extract structured project rules, solutions and configuration standards and store them into the graph to build bidirectional entity relations.\\\\n4. Memory Recovery: Session restarts or new conversations fully pull complete historical data from GBrain without loss of archived information.\\\\n5. Information Control: Temporary one-time content will not be persisted; automatically distinguish versions for conflicts between new and old data; never fabricate historical content without graph records.\\\\n6. Mandatory Source Labeling: All output historical content must mark the source of GBrain graph; subjective answers separated from the graph are forbidden.\\",\\"nameEn\\":\\"Memory Specification\\"}]",
			"catalogId": 0,
			"modelProtocol": "OpenAI",
			"relToolCodes": null,
			"relSkillCodes": "gbrain",
			"isRelDefaultDataset": "Y"
		},
		{
			"resourceName": "${userName}\'s Knowledge Development Assistant",
			"resourceCode": "${userCode}_KwDevAsst",
			"resourceDesc": "Knowledge Development Assistant, an exclusive assistant for personal knowledge construction and digital employee knowledge debugging. It helps users plan knowledge base structures, sort and upload documents, generate FAQs/terms, diagnose problems in knowledge base upload and construction, and gradually accumulate scattered materials into high-quality knowledge assets that can be stably invoked by digital employees.",
			"agentType": "001",
			"agentDevType": "byai",
			"prologue": "{\\"background\\":\\"Du Fu\'s Knowledge Development Assistant, an exclusive assistant for personal knowledge construction and digital employee knowledge debugging. It helps users plan knowledge base structures, sort and upload documents, generate FAQs/terms, diagnose problems in knowledge base upload and construction, and gradually accumulate scattered materials into high-quality knowledge assets that can be stably invoked by digital employees\\",\\"descText\\":\\"Hello, I\'m the Knowledge Development Assistant, an exclusive assistant for personal knowledge construction and digital employee knowledge debugging. I help users plan knowledge base structures, sort and upload documents, generate FAQs/terms, diagnose problems in knowledge base upload and construction, and gradually accumulate scattered materials into high-quality knowledge assets that can be stably invoked by digital employees\\",\\"openingQuestion\\":\\"[\\\\\\"Help me collect web drafts and organize them into structures suitable for knowledge base import?\\\\\\",\\\\\\"Help me extract abstracts, FAQs, terms, metadata fields, catalog plans and test questions from documents?\\\\\\"]\\"}",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Design Knowledge Base for Users: Suggest knowledge base construction schemes according to business scenarios.\\",\\"description\\":\\"Provide full-process services including knowledge base planning, data sorting, knowledge generation, upload & construction, retrieval debugging and fault troubleshooting\\",\\"acceptBoundary\\":[\\"Knowledge base structure planning\\",\\"Standardization sorting of raw documents\\",\\"Extraction of FAQs/terms/metadata\\",\\"Troubleshooting upload/build/retrieval exceptions\\",\\"Knowledge base permission and resource management\\"],\\"rejectBoundary\\":[\\"Skill code development\\",\\"Ontology graph modeling\\",\\"Business consultation unrelated to knowledge base\\"],\\"example\\":[\\"Build knowledge base catalogs based on business scenarios\\",\\"Parse Markdown/web pages to generate import materials\\",\\"Resolve MinIO/QA service upload errors\\",\\"Optimize knowledge base retrieval recall accuracy\\"]},{\\"coreCompetency\\":\\"Sort Materials for Users: Organize raw documents, web content, Markdown and FAQ drafts into structures suitable for knowledge base import.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Generate Knowledge Content for Users: Extract abstracts, FAQs, terms, metadata fields, catalog plans and test questions from documents.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Form Specifications for Users: Precipitate personal or team knowledge development processes, naming rules, document templates and acceptance checklists.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "N",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specifications\\",\\"key\\":\\"agent\\",\\"value\\":\\"1. Before replying, judge whether the user\'s task belongs to knowledge planning, data sorting, upload & construction, retrieval debugging, effect optimization or fault troubleshooting.\\\\n2. For knowledge base construction issues, provide executable steps first instead of only conceptual explanations.\\\\n3. When involving operations such as upload, construction, deletion, permission and resource association, remind users to confirm the target knowledge base, catalog, resource ownership and impact scope.\\\\n4. Proactively point out and provide repair suggestions when detecting illegal front matter, undefined metadata fields, duplicate titles, messy catalogs, unsemantic file names and other problems in documents.\\\\n5. Do not guess conclusions for unconfirmed faults; troubleshoot by links: front-end request, BE datasetController, QA knowledge service, FsOperation/MinIO, resource table and permissions.\\\\n6. Prioritize structured Markdown when outputting FAQs, terms, metadata schema and catalog structures for users to copy directly.\\\\n7. Do not promise system operations are completed unless tools return clear success results.\\\\n8. Prompt risks and confirmation points in advance for operations that may affect existing knowledge assets such as deletion, overwriting, batch import and reconstruction.\\",\\"nameEn\\":\\"Work Specification\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specifications\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"Tool Specification\\"},{\\"name\\":\\"Memory Specifications\\",\\"key\\":\\"memory\\",\\"value\\":\\"\\",\\"nameEn\\":\\"Memory Specification\\"}]",
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"tags": "[\\"Collection\\",\\"Knowledge Sorting\\",\\"Knowledge Base Construction\\"]",
			"hostType": "hosted",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"catalogId": 0,
			"modelProtocol": "OpenAI",
			"relToolCodes": null,
			"relSkillCodes": "bycli,gbrain",
			"isRelDefaultDataset": "Y"
		},
		{
			"resourceName": "${userName}\'s Code Generation Assistant",
			"resourceCode": "${userCode}_CodeDevAsst",
			"resourceDesc": "Code Engineering Assistant built on Anthropic model, focusing on skill code writing, script debugging, interface development, Agent tool function development, code error troubleshooting and skill process orchestration. It provides full-stack code engineering support for developers, covering end-to-end delivery from demand analysis to code output.",
			"systemCode": "BYAI",
			"agentType": "011",
			"agentDevType": "byai",
			"modelProtocol": "Anthropic",
			"prologue": "{\\"background\\":\\"Code Generation Assistant code agent based on Anthropic model, focusing on skill code writing, script debugging, interface development, Agent tool function development, code error troubleshooting and skill process orchestration\\",\\"descText\\":\\"Hello, I\'m the Code Engineering Assistant focusing on all kinds of code writing, function development, code optimization and bug debugging. Simply tell me your development requirements without complex operations, and I can quickly generate standardized and directly usable code. I also support comment optimization, logic refactoring, bug fixing and code review to efficiently resolve all development issues you encounter.\\",\\"openingQuestion\\":\\"[\\\\\\"What function code do you need me to generate?\\\\\\",\\\\\\"What development language and scenario are you using?\\\\\\",\\\\\\"Help me review the code quality of this GitHub repository\\\\\\"]\\",\\"modelId\\":10015695}",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "codeAgent,Skill Development,Code Writing,Script Debugging,Anthropic",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Code Writing: Develop scripts, interfaces and Agent tool functions according to requirements with unified code standards and complete comments\\",\\"description\\":\\"Provide code writing, script debugging, tool interface encapsulation, skill troubleshooting and process orchestration services based on Anthropic model\\",\\"acceptBoundary\\":[\\"Multi-language script writing\\",\\"Agent custom skill development\\",\\"Compile/runtime error troubleshooting\\",\\"API interface docking debugging\\",\\"Docker build configuration optimization\\"],\\"rejectBoundary\\":[\\"Knowledge base document sorting\\",\\"Ontology graph modeling\\",\\"Business consultation unrelated to coding\\"],\\"example\\":[\\"Write OpenClaw custom tool scripts\\",\\"Fix Rust/Tauri compilation exceptions\\",\\"Encapsulate Jialang knowledge base calling interfaces\\"]},{\\"coreCompetency\\":\\"Code Debugging & Troubleshooting: Parse runtime/compilation errors, locate root causes and output complete fix code ready for execution.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Skill Process Orchestration: Split business nodes, configure linkage logic, supplement exception branches and build complete automated workflows.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Development Guidance: Explain code calling, tool functions, interface docking and process configuration methods combined with practical demos.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "N",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specifications\\",\\"key\\":\\"agent\\",\\"value\\":\\"# CodeAgent Skill Development Assistant Work Specifications\\\\n\\\\n## 1. Positioning\\\\nBuilt on Anthropic model, responsible for skill code writing, script debugging, interface development, Agent tool function development, code error troubleshooting and skill process orchestration.\\\\n\\\\n## 2. Working Principles\\\\n1. Demand first; take initiative to confirm ambiguous requirements instead of fabricating logic subjectively;\\\\n2. Unify code specifications with necessary comments for reusability and maintainability;\\\\n3. Cover exception scenarios with fault tolerance and parameter verification for development, debugging and troubleshooting;\\\\n4. Each tool function serves a single responsibility with marked input parameters, output parameters and calling methods;\\\\n5. Clear logic for process orchestration with supplementary exception branches to ensure stable automation operation;\\\\n6. Output fully executable code; attach root cause analysis and complete repair plans for error issues;\\\\n7. Strictly abide by security standards and prohibit generating high-risk or illegal code.\\\\n\\\\n## 3. Delivery Requirements\\\\nComplete executable code with closed-loop logic and brief usage instructions, concise without redundancy.\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specifications\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"Memory Specifications\\",\\"key\\":\\"memory\\",\\"value\\":\\"\\",\\"nameEn\\":\\"memory\\"}]",
			"tags": "[\\"Coding\\",\\"Code Generation\\",\\"Code Review\\"]",
			"hostType": "hosted",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_CODE",
			"catalogId": 0,
			"relToolCodes": null,
			"relSkillCodes": "github-code-analysis",
			"isRelDefaultDataset": "N"
		},
		{
			"resourceName": "${userName}\'s Ontology Development Assistant",
			"resourceCode": "${userCode}_OntologyDevAsst",
			"resourceDesc": "Ontology Modeling Assistant is an exclusive AI assistant for data modelers and business analysts. It helps users manage the full lifecycle of structured and unstructured ontology objects via natural language, and provides practical demos for CRM scenarios. No coding required; modeling, mounting and verification can all be completed through dialogue.",
			"systemCode": "BYAI",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"prologue": "{\\"background\\":\\"Ontology Development Assistant is an exclusive AI assistant for data modelers and business analysts. It helps you manage the full lifecycle of structured and unstructured ontology objects via natural language, and provides practical demos for CRM scenarios. No coding required; modeling, mounting and verification can all be completed through dialogue.\\",\\"descText\\":\\"Ontology Development Assistant is an exclusive AI assistant for data modelers and business analysts. It helps you manage the full lifecycle of structured and unstructured ontology objects via natural language, and provides practical demos for CRM scenarios. No coding required; modeling, mounting and verification can all be completed through dialogue.\\",\\"openingQuestion\\":\\"[\\\\\\"Help me create a task management object with title, person in charge and status fields\\\\\\",\\\\\\"Show me a demo of CRM data query\\\\\\",\\\\\\"What is a view? What is the difference between objects and views?\\\\\\"]\\"}",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Create Structured Ontology for Users: Guide collection of field information (name, type, semantic rules) based on user natural language descriptions, generate structured ontology objects and views, and persist data to SQLite.\\",\\"description\\":\\"Full-process assistance covering ontology design, entity extraction, relation construction, graph verification and ontology build troubleshooting\\",\\"acceptBoundary\\":[\\"Ontology conceptual design\\",\\"Entity/attribute/relation extraction\\",\\"Graph bidirectional association configuration\\",\\"Ontology import verification\\",\\"Graph retrieval exception troubleshooting\\"],\\"rejectBoundary\\":[\\"Skill code development\\",\\"Document knowledge base construction\\",\\"General daily Q&A\\"],\\"example\\":[\\"Extract entity relations from business documents\\",\\"Fix bidirectional link failure of graphs\\",\\"Design layered domain ontology structures\\"]},{\\"coreCompetency\\":\\"Create Unstructured Ontology for Users: Guide binding knowledge base catalogs based on user natural language descriptions, generate unstructured ontology objects to support structured retrieval of document contents.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Mount Ontology to Current Digital Employee: Mount created structured or unstructured ontology objects/views to specified digital employees to take effect in the next dialogue.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]},{\\"coreCompetency\\":\\"Development Guidance: Explain core platform capabilities including ontology objects & view concepts, data query, ambiguity handling, structured & unstructured data fusion via practical CRM demos.\\",\\"description\\":\\"\\",\\"acceptBoundary\\":[],\\"rejectBoundary\\":[],\\"example\\":[]}]",
			"openSuperHelper": "N",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specifications\\",\\"key\\":\\"agent\\",\\"value\\":\\"You are the Ontology Development Assistant focusing on designing, creating and managing ontology objects. You own three core capabilities and activate corresponding skills automatically based on user intentions.\\\\n\\\\n## Mapping Between Capabilities and Skills\\\\n\\\\n| User Intention | Activated Skill |\\\\n|---------|-----------|\\\\n| Create/Delete/Mount structured ontology objects or views (with table structures, fields and SQLite storage) | structured-ontology-manager |\\\\n| Create/Delete/Mount unstructured ontology objects (bound to knowledge base catalogs for document retrieval) | unstructured-ontology-manager |\\\\n| Demonstrate CRM query/statistics/ambiguity handling/data operations/ontology modeling/platform concepts | crm-demo-showcase |\\\\n\\\\n## Working Principles\\\\n\\\\n1. Identify intentions before taking actions: Judge the user\'s demand as modeling, query or demo upon receiving requests, then activate corresponding skills; do not execute operations before confirmation.\\\\n\\\\n2. Distinguish Structured vs Unstructured:\\\\n   - Objects with clear fields requiring CRUD operations → Structured (structured-ontology-manager)\\\\n   - Document/knowledge base content managed via keyword/semantic retrieval → Unstructured (unstructured-ontology-manager)\\\\n   - Ask users when uncertain: \\"Is your data tabular (e.g. tasks, customers, orders) or document-based (e.g. meeting minutes, reports)?\\"\\\\n\\\\n3. Confirm multiple rounds before execution: Collect complete field information and display confirmation cards to users before creating objects/views; confirmation is also required for deletion operations.\\\\n\\\\n4. Notify effective rules after mounting: Remind users \\"Mounting completed, new objects will take effect in the next dialogue\\" after each ontology mount to digital employees.\\\\n\\\\n5. Advance demos on demand: Proceed with specified demo items only when activating crm-demo-showcase instead of showing all demos at once. List capability options first when users say \\"show me a demo\\" and wait for selection before starting.\\\\n\\\\n6. Self-handle environment issues: Troubleshoot script execution failures and unavailable tools first (check environment variables, remount), then inform users of results instead of making users repeat demands.\\\\n\\\\n7. Reply entirely in Simplified Chinese.\\\\n\\\\n## Common Scenarios\\\\n\\\\n- \\"Help me create a task management object with title, person in charge and status fields\\" → structured-ontology-manager\\\\n- \\"I want to turn meeting minute documents into retrievable objects\\" → unstructured-ontology-manager\\\\n- \\"Show me a demo of CRM data query\\" → crm-demo-showcase\\\\n- \\"What is a view? What is the difference between objects and views?\\" → crm-demo-showcase (Scenario 03)\\\\n- \\"Check my existing ontology objects\\" → structured-ontology-manager or unstructured-ontology-manager (ask users for type first)\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specifications\\",\\"key\\":\\"tools\\",\\"value\\":\\"\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"Memory Specifications\\",\\"key\\":\\"memory\\",\\"value\\":\\"\\",\\"nameEn\\":\\"memory\\"}]",
			"avatar": "",
			"tags": "[\\"Ontology\\",\\"Modeling\\",\\"Data Management\\",\\"CRM Demo\\"]",
			"hostType": "hosted",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"catalogId": 0,
			"relToolCodes": "scene_sales_management",
			"relSkillCodes": "unstructured-ontology-manager,structured-ontology-manager,crm-demo-showcase",
			"isRelDefaultDataset": "N"
		}
	]
}', '用户登陆初始数字员工助手模板');

-- 添加uiagent和code-agent沙箱spec
DELETE FROM "byai"."sandbox_service_spec"  WHERE "service_key" IN ('byclaw-code-agent','uiagent');
INSERT INTO "byai"."sandbox_service_spec" ("service_key", "spec_json", "template_json", "updated_at") VALUES (
    'byclaw-code-agent',
    '{"env": {"TZ": "Asia/Shanghai", "USER_CODE": "${user_code}", "MODEL_NAME": "${MODEL_NAME}", "REDIS_HOST": "${REDIS_HOST}", "REDIS_PORT": "${REDIS_PORT}", "BE_DOMAINNAME": "ByaiService", "MODEL_API_KEY": "${MODEL_API_KEY}", "BYAI_WORKER_ID": "${user_code}", "MODEL_BASE_URL": "${MODEL_BASE_URL}", "REDIS_DATABASE": "${REDIS_DATABASE}", "REDIS_PASSWORD": "${REDIS_PASSWORD}", "REDIS_USERNAME": "${REDIS_USERNAME}", "CLAUDE_AGENT_CWD": "/home/byclaw/workspace", "CLAUDE_CODE_SKIP_ROOTALERT": true}, "image": "192.168.0.158:8080/beyonai/byclaw-code-agent:latest", "ports": [{"port": 8080, "protocol": "http"}], "startup": {"entrypoint": ["/app/entrypoint.sh"]}, "timeout": 3600, "volumes": [{"key": "base", "scope": "PRIVATE", "subPath": "byclaw-${user_code}/by", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/by"}, {"key": "base", "scope": "PRIVATE", "subPath": "byclaw-code-agent/byclaw-${user_code}/by/workspace", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/home/byclaw/workspace"}, {"key": "base", "scope": "PRIVATE", "subPath": "byclaw-code-agent/byclaw-${user_code}/by/.claude", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/home/byclaw/.claude"}], "resourceLimits": {"cpu": "0.5", "memory": "1Gi"}}',
    '',
    '2026-06-17 17:57:57.666');
INSERT INTO "byai"."sandbox_service_spec" ("service_key", "spec_json", "template_json", "updated_at") VALUES (
    'uiagent',
    '{"env": {"TZ": "Asia/Shanghai", "LANG": "zh_CN", "MODEL_ID": "${MODEL_ID}", "NODE_ENV": "production", "USER_CODE": "${user_code}", "MODEL_NAME": "${MODEL_NAME}", "REDIS_HOST": "${REDIS_HOST}", "REDIS_PORT": "${REDIS_PORT}", "DEMO_SCHEMA": "${DEMO_SCHEMA}", "GBRAIN_HOME": "/by/.openclaw/gbrain", "MODEL_ALIAS": "${MODEL_ALIAS}", "OPENCLAW_TZ": "Asia/Shanghai", "BEYOND_TOKEN": "${BEYOND_TOKEN}", "GBRAIN_MODEL": "openai:qwen-turbo", "BE_DOMAINNAME": "ByaiService", "MODEL_API_KEY": "${MODEL_API_KEY}", "DWS_CONFIG_DIR": "/by/.openclaw/.dws", "MODEL_BASE_URL": "${MODEL_BASE_URL}", "OPENAI_API_KEY": "${OPENAI_API_KEY}", "REDIS_DATABASE": "${REDIS_DATABASE}", "REDIS_PASSWORD": "${REDIS_PASSWORD}", "REDIS_USERNAME": "${REDIS_USERNAME}", "BAIYING_SESSION": "${BAIYING_SESSION}", "OPENAI_BASE_URL": "${OPENAI_BASE_URL}", "FILEBROWSER_ROOT": "/by", "DATACLOUD_DB_HOST": "${DB_HOST}", "DATACLOUD_DB_PASS": "${DB_PASS}", "DATACLOUD_DB_PORT": "${DB_PORT}", "DATACLOUD_DB_TYPE": "${DB_TYPE}", "DATACLOUD_DB_USER": "${DB_USER}", "BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}", "OPENCLAW_LOG_LEVEL": "debug", "OPENCLAW_STATE_DIR": "/by/.openclaw", "DATACLOUD_DB_SCHEMA": "${DB_SCHEMA}", "DATACLOUD_DB_DATABASE": "${DB_DATABASE}", "DATACLOUD_DB_PASSWORD": "${DB_PASS}", "GBRAIN_EMBEDDING_MODEL": "openai:text-embedding-v4", "OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}", "GBRAIN_EMBEDDING_DIMENSIONS": "1024", "FILE_STORAGE_MINIO_MOUNT_PATH": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "OPENCLAW_GATEWAY_STARTUP_TRACE": "1", "BYCLAW_SANDBOX_FILE_VOLUME_ROOT": "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"}, "image": "192.168.0.158:8080/dmcit2024/ui-agent-jarvis:github_openclaw_novnc_2026.6.6-20260624154256", "ports": [{"port": 8080, "instance": "openclaw", "protocol": "http"}, {"port": 8081, "instance": "vnc", "protocol": "http"}, {"port": 8082, "instance": "filebrowser", "protocol": "http"}, {"port": 9222, "protocol": "http"}, {"port": 5901, "protocol": "http"}, {"port": 18789, "protocol": "http"}], "startup": {"entrypoint": ["/app/start-all.sh"]}, "volumes": [{"key": "base", "scope": "PRIVATE", "subPath": "byclaw-${user_code}/by", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/by"}, {"scope": "PUBLIC", "subPath": "byclaw-${user_code}/by/.uiagent/logs", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/var/log/supervisor"}, {"scope": "PUBLIC", "subPath": "byclaw-${user_code}/by/.uiagent/faiss_data", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/app/ui_recog_faiss/faiss_data"}], "bootstrap": {"copyTemplate": {"copyIfMissing": true, "targetVolumeKey": "base"}}, "sandboxType": "byclaw", "servicePort": 8080, "resourceLimits": {"cpu": "2", "memory": "4Gi"}}',
    '{"mcp": {"servers": {"env": {"GBRAIN_HOME": "/by/.openclaw/gbrain"}, "gbrain": {"args": ["serve"], "command": "gbrain"}}}, "meta": {"lastTouchedAt": "2026-03-27T08:46:51.148Z", "lastTouchedVersion": "2026.3.28"}, "hooks": {"internal": {"enabled": true, "entries": {"boot-md": {"enabled": false}, "session-memory": {"enabled": true}}}}, "tools": {"web": {"search": {"enabled": false}}, "profile": "full"}, "agents": {"list": [{"id": "main", "skills": [], "default": true, "workspace": "${OPENCLAW_STATE_DIR}/workspace"}, {"id": "ui-skill-tester", "name": "UI技能测试", "identity": {"name": "UI技能测试"}, "workspace": "/by/.openclaw/workspace-ui-skill-tester"}, {"id": "ui-skill-creator", "name": "UI技能创建", "model": {"primary": "byclaw/kimi-k2.6"}, "tools": {"deny": ["image", "image_generate", "music_generate", "video_generate", "tts", "canvas", "browser", "agents_list", "update_plan", "code_execution", "cron", "sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "sessions_yield", "subagents", "session_status", "exec", "x_search", "process", "nodes", "gateway", "message", "write", "edit", "memory_search", "memory_get"], "profile": "full", "alsoAllow": ["ui-skill-modeler", "jarvis_run_flow", "read"]}, "identity": {"name": "UI技能创建"}, "workspace": "/by/.openclaw/workspace-ui-skill-creator"}], "defaults": {"model": {"primary": "byclaw/${MODEL_ID}"}, "models": {"byclaw/kimi-k2.5": {"alias": "kimi-k2.5"}}, "subagents": {"maxConcurrent": 8}, "compaction": {"mode": "safeguard"}, "maxConcurrent": 4, "skipBootstrap": true, "verboseDefault": "full", "thinkingDefault": "high", "bootstrapMaxChars": 15000, "blockStreamingBreak": "text_end", "blockStreamingDefault": "on"}}, "models": {"providers": {"byclaw": {"api": "openai-completions", "apiKey": "${MODEL_API_KEY}", "models": [{"id": "${MODEL_ID}", "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "name": "${MODEL_NAME}", "input": ["text"], "maxTokens": 8192, "reasoning": true, "contextWindow": 128000}, {"id": "kimi-k2.5", "api": "openai-completions", "cost": {"input": 4, "output": 21, "cacheRead": 0.7, "cacheWrite": 0}, "name": "kimi-k2.5", "input": ["text", "image"], "maxTokens": 32000, "reasoning": true, "contextWindow": 256000}], "baseUrl": "${MODEL_BASE_URL}"}}}, "skills": {"load": {"watch": true, "watchDebounceMs": 5000}, "install": {"nodeManager": "pnpm"}}, "wizard": {"lastRunAt": "2026-02-03T07:41:55.092Z", "lastRunMode": "local", "lastRunCommand": "configure", "lastRunVersion": "2026.1.30"}, "browser": {"enabled": true, "headless": false, "profiles": {"work": {"color": "#0066CC", "cdpPort": 18801}, "chrome": {"color": "#00AA00", "cdpUrl": "http://127.0.0.1:18792"}, "openclaw": {"color": "#FF4500", "cdpUrl": "http://localhost:9222"}}, "attachOnly": false, "ssrfPolicy": {"dangerouslyAllowPrivateNetwork": true}, "defaultProfile": "openclaw", "executablePath": "/usr/bin/google-chrome"}, "gateway": {"auth": {"mode": "token", "token": "${OPENCLAW_GATEWAY_TOKEN}"}, "bind": "lan", "mode": "local", "port": 8080, "nodes": {"browser": {"mode": "off"}}, "controlUi": {"allowedOrigins": ["*"], "allowInsecureAuth": true, "dangerouslyDisableDeviceAuth": true, "dangerouslyAllowHostHeaderOriginFallback": true}, "tailscale": {"mode": "off", "resetOnExit": false}}, "plugins": {"load": {"paths": ["/app/dist-runtime/extensions/baiying-enhance", "/app/dist-runtime/extensions/byai-channel", "/app/dist-runtime/extensions/byclaw-sqlite", "/app/custom-plugins/foundry", "/app/custom-plugins/runtime"]}, "allow": ["browser", "byai-channel", "baiying-enhance", "byclaw-sqlite", "diagnostics-otel", "memory-core", "ui-skill-foundry", "pincer-runtime"], "slots": {"memory": "none", "contextEngine": "modeler-image-cleaner"}, "enabled": true, "entries": {"xai": {"enabled": false}, "browser": {"enabled": true}, "byai-channel": {"enabled": true}, "byclaw-sqlite": {"enabled": true}, "pincer-runtime": {"config": {"identifyPageUrl": "http://127.0.0.1:8005"}, "enabled": true}, "baiying-enhance": {"config": {"watchDebounceMs": 500, "mainParentAgentId": "main", "workspaceAutoSeed": true, "embedApiKeysFromJson": true, "mergeAllowSpawnForMain": true}, "enabled": true}, "diagnostics-otel": {"enabled": true}, "ui-skill-foundry": {"config": {"identifyPageUrl": "http://127.0.0.1:8005"}, "enabled": true}}}, "channels": {"byai-channel": {"enabled": true, "dmPolicy": "open", "allowFrom": ["*"], "webhookPath": "/webhook/byai-channel", "streamEnabled": true, "blockStreaming": true, "sessionKeyPerSessionId": true}}, "commands": {"native": "auto", "restart": true, "nativeSkills": "auto", "ownerDisplay": "raw"}, "diagnostics": {"otel": {"logs": false, "traces": true, "enabled": true, "headers": {"Authorization": "Basic cGstbGYtMmVlYzQ2YTUtMWZiZi00MDNiLWI0NzAtMTlkMjdlZmZlNDRlOnNrLWxmLTc3MDc4MjE1LTg5YmQtNDViNy1hZmIyLWUyYjEzZjc5YWYxMw==", "x-langfuse-ingestion-version": "4"}, "metrics": false, "endpoint": "https://us.cloud.langfuse.com/api/public/otel", "protocol": "http/protobuf", "sampleRate": 1, "serviceName": "openclaw-gateway", "captureContent": {"enabled": true, "toolInputs": true, "toolOutputs": true, "systemPrompt": true, "inputMessages": true, "outputMessages": true, "toolDefinitions": true}, "flushIntervalMs": 5000}, "enabled": true}}',
    '2026-06-17 17:57:57.666');

delete from byai.byai_system_config where param_code in('OPENCLAW_BUNDLED_SKILLS');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (nextval('byai.seq_any_table'), 'text', 'OPENCLAW_BUNDLED_SKILLS', 'OpenClaw内置Skill清单', 'OPENCLAW_BUNDLED_SKILLS', '[{
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
		"skillDescEn": "Delegate coding tasks to Codex, Claude Code, OpenCode, or Pi agents via immediate background processes. Use when: (1) building or creating features/apps, (2) reviewing PRs in a temp clone/worktree, (3) refactoring large codebases, (4) iterative coding that needs file exploration. NOT for: simple one-line fixes (just edit), reading code (use read tool), thread-bound ACP harness requests in chat (use sessions_spawn with runtime:\\"acp\\"), or any work in ~/clawd workspace (never spawn agents here). All coding-agent runs start with background:true immediately. Claude Code: use --print --permission-mode bypassPermissions (no PTY). Codex/Pi/OpenCode: pty:true required. Completion notification must use openclaw message send, not system event/heartbeat."
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
		"skillName": "gbrain",
		"skillCode": "gbrain",
		"skillDescZh": "为AI智能体提供持久化长期记忆、知识图谱构建与混合检索服务，支持知识存储、关联分析与智能查询。",
		"skillDescEn": "Provide AI agents with persistent long-term memory, knowledge graph construction and hybrid search, supporting knowledge storage, correlation analysis and intelligent query."
	},
	{
		"skillName": "bycli",
		"skillCode": "bycli",
		"skillDescZh": "bycli 是一个全能力技能，把任意网站、桌面应用或外部 CLI 统一成 bycli <site>无需爬页面就能执行命令、驱动浏览器、修复或编写适配器、并将采集内容入库",
		"skillDescEn": "bycli is an all-in-one skill that unifies any website, desktop app, or external CLI into a single bycli ‹ site> <command> interface, letting an agent run commands, drive the browser, fix or author adapters, and ingest collected content into a knowledge base without"
	}
]', 'OpenClaw 仓库 skills/ 目录下内置（随安装分发）的 Agent Skill 元数据 JSON 数组');


-- 平台内置技能初始化start
delete from ss_resource where resource_biz_type in('SKILL') and resource_id in (select resource_id from byai.ss_res_ext_skill WHERE skill_type in('inner'));

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(1,'BYAI','SKILL','ATOM','内容转大纲','把任意内容（网页链接、文章、关键词）整理成一份结构化的播客视频大纲，是制作播客视频的第一步，后续的幻灯片和对话脚本都从这份大纲生成，保证两者内容一致。只要用户想制作播客视频、把文章变成视频、做一期播客、先规划内容结构，或者说"做个大纲"、"做播客"、"把这篇文章做成播客"，就必须触发此技能——即使用户没有提到"大纲"，只要目标是制作播客视频就要触发。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'podcast-outline',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(2,'BYAI','SKILL','ATOM','技术文章生成','技术内容创作技能。输入GitHub开源项目链接，输出一篇可直接发布的技术评测文章，包含项目介绍、安装步骤、功能演示、性能对比和适用场景分析。适用于技术公众号推文、项目推荐、开源社区内容运营。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'tech-article',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(3,'BYAI','SKILL','ATOM','播客视频合成','播客视频成片技能。输入已制作好的幻灯片和播客音频，输出带字幕的专业播客视频，画面与语音自动同步切换。适用于播客视频最终成片、培训视频制作、知识分享视频生成。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'podcast-video',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(4,'BYAI','SKILL','ATOM','视频合成','播客配音技能。输入播客对话脚本，输出双人对话风格的专业播客音频，支持主持人和嘉宾双角色配音，附带精确的时间轴信息。适用于播客音频制作、有声内容生成、视频配音。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'podcast-voice',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(5,'BYAI','SKILL','ATOM','播客脚本生成','播客脚本创作技能。输入任意主题或内容素材，输出自然流畅的双人对话式播客脚本，包含角色分配、对话轮次和情感标注。适用于播客内容创作、对话式知识分享、访谈脚本撰写。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'podcast-script',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(6,'BYAI','SKILL','ATOM','幻灯片生成','演示文稿生成技能。输入播客大纲或内容主题，输出专业排版的演示文稿（PPT），包含封面、目录、内容页和总结页。适用于播客视频配图、工作汇报、产品发布、培训课件制作。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'slide-dec',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(7,'BYAI','SKILL','ATOM','非结构化本体管理','文档智能检索技能。输入知识库中的文档、图片、视频等非结构化内容，输出带结构化标签的可检索知识资产，支持按日期、主题、参会人等维度精准查找。适用于会议纪要管理、周报归档、项目文档检索、合同文件分类。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'unstructured-ontology-manager',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(8,'BYAI','SKILL','ATOM','结构化本体管理','业务数据管理技能。输入自然语言描述的业务需求，输出专属的数据管理对象和查询视图，支持自定义字段和跨表关联。适用于客户管理、任务跟踪、拜访记录、项目台账等自定义业务场景。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'structured-ontology-manager',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(9,'BYAI','SKILL','ATOM','CRM演示案例','平台能力演示技能。输入"给我演示"或指定演示场景，输出CRM场景的完整能力演示，包含自然语言查询、统计分析、数据录入、文档检索等核心功能展示。适用于产品演示、新员工培训、客户方案介绍。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'crm-demo-showcase',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(10,'BYAI','SKILL','ATOM','GitHub事务管理','研发任务管理技能。输入需求描述或任务清单，输出整理好的研发任务列表并自动同步到项目管理平台，支持任务状态追踪和进度看板。适用于需求拆解、Bug跟踪、迭代规划、任务分配。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'github-issues-mgmt',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(11,'BYAI','SKILL','ATOM','GitHub代码分析','代码质量审查技能。输入代码仓库或代码改动，输出包含安全漏洞、性能问题、代码规范、风格一致性等方面的审查报告和改进建议。适用于代码评审、安全审计、技术债务评估、团队代码规范检查。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'github-code-analysis',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(12,'BYAI','SKILL','ATOM','浩鲸百应技能市场浏览','技能市场浏览技能。输入关键词或技能需求，输出匹配的技能资源列表，包含技能名称、功能说明、适用场景和安装指引。适用于发现新能力、技能对比选型、能力扩展。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'iwhalehub',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(13,'BYAI','SKILL','ATOM','知识记忆管理','知识记忆管理技能。输入需要记录的项目背景、决策过程或人物关系，输出结构化的长期记忆资产，支持全文检索和智能关联。适用于项目经验沉淀、历史决策追溯、团队知识传承、个人知识库建设。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'gbrain',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(14,'BYAI','SKILL','ATOM','知识采集','网络内容采集技能。输入任意网站链接或应用名称，输出结构化的采集内容，支持网页信息抓取、应用数据提取和内容归档入库。适用于竞品信息收集、行业动态追踪、资料批量采集、内容聚合。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'bycli',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(15,'BYAI','SKILL','ATOM','钉钉连接器','钉钉协同办公技能。输入办公事务指令，输出钉钉平台上的待办、审批、日程、文档等协同操作结果。适用于待办同步、会议安排、审批流程、团队文档协作、考勤管理。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'dws',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource(resource_id,system_code,resource_biz_type,resource_type,resource_name,resource_desc,resource_version_id,host_type,catalog_id,man_org_id,man_user_id,create_by,create_time,update_by,update_time,com_acct_id,resource_status,resource_d_verid,resource_r_verid,resource_code,publish_time,auth_status,publish_portal,parent_resource_id,publish_type,owner_type,impl_type,worker_agent_type)
VALUES(16,'BYAI','SKILL','ATOM','可视化报告生成','数据可视化报告技能。输入各类经营数据（表格、文本、API数据），输出专业的交互式数据分析报告，包含智能图表、地图点位展示、KPI看板和经营建议，支持导出PDF。适用于经营分析、选址评估、竞品对比、数据汇报、商圈研究。','1.0','hosted',10,-1,10001,10001,CURRENT_TIMESTAMP,10001,CURRENT_TIMESTAMP,1,2,-1,-1,'amap-visual-report-generator',CURRENT_TIMESTAMP,'passed',1,-1,'publish','enterprise','SKILL','NONE');

INSERT INTO byai.ss_resource (resource_id, system_code, resource_source_pk_id, resource_biz_type, resource_type, resource_name, resource_desc, avatar, sample, tags, resource_version_id, host_type, catalog_id, man_org_id, man_user_id, index_list, create_by, create_time, update_by, update_time, com_acct_id, resource_status, resource_d_verid, resource_r_verid, resource_code, publish_time, shelf_time, unshelf_time, auth_status, publish_portal, parent_resource_id, publish_type, owner_type, impl_type, worker_agent_type)
VALUES (17, 'BYAI', null, 'SKILL', 'ATOM', '可视化技能锻造工坊', '可视化 UI 技能锻造工坊，提供拖拽式低代码工作台，支持可视化配置技能入参表单、编排执行流程，可录制业务操作自动生成标准化 OpenClaw 技能包，内置预览沙箱调试，一键打包部署带前端交互面板的自定义技能，面向业务运营快速搭建可视化操作类数字员工能力，区别于纯代码生成的基础 skill-foundry，专注产出带 UI 交互表单的业务工具技能', null, null, null, '1.0', 'hosted', 10, -1, '10001', null, 10001, '2026-06-29 08:38:43.079632', 10001, '2026-06-29 08:38:43.079632', 1, 2, -1, -1, 'ui-skill-foundry', '2026-06-29 08:38:43.079632', null, null, 'passed', 1, -1, 'publish', 'enterprise', 'SKILL', 'NONE');

INSERT INTO byai.ss_resource (resource_id, system_code, resource_source_pk_id, resource_biz_type, resource_type, resource_name, resource_desc, avatar, sample, tags, resource_version_id, host_type, catalog_id, man_org_id, man_user_id, index_list, create_by, create_time, update_by, update_time, com_acct_id, resource_status, resource_d_verid, resource_r_verid, resource_code, publish_time, shelf_time, unshelf_time, auth_status, publish_portal, parent_resource_id, publish_type, owner_type, impl_type, worker_agent_type)
VALUES (18, 'BYAI', null, 'SKILL', 'ATOM', '知识库管理', '通过知识管理器CLI管理知识库内容。当代理或用户需要操作知识库时使用：列出/创建/重命名/删除目录，检查上传冲突，上传或覆盖文件，触发或检查构建，下载文件或目录存档，读取文件行范围，移除文件，或在一个或多个知识库资源ID上运行语义块搜索', null, null, null, '1.0', 'hosted', 10, -1, '10001', null, 10001, '2026-06-29 08:38:43.079632', 10001, '2026-06-29 08:38:43.079632', 1, 2, -1, -1, 'by-knowledge-manager', '2026-06-29 08:38:43.079632', null, null, 'passed', 1, -1, 'publish', 'enterprise', 'SKILL', 'NONE');

-- inner来源技能(1~16)
DELETE from byai.ss_res_ext_skill WHERE skill_type in('inner');
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(1,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(2,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(3,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(4,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(5,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(6,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(7,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(8,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(9,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(10,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(11,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(12,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(13,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(14,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(15,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(16,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO byai.ss_res_ext_skill(resource_id,skill_type,source_type,version,skill_url,skill_package_format,skill_original_filename,skill_package_size,skill_package_hash,sync_status,sync_error,last_sync_time) VALUES(17,'inner','SYSTEM_BUILTIN','v0.1','','zip',NULL,NULL,NULL,'SUCCESS',NULL,CURRENT_TIMESTAMP);
INSERT INTO ss_res_ext_skill (resource_id, skill_type, source_type, version, skill_url, skill_package_format, skill_original_filename, skill_package_size, skill_package_hash, target_content, sync_status, sync_error, last_sync_time) VALUES (18, 'inner', 'SYSTEM_BUILTIN', 'v0.1', null, 'zip', null, null, null, '{"resourceId" : 17, "resourceCode" : "ui-skill-foundry", "resourceName" : "可视化技能锻造工坊", "resourceDesc" : "可视化 UI 技能锻造工坊，提供拖拽式低代码工作台，支持可视化配置技能入参表单、编排执行流程，可录制业务操作自动生成标准化 OpenClaw 技能包，内置预览沙箱调试，一键打包部署带前端交互面板的自定义技能，面向业务运营快速搭建可视化操作类数字员工能力，区别于纯代码生成的基础 skill-foundry，专注产出带 UI 交互表单的业务工具技能", "resourceBizType" : "SKILL", "resourceType" : "ATOM", "ownerType" : "enterprise", "sourceType" : "SYSTEM_BUILTIN", "skillType" : "inner", "skillUrl" : null, "version" : "v0.1", "skillPackageFormat" : "zip", "skillOriginalFilename" : null, "skillPackageSize" : null, "skillPackageHash" : null, "syncStatus" : "SUCCESS", "syncError" : null, "lastSyncTime" : "2026-06-29 08:41:50"}', 'SUCCESS', null, '2026-06-29 08:41:50.535212');

-- 第四步：更新已存在的扩展表记录（直接关联主表获取种子数据，避免 CTE 作用域问题）
UPDATE byai.ss_res_ext_skill e
SET
    skill_type = 'inner',
    source_type = 'SYSTEM_BUILTIN',
    version = COALESCE(NULLIF(e.version, ''), 'v0.1'),
    skill_url = '',
    skill_package_format = 'zip',
    skill_original_filename = NULL,
    skill_package_size = NULL,
    skill_package_hash = NULL,
    target_content = json_build_object(
        'resourceId', r.resource_id,
        'resourceCode', r.resource_code,
        'resourceName', r.resource_name,
        'resourceDesc', r.resource_desc,
        'resourceBizType', r.resource_biz_type,
        'resourceType', r.resource_type,
        'ownerType', r.owner_type,
        'sourceType', 'SYSTEM_BUILTIN',
        'skillType', 'inner',
        'skillUrl', '',
        'version', COALESCE(NULLIF(e.version, ''), 'v0.1'),
        'skillPackageFormat', 'zip',
        'skillOriginalFilename', NULL,
        'skillPackageSize', NULL,
        'skillPackageHash', NULL,
        'syncStatus', 'SUCCESS',
        'syncError', NULL,
        'lastSyncTime', to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
                     )::text,
    sync_status = 'SUCCESS',
    sync_error = NULL,
    last_sync_time = CURRENT_TIMESTAMP
FROM byai.ss_resource r
WHERE e.resource_id = r.resource_id
  AND r.resource_biz_type = 'SKILL'
  AND r.owner_type = 'enterprise'
  AND r.resource_code IN ('podcast-outline','tech-article','podcast-video','podcast-voice','podcast-script','slide-dec','unstructured-ontology-manager','structured-ontology-manager','crm-demo-showcase','github-issues-mgmt','github-code-analysis','iwhalehub','gbrain','bycli','dws','amap-visual-report-generator','ui-skill-foundry','by-knowledge-manager');

-- 沙箱健康检测-默认水位模型初始化
INSERT INTO byai.sandbox_health_watermark_model (
    model_name,
    service_type,
    profile_key,
    enabled,
    priority,
    idle_memory_limit_ratio,
    busy_memory_limit_ratio,
    critical_memory_limit_ratio,
    busy_cpu_request_ratio,
    critical_cpu_request_ratio,
    consecutive_busy_samples,
    recover_samples,
    sample_interval_seconds,
    snapshot_ttl_seconds,
    watch_ttl_seconds,
    remark
)
SELECT
    'Default sandbox health model',
    'default',
    NULL,
    1,
    0,
    0.55,
    0.75,
    0.88,
    1.00,
    1.80,
    2,
    2,
    30,
    120,
    90,
    'Fallback model used when no service/profile model exists.'
FROM (SELECT 1) seed
WHERE NOT EXISTS (
    SELECT 1
    FROM byai.sandbox_health_watermark_model
    WHERE service_type = 'default'
      AND COALESCE(profile_key, '') = ''
      AND enabled = 1
);

-- 沙箱健康检测-OpenClaw服务规格水位模型初始化
WITH desired_models (
    profile_key,
    model_name,
    priority,
    idle_memory_limit_ratio,
    busy_memory_limit_ratio,
    critical_memory_limit_ratio,
    busy_cpu_request_ratio,
    critical_cpu_request_ratio,
    consecutive_busy_samples,
    recover_samples,
    sample_interval_seconds,
    snapshot_ttl_seconds,
    watch_ttl_seconds,
    remark
) AS (
    VALUES
        ('xs', 'OpenClaw XS sandbox health model', 100, 0.45, 0.65, 0.78, 0.80, 1.40, 2, 3, 15, 90, 75, 'OpenClaw xs: request 0.25C/765Mi, limit 1C/1.5Gi. Conservative thresholds for small memory containers.'),
        ('s',  'OpenClaw S sandbox health model',  100, 0.50, 0.72, 0.85, 1.00, 1.80, 2, 3, 20, 120, 90, 'OpenClaw s: request 0.5C/1Gi, limit 1.5C/3Gi. Balanced thresholds for standard containers.'),
        ('m',  'OpenClaw M sandbox health model',  100, 0.55, 0.78, 0.90, 1.20, 2.00, 2, 2, 30, 120, 90, 'OpenClaw m: request 1C/2Gi, limit 2C/4Gi. Moderate thresholds for enhanced containers.'),
        ('l',  'OpenClaw L sandbox health model',  100, 0.60, 0.82, 0.92, 1.50, 2.50, 2, 2, 30, 180, 120, 'OpenClaw l: request 2.5C/6Gi, limit 4C/8Gi. Wider thresholds for high performance containers.')
),
available_models AS (
    SELECT d.*
    FROM desired_models d
    WHERE EXISTS (
        SELECT 1
        FROM byai.sandbox_service_profile p
        WHERE p.service_type = 'openclaw'
          AND p.profile_key = d.profile_key
          AND p.enabled = 1
    )
),
target_models AS (
    SELECT
        a.*,
        (
            SELECT m.id
            FROM byai.sandbox_health_watermark_model m
            WHERE m.service_type = 'openclaw'
              AND COALESCE(m.profile_key, '') = a.profile_key
            ORDER BY m.enabled DESC, m.priority DESC, m.id ASC
            LIMIT 1
        ) AS target_id
    FROM available_models a
)
UPDATE byai.sandbox_health_watermark_model m
SET model_name = t.model_name,
    enabled = 1,
    priority = t.priority,
    idle_memory_limit_ratio = t.idle_memory_limit_ratio,
    busy_memory_limit_ratio = t.busy_memory_limit_ratio,
    critical_memory_limit_ratio = t.critical_memory_limit_ratio,
    busy_cpu_request_ratio = t.busy_cpu_request_ratio,
    critical_cpu_request_ratio = t.critical_cpu_request_ratio,
    consecutive_busy_samples = t.consecutive_busy_samples,
    recover_samples = t.recover_samples,
    sample_interval_seconds = t.sample_interval_seconds,
    snapshot_ttl_seconds = t.snapshot_ttl_seconds,
    watch_ttl_seconds = t.watch_ttl_seconds,
    remark = t.remark,
    updated_at = CURRENT_TIMESTAMP
FROM target_models t
WHERE m.id = t.target_id;

WITH desired_models (
    profile_key,
    model_name,
    priority,
    idle_memory_limit_ratio,
    busy_memory_limit_ratio,
    critical_memory_limit_ratio,
    busy_cpu_request_ratio,
    critical_cpu_request_ratio,
    consecutive_busy_samples,
    recover_samples,
    sample_interval_seconds,
    snapshot_ttl_seconds,
    watch_ttl_seconds,
    remark
) AS (
    VALUES
        ('xs', 'OpenClaw XS sandbox health model', 100, 0.45, 0.65, 0.78, 0.80, 1.40, 2, 3, 15, 90, 75, 'OpenClaw xs: request 0.25C/765Mi, limit 1C/1.5Gi. Conservative thresholds for small memory containers.'),
        ('s',  'OpenClaw S sandbox health model',  100, 0.50, 0.72, 0.85, 1.00, 1.80, 2, 3, 20, 120, 90, 'OpenClaw s: request 0.5C/1Gi, limit 1.5C/3Gi. Balanced thresholds for standard containers.'),
        ('m',  'OpenClaw M sandbox health model',  100, 0.55, 0.78, 0.90, 1.20, 2.00, 2, 2, 30, 120, 90, 'OpenClaw m: request 1C/2Gi, limit 2C/4Gi. Moderate thresholds for enhanced containers.'),
        ('l',  'OpenClaw L sandbox health model',  100, 0.60, 0.82, 0.92, 1.50, 2.50, 2, 2, 30, 180, 120, 'OpenClaw l: request 2.5C/6Gi, limit 4C/8Gi. Wider thresholds for high performance containers.')
)
INSERT INTO byai.sandbox_health_watermark_model (
    model_name,
    service_type,
    profile_key,
    enabled,
    priority,
    idle_memory_limit_ratio,
    busy_memory_limit_ratio,
    critical_memory_limit_ratio,
    busy_cpu_request_ratio,
    critical_cpu_request_ratio,
    consecutive_busy_samples,
    recover_samples,
    sample_interval_seconds,
    snapshot_ttl_seconds,
    watch_ttl_seconds,
    remark
)
SELECT
    d.model_name,
    'openclaw',
    d.profile_key,
    1,
    d.priority,
    d.idle_memory_limit_ratio,
    d.busy_memory_limit_ratio,
    d.critical_memory_limit_ratio,
    d.busy_cpu_request_ratio,
    d.critical_cpu_request_ratio,
    d.consecutive_busy_samples,
    d.recover_samples,
    d.sample_interval_seconds,
    d.snapshot_ttl_seconds,
    d.watch_ttl_seconds,
    d.remark
FROM desired_models d
WHERE EXISTS (
    SELECT 1
    FROM byai.sandbox_service_profile p
    WHERE p.service_type = 'openclaw'
      AND p.profile_key = d.profile_key
      AND p.enabled = 1
)
  AND NOT EXISTS (
      SELECT 1
      FROM byai.sandbox_health_watermark_model m
      WHERE m.service_type = 'openclaw'
        AND COALESCE(m.profile_key, '') = d.profile_key
  );

COMMIT;
---平台内置技能初始化------end-----


UPDATE byai.byai_aimodel SET owner_type = 'PUBLIC' WHERE owner_type IS NULL;

-- Token 月度限额 & tokenSaver 配置（合并为单个 JSON key）
DELETE FROM byai.byai_system_config WHERE param_code IN ('MODEL_QUOTA');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'json', 'MODEL_QUOTA', '模型额度与tokenSaver配置', 'MODEL_QUOTA',
'{"monthlyQuotaLimit":30000000,"tokenSaver":{"enabled":false,"apiUrl":"","modelCode":""}}',
'monthlyQuotaLimit: 每用户每月公共模型Token上限; tokenSaver: 登录时自动分配模型配置');
