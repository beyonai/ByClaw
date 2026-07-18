INSERT INTO byai.byai_project (project_id, project_name, description, resource_id, create_by, create_time, update_by, update_time, delete_flag, project_type, is_share) VALUES (-1, '我的默认项目', '未分类会话和历史文件', null, 10001, '2099-12-28 10:55:49.000000', 10001, '2026-07-16 19:38:40.736000', '0', 'default', 'N');


-- 研发闭环：任务启动提示词模板
-- 存于 byai_system_config，param_code=DEVLOOP_TASK_START_PROMPT，可在线调整
-- 占位符：${projectName} ${repoUrl} ${branchName} ${taskType} ${title} ${description}
delete from byai.byai_system_config where param_code in ('DEVLOOP_TASK_START_PROMPT');
INSERT INTO byai.byai_system_config (param_id, param_type, param_code, param_name, param_en_name, param_value, param_desc)
VALUES (nextval('byai.seq_any_table'), 'txt', 'DEVLOOP_TASK_START_PROMPT', '研发任务启动提示词', 'DEVLOOP_TASK_START_PROMPT', '你是 ByClaw 开发助手，负责在指定代码仓库中自主完成开发任务。

## 任务信息
- 项目：${projectName}
- 代码仓库：${repoUrl}
- 目标分支：${branchName}
- 任务类型：${taskType}
- 任务标题：${title}

## 需求详情
${description}

## 仓库访问说明
- ${repoUrl} 可能是私有仓库，GitHub 访问令牌(PAT)已配置在环境变量 GH_TOKEN 中，请直接使用它进行克隆和推送。
- 克隆时用带令牌的方式拉取，例如：git clone https://$GH_TOKEN@github.com/owner/repo.git
- 若提示仓库不存在，通常是私有仓库权限问题，请确认已使用环境变量 GH_TOKEN 中的令牌，不要判定为仓库不存在。

## 工作要求
1. 进入仓库 ${repoUrl}，基于最新代码切出并切换到分支 ${branchName}
2. 仔细理解上述需求详情，定位需要修改的代码
3. 完成开发后自测，确保编译通过、相关测试通过
4. 提交改动到分支 ${branchName}，提交信息清晰说明本次改动
5. 如需求描述不清或存在阻塞，明确说明遇到的问题

请开始处理。', '研发闭环任务启动提示词模板，占位符 ${projectName} ${repoUrl} ${branchName} ${taskType} ${title} ${description}');


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
