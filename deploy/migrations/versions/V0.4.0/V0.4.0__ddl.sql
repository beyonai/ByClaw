-- V0.4.0 研发闭环·集成测试环境模块
-- 集成测试环境:回答"在哪测/怎么连/怎么部署/用什么账号登录"。
-- 注意:定时(cron)和执行员工不在这里,归属"独立测试数字员工"配置(需求级,一份),避免与环境重复。

-- 连接器授权记录允许在连接器模板重建时保留历史数据，不能被连接器信息表的外键阻塞。
-- 约束删除是幂等的，兼容已执行过部分迁移的环境。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_byai_connector_auth_connector'
          AND conrelid = 'byai.byai_connector_auth'::regclass
    ) THEN
        ALTER TABLE byai.byai_connector_auth
            DROP CONSTRAINT fk_byai_connector_auth_connector;
    END IF;
END
$$;
-- OpenGauss 不支持 ADD COLUMN 的 IF NOT EXISTS 形式，统一通过信息架构表做幂等判断。
CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema_name
          AND table_name = p_table_name
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
            || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS byai.byai_integration_env (
    env_id              BIGINT          NOT NULL,
    project_id          BIGINT          NOT NULL,
    env_name            VARCHAR(100)    NOT NULL,
    address             VARCHAR(500),
    orchestrator        VARCHAR(20)     NOT NULL DEFAULT 'script',
    case_source         VARCHAR(16),
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
-- 用例来源并入环境配置:用例集不再是用户必填的独立概念。
-- workspace:用例由测试助理写进工作区仓库(byai_project_repo.repo_type='workspace'),
-- 按约定路径 tests/run.sh 执行,平台不再要用户填仓库/分支/运行命令。新建环境由后端显式赋这个值。
-- on_env:用例已由运维预置在环境机上,沿用 byai_integration_suite 的既有配置(界面勾选后联动)。
-- 不给 DEFAULT:NULL 在运行时按 on_env 解释(见 IntegrationRunExecutor.casesOnEnvMachine),
-- 让存量环境在"代码已上、回填未跑"的窗口期保住既有行为;新建行由应用层显式赋 workspace。
COMMENT ON COLUMN byai.byai_integration_env.case_source IS '用例来源 workspace跟随工作区仓库(约定 tests/run.sh)/on_env用例已在环境机上';
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
COMMENT ON COLUMN byai.byai_integration_suite.source_type IS '来源类型 code沿用开发已检出目录(免克隆)/standalone克隆指定用例仓库/env用例已在环境机上(跳过克隆,按环境连接方式登录执行);manual套件无来源仓库';
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
    requirement_id  BIGINT,
    status          VARCHAR(16)     NOT NULL DEFAULT 'running',
    branch          VARCHAR(100),
    commit_ref      VARCHAR(100),
    total           INT             DEFAULT 0,
    passed          INT             DEFAULT 0,
    failed          INT             DEFAULT 0,
    skipped         INT             DEFAULT 0,
    kickback_to     VARCHAR(32),
    kickback_at     TIMESTAMP,
    reason          VARCHAR(1000),
    result_dir      VARCHAR(500),
    suites_json     TEXT,
    session_id        BIGINT,
    tester_agent_id   BIGINT,
    tester_agent_name VARCHAR(200),
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
COMMENT ON COLUMN byai.byai_integration_run.requirement_id IS '触发本次执行的研发需求ID byai_scan_log_item.item_id;人工单套件执行可空';
COMMENT ON COLUMN byai.byai_integration_run.status IS '执行状态 running执行中/passed通过/failed失败/error异常/timeout超时';
COMMENT ON COLUMN byai.byai_integration_run.branch IS '被测分支(展示用)';
COMMENT ON COLUMN byai.byai_integration_run.commit_ref IS '被测提交(展示用)';
COMMENT ON COLUMN byai.byai_integration_run.total IS '用例总数(JUnit汇总)';
COMMENT ON COLUMN byai.byai_integration_run.passed IS '通过数';
COMMENT ON COLUMN byai.byai_integration_run.failed IS '失败数';
COMMENT ON COLUMN byai.byai_integration_run.skipped IS '跳过数';
COMMENT ON COLUMN byai.byai_integration_run.kickback_to IS '打回目标环节(失败时记录,自动回灌dev-loop留V2);成功为空';
COMMENT ON COLUMN byai.byai_integration_run.kickback_at IS '失败打回引擎处理本次执行的时间;非空表示已处理(驱动重工或建缺陷),幂等去重用';
COMMENT ON COLUMN byai.byai_integration_run.reason IS '失败/异常原因;成功为空';
COMMENT ON COLUMN byai.byai_integration_run.result_dir IS '远程结果目录(完整日志/报告/截图落地处)';
COMMENT ON COLUMN byai.byai_integration_run.suites_json IS 'JUnit解析出的套件结果数组JSON,对齐前端IntegrationRunSuiteResult(含failedCases)';
-- 集成执行改为「测试数字员工」驱动:run 关联下发给测试员工的会话,结果由 poller 从会话回流,不再 SSH 跑用例命令解析 JUnit。
-- session_id 为空表示尚未成功下发会话(建 run 失败/无默认测试员工);poller 只回收 status=running 且 session_id 非空的行。
COMMENT ON COLUMN byai.byai_integration_run.session_id IS '承载本次测试的数字员工会话ID;结果回流 poller 按此会话读 [PHASE] tester 打点与结构化结果文件';
COMMENT ON COLUMN byai.byai_integration_run.tester_agent_id IS '执行本次测试的测试数字员工ID(下发时由 DefaultAgent 解析并冻结,便于回溯)';
COMMENT ON COLUMN byai.byai_integration_run.tester_agent_name IS '测试数字员工名称(展示用快照)';
COMMENT ON COLUMN byai.byai_integration_run.started_at IS '开始时间';
COMMENT ON COLUMN byai.byai_integration_run.finished_at IS '结束时间';
COMMENT ON COLUMN byai.byai_integration_run.duration_sec IS '总耗时(秒)';
COMMENT ON COLUMN byai.byai_integration_run.create_by IS '触发人';
COMMENT ON COLUMN byai.byai_integration_run.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_integration_run.delete_flag IS '删除标记 0正常 1删除';

CREATE INDEX IF NOT EXISTS idx_integration_run_suite ON byai.byai_integration_run (suite_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_integration_run_project ON byai.byai_integration_run (project_id);
-- 需求维度反查:需求级批量的聚合看板与失败打回都按需求拉本批 run。
CREATE INDEX IF NOT EXISTS idx_integration_run_requirement ON byai.byai_integration_run (requirement_id, create_time DESC);
-- 环境维度历史查询(用例集/环境卡片「日志」按钮按 env 反查执行列表)。
CREATE INDEX IF NOT EXISTS idx_integration_run_env ON byai.byai_integration_run (env_id, create_time DESC);

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

-- 运营需求复用扫描源主表，source_type=collect/publish/analyze 时表示运营需求。
-- 研发渠道仍使用原有类型和字段，新增列均允许为空，不改变钉钉、GitHub 扫描逻辑。
ALTER TABLE byai.byai_scan_source ALTER COLUMN source_name TYPE VARCHAR(500);
SELECT byai.add_column_if_missing('byai', 'byai_scan_source', 'source_description', 'TEXT');
SELECT byai.add_column_if_missing('byai', 'byai_scan_source', 'assignee', 'BIGINT');
SELECT byai.add_column_if_missing('byai', 'byai_scan_source', 'due_time', 'TIMESTAMP');
-- chat 型自动化是应用级的，不归属任何项目，所以 project_id 必须允许为空。
ALTER TABLE byai.byai_scan_source ALTER COLUMN project_id DROP NOT NULL;

-- 应用级自动化每次执行都写一条运行记录，但它没有项目归属，所以日志表的 project_id 同样要允许为空。
ALTER TABLE byai.byai_scan_log ALTER COLUMN project_id DROP NOT NULL;
COMMENT ON COLUMN byai.byai_scan_log.project_id IS '项目ID；应用级自动化(chat)为空';
COMMENT ON COLUMN byai.byai_scan_log.status IS '状态 success成功/failed失败/running进行中';

COMMENT ON COLUMN byai.byai_scan_source.project_id IS '所属项目ID；应用级自动化(chat)为空';
COMMENT ON COLUMN byai.byai_scan_source.source_name IS '扫描源或运营需求名称，运营需求最长500字';
COMMENT ON COLUMN byai.byai_scan_source.source_type IS '类型：研发渠道dingtalk/github_issue/dingtalk_todo/manual；运营需求collect/publish/analyze；应用级自动化chat';
COMMENT ON COLUMN byai.byai_scan_source.source_description IS '运营需求描述，研发扫描源为空';
COMMENT ON COLUMN byai.byai_scan_source.assignee IS '运营需求负责人用户ID，研发扫描源为空';
COMMENT ON COLUMN byai.byai_scan_source.due_time IS '运营需求计划完成时间，研发扫描源为空';
COMMENT ON COLUMN byai.byai_scan_source.cron_expr IS '扫描及运营采集调度Cron表达式；单次年份、双周和间隔由config、last_scan_time补充判断';
COMMENT ON COLUMN byai.byai_scan_source.config IS '研发渠道或运营需求类型专属配置JSON';

CREATE INDEX IF NOT EXISTS idx_scan_source_operation_project
    ON byai.byai_scan_source (project_id, source_type, create_time DESC);

-- 运营任务直接使用会话主表，任务名称沿用现有 session_name 字段长度（255），不修改研发会话表结构。
-- 仅为短值运营字段建索引，避免把任务配置 JSON 的 TEXT 全量写入索引。
CREATE INDEX IF NOT EXISTS idx_session_ext_operation_source
    ON byai.byai_session_ext (ext_param_value) WHERE ext_param_code = 'oploop_source_id';
CREATE INDEX IF NOT EXISTS idx_session_ext_operation_status
    ON byai.byai_session_ext (ext_param_value) WHERE ext_param_code = 'oploop_task_status';
CREATE INDEX IF NOT EXISTS idx_session_ext_operation_assignee
    ON byai.byai_session_ext (ext_param_value) WHERE ext_param_code = 'oploop_assignee_id';

CREATE TABLE byai_project_account
(
    account_id    BIGINT      NOT NULL,
    project_id    BIGINT,
    platform_code VARCHAR(20) NOT NULL,
    account_code  VARCHAR(100),
    account_name  VARCHAR(100),
    status        VARCHAR(20) NOT NULL DEFAULT 'connected',
    login_status  VARCHAR(20),
    custom_url    VARCHAR(500),
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
COMMENT ON COLUMN byai_project_account.project_id IS '所属项目ID；为空表示用户级账号，非空表示项目级账号 → byai_project.project_id';
COMMENT ON COLUMN byai_project_account.platform_code IS '平台编码：WeChatAccount-微信公众号 / Xiaohongshu-小红书 / WeChatChannels-视频号 / CustomLink-自定义链接 / Internet-互联网 / GitHub-GitHub';
COMMENT ON COLUMN byai_project_account.account_code IS '账号编码（平台账号唯一标识，如 oa-beyond-ai）';
COMMENT ON COLUMN byai_project_account.account_name IS '账号名称（如 BeyondAI实验室）';
COMMENT ON COLUMN byai_project_account.status IS '连接状态：connected-已连接 / disconnected-未连接';
COMMENT ON COLUMN byai_project_account.login_status IS '登录状态：online-已登录 / offline-未登录';
COMMENT ON COLUMN byai_project_account.custom_url IS '自定义链接平台的登录URL，仅当 platform_code = CustomLink 时使用';
COMMENT ON COLUMN byai_project_account.config IS '账号配置，TEXT 存 JSON 字符串（粉丝数、作品数等静态概要）';
COMMENT ON COLUMN byai_project_account.metrics IS '运营指标，TEXT 存 JSON 字符串：{"followers":"12.8万","works":"286","reads":"34.6万","growth":"+8.4%"}';
COMMENT ON COLUMN byai_project_account.create_by IS '创建人';
COMMENT ON COLUMN byai_project_account.create_time IS '创建时间';
COMMENT ON COLUMN byai_project_account.update_by IS '更新人';
COMMENT ON COLUMN byai_project_account.update_time IS '更新时间';
COMMENT ON COLUMN byai_project_account.status_cd IS '状态：00A-有效 / 00X-无效';

-- 为自定义链接平台添加复合索引，提高查询性能
CREATE INDEX idx_project_account_platform_custom ON byai_project_account(platform_code, custom_url);


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

-- 默认助理:四种固定角色(架构/需求/研发/测试)的兜底助理配置。
-- 作用域用 project_id 区分:project_id=0 为全局默认行,>0 为该项目的覆盖行。
-- 项目某角色列为空 => 该角色回退到全局默认;全局也为空 => 未配置。
-- 单表两级(global+override)在读取时合并,避免层级表与自关联;冗余存 *_agent_name 供展示,改名不即时失效由上层刷新。
-- coder_* 列名保留:展示文案从「代码」改为「研发」是纯口径变更,不值得为它做列改名+接口字段联动。
CREATE TABLE IF NOT EXISTS byai.byai_default_agent (
    id                  BIGINT          NOT NULL,
    project_id          BIGINT          NOT NULL DEFAULT 0,
    architect_agent_id  VARCHAR(64),
    architect_agent_name VARCHAR(200),
    requirement_agent_id VARCHAR(64),
    requirement_agent_name VARCHAR(200),
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
COMMENT ON TABLE byai.byai_default_agent IS '默认助理表:架构/需求/研发/测试四角色的兜底助理;project_id=0为全局默认,>0为项目覆盖';
COMMENT ON COLUMN byai.byai_default_agent.id IS '主键ID';
COMMENT ON COLUMN byai.byai_default_agent.project_id IS '作用域:0全局默认行,>0该研发项目覆盖行 byai_project.project_id';
COMMENT ON COLUMN byai.byai_default_agent.architect_agent_id IS '架构助理ID(资源ID);空表示该角色回退全局默认';
COMMENT ON COLUMN byai.byai_default_agent.architect_agent_name IS '架构助理名称(冗余展示)';
COMMENT ON COLUMN byai.byai_default_agent.requirement_agent_id IS '需求助理ID(资源ID);空表示该角色回退全局默认';
COMMENT ON COLUMN byai.byai_default_agent.requirement_agent_name IS '需求助理名称(冗余展示)';
COMMENT ON COLUMN byai.byai_default_agent.coder_agent_id IS '研发助理ID(资源ID);空表示该角色回退全局默认';
COMMENT ON COLUMN byai.byai_default_agent.coder_agent_name IS '研发助理名称(冗余展示)';
COMMENT ON COLUMN byai.byai_default_agent.tester_agent_id IS '测试助理ID(资源ID);空表示该角色回退全局默认';
COMMENT ON COLUMN byai.byai_default_agent.tester_agent_name IS '测试助理名称(冗余展示)';
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
    depends_on      VARCHAR(512),
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
COMMENT ON COLUMN byai.byai_scan_item_task.depends_on IS '上游子任务ID列表(逗号分隔),需求内DAG依赖;空=无上游可先开工';
COMMENT ON COLUMN byai.byai_scan_item_task.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_scan_item_task.delete_flag IS '删除标记 0正常 1删除';

-- 同一需求同一仓库只保留一条有效子任务(仅未删除行)。
CREATE UNIQUE INDEX IF NOT EXISTS uk_scan_item_task_req_repo ON byai.byai_scan_item_task (requirement_id, repo_id) WHERE delete_flag = '0';
CREATE INDEX IF NOT EXISTS idx_scan_item_task_project ON byai.byai_scan_item_task (project_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_scan_item_task_session ON byai.byai_scan_item_task (session_id);

-- 仓库区分工作区与代码仓库:研发项目须有且仅有一个 workspace 仓库承载项目上下文/产出,其余为 code 代码仓库。
-- 存量行默认 code;工作区先行由应用层保证,DB 仅存类型不强约束唯一,避免历史数据迁移期写入失败。
SELECT byai.add_column_if_missing(
    'byai', 'byai_project_repo', 'repo_type',
    'VARCHAR(16) NOT NULL DEFAULT ''code'''
);
COMMENT ON COLUMN byai.byai_project_repo.repo_type IS '仓库类型 workspace工作区(项目上下文/产出落点,单个)/code代码仓库(可多个)';

-- 仓库代码平台:决定 clone host 与令牌注入(github->GH_TOKEN,gitlab->GL_TOKEN oauth2前缀,gitea->GITEA_TOKEN)。
-- 存量行默认 github;自建/私有实例靠 repo_url 显式完整地址兜底,不受 host 拼接影响。
SELECT byai.add_column_if_missing(
    'byai', 'byai_project_repo', 'provider',
    'VARCHAR(20) NOT NULL DEFAULT ''github'''
);
COMMENT ON COLUMN byai.byai_project_repo.provider IS '代码平台 github/gitlab/gitea;决定 clone host 与令牌变量,存量默认 github';

-- 仓库用途描述:人工填写,给后来人和大模型理解该仓库承担什么职责。
-- 需求 AI 预拆据此判断该改哪些仓库,仅凭 owner/repo 名字猜职责经常拆错。可空,存量行为 NULL。
SELECT byai.add_column_if_missing('byai', 'byai_project_repo', 'description', 'TEXT');
COMMENT ON COLUMN byai.byai_project_repo.description IS '仓库用途描述,人工填写;供需求AI预拆判断职责归属与人工理解';

-- 项目描述仍由前后端限制最多500个字符；存储改为TEXT，避免不同数据库对中文VARCHAR长度语义不一致。
ALTER TABLE byai.byai_project ALTER COLUMN description TYPE TEXT;
COMMENT ON COLUMN byai.byai_project.description IS '项目描述,前后端限制最多500个字符';

-- 研发项目工作区初始化状态:架构数字员工建成工作区前禁止建需求/启动任务。
SELECT byai.add_column_if_missing('byai', 'byai_project', 'init_status', 'VARCHAR(16)');
COMMENT ON COLUMN byai.byai_project.init_status IS '研发项目初始化状态 pending待初始化/initialized工作区已建好待架构员工/initializing架构员工进行中/ready已就绪;仅 develop 未 ready 前禁用建需求与启动任务。无列默认值,应用层建项目时显式赋值';
SELECT byai.add_column_if_missing(
    'byai', 'byai_project', 'build_index',
    'VARCHAR(4) NOT NULL DEFAULT ''N'''
);
COMMENT ON COLUMN byai.byai_project.build_index IS '初始化是否建索引 Y建立/N不建立(默认)';
SELECT byai.add_column_if_missing('byai', 'byai_project', 'index_skills', 'VARCHAR(512)');
COMMENT ON COLUMN byai.byai_project.index_skills IS '建索引所需技能包,逗号分隔(如 trellis,superpowers)';
-- 初始化交给架构数字员工在沙箱里做:必须记住是哪条会话,轮询才知道该读哪个任务状态文件。
SELECT byai.add_column_if_missing('byai', 'byai_project', 'init_session_id', 'BIGINT');
COMMENT ON COLUMN byai.byai_project.init_session_id IS '工作区初始化会话ID(架构数字员工会话);轮询按此会话读 /by/.acp-runs/sessions/<会话ID>.json 判完成。空表示尚未下发初始化';
SELECT byai.add_column_if_missing('byai', 'byai_project', 'init_fail_reason', 'VARCHAR(500)');
COMMENT ON COLUMN byai.byai_project.init_fail_reason IS '上次工作区初始化失败/超时原因;重新下发初始化时清空';

DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

-- 运营任务模板只保存模板目录元数据和默认配置；用户补充的任务参数进入会话提示词，不回写系统模板。
CREATE TABLE IF NOT EXISTS byai.byai_task_template (
    template_id    BIGINT       NOT NULL,
    template_type  VARCHAR(32)  NOT NULL,
    template_name  VARCHAR(100) NOT NULL,
    description    VARCHAR(500),
    config         TEXT,
    sort_no        INT          DEFAULT 0,
    create_by      BIGINT,
    create_time    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    update_by      BIGINT,
    update_time    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    delete_flag    CHAR(1)      DEFAULT '0',
    CONSTRAINT pk_byai_task_template PRIMARY KEY (template_id)
);

COMMENT ON TABLE byai.byai_task_template IS '运营任务模板表';
COMMENT ON COLUMN byai.byai_task_template.template_id IS '模板ID';
COMMENT ON COLUMN byai.byai_task_template.template_type IS '模板类型 collect/knowledge/object_discovery/content/publish/analyze';
COMMENT ON COLUMN byai.byai_task_template.template_name IS '模板名称';
COMMENT ON COLUMN byai.byai_task_template.description IS '模板卡片说明';
COMMENT ON COLUMN byai.byai_task_template.config IS '模板默认配置 JSON';
COMMENT ON COLUMN byai.byai_task_template.sort_no IS '展示顺序';
COMMENT ON COLUMN byai.byai_task_template.delete_flag IS '删除标记 0正常/1删除';

CREATE INDEX IF NOT EXISTS idx_task_template_type
    ON byai.byai_task_template (template_type, delete_flag, sort_no);
-- 技能组资源类型及成员关系索引。
COMMENT ON COLUMN byai.ss_resource.resource_biz_type IS '资源类型：DIG_EMPLOYEE=数字员工，AGENT=智能体，KG_DOC=文档知识库，KG_DB=数据知识库，KG_QA=问答知识库，KG_TERM=术语知识库，TOOLKIT=插件，MCP=MCP服务，TOOL=工具，MCP_TOOL=MCP工具，OBJECT=对象，ONTOLOGY_BASE=本体库，SCENE=场景，VIEW=视图，ACTION=动作，TAG=标签资源，MAN_USER=管理用户资源，MAN_ORG=管理组织资源，SKILL=技能，SKILL_GROUP=技能组';

-- 唯一索引创建前仅检查重复数据；发现重复时终止迁移，不修改现有数据。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM byai.ss_resource_rel_detail
        WHERE rel_type_name = 'SKILL_GROUP_MEMBER'
          AND rel_status = 1
        GROUP BY resource_id, rel_resource_id, rel_type_name
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate active SKILL_GROUP_MEMBER relationships exist';
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ss_resource_rel_group_member
    ON byai.ss_resource_rel_detail (resource_id, rel_type_name, rel_status, rel_resource_id);

CREATE UNIQUE INDEX IF NOT EXISTS uk_ss_resource_rel_group_member
    ON byai.ss_resource_rel_detail (resource_id, rel_resource_id, rel_type_name)
    WHERE rel_type_name = 'SKILL_GROUP_MEMBER' AND rel_status = 1;

CREATE INDEX IF NOT EXISTS idx_ss_resource_rel_skill_source_candidate
    ON byai.ss_resource_rel_detail (resource_id, rel_type_name, rel_status)
    WHERE rel_resource_info IS NOT NULL;

-- 项目初始化审计日志表
CREATE TABLE IF NOT EXISTS project_init_audit_log (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    username VARCHAR(128),
    ip_address VARCHAR(45),
    repo_path VARCHAR(512) NOT NULL,
    skill_package VARCHAR(64),
    branch VARCHAR(255),
    submodule_count INTEGER DEFAULT 0,
    status VARCHAR(32) NOT NULL,
    duration_ms BIGINT,
    error_message TEXT,
    commit_hash VARCHAR(64),
    pushed BOOLEAN DEFAULT FALSE,
    changes TEXT,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_project_init_audit_request_id ON project_init_audit_log (request_id);
CREATE INDEX IF NOT EXISTS idx_project_init_audit_user_id ON project_init_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_project_init_audit_repo_path ON project_init_audit_log (repo_path);
CREATE INDEX IF NOT EXISTS idx_project_init_audit_status ON project_init_audit_log (status);
CREATE INDEX IF NOT EXISTS idx_project_init_audit_start_time ON project_init_audit_log (start_time);
CREATE INDEX IF NOT EXISTS idx_project_init_audit_created_at ON project_init_audit_log (created_at);

-- 添加表注释
COMMENT ON TABLE project_init_audit_log IS '项目初始化审计日志表 - 记录所有项目初始化操作的审计轨迹';

-- 添加列注释
COMMENT ON COLUMN project_init_audit_log.id IS '主键ID';
COMMENT ON COLUMN project_init_audit_log.request_id IS '请求追踪ID(UUID) - 用于关联整个请求链路';
COMMENT ON COLUMN project_init_audit_log.user_id IS '操作用户ID - 标识执行操作的用户';
COMMENT ON COLUMN project_init_audit_log.username IS '操作用户名 - 用户可读名称';
COMMENT ON COLUMN project_init_audit_log.ip_address IS '客户端IP地址 - 用于安全审计';
COMMENT ON COLUMN project_init_audit_log.repo_path IS '仓库路径 - 操作的目标仓库';
COMMENT ON COLUMN project_init_audit_log.skill_package IS '技能包类型 - trellis/superpower';
COMMENT ON COLUMN project_init_audit_log.branch IS '分支名称 - 操作的目标分支';
COMMENT ON COLUMN project_init_audit_log.submodule_count IS '子模块数量 - 本次操作添加的子模块数';
COMMENT ON COLUMN project_init_audit_log.status IS '操作状态 - SUCCESS/FAILED/TIMEOUT/CANCELLED';
COMMENT ON COLUMN project_init_audit_log.duration_ms IS '执行耗时(毫秒) - 用于性能分析';
COMMENT ON COLUMN project_init_audit_log.error_message IS '错误信息 - 失败时的详细错误';
COMMENT ON COLUMN project_init_audit_log.commit_hash IS '提交哈希值 - Git commit hash';
COMMENT ON COLUMN project_init_audit_log.pushed IS '是否推送到远程 - 标识是否执行了git push';
COMMENT ON COLUMN project_init_audit_log.changes IS '变更详情(JSON格式) - 记录具体的文件变更';
COMMENT ON COLUMN project_init_audit_log.start_time IS '开始时间 - 操作开始时间';
COMMENT ON COLUMN project_init_audit_log.end_time IS '结束时间 - 操作结束时间';
COMMENT ON COLUMN project_init_audit_log.created_at IS '创建时间 - 数据库记录创建时间';
COMMENT ON COLUMN project_init_audit_log.updated_at IS '更新时间 - 数据库记录更新时间';

/**项目关联本体对象文件**/
create table byai_project_object_file
(
    id          bigint primary key,
    session_id  varchar(50),
    object_name varchar(200),
    object_code varchar(200),
    file_name   varchar(200),
    file_path   varchar(500),
    version     varchar(20),
    status_cd   varchar(100),
    ext_content text,
    create_by   bigint,
    create_time timestamp default current_timestamp,
    update_time timestamp
);

comment on table byai_project_object_file is '项目业务对象关联文件表';
comment on column byai_project_object_file.id is '主键ID';
comment on column byai_project_object_file.session_id is '会话ID，关联byai_session表';
comment on column byai_project_object_file.object_name is '业务对象名称';
comment on column byai_project_object_file.object_code is '业务对象编码';
comment on column byai_project_object_file.file_name is '文件原始名称';
comment on column byai_project_object_file.file_path is '文件存储路径';
comment on column byai_project_object_file.version is '对象版本号';
comment on column byai_project_object_file.status_cd is '状态编码';
comment on column byai_project_object_file.ext_content is '扩展文本内容，存储额外属性信息';
comment on column byai_project_object_file.create_by is '创建人';
comment on column byai_project_object_file.create_time is '创建时间';
comment on column byai_project_object_file.update_time is '更新时间';

-- 项目资源绑定关系：支持一个项目绑定多知识库、多数字员工和多本体。
CREATE TABLE IF NOT EXISTS byai.byai_project_resource
(
    id            BIGINT       NOT NULL,
    project_id    BIGINT       NOT NULL,
    resource_type VARCHAR(32)  NOT NULL,
    resource_id   BIGINT       NOT NULL,
    resource_name VARCHAR(255),
    sort_no       INT          NOT NULL DEFAULT 0,
    create_by     BIGINT,
    create_time   TIMESTAMP,
    update_by     BIGINT,
    update_time   TIMESTAMP,
    delete_flag   VARCHAR(2)   DEFAULT '0',
    CONSTRAINT pk_byai_project_resource PRIMARY KEY (id),
    CONSTRAINT uk_byai_project_resource UNIQUE (project_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_byai_project_resource_project
    ON byai.byai_project_resource (project_id, resource_type, sort_no);


-- 数字员工组功能相关索引
CREATE UNIQUE INDEX IF NOT EXISTS uk_ss_resource_rel_dig_employee_group_member
    ON byai.ss_resource_rel_detail (resource_id, rel_resource_id)
    WHERE rel_type_name = 'DIG_EMPLOYEE_GROUP_MEMBER' AND rel_status = 1;

CREATE INDEX IF NOT EXISTS idx_ss_resource_version_active_resource
    ON byai.ss_resource_version (resource_id, version_status, resource_version_id);

-- OAuth2 真实凭证与连接器授权绑定分离：本表只保存 SM4 密文，绝不保存明文 token 或 client secret。
CREATE TABLE IF NOT EXISTS byai.byai_connector_credential_secret (
    credential_id             BIGINT       NOT NULL,
    credential_reference      VARCHAR(64)  NOT NULL,
    provider_code             VARCHAR(64)  NOT NULL,
    user_id                   VARCHAR(64)  NOT NULL,
    connector_id              BIGINT       NOT NULL,
    access_token_cipher       TEXT         NOT NULL,
    refresh_token_cipher      TEXT,
    token_type                VARCHAR(32),
    granted_scopes            TEXT,
    access_expire_time        TIMESTAMP,
    refresh_expire_time       TIMESTAMP,
    status_cd                 CHAR(3)      NOT NULL DEFAULT '00A',
    create_time               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time               TIMESTAMP,
    CONSTRAINT pk_byai_connector_credential_secret PRIMARY KEY (credential_id),
    CONSTRAINT uk_byai_connector_credential_secret_reference UNIQUE (credential_reference)
);

CREATE INDEX IF NOT EXISTS idx_byai_connector_credential_secret_active
    ON byai.byai_connector_credential_secret (user_id, connector_id, provider_code)
    WHERE status_cd = '00A';

CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_connector_credential_secret_active
    ON byai.byai_connector_credential_secret (user_id, connector_id, provider_code)
    WHERE status_cd = '00A';

COMMENT ON TABLE byai.byai_connector_credential_secret IS '连接器 OAuth2 等真实凭证密文；授权绑定表仅保存 credential_reference';
COMMENT ON COLUMN byai.byai_connector_credential_secret.credential_reference IS '随机 UUID 凭证引用，不含 token';
COMMENT ON COLUMN byai.byai_connector_credential_secret.access_token_cipher IS 'SM4 加密的 access token，禁止写入日志或响应';
COMMENT ON COLUMN byai.byai_connector_credential_secret.refresh_token_cipher IS 'SM4 加密的 refresh token，允许为空';

ALTER TABLE byai_project_object_file ADD COLUMN object_type VARCHAR(20) DEFAULT 'object';
COMMENT ON COLUMN byai_project_object_file.object_type IS '文件对象类型,保存本体对象:object,保存知识文件:knowledge';

-- Artifact publication metadata. Object bytes remain in the configured storage backend.
SET search_path TO byai;

CREATE TABLE IF NOT EXISTS byai.byai_artifact (
    artifact_id        VARCHAR(36)    NOT NULL,
    owner_user_id      BIGINT         NOT NULL,
    owner_user_code    VARCHAR(100)   NOT NULL,
    status             VARCHAR(16)    NOT NULL,
    kind               VARCHAR(20),
    storage_type       VARCHAR(32)    NOT NULL,
    storage_root       VARCHAR(500)   NOT NULL,
    storage_prefix     VARCHAR(1000)  NOT NULL,
    original_key       VARCHAR(1200)  NOT NULL,
    content_prefix     VARCHAR(1200)  NOT NULL,
    original_name      VARCHAR(500)   NOT NULL,
    display_name       VARCHAR(500),
    entry_point        VARCHAR(1000),
    content_type       VARCHAR(200),
    file_size          BIGINT         NOT NULL DEFAULT 0,
    expanded_size      BIGINT         NOT NULL DEFAULT 0,
    sha256             VARCHAR(64),
    access_key_hash    VARCHAR(64)    NOT NULL,
    warnings_json      TEXT,
    expires_at         TIMESTAMP      NOT NULL,
    create_time        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_artifact PRIMARY KEY (artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_byai_artifact_owner
    ON byai.byai_artifact (owner_user_id, create_time DESC);

CREATE INDEX IF NOT EXISTS idx_byai_artifact_cleanup
    ON byai.byai_artifact (status, expires_at);

COMMENT ON TABLE byai.byai_artifact IS 'Agent Harness发布的限时预览与下载Artifact元数据';
COMMENT ON COLUMN byai.byai_artifact.access_key_hash IS '不记名访问密钥的SHA-256，仅上传响应返回原始密钥';
COMMENT ON COLUMN byai.byai_artifact.storage_type IS '创建时实际使用的存储后端，切换默认后仍用于读取历史Artifact';

-- Add platform-managed general-purpose JSON records for published HTML Artifacts.
CREATE TABLE IF NOT EXISTS byai.artifact_data_record (
    id               VARCHAR(36)   NOT NULL,
    artifact_id      VARCHAR(36)   NOT NULL,
    collection_name  VARCHAR(64)   NOT NULL,
    record_key       VARCHAR(36)   NOT NULL,
    data_json        JSONB         NOT NULL,
    version          INTEGER       NOT NULL DEFAULT 1,
    create_time      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_artifact_data_record PRIMARY KEY (id),
    CONSTRAINT uk_artifact_data_record_key UNIQUE (artifact_id, record_key)
);

CREATE INDEX IF NOT EXISTS idx_artifact_data_record_list
    ON byai.artifact_data_record (artifact_id, collection_name, create_time DESC);

COMMENT ON TABLE byai.artifact_data_record IS '已发布HTML Artifact持久化的通用JSON数据';

ALTER TABLE byai_project ADD COLUMN cloud_resource_id bigint;
COMMENT ON COLUMN byai_project.cloud_resource_id IS '云盘知识库资源ID';

-- 设置默认值为 personal
ALTER TABLE ss_resource ALTER COLUMN owner_type SET DEFAULT 'personal';

-- Remove the unused legacy scheduled-task module. Task instances reference tasks,
-- so the instance table must be dropped first.
DROP TABLE IF EXISTS byai.byai_schedule_task_inst;
DROP TABLE IF EXISTS byai.byai_schedule_task;
