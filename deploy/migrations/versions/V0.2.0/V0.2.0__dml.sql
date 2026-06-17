<<<<<<< Updated upstream
UPDATE byai.sandbox_service_spec SET template_json = '{"mcp": {"servers": {"env": {"GBRAIN_HOME": "/by/.openclaw/gbrain"}, "gbrain": {"args": ["serve"], "command": "gbrain"}}}, "meta": {"lastTouchedAt": "2026-03-27T08:46:51.148Z", "lastTouchedVersion": "2026.3.28"}, "hooks": {"internal": {"enabled": true, "entries": {"boot-md": {"enabled": false}, "session-memory": {"enabled": true}}}}, "tools": {"web": {"search": {"enabled": false}}, "profile": "full"}, "agents": {"list": [{"id": "main", "skills": [], "default": true, "workspace": "${OPENCLAW_STATE_DIR}/workspace"}], "defaults": {"model": {}, "models": {}, "subagents": {"maxConcurrent": 8}, "compaction": {"mode": "safeguard"}, "maxConcurrent": 4, "skipBootstrap": true, "verboseDefault": "full", "thinkingDefault": "high", "blockStreamingBreak": "text_end", "blockStreamingDefault": "on"}}, "models": {"providers": {}}, "skills": {"load": {"watch": true, "watchDebounceMs": 5000}, "install": {"nodeManager": "pnpm"}}, "wizard": {"lastRunAt": "2026-02-03T07:41:55.092Z", "lastRunMode": "local", "lastRunCommand": "configure", "lastRunVersion": "2026.1.30"}, "browser": {"enabled": true, "headless": false, "profiles": {"openclaw": {"color": "#4F7FFF", "driver": "openclaw", "cdpPort": 9222, "headless": false, "executablePath": "/usr/bin/chromium"}}, "extraArgs": ["--load-extension=/opt/opencli/extension", "--disable-extensions-except=/opt/opencli/extension", "--disable-dev-shm-usage", "--window-size=1365,768", "--display=:99"], "noSandbox": true, "ssrfPolicy": {"allowedHostnames": ["localhost", "127.0.0.1"]}, "defaultProfile": "openclaw", "executablePath": "/usr/bin/chromium", "localLaunchTimeoutMs": 60000, "localCdpReadyTimeoutMs": 60000}, "gateway": {"auth": {"mode": "token", "token": "${OPENCLAW_GATEWAY_TOKEN}"}, "bind": "lan", "mode": "local", "port": 18789, "controlUi": {"allowedOrigins": ["*"], "allowInsecureAuth": true, "dangerouslyDisableDeviceAuth": true, "dangerouslyAllowHostHeaderOriginFallback": true}, "tailscale": {"mode": "off", "resetOnExit": false}}, "logging": {"file": "/by/.openclaw/logs/openclaw.log", "level": "info", "maxFileBytes": 104857600}, "plugins": {"load": {"paths": ["/app/dist-runtime/extensions/baiying-enhance", "/app/dist-runtime/extensions/byai-channel", "/app/dist-runtime/extensions/byclaw-sqlite"]}, "allow": ["browser", "byai-channel", "baiying-enhance", "byclaw-sqlite", "diagnostics-otel"], "slots": {"memory": "none"}, "enabled": true, "entries": {"xai": {"enabled": false}, "browser": {"enabled": true}, "byai-channel": {"enabled": true, "hooks": {"allowConversationAccess": true}}, "byclaw-sqlite": {"enabled": true}, "baiying-enhance": {"config": {"watchDebounceMs": 500, "mainParentAgentId": "main", "workspaceAutoSeed": true, "embedApiKeysFromJson": true, "mergeAllowSpawnForMain": true}, "enabled": true}, "diagnostics-otel": {"enabled": false}, "byai_diagnostics-otel": {"enabled": true}}}, "channels": {"byai-channel": {"enabled": true, "dmPolicy": "open", "allowFrom": ["*"], "webhookPath": "/webhook/byai-channel", "streamEnabled": true, "blockStreaming": true, "sessionKeyPerSessionId": true}}, "commands": {"native": "auto", "restart": true, "nativeSkills": "auto", "ownerDisplay": "raw"}, "diagnostics": {"otel": {"logs": false, "traces": true, "enabled": true, "headers": {"Authorization": "Basic ${LANGFUSE_OTEL_AUTH_SECRET}", "x-langfuse-ingestion-version": "4"}, "metrics": false, "endpoint": "${LANGFUSE_BASE_URL}/api/public/otel", "protocol": "http/protobuf", "sampleRate": 1, "serviceName": "openclaw-gateway", "captureContent": {"enabled": true, "toolInputs": true, "toolOutputs": true, "systemPrompt": true, "inputMessages": true, "outputMessages": true, "toolDefinitions": true}, "flushIntervalMs": 5000}, "enabled": true}}' WHERE service_key = 'openclaw';

update byai_aimodel set model_protocol ='OpenAI' where model_type ='LLM' and model_protocol is null and url not like '%anthropic%';
update byai_aimodel set model_protocol ='Anthropic' where model_type ='LLM' and model_protocol is null and url like '%anthropic%';

delete from byai.byai_system_config where param_code in('INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc) VALUES (nextval('byai.seq_any_table'), 'json', 'INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE', '用户登陆初始数字员工助手模板', 'INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE', '{
	"zh_CN": [
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}的超级助手",
			"resourceDesc": "${userName}的超级助手，通用全能型数字员工，覆盖日常问答、资料处理、代码辅助、知识检索、本体建模全场景通用支撑",
			"catalogId": 0,
			"resourceCode": "${userCode}_main",
			"publishingPortal": 1,
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "知识库,知识开发,文档整理,故障排查",
			"skills": "[\\"dws\\"]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"通用全能支撑\\",\\"description\\":\\"全业务场景无边界辅助，兼容知识、技能、本体开发各类任务\\",\\"acceptBoundary\\":[\\"全部业务咨询\\",\\"文档处理\\",\\"代码调试\\",\\"知识库搭建\\",\\"本体建模\\"],\\"rejectBoundary\\":[],\\"example\\":[\\"日常业务问答\\",\\"多类型文档解析\\",\\"多场景工具调用辅助\\"]}]",
			"openSuperHelper": "Y",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}的超级助手\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"全能通用助手，响应各类需求，无场景限制\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"兼容平台全部内置工具接口\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"关联个人全量知识库会话记忆\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		},
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}的知识开发助手",
			"resourceDesc": "${userName}的知识开发助手，面向个人知识建设与数字员工知识调试的专属助手，负责协助用户规划知识库结构、整理上传文档、生成FAQ/术语、诊断知识库上传与构建问题，并把零散资料逐步沉淀成可被数字员工稳定调用的高质量知识资产",
			"catalogId": 0,
			"resourceCode": "${userCode}_KwDevAsst",
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "知识库,知识开发,文档整理,故障排查",
			"skills": "[]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"知识库全生命周期管理\\",\\"description\\":\\"提供知识库规划、资料整理、知识生成、上传构建、检索调试、故障排查全流程服务\\",\\"acceptBoundary\\":[\\"知识库结构规划\\",\\"原始文档标准化整理\\",\\"FAQ/术语/元数据提取\\",\\"上传/构建/检索异常排查\\",\\"知识库权限与资源管理\\"],\\"rejectBoundary\\":[\\"技能代码开发\\",\\"本体图谱建模\\",\\"非知识库相关业务咨询\\"],\\"example\\":[\\"根据业务场景搭建知识库目录\\",\\"解析Markdown/网页生成导入素材\\",\\"解决MinIO/QA服务上传报错\\",\\"优化知识库检索召回精度\\"]}]",
			"openSuperHelper": "N",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}的知识开发助手\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"专业知识库建设专家，步骤导向、操作优先，操作前提醒资源归属与风险\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"优先调用OpenCLI、Gbrain、嘉朗知识库接口处理知识任务\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"绑定个人默认知识库，留存知识库调试会话记录\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		},
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}的本体开发助手",
			"resourceDesc": "${userName}的本体开发助手，专注知识图谱、实体关系、本体模型搭建与调试，辅助用户完成本体定义、实体抽取、关系关联、图谱校验、本体构建故障排查工作",
			"catalogId": 0,
			"resourceCode": "${userCode}_OntologyDevAsst",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "本体开发,知识图谱,实体关系,图谱建模",
			"skills": "[]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"知识图谱本体建模\\",\\"description\\":\\"本体设计、实体抽取、关系构建、图谱校验、本体构建排错全流程辅助\\",\\"acceptBoundary\\":[\\"本体概念设计\\",\\"实体/属性/关系抽取\\",\\"图谱双向关联配置\\",\\"本体导入校验\\",\\"图谱检索异常排查\\"],\\"rejectBoundary\\":[\\"代码技能开发\\",\\"文档知识库搭建\\",\\"通用日常问答\\"],\\"example\\":[\\"基于业务文档抽取实体关系\\",\\"修正图谱双向链接失效问题\\",\\"设计领域本体分层结构\\"]}]",
			"openSuperHelper": "N",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}的本体开发助手\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"知识图谱建模专家，逻辑严谨，优先输出可落地本体结构方案\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"调用平台图谱本体相关接口完成实体、关系操作\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"存储历史本体模型、实体关系会话记录\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		},
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}的技能开发助手",
			"resourceDesc": "${userName}的技能开发助手codeagent，基于Anthropic模型，专注技能代码编写、脚本调试、接口开发、Agent工具函数开发、代码报错排查、技能流程编排",
			"catalogId": 0,
			"resourceCode": "${userCode}_SkillDevAsst",
			"publishingPortal": 1,
			"parentResourceId": "-1",
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "Anthropic",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "codeagent,技能开发,代码编写,脚本调试,Anthropic",
			"skills": "[]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"数字员工技能代码开发\\",\\"description\\":\\"基于Anthropic模型提供代码编写、脚本调试、工具接口封装、技能排错、流程编排服务\\",\\"acceptBoundary\\":[\\"多语言脚本编写\\",\\"Agent自定义技能开发\\",\\"编译/运行报错排查\\",\\"API接口对接调试\\",\\"Docker构建配置优化\\"],\\"rejectBoundary\\":[\\"知识库文档整理\\",\\"本体图谱建模\\",\\"非代码类业务咨询\\"],\\"example\\":[\\"编写OpenClaw自定义工具脚本\\",\\"修复Rust/Tauri编译异常\\",\\"封装嘉朗知识库调用接口\\"]}]",
			"openSuperHelper": "N",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"工作规范\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}的技能开发助手（codeagent）\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"人格定义\\",\\"key\\":\\"soul\\",\\"value\\":\\"专业全栈开发工程师，代码严谨可执行，报错精准定位并给出修复命令\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"工具规范\\",\\"key\\":\\"tools\\",\\"value\\":\\"优先调用代码运行、编译、接口调试类工具\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"记忆规范\\",\\"key\\":\\"memory\\",\\"value\\":\\"留存历史代码片段、报错日志、技能开发会话\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		}
	],
	"en_US": [
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}\'s Super Assistant",
			"resourceDesc": "${userName}\'s Super Assistant is a universal all-around digital employee. It provides comprehensive support covering daily Q&A, document processing, code assistance, knowledge retrieval and ontology modeling scenarios.",
			"catalogId": 0,
			"resourceCode": "${userCode}_main",
			"publishingPortal": 1,
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "Knowledge Base,Knowledge Development,Document Sorting,Troubleshooting",
			"skills": "[\\"dws\\"]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Universal All-Around Support\\",\\"description\\":\\"Borderless assistance for all business scenarios, compatible with knowledge management, skill development, ontology modeling and other tasks\\",\\"acceptBoundary\\":[\\"All business consultations\\",\\"Document processing\\",\\"Code debugging\\",\\"Knowledge base construction\\",\\"Ontology modeling\\"],\\"rejectBoundary\\":[],\\"example\\":[\\"Daily business Q&A\\",\\"Multi-format document parsing\\",\\"Multi-scenario tool invocation assistance\\"]}]",
			"openSuperHelper": "Y",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specification\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}\'s Super Assistant\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"A versatile general assistant that responds to all demands without scenario limitations\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specification\\",\\"key\\":\\"tools\\",\\"value\\":\\"Compatible with all built-in tool interfaces of the platform\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"Memory Specification\\",\\"key\\":\\"memory\\",\\"value\\":\\"Linked to full session memory of personal knowledge base\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		},
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}\'s Knowledge Development Assistant",
			"resourceDesc": "${userName}\'s Knowledge Development Assistant is a dedicated assistant for personal knowledge construction and digital employee knowledge debugging. It helps users plan knowledge base structure, organize and upload documents, generate FAQs and glossaries, diagnose issues in knowledge base upload and construction, and turn scattered materials into high-quality knowledge assets stably accessible by digital employees.",
			"catalogId": 0,
			"resourceCode": "${userCode}_KwDevAsst",
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "Knowledge Base,Knowledge Development,Document Sorting,Troubleshooting",
			"skills": "[\\"Knowledge Collection (OpenCLI)\\",\\"Knowledge Arrangement (Gbrain)\\",\\"Knowledge Construction (Jialang API)\\"]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Full Lifecycle Knowledge Base Management\\",\\"description\\":\\"End-to-end services including knowledge base planning, document sorting, knowledge generation, upload & construction, retrieval tuning and fault troubleshooting\\",\\"acceptBoundary\\":[\\"Knowledge base structure planning\\",\\"Standardization of raw documents\\",\\"FAQ/Term/Metadata Extraction\\",\\"Upload/Build/Retrieval Exception Troubleshooting\\",\\"Knowledge Base Permission & Resource Management\\"],\\"rejectBoundary\\":[\\"Skill code development\\",\\"Ontology graph modeling\\",\\"Business consultations unrelated to knowledge base\\"],\\"example\\":[\\"Build knowledge base catalogs based on business scenarios\\",\\"Parse Markdown and web pages to generate import materials\\",\\"Resolve MinIO/QA service upload errors\\",\\"Optimize retrieval recall accuracy of knowledge base\\"]}]",
			"openSuperHelper": "N",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specification\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}\'s Knowledge Development Assistant\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"Professional knowledge base construction expert, process-oriented and operation-first; remind resource ownership and risks before executing operations\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specification\\",\\"key\\":\\"tools\\",\\"value\\":\\"Prioritize OpenCLI, Gbrain and Jialang knowledge base APIs for knowledge tasks\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"Memory Specification\\",\\"key\\":\\"memory\\",\\"value\\":\\"Bind user\'s default personal knowledge base and retain knowledge base debugging session records\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		},
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}\'s Ontology Development Assistant",
			"resourceDesc": "${userName}\'s Ontology Development Assistant focuses on knowledge graph, entity relationship and ontology model construction and debugging. It assists users with ontology definition, entity extraction, relationship association, graph verification and troubleshooting ontology building failures.",
			"catalogId": 0,
			"resourceCode": "${userCode}_OntologyDevAsst",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "OpenAI",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "Ontology Development,Knowledge Graph,Entity Relationship,Graph Modeling",
			"skills": "[]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Knowledge Graph Ontology Modeling\\",\\"description\\":\\"Full-process assistance covering ontology design, entity extraction, relationship construction, graph validation and ontology troubleshooting\\",\\"acceptBoundary\\":[\\"Ontology conceptual design\\",\\"Entity/Attribute/Relationship Extraction\\",\\"Bidirectional graph link configuration\\",\\"Ontology import validation\\",\\"Knowledge graph retrieval exception troubleshooting\\"],\\"rejectBoundary\\":[\\"Skill code development\\",\\"Document knowledge base construction\\",\\"General daily Q&A\\"],\\"example\\":[\\"Extract entities and relationships from business documents\\",\\"Fix invalid bidirectional links in knowledge graph\\",\\"Design layered domain ontology structure\\"]}]",
			"openSuperHelper": "N",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specification\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}\'s Ontology Development Assistant\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"Knowledge graph modeling specialist with rigorous logic, prioritizing deliverable and implementable ontology solutions\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specification\\",\\"key\\":\\"tools\\",\\"value\\":\\"Call platform graph and ontology related APIs to operate entities and relationships\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"Memory Specification\\",\\"key\\":\\"memory\\",\\"value\\":\\"Store historical ontology models and entity relationship conversation records\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		},
		{
			"systemCode": "BYAI",
			"resourceBizType": "DIG_EMPLOYEE",
			"resourceType": "COMBIN",
			"resourceName": "${userName}\'s Skill Development Assistant",
			"resourceDesc": "${userName}\'s Skill Development Assistant (codeagent) is built on the Anthropic model. It specializes in skill coding, script debugging, interface development, custom Agent tool function development, code error troubleshooting and skill workflow orchestration.",
			"catalogId": 0,
			"resourceCode": "${userCode}_SkillDevAsst",
			"publishingPortal": 1,
			"parentResourceId": "-1",
			"publishingType": "publish",
			"ownerType": "personal",
			"implType": "ASK_AGENT",
			"workerAgentType": "BYCLAW_EXE",
			"agentType": "001",
			"agentDevType": "byai",
			"modelProtocol": "Anthropic",
			"createType": "FROM_MANUALLY",
			"integrationType": "NONE",
			"terminal": "ALL",
			"tagName": "codeagent,Skill Development,Code Writing,Script Debugging,Anthropic",
			"skills": "[]",
			"coreCompetencies": "[{\\"coreCompetency\\":\\"Digital Employee Skill Code Development\\",\\"description\\":\\"Provide code writing, script debugging, tool interface encapsulation, skill troubleshooting and workflow orchestration services based on Anthropic model\\",\\"acceptBoundary\\":[\\"Multi-language script writing\\",\\"Custom Agent skill development\\",\\"Compilation & runtime error troubleshooting\\",\\"API interface integration debugging\\",\\"Docker build configuration optimization\\"],\\"rejectBoundary\\":[\\"Knowledge base document sorting\\",\\"Ontology graph modeling\\",\\"Non-code business consultation\\"],\\"example\\":[\\"Write custom OpenClaw tool scripts\\",\\"Fix Rust/Tauri compilation exceptions\\",\\"Encapsulate Jialang knowledge base calling APIs\\"]}]",
			"openSuperHelper": "N",
			"machineChannel": "[]",
			"corePersonaDefinition": "[{\\"name\\":\\"Work Specification\\",\\"key\\":\\"agent\\",\\"value\\":\\"${userName}\'s Skill Development Assistant (codeagent)\\",\\"nameEn\\":\\"agent\\"},{\\"name\\":\\"Persona Definition\\",\\"key\\":\\"soul\\",\\"value\\":\\"Professional full-stack engineer who writes rigorous and executable code, accurately locates errors and provides repair commands\\",\\"nameEn\\":\\"soul\\"},{\\"name\\":\\"Tool Specification\\",\\"key\\":\\"tools\\",\\"value\\":\\"Prioritize code execution, compilation and interface debugging tools\\",\\"nameEn\\":\\"tools\\"},{\\"name\\":\\"Memory Specification\\",\\"key\\":\\"memory\\",\\"value\\":\\"Archive historical code snippets, error logs and skill development conversation records\\",\\"nameEn\\":\\"memory\\"}]",
			"advancedSettings": "[]"
		}
	]
}', '用户登陆初始数字员工助手模板');

-- 添加uiagent和code-agent沙箱spec
DELETE FROM "byai"."sandbox_service_spec"  WHERE "service_key" IN ('byclaw-code-agent','uiagent');
INSERT INTO "byai"."sandbox_service_spec" ("service_key", "spec_json", "template_json", "updated_at") VALUES (
    'byclaw-code-agent',
    '{"env": {"TZ": "Asia/Shanghai", "USER_CODE": "${user_code}", "MODEL_NAME": "MiniMax-M2.7-highspeed", "REDIS_HOST": "${REDIS_HOST}", "REDIS_PORT": "${REDIS_PORT}", "BE_DOMAINNAME": "ByaiService", "MODEL_API_KEY": "sk-cp-MfXezS3v3cI0S7zr2izv7j0WiALXOG4ugHU1CcZlG6SM0MLFzg7fahApNgUC-uxZbNzjnTs010Wu5BjIJFZFbobvWRa6XWOz50X-O6tMRtgugq_SSyLQD0E", "MODEL_BASE_URL": "https://api.minimaxi.com/anthropic", "REDIS_DATABASE": "${REDIS_DATABASE}", "REDIS_PASSWORD": "${REDIS_PASSWORD}", "REDIS_USERNAME": "${REDIS_USERNAME}", "CLAUDE_AGENT_CWD": "/home/byclaw/workspace", "CLAUDE_CODE_SKIP_ROOTALERT": true}, "image": "ghcr.io/beyonai/byclaw-code-agent:latest", "ports": [{"port": 8080, "protocol": "http"}], "startup": {"entrypoint": ["/app/entrypoint.sh"]}, "volumes": [{"key": "base", "scope": "PRIVATE", "subPath": "byclaw-${user_code}/by", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/by"}, {"key": "base", "scope": "PRIVATE", "subPath": "byclaw-code-agent/byclaw-${user_code}/by/workspace", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/home/byclaw/workspace"}, {"key": "base", "scope": "PRIVATE", "subPath": "byclaw-code-agent/byclaw-${user_code}/by/.claude", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/home/byclaw/.claude"}], "resourceLimits": {"cpu": "0.5", "memory": "1Gi"}}',
    '',
    '2026-06-17 17:57:57.666');
INSERT INTO "byai"."sandbox_service_spec" ("service_key", "spec_json", "template_json", "updated_at") VALUES (
    'uiagent',
    '{"env": {"TZ": "Asia/Shanghai", "LANG": "zh_CN", "MODEL_ID": "${MODEL_ID}", "NODE_ENV": "production", "USER_CODE": "${user_code}", "MODEL_NAME": "${MODEL_NAME}", "REDIS_HOST": "${REDIS_HOST}", "REDIS_PORT": "${REDIS_PORT}", "DEMO_SCHEMA": "${DEMO_SCHEMA}", "GBRAIN_HOME": "/by/.openclaw/gbrain", "MODEL_ALIAS": "${MODEL_ALIAS}", "OPENCLAW_TZ": "Asia/Shanghai", "BEYOND_TOKEN": "${BEYOND_TOKEN}", "GBRAIN_MODEL": "openai:qwen-turbo", "NODE_OPTIONS": "--max-old-space-size=4096", "BE_DOMAINNAME": "ByaiService", "MODEL_API_KEY": "${MODEL_API_KEY}", "DWS_CONFIG_DIR": "/by/.openclaw/.dws", "MODEL_BASE_URL": "${MODEL_BASE_URL}", "OPENAI_API_KEY": "${OPENAI_API_KEY}", "REDIS_DATABASE": "${REDIS_DATABASE}", "REDIS_PASSWORD": "${REDIS_PASSWORD}", "REDIS_USERNAME": "${REDIS_USERNAME}", "BAIYING_SESSION": "${BAIYING_SESSION}", "OPENAI_BASE_URL": "${OPENAI_BASE_URL}", "FILEBROWSER_ROOT": "/by", "DATACLOUD_DB_HOST": "${DB_HOST}", "DATACLOUD_DB_PASS": "${DB_PASS}", "DATACLOUD_DB_PORT": "${DB_PORT}", "DATACLOUD_DB_TYPE": "${DB_TYPE}", "DATACLOUD_DB_USER": "${DB_USER}", "BAIYING_AGENT_AUTH": "${BAIYING_AGENT_AUTH}", "OPENCLAW_LOG_LEVEL": "debug", "OPENCLAW_STATE_DIR": "/by/.openclaw", "DATACLOUD_DB_SCHEMA": "${DB_SCHEMA}", "DATACLOUD_DB_DATABASE": "${DB_DATABASE}", "DATACLOUD_DB_PASSWORD": "${DB_PASS}", "GBRAIN_EMBEDDING_MODEL": "openai:text-embedding-v4", "OPENCLAW_GATEWAY_TOKEN": "${OPENCLAW_GATEWAY_TOKEN}", "GBRAIN_EMBEDDING_DIMENSIONS": "1024", "FILE_STORAGE_MINIO_MOUNT_PATH": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "OPENCLAW_GATEWAY_STARTUP_TRACE": "1", "BYCLAW_SANDBOX_FILE_VOLUME_ROOT": "${BYCLAW_SANDBOX_FILE_VOLUME_ROOT}"}, "image": "hub-nj.iwhalecloud.com/dmcit2024/ui-agent-jarvis:github_openclaw_novnc_2026.6.6-20260615171653", "ports": [{"port": 8080, "instance": "openclaw", "protocol": "http"}, {"port": 8081, "instance": "vnc", "protocol": "http"}, {"port": 8082, "instance": "filebrowser", "protocol": "http"}, {"port": 9222, "protocol": "http"}, {"port": 5901, "protocol": "http"}, {"port": 18789, "protocol": "http"}], "startup": {"entrypoint": ["/app/start-all.sh"]}, "volumes": [{"key": "base", "scope": "PRIVATE", "subPath": "byclaw-${user_code}/by", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/by"}, {"scope": "PUBLIC", "subPath": "byclaw/resource", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": true, "mountPath": "/by/.openclaw/byresources"}, {"scope": "PUBLIC", "subPath": "byclaw-${user_code}/by/.uiagent/logs", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/var/log/supervisor"}, {"scope": "PUBLIC", "subPath": "byclaw-${user_code}/by/.uiagent/faiss_data", "hostPath": "${FILE_STORAGE_MINIO_MOUNT_PATH}", "readOnly": false, "mountPath": "/app/ui_recog_faiss/faiss_data"}], "bootstrap": {"copyTemplate": {"copyIfMissing": true, "targetVolumeKey": "base"}}, "sandboxType": "byclaw", "servicePort": 8080, "resourceLimits": {"cpu": "4", "memory": "3Gi"}}',
    '{"mcp": {"servers": {"env": {"GBRAIN_HOME": "/by/.openclaw/gbrain"}, "gbrain": {"args": ["serve"], "command": "gbrain"}}}, "meta": {"lastTouchedAt": "2026-03-27T08:46:51.148Z", "lastTouchedVersion": "2026.3.28"}, "hooks": {"internal": {"enabled": true, "entries": {"boot-md": {"enabled": false}, "session-memory": {"enabled": true}}}}, "tools": {"web": {"search": {"enabled": false}}, "profile": "full"}, "agents": {"list": [{"id": "main", "skills": [], "default": true, "workspace": "${OPENCLAW_STATE_DIR}/workspace"}, {"id": "ui-skill-tester", "name": "UI技能测试", "identity": {"name": "UI技能测试"}, "workspace": "/by/.openclaw/workspace-ui-skill-tester"}, {"id": "ui-skill-creator", "name": "UI技能创建", "model": {"primary": "byclaw/kimi-k2.6"}, "tools": {"deny": ["image", "image_generate", "music_generate", "video_generate", "tts", "canvas", "browser", "agents_list", "update_plan", "code_execution", "cron", "sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "sessions_yield", "subagents", "session_status", "exec", "x_search", "process", "nodes", "gateway", "message", "write", "edit", "memory_search", "memory_get"], "profile": "full", "alsoAllow": ["ui-skill-modeler", "jarvis_run_flow", "read"]}, "identity": {"name": "UI技能创建"}, "workspace": "/by/.openclaw/workspace-ui-skill-creator"}], "defaults": {"model": {"primary": "byclaw/${MODEL_ID} "}, "models": {"byclaw/kimi-k2.5": {"alias": "kimi-k2.5"}}, "subagents": {"maxConcurrent": 8}, "compaction": {"mode": "safeguard"}, "maxConcurrent": 4, "skipBootstrap": true, "verboseDefault": "full", "embeddedHarness": {"runtime": "skip-prewarm", "fallback": "pi"}, "thinkingDefault": "high", "bootstrapMaxChars": 15000, "blockStreamingBreak": "text_end", "blockStreamingDefault": "on"}}, "models": {"providers": {"byclaw": {"api": "openai-completions", "apiKey": "${MODEL_API_KEY}", "models": [{"id": "${MODEL_ID}", "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "name": "${MODEL_NAME}", "input": ["text"], "maxTokens": 8192, "reasoning": true, "contextWindow": 128000}, {"id": "kimi-k2.5", "api": "openai-completions", "cost": {"input": 4, "output": 21, "cacheRead": 0.7, "cacheWrite": 0}, "name": "kimi-k2.5", "input": ["text", "image"], "maxTokens": 32000, "reasoning": true, "contextWindow": 256000}], "baseUrl": "${MODEL_BASE_URL}"}}}, "skills": {"load": {"watch": true, "watchDebounceMs": 5000}, "install": {"nodeManager": "pnpm"}}, "wizard": {"lastRunAt": "2026-02-03T07:41:55.092Z", "lastRunMode": "local", "lastRunCommand": "configure", "lastRunVersion": "2026.1.30"}, "browser": {"enabled": true, "headless": false, "profiles": {"work": {"color": "#0066CC", "cdpPort": 18801}, "chrome": {"color": "#00AA00", "cdpUrl": "http://127.0.0.1:18792"}, "openclaw": {"color": "#FF4500", "cdpUrl": "http://localhost:9222"}}, "attachOnly": false, "ssrfPolicy": {"dangerouslyAllowPrivateNetwork": true}, "defaultProfile": "openclaw", "executablePath": "/usr/bin/google-chrome"}, "gateway": {"auth": {"mode": "token", "token": "${OPENCLAW_GATEWAY_TOKEN}"}, "bind": "lan", "mode": "local", "port": 8080, "nodes": {"browser": {"mode": "off"}}, "controlUi": {"allowedOrigins": ["*"], "allowInsecureAuth": true, "dangerouslyDisableDeviceAuth": true, "dangerouslyAllowHostHeaderOriginFallback": true}, "tailscale": {"mode": "off", "resetOnExit": false}}, "plugins": {"load": {"paths": ["/app/dist-runtime/extensions/baiying-enhance", "/app/dist-runtime/extensions/byai-channel", "/app/dist-runtime/extensions/byclaw-sqlite", "/app/custom-plugins/foundry", "/app/custom-plugins/runtime"]}, "allow": ["browser", "byai-channel", "baiying-enhance", "byclaw-sqlite", "diagnostics-otel", "memory-core", "ui-skill-foundry", "pincer-runtime"], "slots": {"memory": "none", "contextEngine": "modeler-image-cleaner"}, "enabled": true, "entries": {"xai": {"enabled": false}, "browser": {"enabled": true}, "byai-channel": {"enabled": true}, "byclaw-sqlite": {"enabled": true}, "pincer-runtime": {"config": {"identifyPageUrl": "http://127.0.0.1:8005"}, "enabled": true}, "baiying-enhance": {"config": {"watchDebounceMs": 500, "mainParentAgentId": "main", "workspaceAutoSeed": true, "embedApiKeysFromJson": true, "mergeAllowSpawnForMain": true}, "enabled": true}, "diagnostics-otel": {"enabled": false}, "ui-skill-foundry": {"config": {"identifyPageUrl": "http://127.0.0.1:8005"}, "enabled": true}, "byai_diagnostics-otel": {"enabled": true}}}, "channels": {"byai-channel": {"enabled": true, "dmPolicy": "open", "allowFrom": ["*"], "webhookPath": "/webhook/byai-channel", "streamEnabled": true, "blockStreaming": true, "sessionKeyPerSessionId": true}}, "commands": {"native": "auto", "restart": true, "nativeSkills": "auto", "ownerDisplay": "raw"}, "diagnostics": {"otel": {"logs": false, "traces": true, "enabled": true, "headers": {"Authorization": "Basic cGstbGYtMmVlYzQ2YTUtMWZiZi00MDNiLWI0NzAtMTlkMjdlZmZlNDRlOnNrLWxmLTc3MDc4MjE1LTg5YmQtNDViNy1hZmIyLWUyYjEzZjc5YWYxMw==", "x-langfuse-ingestion-version": "4"}, "metrics": false, "endpoint": "https://us.cloud.langfuse.com/api/public/otel", "protocol": "http/protobuf", "sampleRate": 1, "serviceName": "openclaw-gateway", "captureContent": {"enabled": true, "toolInputs": true, "toolOutputs": true, "systemPrompt": true, "inputMessages": true, "outputMessages": true, "toolDefinitions": true}, "flushIntervalMs": 5000}, "enabled": true}}',
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
=======


---平台内置技能初始化
DROP TABLE IF EXISTS tmp_builtin_skill_seed;

CREATE TEMP TABLE tmp_builtin_skill_seed (
    resource_name varchar(255),
    resource_code varchar(255),
    resource_desc text
);

INSERT INTO tmp_builtin_skill_seed (resource_name, resource_code, resource_desc)
VALUES
    ('content-to-outline', 'content-to-outline', '将 GitHub URL、微信文章、博客、研究报告或主题关键词解析为结构化 slide-outline.json，提炼核心主张、关键主题、支撑案例和受众问题，规划 8-12 页播客视频幻灯片大纲，并统一驱动 PPT 生成和播客脚本生成，保证幻灯片内容与音频对话按 slide 编号一致。'),
    ('dingtalk-todo-sync', 'dingtalk-todo-sync', '扫描 GitHub Issues 生成结构化待办清单，并通过钉钉 Webhook 机器人推送到钉钉群；支持 GitHub 授权检查、按优先级和标签整理 open issues、批量待办同步，以及自定义 Markdown 或文本消息通知。'),
    ('dws', 'dws', '通过 dws CLI 管理钉钉 AI 表格、日历、通讯录、群聊与机器人、待办、OA 审批、考勤、日志、DING 消息、开放平台文档、钉钉文档、云盘、AI 听记、邮箱等能力；支持查询、创建、修改、删除、发送、审批、上传下载和设备登录鉴权流程。'),
    ('gbrain', 'gbrain', '使用 gbrain CLI 管理 agent 第二大脑和长期记忆，支持 brain-first 查询、全文/向量检索、读取与写入记忆、导入 Markdown 知识库、维护图谱和时间线、embed、sync、dream、onboard 等操作，适用于项目背景、历史决策、人物关系和长期知识沉淀。'),
    ('github-code-analysis', 'github-code-analysis', '面向 GitHub 仓库的代码分析套件，支持 PR 审查、代码质量扫描、安全扫描、性能扫描、不一致性检测和自动文档生成；可拉取 PR diff 或克隆仓库，从安全、性能、质量、测试等维度生成报告或评论。'),
    ('github-issues-mgmt', 'github-issues-mgmt', 'GitHub Issues 管理工具，支持从自然语言、CSV 或 Excel 需求描述中提取任务并批量创建 Issues，也支持列出、查询、按状态或标签过滤现有 Issues；默认面向 ByClaw 仓库并内置 OAuth Device Flow 授权流程。'),
    ('iwhalehub', 'iwhalehub', '连接 iWhale Hub 资源市场，支持按关键词搜索、浏览、比较、校验并安装平台资源，返回资源名称、编码、描述、标签、版本、注册表信息和可安装的 skillId，适用于从技能广场查找和安装技能或后续资源类型。'),
    ('podcast-script-generator', 'podcast-script-generator', '将主题关键词、文章、博客、URL 提取内容或 slide-outline.json 转换为自然的双人播客对话脚本；生成 host/guest 角色轮次、标题、大纲，并支持按幻灯片编号输出 slide 标注，便于 TTS 合成和视频字幕/画面同步。'),
    ('podcast-video-composer', 'podcast-video-composer', '将 PPTX 幻灯片、音频文件、播客脚本 JSON、TTS timing 或 slide durations 合成为 1920×1080 MP4；支持按脚本 slide 标注计算每页停留时间、生成并烧录底部字幕、输出最终播客视频和字幕资产。'),
    ('pptx-generator', 'pptx-generator', 'PowerPoint 生成与编辑工具，支持读取和分析 PPTX、基于模板进行 XML 编辑，以及用 PptxGenJS 从零创建封面、目录、内容页、章节页、总结页等幻灯片；内置设计系统、配色、字体、版式和 QA 流程，也可直接消费 slide-outline.json。'),
    ('structured-ontology-manager', 'structured-ontology-manager', '对话式结构化个人本体管理工具，支持查询、创建、删除个人结构化本体对象和视图，维护字段与术语绑定，并将对象数据持久化到个人 SQLite 动态表；支持挂载本体到当前数字员工或个人助理。'),
    ('unstructured-ontology-manager', 'unstructured-ontology-manager', '对话式非结构化个人本体管理工具，支持查询个人知识库和目录、创建或删除绑定知识库目录的非结构化本体对象，并挂载到数字员工或个人助理；适用于以知识库文档作为数据来源而不建 SQLite 表的本体管理。'),
    ('volcengine-podcast-tts', 'volcengine-podcast-tts', '将 podcast-script-generator 输出的双人播客脚本转换为火山引擎/豆包 TTS V3 双声道语音，生成 podcast.mp3 和包含句子级或轮次级 start、duration、slide 信息的 timing JSON；支持低并发、缓存、重试和字幕精确同步。'),
    ('wechat-tech-article', 'wechat-tech-article', '将 GitHub 开源项目分析转换为微信公众号风格技术文章，流程包含仓库克隆、README/依赖/架构/基准数据分析、本地实测和文章撰写；输出突出核心数据、项目优势、实战演练和手机友好的技术分享 Markdown，并可衔接播客视频流水线。');

INSERT INTO byai.ss_resource (
    resource_id,
    system_code,
    resource_biz_type,
    resource_type,
    resource_name,
    resource_desc,
    resource_version_id,
    host_type,
    catalog_id,
    man_org_id,
    man_user_id,
    create_by,
    create_time,
    update_by,
    update_time,
    com_acct_id,
    resource_status,
    resource_d_verid,
    resource_r_verid,
    resource_code,
    publish_time,
    auth_status,
    publish_portal,
    parent_resource_id,
    publish_type,
    owner_type,
    impl_type,
    worker_agent_type
)
SELECT
    nextval('byai.seq_any_table'::regclass),
    'BYAI',
    'SKILL',
    'ATOM',
    v.resource_name,
    v.resource_desc,
    '1.0',
    'hosted',
    10,
    -1,
    10001,
    10001,
    CURRENT_TIMESTAMP,
    10001,
    CURRENT_TIMESTAMP,
    1,
    2,
    -1,
    -1,
    v.resource_code,
    CURRENT_TIMESTAMP,
    'passed',
    1,
    -1,
    'publish',
    'enterprise',
    'SKILL',
    'NONE'
FROM tmp_builtin_skill_seed v
WHERE NOT EXISTS (
    SELECT 1
    FROM byai.ss_resource r
    WHERE r.resource_biz_type = 'SKILL'
      AND r.owner_type = 'enterprise'
      AND r.resource_code = v.resource_code
);

INSERT INTO byai.ss_res_ext_skill (
    resource_id,
    skill_type,
    source_type,
    version,
    skill_url,
    skill_package_format,
    skill_original_filename,
    skill_package_size,
    skill_package_hash,
    target_content,
    sync_status,
    sync_error,
    last_sync_time
)
SELECT
    r.resource_id,
    'inner',
    'SYSTEM_BUILTIN',
    'v0.1',
    '',
    'zip',
    NULL,
    NULL,
    NULL,
    json_build_object(
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
        'version', 'v0.1',
        'skillPackageFormat', 'zip',
        'skillOriginalFilename', NULL,
        'skillPackageSize', NULL,
        'skillPackageHash', NULL,
        'syncStatus', 'SUCCESS',
        'syncError', NULL,
        'lastSyncTime', to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    )::text,
    'SUCCESS',
    NULL,
    CURRENT_TIMESTAMP
FROM byai.ss_resource r
         JOIN tmp_builtin_skill_seed v
              ON v.resource_code = r.resource_code
WHERE r.resource_biz_type = 'SKILL'
  AND r.owner_type = 'enterprise'
  AND NOT EXISTS (
    SELECT 1
    FROM byai.ss_res_ext_skill e
    WHERE e.resource_id = r.resource_id
);

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
    JOIN tmp_builtin_skill_seed v
ON v.resource_code = r.resource_code
WHERE e.resource_id = r.resource_id
  AND r.resource_biz_type = 'SKILL'
  AND r.owner_type = 'enterprise';

COMMIT;

DROP TABLE IF EXISTS tmp_builtin_skill_seed;
>>>>>>> Stashed changes
