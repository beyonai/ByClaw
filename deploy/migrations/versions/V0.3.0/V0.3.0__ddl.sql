-- V0.3.0 需求收集模块
-- 项目表
CREATE TABLE IF NOT EXISTS byai.byai_project (
    project_id      BIGINT          NOT NULL,
    project_name    VARCHAR(100)    NOT NULL,
    description     VARCHAR(500),
    resource_id     BIGINT,
    create_by       VARCHAR(64),
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by       VARCHAR(64),
    update_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_project PRIMARY KEY (project_id)
);

COMMENT ON TABLE byai.byai_project IS '项目表';
COMMENT ON COLUMN byai.byai_project.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project.project_name IS '项目名称';
COMMENT ON COLUMN byai.byai_project.description IS '项目描述';
COMMENT ON COLUMN byai.byai_project.resource_id IS '关联Agent资源ID';
COMMENT ON COLUMN byai.byai_project.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_project.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_project.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_project.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_project.delete_flag IS '删除标记 0正常 1删除';

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

-- 需求扫描源配置表
CREATE TABLE IF NOT EXISTS byai.byai_scan_source (
    source_id       BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    source_name     VARCHAR(100)    NOT NULL,
    source_type     VARCHAR(30)     NOT NULL,
    config          TEXT,
    cron_expr       VARCHAR(100),
    enabled         CHAR(1)         DEFAULT '1',
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
    task_id         BIGINT,
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
COMMENT ON COLUMN byai.byai_scan_log_item.action IS '处理动作 created/duplicate/deferred';
COMMENT ON COLUMN byai.byai_scan_log_item.task_id IS '关联任务ID';

-- 索引
CREATE INDEX IF NOT EXISTS idx_scan_source_project ON byai.byai_scan_source(project_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_source ON byai.byai_scan_log(source_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_item_log ON byai.byai_scan_log_item(log_id);
CREATE INDEX IF NOT EXISTS idx_project_repo_project ON byai.byai_project_repo(project_id);

-- 研发任务表
CREATE TABLE IF NOT EXISTS byai.byai_task (
    task_id         BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    source_item_id  BIGINT,
    title           TEXT            NOT NULL,
    status          VARCHAR(32)     NOT NULL DEFAULT '待开始',
    phase           VARCHAR(32)     DEFAULT '分诊',
    current_round   INT             DEFAULT 0,
    total_rounds    INT             DEFAULT 0,
    score           INT             DEFAULT 0,
    assignee        VARCHAR(128),
    agent_name      VARCHAR(128)    DEFAULT 'Code Agent',
    branch_name     VARCHAR(256),
    warning_tag     VARCHAR(256),
    session_id      BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_time     TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_task PRIMARY KEY (task_id)
);

COMMENT ON TABLE byai.byai_task IS '研发任务表';
COMMENT ON COLUMN byai.byai_task.task_id IS '任务ID';
COMMENT ON COLUMN byai.byai_task.project_id IS '所属项目ID';
COMMENT ON COLUMN byai.byai_task.source_item_id IS '关联扫描条目ID';
COMMENT ON COLUMN byai.byai_task.title IS '任务标题';
COMMENT ON COLUMN byai.byai_task.status IS '状态: 待开始/进行中/暂停/完成';
COMMENT ON COLUMN byai.byai_task.phase IS '阶段: 分诊/设计/编码/测试/审批/发布';
COMMENT ON COLUMN byai.byai_task.current_round IS '当前轮次';
COMMENT ON COLUMN byai.byai_task.total_rounds IS '总轮次';
COMMENT ON COLUMN byai.byai_task.score IS '评分';
COMMENT ON COLUMN byai.byai_task.assignee IS '负责人';
COMMENT ON COLUMN byai.byai_task.agent_name IS 'Agent名称';
COMMENT ON COLUMN byai.byai_task.branch_name IS '关联分支';
COMMENT ON COLUMN byai.byai_task.warning_tag IS '告警标签';
COMMENT ON COLUMN byai.byai_task.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_task.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_task.delete_flag IS '删除标记 0正常 1删除';

CREATE INDEX IF NOT EXISTS idx_task_project ON byai.byai_task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON byai.byai_task(status);

-- 项目成员表
CREATE TABLE IF NOT EXISTS byai.byai_project_member (
    member_id       BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    user_id         VARCHAR(64)     NOT NULL,
    user_code       VARCHAR(64),
    user_name       VARCHAR(128),
    role            VARCHAR(32)     DEFAULT 'member',
    agent_id        BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_project_member PRIMARY KEY (member_id)
);

COMMENT ON TABLE byai.byai_project_member IS '项目成员表';
COMMENT ON COLUMN byai.byai_project_member.member_id IS '记录ID';
COMMENT ON COLUMN byai.byai_project_member.project_id IS '项目ID';
COMMENT ON COLUMN byai.byai_project_member.user_id IS '用户ID';
COMMENT ON COLUMN byai.byai_project_member.user_code IS '工号';
COMMENT ON COLUMN byai.byai_project_member.user_name IS '用户名称';
COMMENT ON COLUMN byai.byai_project_member.role IS '角色: owner/member';
COMMENT ON COLUMN byai.byai_project_member.agent_id IS '关联的默认数字员工ID';
COMMENT ON COLUMN byai.byai_project_member.create_time IS '加入时间';

CREATE INDEX IF NOT EXISTS idx_project_member_project ON byai.byai_project_member(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_member_unique ON byai.byai_project_member(project_id, user_id);
