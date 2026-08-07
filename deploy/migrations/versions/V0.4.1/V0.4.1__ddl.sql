-- V0.4.1 项目会话高级搜索索引
-- 仅为数字员工名称/描述与可见聊天正文的包含搜索建立索引，避免全表扫描影响普通项目会话列表。

CREATE INDEX IF NOT EXISTS idx_byai_session_project_creator_recent
    ON byai.byai_session (project_id, creator_id, (COALESCE(update_time, create_time)) DESC, create_time DESC);

CREATE INDEX IF NOT EXISTS idx_byai_session_member_session_agent
    ON byai.byai_session_member (session_id, mem_obj_type, mem_obj_id);

CREATE INDEX IF NOT EXISTS idx_byai_message_visible_session_recent
    ON byai.byai_message (session_id, create_time DESC, message_id DESC)
    WHERE archived_at IS NULL AND "usage" IN (1, 2) AND message_content IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_byai_message_visible_content_trgm
    ON byai.byai_message
    USING gin (LOWER(message_content) gin_trgm_ops)
    WHERE archived_at IS NULL AND "usage" IN (1, 2) AND message_content IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ss_resource_digital_employee_search_trgm
    ON byai.ss_resource
    USING gin ((LOWER(COALESCE(resource_name, '') || ' ' || COALESCE(resource_desc, ''))) gin_trgm_ops)
    WHERE resource_biz_type = 'DIG_EMPLOYEE';
