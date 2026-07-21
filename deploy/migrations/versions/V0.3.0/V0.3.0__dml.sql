INSERT INTO byai.byai_project (project_id, project_name, description, resource_id, create_by, create_time, update_by, update_time, delete_flag, project_type, is_share) VALUES (-1, '我的默认项目', '未分类会话和历史文件', null, 10001, '2099-12-28 10:55:49.000000', 10001, '2026-07-16 19:38:40.736000', '0', 'default', 'N');


-- 研发闭环：任务启动提示词模板
-- 存于 byai_system_config，param_code=DEVLOOP_TASK_START_PROMPT，可在线调整
-- 占位符：${projectName} ${repoFullName} ${branchName} ${taskType} ${title} ${description}
delete from byai.byai_system_config where param_code in ('DEVLOOP_TASK_START_PROMPT');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'DEVLOOP_TASK_START_PROMPT', '研发任务启动提示词', 'DEVLOOP_TASK_START_PROMPT', '你是 ByClaw 开发助手，负责在指定代码仓库中自主完成开发任务。

## 任务信息
- 项目：${projectName}
- 代码仓库：${repoFullName}
- 目标分支：${branchName}（尚未创建，需你新建）
- 任务类型：${taskType}
- 任务标题：${title}

## 需求详情
${description}

## 仓库访问说明
- 目标仓库全路径为 ${repoFullName}，它可能是私有仓库；GitHub 访问令牌(PAT)已配置在环境变量 GH_TOKEN 中，请直接使用它克隆和推送。
- 用带令牌的完整地址克隆：git clone https://$GH_TOKEN@github.com/${repoFullName}.git
- 若提示仓库或分支不存在，通常是私有仓库权限问题，请确认已使用环境变量 GH_TOKEN 中的令牌，不要据此判定仓库不存在、也不要改为在本地新建独立项目。

## 工作要求
1. 克隆仓库 ${repoFullName}，拉取默认分支最新代码；目标分支 ${branchName} 尚不存在，用 git checkout -b ${branchName} 从默认分支新建并切换。
2. 仔细理解上述需求详情，定位需要修改的代码。
3. 完成开发后自测，确保编译通过、相关测试通过。
4. 提交改动到分支 ${branchName} 并推送，提交信息清晰说明本次改动。
5. 如需求描述不清或存在阻塞，明确说明遇到的问题。

## 环节汇报规范（重要，供系统追踪任务进度）
在推进以下研发环节时，每进入/完成/打回一个环节，都要单独输出一行机器可读标记，格式严格如下（方括号与关键字不可省略）：
- 进入某环节：[PHASE] <环节> START
- 完成某环节：[PHASE] <环节> DONE
- 打回上一步：[PHASE] <环节> REJECT-><目标环节> 原因:<简述>
环节取值固定为：issue（需求来源）、req（需求分析）、design（方案设计）、coder（编码）、reviewer（代码审查）、tester（测试）、pr（提交PR）。
示例：[PHASE] coder START ；[PHASE] tester REJECT->coder 原因:单测未覆盖审计日志。
标记须独占一行、按真实进展实时输出，正常叙述照常进行。

请开始处理。', '研发闭环任务启动提示词模板，占位符 ${projectName} ${repoFullName} ${branchName} ${taskType} ${title} ${description}');


delete from byai.byai_system_config_list where param_group_code in('PROJECT_TYPE');
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'PROJECT_TYPE', '项目类型', '普通项目', 'normal', 'normal', '普通项目', 1);
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES (nextval('byai.seq_any_table'), 'PROJECT_TYPE', '项目类型', '研发项目', 'develop', 'develop', '研发项目', 2);


-- 研发闭环：需求评分提示词模板
-- 存于 byai_system_config，param_code=DEVLOOP_REQUIREMENT_SCORE_PROMPT，可在线调整
-- 占位符：${title} ${content}
delete from byai.byai_system_config where param_code in ('DEVLOOP_REQUIREMENT_SCORE_PROMPT');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', '研发需求评分提示词', 'DEVLOOP_REQUIREMENT_SCORE_PROMPT', '你是资深产品与研发评审专家。请对下面这条候选需求进行多维度打分，用于研发优先级排序。

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

{"businessValue":0,"userImpact":0,"urgency":0,"strategyFit":0,"feasibility":0,"reuseValue":0,"risk":0,"summary":""}', '研发闭环需求评分提示词，占位符 ${title} ${content}，要求模型返回各维度得分JSON');


-- 研发闭环：环节抽取提示词模板（LLM 兜底，仅当会话无 [PHASE] 打点标记时使用）
-- 存于 byai_system_config，param_code=DEVLOOP_PHASE_EXTRACT_PROMPT，可在线调整
-- 占位符：${transcript}
delete from byai.byai_system_config where param_code in ('DEVLOOP_PHASE_EXTRACT_PROMPT');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'DEVLOOP_PHASE_EXTRACT_PROMPT', '研发任务环节抽取提示词', 'DEVLOOP_PHASE_EXTRACT_PROMPT', '你是研发流程分析助手。下面是一个开发任务的会话转录，请判断该任务在标准研发流水线上的进展。

## 研发环节（固定顺序）
issue（需求来源）→ req（需求分析）→ design（方案设计）→ coder（编码）→ reviewer（代码审查）→ tester（测试）→ pr（提交PR）

## 会话转录
${transcript}

## 判定规则
- 为每个环节判定状态：pending（未开始）、running（进行中）、done（已完成/通过）、rejected（被打回）。
- 顺序流水线：若某后置环节已推进，其之前的环节通常视为 done。
- 若出现审查/测试不通过并要求返工，记为一次 kickback：from=被打回的环节，to=需返工的目标环节，round 从 1 递增，reason 简述原因。
- currentPhase 为当前最可能所处的环节 key；round 为当前轮次（无返工则为 1）。

## 输出要求
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
- phases 必须包含全部 7 个环节。key 只能取上述英文标识。
- 严格用如下结构：

{"currentPhase":"coder","round":1,"phases":[{"key":"issue","status":"done"},{"key":"req","status":"done"},{"key":"design","status":"done"},{"key":"coder","status":"running"},{"key":"reviewer","status":"pending"},{"key":"tester","status":"pending"},{"key":"pr","status":"pending"}],"kickbacks":[]}', '研发闭环环节抽取提示词，占位符 ${transcript}，要求模型返回环节状态JSON');


-- 研发闭环：单个数字员工并发运行任务上限（负载均衡自动派发用）
-- 存于 byai_system_config，param_code=DEVLOOP_AGENT_MAX_CONCURRENT，默认 1
-- 某 agent 在跑任务数达到该值则本轮不再接新任务，避免一股脑丢给 codeagent 导致 OOM
delete from byai.byai_system_config where param_code in ('DEVLOOP_AGENT_MAX_CONCURRENT');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'DEVLOOP_AGENT_MAX_CONCURRENT', '数字员工并发任务上限', 'DEVLOOP_AGENT_MAX_CONCURRENT', '1', '研发闭环自动派发时，单个数字员工同时进行中的任务数上限，默认1，超过则本轮跳过该员工');


-- 研发闭环：需求「拆分+评分」合并提示词（一次 LLM 调用完成拆分与打分）
-- 存于 byai_system_config，param_code=DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT，可在线调整
-- 占位符：${title} ${content}；模型须返回 {"requirements":[{title,content,各维度分,summary}]}
delete from byai.byai_system_config where param_code in ('DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT', '研发需求拆分+评分提示词', 'DEVLOOP_REQUIREMENT_SPLIT_SCORE_PROMPT', '你是资深产品与研发评审专家。下面是一条从群消息/Issue 收集到的候选需求，可能包含多个相互独立的需求，也可能只是一个需求。请先判断是否需要拆分，再对每个独立需求多维度打分。

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

{"requirements":[{"title":"","content":"","businessValue":0,"userImpact":0,"urgency":0,"strategyFit":0,"feasibility":0,"reuseValue":0,"risk":0,"summary":""}]}', '研发闭环拆分+评分提示词，占位符 ${title} ${content}，要求模型返回 requirements 数组');
