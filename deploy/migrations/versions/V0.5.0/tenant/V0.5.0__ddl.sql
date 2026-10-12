-- V0.5.0 租户同版本修复：补齐基线遗漏的任务轮次绑定。
-- 不回填历史任务的运行状态；执行器须先校验字段是否存在及类型，事务和 schema 指纹更新由部署执行器管理。
ALTER TABLE byai.byai_group_chat_task ADD COLUMN current_turn_id BIGINT;
ALTER TABLE byai.byai_group_chat_task ADD COLUMN current_turn_trace_id VARCHAR(255);
COMMENT ON COLUMN byai.byai_group_chat_task.current_turn_id IS '当前轮次启动占位标识，用于隔离迟到的启动失败回调';
COMMENT ON COLUMN byai.byai_group_chat_task.current_turn_trace_id IS '当前轮次实际trace，用于完成回调与落库结果补偿';
CREATE INDEX IF NOT EXISTS idx_group_chat_task_running_turn
    ON byai.byai_group_chat_task (status, turn_status, task_session_id);
