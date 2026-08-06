
/**百应运营渠道**/
-- 运营闭环：按运营需求类型配置独立启动提示词，避免不同类型任务携带无关字段。
-- 后端按 operationType 读取：collect -> OPLOOP_TASK_START_PROMPT_COLLECT，publish/content -> OPLOOP_TASK_START_PROMPT_PUBLISH，analyze -> OPLOOP_TASK_START_PROMPT_ANALYZE。
delete from byai.byai_system_config where param_code in (
    'OPLOOP_TASK_START_PROMPT',
    'OPLOOP_COLLECT_TASK_START_PROMPT',
    'OPLOOP_PUBLISH_TASK_START_PROMPT',
    'OPLOOP_ANALYZE_TASK_START_PROMPT',
    'OPLOOP_TASK_START_PROMPT_COLLECT',
    'OPLOOP_TASK_START_PROMPT_PUBLISH',
    'OPLOOP_TASK_START_PROMPT_ANALYZE'
);

-- 运营提示词与研发提示词统一进入 byai_ai_prompt，脚本可重复执行而不会产生重复模板。
delete from byai.byai_ai_prompt where prompt_code in (
    'OPLOOP_TASK_START_PROMPT',
    'OPLOOP_COLLECT_TASK_START_PROMPT',
    'OPLOOP_PUBLISH_TASK_START_PROMPT',
    'OPLOOP_ANALYZE_TASK_START_PROMPT',
    'OPLOOP_TASK_START_PROMPT_COLLECT',
    'OPLOOP_TASK_START_PROMPT_PUBLISH',
    'OPLOOP_TASK_START_PROMPT_ANALYZE'
);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_COLLECT', '运营任务启动提示词-资料采集与整理', '运营资料采集与整理任务启动提示词，占位符 ${projectName} ${title} ${requirementName} ${requirementDescription} ${collectChannel} ${collectAccount} ${collectTopic} ${collectStartTime} ${collectEndTime} ${collectMethod} ${collectSchedule} ${knowledgeBase} ${directory} ${collectOrganize} ${collectOntology} ${collectOrganizationRequest} ${collectOrganizationStructure}', 'OPLOOP_TASK_START_PROMPT_COLLECT', '请处理以下资料采集与整理任务：

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
', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_PUBLISH', '运营任务启动提示词-内容创作', '运营内容创作与发布任务启动提示词，占位符 ${projectName} ${title} ${requirementName} ${requirementDescription} ${contentType} ${publishChannel} ${publishAccount} ${publishTopic} ${publishSchedule}', 'OPLOOP_TASK_START_PROMPT_PUBLISH', '请处理以下内容创作与发布任务：

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
', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'OPLOOP_PROMPT', 'OPLOOP_TASK_START_PROMPT_ANALYZE', '运营任务启动提示词-数据分析', '运营数据分析与优化任务启动提示词，占位符 ${projectName} ${title} ${requirementName} ${requirementDescription} ${analysisPlatform} ${analysisAccount} ${analysisScope} ${analysisWorks}', 'OPLOOP_TASK_START_PROMPT_ANALYZE', '请处理以下数据分析与优化任务：

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
', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

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



-- 研发闭环提示词迁移：从 byai_system_config 移到 byai_ai_prompt（分组 DEVLOOP_PROMPT）。
-- TASK_START / REQUIREMENT_SCORE / REQUIREMENT_SPLIT_SCORE 迁移；PHASE_EXTRACT 环节抽取已废弃，仅删不迁。
delete from byai.byai_system_config where param_code in ('DEVLOOP_TASK_START_PROMPT');
delete from byai.byai_system_config where param_code in ('DEVLOOP_REQUIREMENT_SCORE_PROMPT');
delete from byai.byai_system_config where param_code in ('DEVLOOP_PHASE_EXTRACT_PROMPT');
delete from byai.byai_system_config where param_code in ('DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT');

-- 幂等：先按 prompt_code 清掉旧行再插入当前模板。
delete from byai.byai_ai_prompt where prompt_code in
    ('DEVLOOP_TASK_START_PROMPT', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT');

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_TASK_START_PROMPT', '研发任务启动提示词', '研发闭环任务启动提示词模板，占位符 ${projectName} ${repoFullName} ${branchName} ${taskType} ${title} ${description} ${repoCloneHint}(后端按代码平台生成带令牌的克隆说明)', 'DEVLOOP_TASK_START_PROMPT', '请处理以下任务：
## 任务信息
- 项目：${projectName}
- 代码仓库：${repoFullName}
- 目标分支：${branchName}（尚未创建，需你新建）
- 任务类型：${taskType}
- 任务标题：${title}

## 需求详情
${description}

## 仓库访问说明
${repoCloneHint}

## 代码仓库
任务的代码克隆仓库路径需要遵循/by/.sessions/{sessionId}/{repoName}/

## 强制要求
acp下发任务告诉对方启动的时候必须要调用skill：self-developed-rules;
研发流程的输出文档如：需求文档、设计文档、测试文档保存在/by/.sessions/{sessionId}/下面', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', '研发需求评分提示词', '研发闭环需求评分提示词，占位符 ${title} ${content}，要求模型返回各维度得分JSON', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', '你是资深产品与研发评审专家。请对下面这条候选需求进行多维度打分，用于研发优先级排序。

## 待评估需求
标题：${title}
内容：${content}

## 评分维度与分值上限
- businessValue 业务价值（0-30）：对业务目标、营收或核心指标的贡献
- userImpact 用户影响（0-20）：影响的用户范围与体验提升程度
- urgency 紧迫度（0-15）：时间敏感性，是否阻塞或有明确截止
- strategyFit 战略匹配（0-15）：与产品/公司战略方向的契合度
- feasibility 实现可行性（0-10）：技术实现难度，越可行分越高
- reuseValue 复用价值（0-10）：能力沉淀与跨场景复用潜力
- risk 风险与冲突（-10-0）：与现有功能冲突、合规或稳定性风险，作为负分扣减

## 输出要求
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
- 各维度取整数，不得超过上限；risk 为 0 到 -10 的整数。
- summary 为一句话「AI 整理的产品需求」，凝练该需求要交付的能力。
- 严格用如下字段：

{"businessValue":0,"userImpact":0,"urgency":0,"strategyFit":0,"feasibility":0,"reuseValue":0,"risk":0,"summary":""}', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);

INSERT INTO byai.byai_ai_prompt (prompt_id, prompt_group_code, prompt_code, prompt_name, prompt_desc, prompt_filed_code, prompt_zh_template, prompt_en_template, create_by, create_time, update_time, model_code)
VALUES (nextval('byai.seq_any_table'), 'DEVLOOP_PROMPT', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT', '研发需求拆分+评分提示词', '研发闭环拆分+评分提示词，占位符 ${title} ${content}，要求模型返回 requirements 数组', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT', '你是资深产品与研发评审专家。下面是一条从群消息/Issue 收集到的候选需求，可能包含多个相互独立的需求，也可能只是一个需求。请先判断是否需要拆分，再对每个独立需求多维度打分。

## 待评估内容
标题：${title}
内容：${content}

## 拆分规则
- 仅当内容里确实包含多个「相互独立、可分别交付」的需求时才拆分；一个需求的多个步骤/细节不要拆开。
- 最多拆 5 个；无法明确拆分时按 1 个处理（原样返回一条）。
- 每个子需求给出清晰的 title（简短）和 content（自包含、不依赖其它子需求也能理解）。

## 评分维度与分值上限（对每个子需求分别打分）
- businessValue 业务价值（0-30）
- userImpact 用户影响（0-20）
- urgency 紧迫度（0-15）
- strategyFit 战略匹配（0-15）
- feasibility 实现可行性（0-10）
- reuseValue 复用价值（0-10）
- risk 风险与冲突（-10-0，负分扣减）

## 输出要求
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
- requirements 为数组，每个元素含 title、content 及各维度整数分与 summary（一句话概括该需求要交付的能力）。
- 不拆分时 requirements 只含 1 个元素。
- 严格用如下结构：

{"requirements":[{"title":"","content":"","businessValue":0,"userImpact":0,"urgency":0,"strategyFit":0,"feasibility":0,"reuseValue":0,"risk":0,"summary":""}]}', null, 10001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, null);


-- 回填研发子任务:历史需求为 1:1(scan_log_item.session_id 直连一个会话),各生成一条子任务,
-- 让存量数据具备需求级批量集成的就绪聚合能力。project_id 与 repo_id 均经 scan_source 派生(item.source_id 直连)。
-- 幂等:仅对尚无有效子任务的已启动需求插入。
INSERT INTO byai.byai_scan_item_task (task_id, requirement_id, project_id, repo_id, session_id, status, create_time, delete_flag)
SELECT nextval('byai.seq_any_table'), i.item_id, s.project_id, s.repo_id, i.session_id, 'running', CURRENT_TIMESTAMP, '0'
FROM byai.byai_scan_log_item i
JOIN byai.byai_scan_source s ON s.source_id = i.source_id
WHERE i.session_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM byai.byai_scan_item_task t
      WHERE t.requirement_id = i.item_id AND t.delete_flag = '0'
  );