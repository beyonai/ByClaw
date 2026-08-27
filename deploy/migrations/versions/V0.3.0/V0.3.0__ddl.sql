-- V0.3.0 需求收集模块
-- 项目表
CREATE TABLE IF NOT EXISTS byai.byai_project (
    project_id      BIGINT          NOT NULL,
    project_name    VARCHAR(100)    NOT NULL,
    description     VARCHAR(500),
    resource_id     BIGINT,
    project_type    VARCHAR(20)     NOT NULL DEFAULT 'normal',
    is_share        VARCHAR(10)     NOT NULL DEFAULT 'N',
    create_by       BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by       BIGINT,
    update_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_project PRIMARY KEY (project_id)
);

COMMENT ON TABLE byai.byai_project IS '项目表';
COMMENT ON COLUMN byai.byai_project.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project.project_name IS '项目名称';
COMMENT ON COLUMN byai.byai_project.description IS '项目描述';
COMMENT ON COLUMN byai.byai_project.resource_id IS '关联Agent资源ID';
COMMENT ON COLUMN byai.byai_project.project_type IS '项目类型：normal普通项目，develop研发项目';
COMMENT ON COLUMN byai.byai_project.is_share IS '是否分享：N-不分享，Y-可分享';
COMMENT ON COLUMN byai.byai_project.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_project.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_project.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_project.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_project.delete_flag IS '删除标记 0正常 1删除';

-- 项目关联会话
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'byai'
          AND table_name = 'byai_session'
          AND column_name = 'project_id'
    ) THEN
        ALTER TABLE byai.byai_session
            ADD COLUMN project_id BIGINT NOT NULL DEFAULT -1;
    END IF;
END;
$$;
COMMENT ON COLUMN byai_session.project_id IS '项目ID,-1代表无归属项目,即默认项目';

-- 项目关联成员
CREATE TABLE IF NOT EXISTS byai.byai_project_member
(
    member_id   BIGINT NOT NULL,
    project_id  BIGINT NOT NULL,
    user_id     BIGINT,
    role        VARCHAR(32) DEFAULT 'member',
    agent_id    BIGINT,
    create_time TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_project_member PRIMARY KEY (member_id)
);

COMMENT ON TABLE byai.byai_project_member IS '项目成员表';
COMMENT ON COLUMN byai.byai_project_member.member_id IS '记录ID';
COMMENT ON COLUMN byai.byai_project_member.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_member.user_id IS '用户ID';
COMMENT ON COLUMN byai.byai_project_member.role IS '角色: owner/member';
COMMENT ON COLUMN byai.byai_project_member.agent_id IS '关联的默认数字员工ID';
COMMENT ON COLUMN byai.byai_project_member.create_time IS '加入时间';

CREATE INDEX IF NOT EXISTS idx_project_member_project ON byai.byai_project_member (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_member_unique ON byai.byai_project_member (project_id, user_id);

-- 项目仓库关联表
CREATE TABLE IF NOT EXISTS byai.byai_project_repo (
    repo_id         BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    repo_full_name  VARCHAR(200)    NOT NULL,
    repo_url        VARCHAR(500),
    default_branch  VARCHAR(100)    DEFAULT 'main',
    create_by       VARCHAR(64),
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_project_repo PRIMARY KEY (repo_id)
);

COMMENT ON TABLE byai.byai_project_repo IS '项目仓库关联表';
COMMENT ON COLUMN byai.byai_project_repo.repo_id IS '仓库记录ID';
COMMENT ON COLUMN byai.byai_project_repo.project_id IS '所属项目ID';
COMMENT ON COLUMN byai.byai_project_repo.repo_full_name IS '仓库全名 owner/repo';
COMMENT ON COLUMN byai.byai_project_repo.repo_url IS '仓库地址';
COMMENT ON COLUMN byai.byai_project_repo.default_branch IS '默认分支';

-- 项目空间共享文件表
CREATE TABLE IF NOT EXISTS byai.byai_project_share_file
(
    share_id    BIGINT PRIMARY KEY NOT NULL,
    project_id  BIGINT,
    file_id     BIGINT             NOT NULL,
    share_link  VARCHAR(1000),
    create_by   BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE byai.byai_project_share_file IS '项目空间共享文件表';
COMMENT ON COLUMN byai.byai_project_share_file.share_id IS '共享记录ID';
COMMENT ON COLUMN byai.byai_project_share_file.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_share_file.file_id IS '文件ID';
COMMENT ON COLUMN byai.byai_project_share_file.share_link IS '分享链接';
COMMENT ON COLUMN byai.byai_project_share_file.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_project_share_file.create_time IS '创建时间';

-- 需求扫描源配置表
CREATE TABLE IF NOT EXISTS byai.byai_scan_source (
    source_id       BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    source_name     VARCHAR(100)    NOT NULL,
    source_type     VARCHAR(30)     NOT NULL,
    config          TEXT,
    cron_expr       VARCHAR(100),
    enabled         CHAR(1)         DEFAULT '1',
    repo_id         BIGINT,
    confirm_mode    VARCHAR(16)     DEFAULT 'manual',
    score_threshold INT             DEFAULT 70,
    last_scan_time  TIMESTAMP,
    create_by       VARCHAR(64),
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by       VARCHAR(64),
    update_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_scan_source PRIMARY KEY (source_id)
);

COMMENT ON TABLE byai.byai_scan_source IS '需求扫描源配置表';
COMMENT ON COLUMN byai.byai_scan_source.source_id IS '扫描源ID';
COMMENT ON COLUMN byai.byai_scan_source.project_id IS '所属项目ID';
COMMENT ON COLUMN byai.byai_scan_source.source_name IS '扫描源名称';
COMMENT ON COLUMN byai.byai_scan_source.source_type IS '扫描源类型 dingtalk/github_issue/ci_failure';
COMMENT ON COLUMN byai.byai_scan_source.config IS '配置JSON';
COMMENT ON COLUMN byai.byai_scan_source.cron_expr IS 'Cron表达式';
COMMENT ON COLUMN byai.byai_scan_source.enabled IS '是否启用 1启用 0停用';
COMMENT ON COLUMN byai.byai_scan_source.repo_id IS '关联目标仓库ID byai_project_repo.repo_id，扫来的需求据此确定开发仓库';
COMMENT ON COLUMN byai.byai_scan_source.confirm_mode IS '需求确认规则 manual人工确认/auto全自动派生/score按分数阈值派生';
COMMENT ON COLUMN byai.byai_scan_source.score_threshold IS 'score模式下自动派生的最低综合分，默认70';
COMMENT ON COLUMN byai.byai_scan_source.last_scan_time IS '最近扫描时间';
COMMENT ON COLUMN byai.byai_scan_source.delete_flag IS '删除标记 0正常 1删除';

-- 扫描执行日志表
CREATE TABLE IF NOT EXISTS byai.byai_scan_log (
    log_id          BIGINT          NOT NULL,
    source_id       BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    scan_time       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    found_count     INT             DEFAULT 0,
    created_count   INT             DEFAULT 0,
    status          VARCHAR(20)     DEFAULT 'success',
    error_msg       VARCHAR(1000),
    CONSTRAINT pk_byai_scan_log PRIMARY KEY (log_id)
);

COMMENT ON TABLE byai.byai_scan_log IS '扫描执行日志表';
COMMENT ON COLUMN byai.byai_scan_log.log_id IS '日志ID';
COMMENT ON COLUMN byai.byai_scan_log.source_id IS '扫描源ID';
COMMENT ON COLUMN byai.byai_scan_log.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_scan_log.scan_time IS '扫描时间';
COMMENT ON COLUMN byai.byai_scan_log.found_count IS '发现数量';
COMMENT ON COLUMN byai.byai_scan_log.created_count IS '创建数量';
COMMENT ON COLUMN byai.byai_scan_log.status IS '状态 success/failed';
COMMENT ON COLUMN byai.byai_scan_log.error_msg IS '错误信息';

-- 扫描结果明细表
CREATE TABLE IF NOT EXISTS byai.byai_scan_log_item (
    item_id         BIGINT          NOT NULL,
    log_id          BIGINT          NOT NULL,
    source_id       BIGINT          NOT NULL,
    title           VARCHAR(500)    NOT NULL,
    content         TEXT,
    origin_id       VARCHAR(200),
    origin_url      VARCHAR(500),
    action          VARCHAR(20)     NOT NULL,
    session_id      BIGINT,
    score           INT,
    priority        VARCHAR(8),
    score_detail    TEXT,
    parent_item_id  BIGINT,
    content_hash    VARCHAR(64),
    dedup_status    VARCHAR(20)     DEFAULT 'normal',
    duplicate_of_item_id BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_scan_log_item PRIMARY KEY (item_id)
);

COMMENT ON TABLE byai.byai_scan_log_item IS '扫描结果明细表';
COMMENT ON COLUMN byai.byai_scan_log_item.item_id IS '明细ID';
COMMENT ON COLUMN byai.byai_scan_log_item.log_id IS '所属日志ID';
COMMENT ON COLUMN byai.byai_scan_log_item.source_id IS '扫描源ID';
COMMENT ON COLUMN byai.byai_scan_log_item.title IS '需求标题';
COMMENT ON COLUMN byai.byai_scan_log_item.content IS '需求内容';
COMMENT ON COLUMN byai.byai_scan_log_item.origin_id IS '来源原始ID(issue号/消息ID)';
COMMENT ON COLUMN byai.byai_scan_log_item.origin_url IS '来源链接';
COMMENT ON COLUMN byai.byai_scan_log_item.action IS '处理动作 created/duplicate/deferred/split(被拆分的原始条,不派发)';
COMMENT ON COLUMN byai.byai_scan_log_item.session_id IS '已启动会话ID(byai_session.session_id)，标记需求已启动';
COMMENT ON COLUMN byai.byai_scan_log_item.score IS 'AI综合评分 0-100';
COMMENT ON COLUMN byai.byai_scan_log_item.priority IS 'AI优先级 P0/P1/P2';
COMMENT ON COLUMN byai.byai_scan_log_item.score_detail IS 'AI评分明细JSON:各维度得分/风险/AI整理需求';
COMMENT ON COLUMN byai.byai_scan_log_item.parent_item_id IS '拆分溯源:子需求指向被拆分的原始item;未拆分为空';
COMMENT ON COLUMN byai.byai_scan_log_item.content_hash IS '归一化内容指纹,二期去重用';
COMMENT ON COLUMN byai.byai_scan_log_item.dedup_status IS '去重状态 normal/suspected_dup/confirmed_dup/not_dup';
COMMENT ON COLUMN byai.byai_scan_log_item.duplicate_of_item_id IS '疑似/确认重复时指向的原始item';

-- 索引
CREATE INDEX IF NOT EXISTS idx_scan_source_project ON byai.byai_scan_source(project_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_source ON byai.byai_scan_log(source_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_log ON byai.byai_scan_log_item(log_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_hash ON byai.byai_scan_log_item(content_hash);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_dedup ON byai.byai_scan_log_item(dedup_status);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_parent ON byai.byai_scan_log_item(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_project_repo_project ON byai.byai_project_repo(project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_file_project ON byai.byai_project_share_file(project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_file_file ON byai.byai_project_share_file(file_id);
CREATE INDEX IF NOT EXISTS idx_project_share_file_create_by ON byai.byai_project_share_file(create_by);
