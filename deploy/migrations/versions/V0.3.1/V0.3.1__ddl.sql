-- V0.3.1 项目空间会话关联表补偿迁移
-- 兼容已执行旧版 V0.3.0 但未包含 byai_project_session 的环境，避免项目列表查询会话数时报错。
CREATE TABLE IF NOT EXISTS byai.byai_project_session (
    relation_id     BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    session_id      BIGINT          NOT NULL,
    create_by       VARCHAR(64),
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by       VARCHAR(64),
    update_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_project_session PRIMARY KEY (relation_id)
);

COMMENT ON TABLE byai.byai_project_session IS '项目会话关联表';
COMMENT ON COLUMN byai.byai_project_session.relation_id IS '关联记录ID';
COMMENT ON COLUMN byai.byai_project_session.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_session.session_id IS '会话ID';
COMMENT ON COLUMN byai.byai_project_session.delete_flag IS '删除标记 0正常 1删除';

CREATE INDEX IF NOT EXISTS idx_project_session_project ON byai.byai_project_session(project_id);
CREATE INDEX IF NOT EXISTS idx_project_session_session ON byai.byai_project_session(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_session_unique ON byai.byai_project_session(project_id, session_id);
