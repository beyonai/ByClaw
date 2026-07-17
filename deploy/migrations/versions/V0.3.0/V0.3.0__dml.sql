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

## 工作要求
1. 进入仓库 ${repoUrl}，基于最新代码切出并切换到分支 ${branchName}
2. 仔细理解上述需求详情，定位需要修改的代码
3. 完成开发后自测，确保编译通过、相关测试通过
4. 提交改动到分支 ${branchName}，提交信息清晰说明本次改动
5. 如需求描述不清或存在阻塞，明确说明遇到的问题

请开始处理。', '研发闭环任务启动提示词模板，占位符 ${projectName} ${repoUrl} ${branchName} ${taskType} ${title} ${description}');
