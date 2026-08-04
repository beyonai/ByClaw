
/**百应运营渠道**/
-- 运营闭环：按运营需求类型配置独立启动提示词，避免不同类型任务携带无关字段。
-- 后端按 operationType 读取：collect -> OPLOOP_TASK_START_PROMPT_COLLECT，publish/content -> OPLOOP_TASK_START_PROMPT_PUBLISH，analyze -> OPLOOP_TASK_START_PROMPT_ANALYZE。
delete from byai.byai_system_config where param_code in (
    'OPLOOP_TASK_START_PROMPT_COLLECT',
    'OPLOOP_TASK_START_PROMPT_PUBLISH',
    'OPLOOP_TASK_START_PROMPT_ANALYZE'
);

INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'OPLOOP_TASK_START_PROMPT_COLLECT', '研发任务启动提示词-资料采集与整理', 'OPLOOP_TASK_START_PROMPT_COLLECT', '请处理以下资料采集与整理任务：

## 关联需求
- 需求名称：${requirementName}
- 需求描述：${requirementDescription}

## 运营任务信息
- 运营项目：${projectName}
- 任务名称：${title}

## 资料采集配置
- 采集渠道：${collectChannel}
- 采集账号或地址：${collectAccount}
- 采集主题：${collectTopic}
- 采集开始时间：${collectStartTime}
- 采集结束时间：${collectEndTime}
- 采集方式：${collectMethod}
- 定时规则：${collectSchedule}
- 采集知识库：${knowledgeBase}
- 采集目录：${directory}
- 是否知识整理：${collectOrganize}
- 整理本体：${collectOntology}
- 整理要求：${collectOrganizationRequest}
- 结构化要求：${collectOrganizationStructure}

## 执行要求
1. 严格依据关联需求和资料采集配置开展工作。
2. 将采集结果归档到指定知识库和目录，并同步关键进度、产出结果和异常情况。
3. 涉及登录或对外访问时，先核对对应运营账号和平台配置。
', '资料采集与整理任务启动提示词，占位符 ${projectName} ${title} ${assigneeName} ${dueTime} ${requirementName} ${requirementDescription} ${collectChannel} ${collectAccount} ${collectTopic} ${collectStartTime} ${collectEndTime} ${collectMethod} ${collectSchedule} ${knowledgeBase} ${directory} ${collectOrganize} ${collectOntology} ${collectOrganizationRequest} ${collectOrganizationStructure}');

INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'OPLOOP_TASK_START_PROMPT_PUBLISH', '研发任务启动提示词-内容创作', 'OPLOOP_TASK_START_PROMPT_PUBLISH', '请处理以下内容创作与发布任务：

## 关联需求
- 需求名称：${requirementName}
- 需求描述：${requirementDescription}

## 运营任务信息
- 运营项目：${projectName}
- 任务名称：${title}

## 内容创作与发布配置
- 内容类型：${contentType}
- 发布渠道：${publishChannel}
- 发布账号：${publishAccount}
- 创作主题：${publishTopic}
- 发布时间或计划：${publishSchedule}

## 执行要求
1. 严格依据关联需求和内容创作配置完成内容生产。
2. 涉及发布或登录时，先核对发布账号和平台配置，再执行对外操作。
3. 及时同步关键进度、发布结果和异常情况。
', '内容创作与发布任务启动提示词，占位符 ${projectName} ${title} ${assigneeName} ${dueTime} ${requirementName} ${requirementDescription} ${contentType} ${publishChannel} ${publishAccount} ${publishTopic} ${publishSchedule}');

INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'OPLOOP_TASK_START_PROMPT_ANALYZE', '研发任务启动提示词-数据分析', 'OPLOOP_TASK_START_PROMPT_ANALYZE', '请处理以下数据分析与优化任务：

## 关联需求
- 需求名称：${requirementName}
- 需求描述：${requirementDescription}

## 运营任务信息
- 运营项目：${projectName}
- 任务名称：${title}

## 数据分析配置
- 分析平台：${analysisPlatform}
- 分析账号：${analysisAccount}
- 分析范围：${analysisScope}
- 指定作品：${analysisWorks}

## 执行要求
1. 严格依据关联需求和数据分析配置开展分析与优化。
2. 分析范围为指定作品时，仅处理列出的作品；未指定时按账号范围处理。
3. 及时同步关键进度、分析结论、优化建议和异常情况。
', '数据分析与优化任务启动提示词，占位符 ${projectName} ${title} ${assigneeName} ${dueTime} ${requirementName} ${requirementDescription} ${analysisPlatform} ${analysisAccount} ${analysisScope} ${analysisWorks}');

delete from byai.byai_system_config_list where param_group_code in('OPERATION_CHANNEL');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '微信公众号', 'WeChatAccount', 'WeChatAccount', '微信公众号', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '小红书', 'Xiaohongshu', 'Xiaohongshu', '小红书', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '视频号', 'WeChatChannels', 'WeChatChannels', '视频号', 3);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', '互联网', 'Internet', 'Internet', '互联网', 4);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_CHANNEL', '项目运营渠道', 'GitHub', 'GitHub', 'GitHub', 'GitHub', 5);

/**百应运营需求类型**/
delete from byai.byai_system_config_list where param_group_code in('OPERATION_REQUIRE_TYPE');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_REQUIRE_TYPE', '项目运营需求类型', '素材采集与整理', 'collect', 'collect', '素材采集与整理', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_REQUIRE_TYPE', '项目运营需求类型', '内容创作与发布', 'publish', 'publish', '内容创作与发布', 2);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'OPERATION_REQUIRE_TYPE', '项目运营需求类型', '数据分析与优化', 'analyze', 'analyze', '数据分析与优化', 3);

-- 运营项目类型由项目空间前端动态读取，补齐后新环境才会显示“运营项目”创建入口。
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq)
SELECT nextval('byai.seq_any_table'), 'PROJECT_TYPE', '项目类型', '运营项目', 'operation', 'operation', '运营项目', 3
WHERE NOT EXISTS (
    SELECT 1 FROM byai.byai_system_config_list
    WHERE param_group_code = 'PROJECT_TYPE' AND param_value = 'operation'
);
