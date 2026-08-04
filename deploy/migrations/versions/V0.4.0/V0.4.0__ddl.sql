-- V0.4.0 研发闭环·集成测试环境模块
-- 集成测试环境:回答"在哪测/怎么连/怎么部署/用什么账号登录"。
-- 注意:定时(cron)和执行员工不在这里,归属"独立测试数字员工"配置(需求级,一份),避免与环境重复。
CREATE TABLE IF NOT EXISTS byai.byai_integration_env (
    env_id              BIGINT          NOT NULL,
    project_id          BIGINT          NOT NULL,
    env_name            VARCHAR(100)    NOT NULL,
    address             VARCHAR(500),
    orchestrator        VARCHAR(20)     NOT NULL DEFAULT 'script',
    conn_protocol       VARCHAR(16)     NOT NULL DEFAULT 'ssh',
    conn_host           VARCHAR(200),
    conn_port           VARCHAR(10),
    conn_user           VARCHAR(100),
    conn_auth           VARCHAR(16)     DEFAULT 'key',
    conn_credential_ref VARCHAR(200),
    conn_workdir        VARCHAR(500),
    stages              TEXT,
    test_accounts       TEXT,
    create_by           BIGINT,
    create_time         TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by           BIGINT,
    update_time         TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag         CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_integration_env PRIMARY KEY (env_id)
);

COMMENT ON TABLE byai.byai_integration_env IS '集成测试环境表:E2E 集成测试的目标环境(连接/编排/部署阶段/业务账号)';
COMMENT ON COLUMN byai.byai_integration_env.env_id IS '环境ID';
COMMENT ON COLUMN byai.byai_integration_env.project_id IS '所属研发项目ID byai_project.project_id';
COMMENT ON COLUMN byai.byai_integration_env.env_name IS '环境名称';
COMMENT ON COLUMN byai.byai_integration_env.address IS '环境访问地址(被测应用入口)';
COMMENT ON COLUMN byai.byai_integration_env.orchestrator IS '编排方式 script脚本/jenkins/k8s/webhook';
COMMENT ON COLUMN byai.byai_integration_env.conn_protocol IS '连接方式 ssh远程/local本机';
COMMENT ON COLUMN byai.byai_integration_env.conn_host IS 'SSH主机地址';
COMMENT ON COLUMN byai.byai_integration_env.conn_port IS 'SSH端口';
COMMENT ON COLUMN byai.byai_integration_env.conn_user IS 'SSH登录用户';
COMMENT ON COLUMN byai.byai_integration_env.conn_auth IS 'SSH认证方式 key密钥/password密码';
COMMENT ON COLUMN byai.byai_integration_env.conn_credential_ref IS '连接凭据key,指向 ~/.openclaw/credentials/,不存明文';
COMMENT ON COLUMN byai.byai_integration_env.conn_workdir IS '远程/本机工作目录';
COMMENT ON COLUMN byai.byai_integration_env.stages IS '部署/准备阶段脚本数组JSON:[{id,name,interpreter,source,script,workdir,timeoutSec,continueOnError}]';
COMMENT ON COLUMN byai.byai_integration_env.test_accounts IS '业务测试账号数组JSON:[{id,role,envPrefix,username,credentialRef}],密码只存凭据key不入库';
COMMENT ON COLUMN byai.byai_integration_env.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_integration_env.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_integration_env.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_integration_env.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_integration_env.delete_flag IS '删除标记 0正常 1删除';

CREATE INDEX IF NOT EXISTS idx_integration_env_project ON byai.byai_integration_env (project_id);

-- 端到端测试用例集:自动化套件(pytest/playwright/jest/vitest/custom)按运行命令执行、按JUnit报告收结果;
-- manual 套件是人工检查清单,清单本身不入库(在仓库文件里),这里只登记 manual_file 路径。
CREATE TABLE IF NOT EXISTS byai.byai_integration_suite (
    suite_id        BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    suite_name      VARCHAR(100)    NOT NULL,
    runner          VARCHAR(20)     NOT NULL DEFAULT 'pytest',
    source_type     VARCHAR(16)     NOT NULL DEFAULT 'git',
    repo_id         BIGINT,
    source          VARCHAR(500),
    branch          VARCHAR(100),
    run_command     VARCHAR(1000),
    workdir         VARCHAR(500),
    report_path     VARCHAR(500),
    case_count      INT             DEFAULT 0,
    enabled         CHAR(1)         DEFAULT '1',
    manual_file     VARCHAR(500),
    create_by       BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by       BIGINT,
    update_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_integration_suite PRIMARY KEY (suite_id)
);

COMMENT ON TABLE byai.byai_integration_suite IS '端到端测试用例集表:自动化/人工套件的运行入口与结果解析规约';
COMMENT ON COLUMN byai.byai_integration_suite.suite_id IS '用例集ID';
COMMENT ON COLUMN byai.byai_integration_suite.project_id IS '所属研发项目ID byai_project.project_id';
COMMENT ON COLUMN byai.byai_integration_suite.suite_name IS '用例集名称';
COMMENT ON COLUMN byai.byai_integration_suite.runner IS '执行器 pytest/playwright/jest/vitest/custom/manual';
COMMENT ON COLUMN byai.byai_integration_suite.source_type IS '来源类型 git独立测试工程仓库/shared共享空间用例目录;manual套件无来源仓库';
COMMENT ON COLUMN byai.byai_integration_suite.repo_id IS '仅git来源:关联项目仓库ID byai_project_repo.repo_id;仓库改名/换URL不失效';
COMMENT ON COLUMN byai.byai_integration_suite.source IS '来源:shared共享目录路径;git来源冗余存仓库URL供展示,权威关联走repo_id';
COMMENT ON COLUMN byai.byai_integration_suite.branch IS 'git来源分支';
COMMENT ON COLUMN byai.byai_integration_suite.run_command IS '运行命令(自动化套件);manual套件为空';
COMMENT ON COLUMN byai.byai_integration_suite.workdir IS '运行工作目录';
COMMENT ON COLUMN byai.byai_integration_suite.report_path IS 'JUnit XML报告相对路径,后端据此汇总通过率;manual套件为空';
COMMENT ON COLUMN byai.byai_integration_suite.case_count IS '用例数量(展示用)';
COMMENT ON COLUMN byai.byai_integration_suite.enabled IS '是否启用 1启用 0停用';
COMMENT ON COLUMN byai.byai_integration_suite.manual_file IS '仅manual套件:仓库内清单文件路径;清单本身不入库,平台读取该文件解析预览';
COMMENT ON COLUMN byai.byai_integration_suite.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_integration_suite.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_integration_suite.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_integration_suite.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_integration_suite.delete_flag IS '删除标记 0正常 1删除';

CREATE INDEX IF NOT EXISTS idx_integration_suite_project ON byai.byai_integration_suite (project_id);

-- 一次「执行测试」的主记录:SSH 连上环境跑 stages + 用例集 runCommand,采集 JUnit 汇总。
-- status 与前端 IntegrationRunResult 契约对齐:running(执行中)/passed/failed/error/timeout。
CREATE TABLE IF NOT EXISTS byai.byai_integration_run (
    run_id          BIGINT          NOT NULL,
    project_id      BIGINT          NOT NULL,
    suite_id        BIGINT          NOT NULL,
    env_id          BIGINT          NOT NULL,
    status          VARCHAR(16)     NOT NULL DEFAULT 'running',
    branch          VARCHAR(100),
    commit_ref      VARCHAR(100),
    total           INT             DEFAULT 0,
    passed          INT             DEFAULT 0,
    failed          INT             DEFAULT 0,
    skipped         INT             DEFAULT 0,
    kickback_to     VARCHAR(32),
    reason          VARCHAR(1000),
    result_dir      VARCHAR(500),
    suites_json     TEXT,
    started_at      TIMESTAMP,
    finished_at     TIMESTAMP,
    duration_sec    INT             DEFAULT 0,
    create_by       BIGINT,
    create_time     TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag     CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_integration_run PRIMARY KEY (run_id)
);

COMMENT ON TABLE byai.byai_integration_run IS '集成测试执行记录表:一次「执行测试」的主记录与汇总结果';
COMMENT ON COLUMN byai.byai_integration_run.run_id IS '执行ID';
COMMENT ON COLUMN byai.byai_integration_run.project_id IS '所属研发项目ID';
COMMENT ON COLUMN byai.byai_integration_run.suite_id IS '被执行的测试用例集ID byai_integration_suite.suite_id';
COMMENT ON COLUMN byai.byai_integration_run.env_id IS '执行所用集成测试环境ID byai_integration_env.env_id';
COMMENT ON COLUMN byai.byai_integration_run.status IS '执行状态 running执行中/passed通过/failed失败/error异常/timeout超时';
COMMENT ON COLUMN byai.byai_integration_run.branch IS '被测分支(展示用)';
COMMENT ON COLUMN byai.byai_integration_run.commit_ref IS '被测提交(展示用)';
COMMENT ON COLUMN byai.byai_integration_run.total IS '用例总数(JUnit汇总)';
COMMENT ON COLUMN byai.byai_integration_run.passed IS '通过数';
COMMENT ON COLUMN byai.byai_integration_run.failed IS '失败数';
COMMENT ON COLUMN byai.byai_integration_run.skipped IS '跳过数';
COMMENT ON COLUMN byai.byai_integration_run.kickback_to IS '打回目标环节(失败时记录,自动回灌dev-loop留V2);成功为空';
COMMENT ON COLUMN byai.byai_integration_run.reason IS '失败/异常原因;成功为空';
COMMENT ON COLUMN byai.byai_integration_run.result_dir IS '远程结果目录(完整日志/报告/截图落地处)';
COMMENT ON COLUMN byai.byai_integration_run.suites_json IS 'JUnit解析出的套件结果数组JSON,对齐前端IntegrationRunSuiteResult(含failedCases)';
COMMENT ON COLUMN byai.byai_integration_run.started_at IS '开始时间';
COMMENT ON COLUMN byai.byai_integration_run.finished_at IS '结束时间';
COMMENT ON COLUMN byai.byai_integration_run.duration_sec IS '总耗时(秒)';
COMMENT ON COLUMN byai.byai_integration_run.create_by IS '触发人';
COMMENT ON COLUMN byai.byai_integration_run.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_integration_run.delete_flag IS '删除标记 0正常 1删除';

CREATE INDEX IF NOT EXISTS idx_integration_run_suite ON byai.byai_integration_run (suite_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_integration_run_project ON byai.byai_integration_run (project_id);

-- run 内每一步(环境stage 或 用例集命令)的执行明细,按 seq 有序;日志截断存尾部,完整日志在远程 result_dir。
CREATE TABLE IF NOT EXISTS byai.byai_integration_run_step (
    step_id         BIGINT          NOT NULL,
    run_id          BIGINT          NOT NULL,
    seq             INT             NOT NULL,
    step_type       VARCHAR(16)     NOT NULL,
    step_name       VARCHAR(200),
    exit_code       INT,
    status          VARCHAR(16),
    duration_sec    INT             DEFAULT 0,
    log_text        TEXT,
    started_at      TIMESTAMP,
    finished_at     TIMESTAMP,
    CONSTRAINT pk_byai_integration_run_step PRIMARY KEY (step_id)
);

COMMENT ON TABLE byai.byai_integration_run_step IS '集成测试执行步骤明细表:一次run内的每个stage/命令的退出码与日志';
COMMENT ON COLUMN byai.byai_integration_run_step.step_id IS '步骤ID';
COMMENT ON COLUMN byai.byai_integration_run_step.run_id IS '所属执行ID byai_integration_run.run_id';
COMMENT ON COLUMN byai.byai_integration_run_step.seq IS '步骤顺序号(从0递增)';
COMMENT ON COLUMN byai.byai_integration_run_step.step_type IS '步骤类型 stage环境阶段/suite用例集命令';
COMMENT ON COLUMN byai.byai_integration_run_step.step_name IS '步骤名称';
COMMENT ON COLUMN byai.byai_integration_run_step.exit_code IS '命令退出码';
COMMENT ON COLUMN byai.byai_integration_run_step.status IS '步骤状态 running/passed/failed/error/timeout/skipped';
COMMENT ON COLUMN byai.byai_integration_run_step.duration_sec IS '耗时(秒)';
COMMENT ON COLUMN byai.byai_integration_run_step.log_text IS 'stdout/stderr合并日志(截断存尾部,避免膨胀);完整日志在远程result_dir';
COMMENT ON COLUMN byai.byai_integration_run_step.started_at IS '开始时间';
COMMENT ON COLUMN byai.byai_integration_run_step.finished_at IS '结束时间';

CREATE INDEX IF NOT EXISTS idx_integration_run_step_run ON byai.byai_integration_run_step (run_id, seq);

-- 运营需求独立于研发扫描结果表，避免运营状态和任务配置影响钉钉、GitHub 等扫描需求。
CREATE TABLE IF NOT EXISTS byai.byai_operation_requirement (
    item_id         BIGINT       NOT NULL,
    project_id      BIGINT       NOT NULL,
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    operation_type  VARCHAR(20)  NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'todo',
    assignee        BIGINT,
    due_time        TIMESTAMP,
    progress        INT          NOT NULL DEFAULT 0,
    config          TEXT,
    create_by       BIGINT,
    create_time     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    update_by       BIGINT,
    update_time     TIMESTAMP,
    delete_flag     CHAR(1)      DEFAULT '0',
    CONSTRAINT pk_byai_operation_requirement PRIMARY KEY (item_id)
);

COMMENT ON TABLE byai.byai_operation_requirement IS '运营需求表，与研发扫描结果表和历史扫描条目表隔离';
COMMENT ON COLUMN byai.byai_operation_requirement.item_id IS '运营需求ID';
COMMENT ON COLUMN byai.byai_operation_requirement.project_id IS '所属运营项目ID';
COMMENT ON COLUMN byai.byai_operation_requirement.title IS '需求名称';
COMMENT ON COLUMN byai.byai_operation_requirement.description IS '需求描述';
COMMENT ON COLUMN byai.byai_operation_requirement.operation_type IS '运营需求类型：collect、publish、analyze';
COMMENT ON COLUMN byai.byai_operation_requirement.status IS '状态：todo、launched、doing、pendingReview、done、cancelled';
COMMENT ON COLUMN byai.byai_operation_requirement.assignee IS '负责人用户ID';
COMMENT ON COLUMN byai.byai_operation_requirement.due_time IS '完成时间';
COMMENT ON COLUMN byai.byai_operation_requirement.progress IS '任务进度，范围0至100';
COMMENT ON COLUMN byai.byai_operation_requirement.config IS '运营类型专属配置JSON';
COMMENT ON COLUMN byai.byai_operation_requirement.delete_flag IS '删除标识：0有效，1删除';

CREATE INDEX IF NOT EXISTS idx_operation_requirement_project ON byai.byai_operation_requirement (project_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_operation_requirement_assignee ON byai.byai_operation_requirement (project_id, assignee);
CREATE INDEX IF NOT EXISTS idx_operation_requirement_due_time ON byai.byai_operation_requirement (project_id, due_time);

-- 运营需求启动后可拆分为多个任务，任务执行状态与原始需求分表维护，便于追溯与重试。
CREATE TABLE IF NOT EXISTS byai.byai_operation_task (
    task_id         BIGINT       NOT NULL,
    requirement_id  BIGINT       NOT NULL,
    project_id      BIGINT       NOT NULL,
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    operation_type  VARCHAR(20)  NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'todo',
    assignee        BIGINT,
    due_time        TIMESTAMP,
    progress        INT          NOT NULL DEFAULT 0,
    config          TEXT,
    agent_selection TEXT,
    workflow        TEXT,
    session_id      BIGINT,
    create_by       BIGINT,
    create_time     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    update_by       BIGINT,
    update_time     TIMESTAMP,
    delete_flag     CHAR(1)      DEFAULT '0',
    CONSTRAINT pk_byai_operation_task PRIMARY KEY (task_id)
);

COMMENT ON TABLE byai.byai_operation_task IS '运营任务表，由运营需求启动后拆解生成';
COMMENT ON COLUMN byai.byai_operation_task.task_id IS '运营任务ID';
COMMENT ON COLUMN byai.byai_operation_task.requirement_id IS '来源运营需求ID';
COMMENT ON COLUMN byai.byai_operation_task.project_id IS '所属运营项目ID';
COMMENT ON COLUMN byai.byai_operation_task.operation_type IS '运营任务类型：collect、publish、analyze';
COMMENT ON COLUMN byai.byai_operation_task.status IS '任务状态：todo、doing、pendingReview、done、failed、cancelled';
COMMENT ON COLUMN byai.byai_operation_task.config IS '从运营需求继承的类型配置JSON';
COMMENT ON COLUMN byai.byai_operation_task.agent_selection IS '确认执行的数字员工ID列表JSON';
COMMENT ON COLUMN byai.byai_operation_task.workflow IS '运营工作流步骤及状态JSON';
COMMENT ON COLUMN byai.byai_operation_task.session_id IS '执行运营任务后关联的主会话ID';
COMMENT ON COLUMN byai.byai_operation_task.delete_flag IS '删除标识：0有效，1删除';

CREATE INDEX IF NOT EXISTS idx_operation_task_project ON byai.byai_operation_task (project_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_operation_task_requirement ON byai.byai_operation_task (requirement_id, create_time ASC);
CREATE INDEX IF NOT EXISTS idx_operation_task_assignee ON byai.byai_operation_task (project_id, assignee, create_time DESC);


CREATE TABLE byai_project_account
(
    account_id    BIGINT      NOT NULL,
    project_id    BIGINT      NOT NULL,
    platform_code VARCHAR(20) NOT NULL,
    account_code  VARCHAR(100),
    account_name  VARCHAR(100),
    status        VARCHAR(20) NOT NULL DEFAULT 'connected',
    login_status  VARCHAR(20),
    config        TEXT,
    metrics       TEXT,
    create_by     BIGINT,
    create_time   TIMESTAMP            DEFAULT CURRENT_TIMESTAMP,
    update_by     BIGINT,
    update_time   TIMESTAMP,
    status_cd     CHAR(3)              DEFAULT '00A',

    CONSTRAINT pk_byai_project_account PRIMARY KEY (account_id)
);

COMMENT ON TABLE byai_project_account IS '运营账号表';
COMMENT ON COLUMN byai_project_account.account_id IS '账号ID（PK）';
COMMENT ON COLUMN byai_project_account.project_id IS '所属项目ID → byai_project.project_id';
COMMENT ON COLUMN byai_project_account.platform_code IS '平台编码：WeChatAccount-微信公众号 / Xiaohongshu-小红书 / WeChatChannels-视频号 / Internet-互联网 / GitHub-GitHub';
COMMENT ON COLUMN byai_project_account.account_code IS '账号编码（平台账号唯一标识，如 oa-beyond-ai）';
COMMENT ON COLUMN byai_project_account.account_name IS '账号名称（如 BeyondAI实验室）';
COMMENT ON COLUMN byai_project_account.status IS '连接状态：connected-已连接 / disconnected-未连接';
COMMENT ON COLUMN byai_project_account.login_status IS '登录状态：online-已登录 / offline-未登录';
COMMENT ON COLUMN byai_project_account.config IS '账号配置，TEXT 存 JSON 字符串（粉丝数、作品数等静态概要）';
COMMENT ON COLUMN byai_project_account.metrics IS '运营指标，TEXT 存 JSON 字符串：{"followers":"12.8万","works":"286","reads":"34.6万","growth":"+8.4%"}';
COMMENT ON COLUMN byai_project_account.create_by IS '创建人';
COMMENT ON COLUMN byai_project_account.create_time IS '创建时间';
COMMENT ON COLUMN byai_project_account.update_by IS '更新人';
COMMENT ON COLUMN byai_project_account.update_time IS '更新时间';
COMMENT ON COLUMN byai_project_account.status_cd IS '状态：00A-有效 / 00X-无效';


/**账号-发布作品明细表**/
CREATE TABLE byai_project_account_work
(
    work_id           BIGINT       NOT NULL,
    account_id        BIGINT       NOT NULL,
    work_title        VARCHAR(500) NOT NULL,
    work_type         VARCHAR(20)  NOT NULL,
    work_url          VARCHAR(1000),
    cover_url         VARCHAR(1000),
    publish_time      TIMESTAMP,
    status            VARCHAR(20) DEFAULT 'normal',
    read_count        BIGINT      DEFAULT 0,
    like_count        BIGINT      DEFAULT 0,
    comment_count     BIGINT      DEFAULT 0,
    favorite_count    BIGINT      DEFAULT 0,
    share_count       BIGINT      DEFAULT 0,
    interaction_count BIGINT      DEFAULT 0,
    interaction_rate  NUMERIC(5, 2),
    metrics           TEXT,
    ext_count_1       BIGINT      DEFAULT 0,
    ext_count_2       BIGINT      DEFAULT 0,
    ext_count_3       BIGINT      DEFAULT 0,
    ext_count_4       BIGINT      DEFAULT 0,
    ext_count_5       BIGINT      DEFAULT 0,
    ext_count_6       BIGINT      DEFAULT 0,
    ext_count_7       BIGINT      DEFAULT 0,
    ext_count_8       BIGINT      DEFAULT 0,
    ext_count_9       BIGINT      DEFAULT 0,
    ext_count_10      BIGINT      DEFAULT 0,
    create_by         BIGINT,
    create_time       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    update_by         BIGINT,
    update_time       TIMESTAMP,
    status_cd         CHAR(3)     DEFAULT '00A',

    CONSTRAINT pk_byai_project_account_work PRIMARY KEY (work_id)
);

COMMENT ON TABLE byai_project_account_work IS '账号-发布作品明细表';
COMMENT ON COLUMN byai_project_account_work.work_id IS '作品ID（PK）';
COMMENT ON COLUMN byai_project_account_work.account_id IS '所属账号ID → byai_project_account.account_id';
COMMENT ON COLUMN byai_project_account_work.work_title IS '作品标题';
COMMENT ON COLUMN byai_project_account_work.work_type IS '作品类型：article-文章 / post-笔记 / short-video-短视频';
COMMENT ON COLUMN byai_project_account_work.work_url IS '作品链接';
COMMENT ON COLUMN byai_project_account_work.cover_url IS '封面图链接';
COMMENT ON COLUMN byai_project_account_work.publish_time IS '发布时间';
COMMENT ON COLUMN byai_project_account_work.status IS '状态：normal-正常 / hidden-隐藏 / deleted-已删除';
COMMENT ON COLUMN byai_project_account_work.read_count IS '阅读量/播放量';
COMMENT ON COLUMN byai_project_account_work.like_count IS '点赞数';
COMMENT ON COLUMN byai_project_account_work.comment_count IS '评论数';
COMMENT ON COLUMN byai_project_account_work.favorite_count IS '收藏数';
COMMENT ON COLUMN byai_project_account_work.share_count IS '分享/转发数';
COMMENT ON COLUMN byai_project_account_work.interaction_count IS '互动总数';
COMMENT ON COLUMN byai_project_account_work.interaction_rate IS '互动率（百分比，0–100.00）';
COMMENT ON COLUMN byai_project_account_work.metrics IS '扩展指标，TEXT 存 JSON 字符串';
COMMENT ON COLUMN byai_project_account_work.ext_count_1 IS '扩展统计列1';
COMMENT ON COLUMN byai_project_account_work.ext_count_2 IS '扩展统计列2';
COMMENT ON COLUMN byai_project_account_work.ext_count_3 IS '扩展统计列3';
COMMENT ON COLUMN byai_project_account_work.ext_count_4 IS '扩展统计列4';
COMMENT ON COLUMN byai_project_account_work.ext_count_5 IS '扩展统计列5';
COMMENT ON COLUMN byai_project_account_work.ext_count_6 IS '扩展统计列6';
COMMENT ON COLUMN byai_project_account_work.ext_count_7 IS '扩展统计列7';
COMMENT ON COLUMN byai_project_account_work.ext_count_8 IS '扩展统计列8';
COMMENT ON COLUMN byai_project_account_work.ext_count_9 IS '扩展统计列9';
COMMENT ON COLUMN byai_project_account_work.ext_count_10 IS '扩展统计列10';
COMMENT ON COLUMN byai_project_account_work.create_by IS '创建人';
COMMENT ON COLUMN byai_project_account_work.create_time IS '创建时间';
COMMENT ON COLUMN byai_project_account_work.update_by IS '更新人';
COMMENT ON COLUMN byai_project_account_work.update_time IS '更新时间';
COMMENT ON COLUMN byai_project_account_work.status_cd IS '状态：00A-有效 / 00X-无效';

-- 默认数字员工:三种固定角色(架构/代码/测试)的兜底员工配置。
-- 作用域用 project_id 区分:project_id=0 为全局默认行,>0 为该项目的覆盖行。
-- 项目某角色列为空 => 该角色回退到全局默认;全局也为空 => 未配置。
-- 单表两级(global+override)在读取时合并,避免层级表与自关联;冗余存 *_agent_name 供展示,改名不即时失效由上层刷新。
CREATE TABLE IF NOT EXISTS byai.byai_default_agent (
    id                  BIGINT          NOT NULL,
    project_id          BIGINT          NOT NULL DEFAULT 0,
    architect_agent_id  VARCHAR(64),
    architect_agent_name VARCHAR(200),
    coder_agent_id      VARCHAR(64),
    coder_agent_name    VARCHAR(200),
    tester_agent_id     VARCHAR(64),
    tester_agent_name   VARCHAR(200),
    create_by           BIGINT,
    create_time         TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by           BIGINT,
    update_time         TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag         CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_default_agent PRIMARY KEY (id)
);
COMMENT ON TABLE byai.byai_default_agent IS '默认数字员工表:架构/代码/测试三角色的兜底员工;project_id=0为全局默认,>0为项目覆盖';
COMMENT ON COLUMN byai.byai_default_agent.id IS '主键ID';
COMMENT ON COLUMN byai.byai_default_agent.project_id IS '作用域:0全局默认行,>0该研发项目覆盖行 byai_project.project_id';
COMMENT ON COLUMN byai.byai_default_agent.architect_agent_id IS '架构数字员工ID(资源ID);空表示该角色回退全局默认';
COMMENT ON COLUMN byai.byai_default_agent.architect_agent_name IS '架构数字员工名称(冗余展示)';
COMMENT ON COLUMN byai.byai_default_agent.coder_agent_id IS '代码数字员工ID(资源ID);空表示该角色回退全局默认';
COMMENT ON COLUMN byai.byai_default_agent.coder_agent_name IS '代码数字员工名称(冗余展示)';
COMMENT ON COLUMN byai.byai_default_agent.tester_agent_id IS '测试数字员工ID(资源ID);空表示该角色回退全局默认';
COMMENT ON COLUMN byai.byai_default_agent.tester_agent_name IS '测试数字员工名称(冗余展示)';
COMMENT ON COLUMN byai.byai_default_agent.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_default_agent.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_default_agent.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_default_agent.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_default_agent.delete_flag IS '删除标记 0正常 1删除';
-- 每个作用域仅一行有效配置(全局或某项目),按 project_id 唯一(仅未删除行)。
CREATE UNIQUE INDEX IF NOT EXISTS uk_default_agent_project ON byai.byai_default_agent (project_id) WHERE delete_flag = '0';

-- ==========================================================================
-- 独立测试数字员工配置表:需求级集成的「谁测/何时测/失败怎么打回」总开关(项目级唯一)。
-- 执行员工不在此表,统一取全局「测试数字员工」默认(byai_default_agent 解析),此处只存节流/准入/打回策略。
-- 扁平列对齐前端 TesterConfig(schedule/admission/kickback 三组);每项目仅一行有效配置,upsert。
-- ==========================================================================
CREATE TABLE IF NOT EXISTS byai.byai_tester_config (
    id                          BIGINT          NOT NULL,
    project_id                  BIGINT          NOT NULL,
    enabled                     CHAR(1)         DEFAULT '1',
    cron                        VARCHAR(64),
    cron_label                  VARCHAR(64),
    timezone                    VARCHAR(64)     DEFAULT 'Asia/Shanghai',
    require_all_coded           CHAR(1)         DEFAULT '1',
    max_concurrent_reqs         INTEGER         DEFAULT 2,
    auto_attribute              CHAR(1)         DEFAULT '1',
    create_defect_when_unclear  CHAR(1)         DEFAULT '1',
    max_rounds                  INTEGER         DEFAULT 3,
    create_by                   BIGINT,
    create_time                 TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    update_by                   BIGINT,
    update_time                 TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    delete_flag                 CHAR(1)         DEFAULT '0',
    CONSTRAINT pk_byai_tester_config PRIMARY KEY (id)
);
COMMENT ON TABLE byai.byai_tester_config IS '独立测试数字员工配置表:需求级集成的定时节流+就绪准入+失败打回策略;每研发项目一行,执行员工取全局测试默认';
COMMENT ON COLUMN byai.byai_tester_config.id IS '主键ID';
COMMENT ON COLUMN byai.byai_tester_config.project_id IS '所属研发项目ID byai_project.project_id';
COMMENT ON COLUMN byai.byai_tester_config.enabled IS '是否启用定时批量集成 1启用 0停用(停用退回人工触发)';
COMMENT ON COLUMN byai.byai_tester_config.cron IS '标准5段cron,决定「多久看一次」,如 0 2 * * *';
COMMENT ON COLUMN byai.byai_tester_config.cron_label IS 'cron人话展示,如 每日 02:00';
COMMENT ON COLUMN byai.byai_tester_config.timezone IS '计算下次运行的时区,如 Asia/Shanghai';
COMMENT ON COLUMN byai.byai_tester_config.require_all_coded IS '就绪门禁:需求下所有子任务都coded才纳入本轮 1是 0否';
COMMENT ON COLUMN byai.byai_tester_config.max_concurrent_reqs IS '单轮最多并行几个需求的E2E,防打满集成环境';
COMMENT ON COLUMN byai.byai_tester_config.auto_attribute IS '失败按依赖图自动归因并打回责任任务编码环节 1是 0否';
COMMENT ON COLUMN byai.byai_tester_config.create_defect_when_unclear IS '归因不清时新建集成缺陷任务 1是 0否';
COMMENT ON COLUMN byai.byai_tester_config.max_rounds IS '同一需求最多自动打回轮次,超过升级人工介入';
COMMENT ON COLUMN byai.byai_tester_config.create_by IS '创建人';
COMMENT ON COLUMN byai.byai_tester_config.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_tester_config.update_by IS '更新人';
COMMENT ON COLUMN byai.byai_tester_config.update_time IS '更新时间';
COMMENT ON COLUMN byai.byai_tester_config.delete_flag IS '删除标记 0正常 1删除';
-- 每个项目仅一行有效配置,按 project_id 唯一(仅未删除行)。
CREATE UNIQUE INDEX IF NOT EXISTS uk_tester_config_project ON byai.byai_tester_config (project_id) WHERE delete_flag = '0';

-- 研发需求拆解为多仓库子任务,支撑需求级批量集成:一个 scan_log_item 可跨多个仓库各起一个会话。
-- 需求就绪=其下所有子任务的 coder 环节 done;每子任务的环节由 DevloopPhaseService 从会话消息实时投影,不落库。
CREATE TABLE IF NOT EXISTS byai.byai_scan_item_task (
    task_id         BIGINT       NOT NULL,
    requirement_id  BIGINT       NOT NULL,
    project_id      BIGINT       NOT NULL,
    repo_id         BIGINT,
    session_id      BIGINT,
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    create_by       BIGINT,
    create_time     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    update_by       BIGINT,
    update_time     TIMESTAMP,
    delete_flag     CHAR(1)      DEFAULT '0',
    CONSTRAINT pk_byai_scan_item_task PRIMARY KEY (task_id)
);

COMMENT ON TABLE byai.byai_scan_item_task IS '研发需求子任务表:一条研发需求(byai_scan_log_item)拆到多个仓库各一个会话,支撑需求级就绪批量集成';
COMMENT ON COLUMN byai.byai_scan_item_task.task_id IS '子任务ID';
COMMENT ON COLUMN byai.byai_scan_item_task.requirement_id IS '来源研发需求ID byai_scan_log_item.item_id';
COMMENT ON COLUMN byai.byai_scan_item_task.project_id IS '所属研发项目ID byai_project.project_id';
COMMENT ON COLUMN byai.byai_scan_item_task.repo_id IS '目标仓库ID byai_project_repo.repo_id;单仓库需求可空';
COMMENT ON COLUMN byai.byai_scan_item_task.session_id IS '执行该仓库工作的会话ID byai_session.session_id;启动前为空';
COMMENT ON COLUMN byai.byai_scan_item_task.status IS '子任务状态 pending待启动/running进行中/done完成/failed失败';
COMMENT ON COLUMN byai.byai_scan_item_task.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_scan_item_task.delete_flag IS '删除标记 0正常 1删除';

-- 同一需求同一仓库只保留一条有效子任务(仅未删除行)。
CREATE UNIQUE INDEX IF NOT EXISTS uk_scan_item_task_req_repo ON byai.byai_scan_item_task (requirement_id, repo_id) WHERE delete_flag = '0';
CREATE INDEX IF NOT EXISTS idx_scan_item_task_project ON byai.byai_scan_item_task (project_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_scan_item_task_session ON byai.byai_scan_item_task (session_id);

-- 集成执行记录挂上需求维度:需求级批量把每个 run 关联到触发它的需求,聚合看板与失败打回按此反查。
ALTER TABLE byai.byai_integration_run ADD COLUMN IF NOT EXISTS requirement_id BIGINT;
COMMENT ON COLUMN byai.byai_integration_run.requirement_id IS '触发本次执行的研发需求ID byai_scan_log_item.item_id;人工单套件执行可空';
CREATE INDEX IF NOT EXISTS idx_integration_run_requirement ON byai.byai_integration_run (requirement_id, create_time DESC);
ALTER TABLE byai.byai_integration_run ADD COLUMN IF NOT EXISTS kickback_at TIMESTAMP;
COMMENT ON COLUMN byai.byai_integration_run.kickback_at IS '失败打回引擎处理本次执行的时间;非空表示已处理(驱动重工或建缺陷),幂等去重用';
