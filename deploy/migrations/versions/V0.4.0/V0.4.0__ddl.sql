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
