package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.manager.application.service.devloop.IntegrationRunAsyncConfig;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.exec.CommandExecSpec;
import com.iwhalecloud.byai.manager.domain.devloop.exec.CommandRunner;
import com.iwhalecloud.byai.manager.domain.devloop.exec.SshExecResult;
import com.iwhalecloud.byai.manager.entity.devloop.DefaultAgent;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationEnv;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRun;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRunStep;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationSuite;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ScanItemTask;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationRunMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationRunStepMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.util.threadPoolUti.ThreadPoolUtil;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

/**
 * 集成测试执行的异步执行体。放在独立 service 里,让 @Async 通过 Spring 代理生效(自调用不走代理)。
 * 全流程:解密连接凭据/测试账号 → 按 seq 跑环境 stages 把被测系统部署起来 → 按 executorMode 分流执行用例。
 * tester(默认):拼提示词调起「测试数字员工」克隆并跑用例,run 保持 running,结果由回收 poller 从会话回流。
 * backend(自测用):后端 SSH 克隆用例仓库 → 跑套件命令 → 解析 JUnit,run 当场出终态、不写 sessionId。
 * 两种模式的用例代码都来自套件的仓库配置(同一事实源),也都落在用户桶的 /by/.sessions/{key}/ 会话工作区
 * (见 SessionWorkspacePathResolver),环境 stages 只负责部署被测系统。
 * backend 模式的会话路径按后端宿主机的 NFS 挂载点算却在 env 连接上执行,因此要求环境机挂载同一份存储
 * 且挂载点路径与后端一致;clone 前先探桶根,不成立就当场失败,不让 mkdir -p 造出与用户桶无关的假目录树。
 * 环境阶段异常收敛为 run=error/failed 并记 reason;私钥/密码/PAT 解密后仅内存持有,不落库不打日志。
 */
@Slf4j
@Service
public class IntegrationRunExecutor {

    private static final String STATUS_PASSED = "passed";
    private static final String STATUS_FAILED = "failed";
    private static final String STATUS_ERROR = "error";
    private static final String STATUS_TIMEOUT = "timeout";
    private static final String STATUS_SKIPPED = "skipped";

    private static final String STEP_STAGE = "stage";
    private static final String STEP_SUITE = "suite";
    private static final String STEP_CLONE = "clone";

    private static final int DEFAULT_SUITE_TIMEOUT_SEC = 1800;
    private static final int CLONE_TIMEOUT_SEC = 600;

    /** 沿用开发检出只做一次目录探测,不该等到克隆那么久。 */
    private static final int VERIFY_TIMEOUT_SEC = 60;

    /** 按需读取报告的体积上限:整份原文要过 HTTP 回前端预览,超限直接拒绝而不是截断出坏 XML。 */
    private static final int REPORT_MAX_BYTES = 5 * 1024 * 1024;

    /** 用例来源:沿用开发已检出目录,免克隆。 */
    private static final String SOURCE_CODE = "code";

    /** 用例来源:克隆指定的独立用例仓库。 */
    private static final String SOURCE_STANDALONE = "standalone";

    /** 用例来源:用例已在环境机上(运维预置/镜像自带),跳过全部克隆,直接按环境连接方式登录执行。 */
    private static final String SOURCE_ON_ENV = "env";

    /** 没有前序 coder 会话时用的会话键前缀:仍落在用户桶的 .sessions 下,靠前缀与真实会话 id 区分开。 */
    private static final String RUN_SESSION_KEY_PREFIX = "integration-run-";

    // 执行方式开关:backend=后端直接 SSH 克隆用例+跑命令+解析 JUnit(run 当场出终态,便于排查);
    // tester=下发测试数字员工克隆并执行(run 保持 running,由回收 poller 从会话回流)。
    // 默认 tester 为正式形态:定时批量与自动触发都走它。前端「执行测试」弹框可按次覆盖成 backend 调试。
    public static final String EXECUTOR_MODE_BACKEND = "backend";
    public static final String EXECUTOR_MODE_TESTER = "tester";

    @Value("${devloop.integration.executorMode:" + EXECUTOR_MODE_TESTER + "}")
    private String executorMode;

    /**
     * 归一化按次传入的执行方式:只认两个合法值,其余(null/空/拼错)一律回落全局配置。
     * 入参来自 HTTP,不能让拼错的字符串静默变成 backend——那会让本该下发员工的执行悄悄改道。
     */
    private String resolveExecutorMode(String override) {
        String mode = StringUtils.trimToEmpty(override);
        if (EXECUTOR_MODE_TESTER.equalsIgnoreCase(mode) || EXECUTOR_MODE_BACKEND.equalsIgnoreCase(mode)) {
            return mode.toLowerCase();
        }
        return StringUtils.defaultIfBlank(executorMode, EXECUTOR_MODE_TESTER);
    }

    // 测试员工 chat 全程流式,时间长;隔离到独立线程池下发,避免占满集成执行线程池。
    private static final Executor TESTER_CHAT_EXECUTOR =
        ThreadPoolUtil.getThreadPool(2, 8, 100, 60, "integration-tester-chat");

    @Autowired
    private IntegrationRunMapper integrationRunMapper;

    @Autowired
    private IntegrationRunStepMapper integrationRunStepMapper;

    @Autowired
    private CommandRunner commandRunner;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private DangerousScriptGuard dangerousScriptGuard;

    @Autowired
    private DefaultAgentService defaultAgentService;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private AssistantChatService assistantChatService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private DevloopPatService patService;

    @Autowired
    private ScanItemTaskService scanItemTaskService;

    @Autowired
    private SessionWorkspacePathResolver sessionWorkspacePathResolver;

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    @Autowired
    private UserFS userFS;

    @Autowired
    private SandboxUserContextRunner userContextRunner;

    /**
     * @param executorModeOverride 按次指定执行方式(backend/tester);null 或非法值走全局配置。
     *                             异步执行,模式必须随调用传进来,不能让调用方改字段。
     */
    @Async(IntegrationRunAsyncConfig.INTEGRATION_RUN_EXECUTOR)
    public void executeRun(IntegrationRun run, IntegrationEnv env, IntegrationSuite suite,
                           String executorModeOverride) {
        long startMs = System.currentTimeMillis();
        int seq = 0;
        String effectiveMode = resolveExecutorMode(executorModeOverride);
        log.info("Integration run start, runId={}, envId={}, suiteId={}, host={}, mode={}",
            run.getRunId(), env.getEnvId(), suite.getSuiteId(), env.getConnHost(), effectiveMode);
        try {
            // 连接凭据:connCredentialRef 存的是 SM4 密文,直接解密拿明文(不再查 po_user_private_param)。
            // 安全:reason 会落库并回显前端,绝不能带出任何凭据原值;缺失/解密失败只给通用提示。
            String connSecret = decryptSecret(env.getConnCredentialRef());
            if (StringUtils.isBlank(connSecret)) {
                finishError(run, "连接凭据缺失或解密失败:请在环境配置中重新填写 SSH 密码/私钥后重试", startMs);
                return;
            }

            // 测试账号密码 → <PREFIX>_USER / <PREFIX>_PASS 注入 env,供 E2E 用例登录。
            Map<String, String> injectedEnv = buildAccountEnv(env.getTestAccounts());

            // 1) 按 seq 跑环境 stages:非 continueOnError 的 stage 失败即整 run 失败并停止后续。
            List<StageDef> stages = parseStages(env.getStages());
            for (StageDef stage : stages) {
                StepOutcome outcome = runStage(run, env, connSecret, injectedEnv, stage, seq++);
                if (!STATUS_PASSED.equals(outcome.status) && !stage.continueOnError) {
                    finishByStepFailure(run, outcome, "环境阶段失败: " + stage.name, startMs);
                    return;
                }
            }

            // 2) 环境已就绪:按执行方式开关分流。
            //    backend:后端直接 SSH 跑套件命令 + 解析 JUnit 报告,run 当场出终态(方便本地/联调测试)。
            //    tester:拼提示词下发「测试数字员工」克隆并执行,run 保持 running,结果由回收 poller 从会话回流。
            if (EXECUTOR_MODE_TESTER.equals(effectiveMode)) {
                dispatchTester(run, env, suite, connSecret, startMs);
            } else {
                runByBackend(run, env, connSecret, injectedEnv, suite, seq, startMs);
            }
        } catch (Exception e) {
            log.error("Integration run execution failed, runId={}", run.getRunId(), e);
            finishError(run, "执行异常: " + rootMessage(e), startMs);
        }
    }

    /** 跑单个环境 stage:高危闸门 → 构建命令 → 执行 → 写一条 run_step。 */
    private StepOutcome runStage(IntegrationRun run, IntegrationEnv env, String connSecret,
                                 Map<String, String> injectedEnv, StageDef stage, int seq) throws Exception {
        // 运行时再过一遍高危闸门:防止绕过保存 API 直接改库注入危险脚本。命中即拦,不执行。
        String blocked = dangerousScriptGuard.detect(stage.name, stage.script);
        if (blocked != null) {
            return recordBlockedStep(run, seq, STEP_STAGE, stage.name, blocked);
        }
        CommandExecSpec spec = baseSpec(env, connSecret, injectedEnv);
        spec.setWorkdir(StringUtils.defaultIfBlank(stage.workdir, env.getConnWorkdir()));
        spec.setCommand(buildStageCommand(stage));
        spec.setTimeoutSec(stage.timeoutSec);
        return execAndRecord(run, seq, STEP_STAGE, stage.name, spec);
    }

    /**
     * 后端直跑:克隆用例仓库 → SSH 跑套件 runCommand → 拉取并解析 JUnit 报告 → 当场出终态。
     * 供本地/联调测试用,不经测试数字员工;run 直接落终态,不写 sessionId(故不会被结果回收 poller 误扫)。
     * 用例代码来源与 tester 模式同一事实源(套件的仓库配置),而非依赖环境 stages 里手写 clone。
     */
    private void runByBackend(IntegrationRun run, IntegrationEnv env, String connSecret,
                              Map<String, String> injectedEnv, IntegrationSuite suite, int seq, long startMs) throws Exception {
        // 1) 定位用例代码。沿用开发检出时不产生 clone 步骤;需要克隆时失败即整 run 失败(没有代码后续命令无意义)。
        CaseCheckout checkout = resolveCaseCheckout(run, env, suite);
        if (checkout.error != null) {
            // 配置缺失是 error 而非用例失败;仍落一条 step 让前端日志弹窗能看到具体原因。
            recordBlockedStep(run, seq, STEP_CLONE, "准备用例代码", checkout.error);
            finishError(run, checkout.error, startMs);
            return;
        }
        StepOutcome prepareOutcome = checkout.onEnv || checkout.reuseCoderCheckout
            ? verifyCaseDir(run, env, connSecret, injectedEnv, checkout, seq++)
            : runCaseClone(run, env, connSecret, injectedEnv, checkout, seq++);
        if (!STATUS_PASSED.equals(prepareOutcome.status)) {
            finishByStepFailure(run, prepareOutcome, prepareFailureReason(checkout), startMs);
            return;
        }

        // 2) 跑选中套件的 runCommand:workdir 落在克隆出的用例目录下(套件 workdir 视为其内相对子目录)。
        String suiteWorkdir = resolveSuiteWorkdir(checkout, suite);
        StepOutcome suiteOutcome = runSuiteCommand(run, env, connSecret, injectedEnv, suite, suiteWorkdir, seq);
        // 3) 拉取并解析 JUnit 报告,拼 suites 结果与 totals。
        JunitSummary summary = parseJunitReport(env, connSecret, injectedEnv, suite, suiteWorkdir);
        finishSuccessOrFailure(run, suite, suiteOutcome, summary, startMs);
    }

    /**
     * 解析用例仓库检出信息:与 tester 模式共用套件的仓库配置(code=关联项目仓库,standalone=独立用例仓库地址)。
     * 令牌单独返回并只经 env 注入,绝不拼进命令正文,避免落库到 run_step.logText 或打进日志。
     */
    private CaseCheckout resolveCaseCheckout(IntegrationRun run, IntegrationEnv env, IntegrationSuite suite) {
        CaseCheckout checkout = new CaseCheckout();
        // env:用例已在环境机上(运维预置/镜像自带),不涉及任何仓库,基目录取环境的连接工作目录。
        if (SOURCE_ON_ENV.equalsIgnoreCase(StringUtils.defaultString(suite.getSourceType()))) {
            checkout.onEnv = true;
            checkout.caseDir = StringUtils.defaultString(env.getConnWorkdir()).trim();
            if (checkout.caseDir.isEmpty()) {
                checkout.error = "用例在环境机上,但该集成测试环境未配置工作目录:请先在环境配置里填写工作目录后重试";
            }
            return checkout;
        }
        boolean standalone = SOURCE_STANDALONE.equalsIgnoreCase(suite.getSourceType());
        if (standalone) {
            checkout.repoUrl = StringUtils.defaultString(suite.getSource()).trim();
            checkout.provider = null;
        } else {
            ProjectRepo repo = suite.getRepoId() == null ? null : projectRepoMapper.selectById(suite.getRepoId());
            if (repo == null) {
                checkout.error = "套件未关联代码仓库:请在测试用例集中选择用例所在仓库后重试";
                return checkout;
            }
            checkout.provider = repo.getProvider();
            checkout.repoUrl = resolveRepoUrl(repo);
        }
        if (StringUtils.isBlank(checkout.repoUrl)) {
            checkout.error = "用例仓库地址缺失:请在测试用例集中填写用例仓库地址后重试";
            return checkout;
        }
        checkout.branch = StringUtils.defaultString(suite.getBranch()).trim();
        checkout.repoName = repoNameOf(checkout.repoUrl);
        resolveCaseDir(run, suite, standalone, checkout);
        if (checkout.error != null) {
            return checkout;
        }
        if (checkout.reuseCoderCheckout) {
            // 沿用开发检出不发起任何网络请求,不必解密 PAT。
            return checkout;
        }
        // 私有仓库令牌:取触发用户配置的 PAT,未配置则按公开仓库尝试(clone 失败时会落到 step 日志里)。
        checkout.token = patService.getGitHubPat(run.getCreateBy() == null ? null : String.valueOf(run.getCreateBy()));
        return checkout;
    }

    /**
     * 用例代码的落地目录,必须落在用户桶的会话工作区里({nfs根}/{bucket}/by/.sessions/{key}/{repoName}),
     * 与测试数字员工在沙箱里看到的 /by/.sessions/{key}/ 是同一份 NFS 数据。不允许用 /tmp:那样后端跑的代码
     * 与员工侧分叉,产物也不在用户桶里、前端会话空间与本地 git 变更都读不到。
     * code 来源优先复用 coder 的会话目录,和 tester 提示词里"直接进开发已检出目录、不要重新克隆"完全同一路径;
     * 没有前序 coder(手动触发)或独立用例仓库时,退化为 run 独占的会话键,避免并发 run 互相覆盖。
     */
    private void resolveCaseDir(IntegrationRun run, IntegrationSuite suite, boolean standalone, CaseCheckout checkout) {
        if (!standalone) {
            // sourceType=code 是"沿用开发代码,免克隆"的硬承诺:定位不到开发检出目录就当场失败,
            // 不退化成克隆。否则用户显式选了免克隆却看到 clone 步骤、还可能撞上执行机不通外网。
            CoderSession coder = findCoderSession(run, suite.getRepoId());
            if (coder.sessionId == null) {
                checkout.error = "沿用开发代码失败:" + coder.missReason
                    + "。请改用「克隆指定仓库」,或从需求发起集成测试以便沿用开发检出目录";
                return;
            }
            // 桶按人隔离,须用会话创建者解析,用触发人会指到别人的桶。
            Long sessionOwnerId = findSessionCreatorId(coder.sessionId);
            String coderDir = sessionOwnerId == null ? null
                : sessionWorkspacePathResolver.resolveSessionDir(sessionOwnerId, coder.sessionId);
            if (coderDir == null) {
                checkout.error = "沿用开发代码失败:无法解析开发会话 " + coder.sessionId
                    + " 的工作区目录,请确认该会话所属用户已初始化个人存储桶";
                return;
            }
            checkout.parentDir = coderDir;
            checkout.caseDir = coderDir + "/" + checkout.repoName;
            checkout.bucketDir = sessionWorkspacePathResolver.resolveBucketDir(sessionOwnerId);
            checkout.reuseCoderCheckout = true;
            return;
        }
        String runDir = sessionWorkspacePathResolver.resolveSessionDir(run.getCreateBy(),
            RUN_SESSION_KEY_PREFIX + run.getRunId());
        if (runDir == null) {
            checkout.error = "无法解析用例工作区目录:请确认触发用户已初始化个人存储桶后重试";
            return;
        }
        checkout.parentDir = runDir;
        checkout.caseDir = runDir + "/" + checkout.repoName;
        checkout.bucketDir = sessionWorkspacePathResolver.resolveBucketDir(run.getCreateBy());
    }

    /** 会话创建者 id,用于解析该会话工作区所在的用户桶;会话不存在时返回 null 走 run 独占目录兜底。 */
    private Long findSessionCreatorId(Long sessionId) {
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        return session == null ? null : session.getCreatorId();
    }

    /** 项目仓库的 clone 地址:显式 repoUrl 优先,否则按平台公共域名 + owner/repo 拼。 */
    private String resolveRepoUrl(ProjectRepo repo) {
        String repoUrl = StringUtils.defaultString(repo.getRepoUrl()).trim();
        if (repoUrl.startsWith("http")) {
            return repoUrl;
        }
        String fullName = StringUtils.defaultString(repo.getRepoFullName()).trim();
        if (StringUtils.isBlank(fullName)) {
            return "";
        }
        return "https://" + DevloopApplicationService.repoProviderHost(repo.getProvider()) + "/" + fullName + ".git";
    }

    /**
     * 准备用例代码:目标目录已有检出则复用,否则克隆到会话工作区。
     * 令牌经 env 注入后在 URL 里以 $VAR 形式展开,命令正文与日志都不含令牌明文。
     */
    private StepOutcome runCaseClone(IntegrationRun run, IntegrationEnv env, String connSecret,
                                     Map<String, String> injectedEnv, CaseCheckout checkout, int seq) throws Exception {
        Map<String, String> cloneEnv = new LinkedHashMap<>(injectedEnv);
        boolean withToken = StringUtils.isNotBlank(checkout.token);
        if (withToken) {
            cloneEnv.put(DevloopApplicationService.repoProviderTokenEnv(checkout.provider), checkout.token);
        }
        String cloneUrl = withToken
            ? DevloopApplicationService.tokenizedRepoCloneUrl(checkout.provider, checkout.repoUrl) : checkout.repoUrl;
        String branchOpt = StringUtils.isBlank(checkout.branch) ? "" : " --branch " + shellQuote(checkout.branch);
        // URL 用双引号让 shell 展开 $TOKEN,单引号会阻止展开,令牌因此不出现在命令正文里。
        String clone = "mkdir -p " + shellQuote(checkout.parentDir)
            + " && git clone --depth 1" + branchOpt + " \"" + cloneUrl + "\" " + shellQuote(checkout.caseDir);
        // 目录已有 .git 就直接复用,让重跑同一 run 幂等(run 独占目录,不会撞上别人的工作树)。
        String reuseOrClone = "if [ -d " + shellQuote(checkout.caseDir + "/.git") + " ]; then"
            + " echo '复用已有检出目录: " + checkout.caseDir + "'; else " + clone + "; fi";
        // 先探桶根:会话路径按后端宿主机的 NFS 挂载点算,执行机没挂同一份 NFS 时它整条都不成立,
        // 直接 mkdir -p 会凭空造一棵与用户桶无关的空目录树,产物丢失且日志里看不出原因。宁可当场失败。
        String command = StringUtils.isBlank(checkout.bucketDir) ? reuseOrClone
            : "if [ ! -d " + shellQuote(checkout.bucketDir) + " ]; then"
                + " echo '执行机未挂载用户桶 NFS,缺少目录: " + checkout.bucketDir
                + " ;请确认该环境机与后端挂载同一份存储且挂载点路径一致' >&2; exit 1; fi\n" + reuseOrClone;

        CommandExecSpec spec = baseSpec(env, connSecret, cloneEnv);
        spec.setWorkdir(null);
        spec.setCommand(command);
        spec.setTimeoutSec(CLONE_TIMEOUT_SEC);
        return execAndRecord(run, seq, STEP_CLONE, "克隆用例仓库 " + checkout.repoName, spec);
    }

    /** 套件命令的工作目录:克隆出的用例目录为根,套件 workdir 视为其内相对子目录。 */
    private String resolveSuiteWorkdir(CaseCheckout checkout, IntegrationSuite suite) {
        String suiteWorkdir = StringUtils.defaultString(suite.getWorkdir()).trim();
        if (StringUtils.isBlank(suiteWorkdir) || ".".equals(suiteWorkdir)) {
            return checkout.caseDir;
        }
        // 绝对路径按用户显式指定处理,不再拼到用例目录下。
        if (suiteWorkdir.startsWith("/")) {
            return suiteWorkdir;
        }
        return checkout.caseDir + "/" + StringUtils.removeStart(suiteWorkdir, "./");
    }

    /** 从 clone 地址取仓库名做目录名;取不到时用 cases 兜底,避免拼出空目录。 */
    private String repoNameOf(String repoUrl) {
        String tail = StringUtils.substringAfterLast(StringUtils.removeEnd(repoUrl, "/"), "/");
        String name = StringUtils.removeEnd(tail, ".git");
        return StringUtils.isBlank(name) ? "cases" : name;
    }

    /** 跑套件 runCommand:高危闸门 → 执行。 */
    private StepOutcome runSuiteCommand(IntegrationRun run, IntegrationEnv env, String connSecret,
                                        Map<String, String> injectedEnv, IntegrationSuite suite,
                                        String workdir, int seq) throws Exception {
        String blocked = dangerousScriptGuard.detect("套件命令", suite.getRunCommand());
        if (blocked != null) {
            return recordBlockedStep(run, seq, STEP_SUITE, suite.getSuiteName(), blocked);
        }
        CommandExecSpec spec = baseSpec(env, connSecret, injectedEnv);
        spec.setWorkdir(workdir);
        spec.setCommand(suite.getRunCommand());
        spec.setTimeoutSec(DEFAULT_SUITE_TIMEOUT_SEC);
        return execAndRecord(run, seq, STEP_SUITE, suite.getSuiteName(), spec);
    }

    /**
     * 免克隆路径没有 clone 步骤兜底验证,这里显式确认目录在执行机上真实存在。
     * 直接 cd 进去只会得到一句难懂的 shell 报错,定位不到是挂载、检出还是配置写错。
     */
    private StepOutcome verifyCaseDir(IntegrationRun run, IntegrationEnv env, String connSecret,
                                      Map<String, String> injectedEnv, CaseCheckout checkout, int seq) throws Exception {
        String hint = checkout.onEnv
            ? "请确认该环境机上用例已就位,且环境配置的工作目录填写正确"
            : "请确认该环境机与后端挂载同一份用户桶存储且挂载点路径一致,且开发会话已检出该仓库";
        CommandExecSpec spec = baseSpec(env, connSecret, injectedEnv);
        spec.setWorkdir(null);
        spec.setCommand("if [ ! -d " + shellQuote(checkout.caseDir) + " ]; then"
            + " echo '用例目录在执行机上不存在: " + checkout.caseDir + " ;" + hint + "' >&2; exit 1; fi\n"
            + "echo '使用已有用例目录: " + checkout.caseDir + "'");
        spec.setTimeoutSec(VERIFY_TIMEOUT_SEC);
        return execAndRecord(run, seq, STEP_CLONE, caseDirStepName(checkout), spec);
    }

    /** 免克隆场景的步骤名/失败原因分开写,让前端一眼看出这条 run 走的是哪种用例来源。 */
    private static String caseDirStepName(CaseCheckout checkout) {
        return checkout.onEnv ? "校验环境机用例目录" : "沿用开发检出 " + checkout.repoName;
    }

    private static String prepareFailureReason(CaseCheckout checkout) {
        if (checkout.onEnv) {
            return "环境机用例目录不可用: " + checkout.caseDir;
        }
        return checkout.reuseCoderCheckout
            ? "沿用开发检出目录失败: " + checkout.repoName : "克隆用例仓库失败: " + checkout.repoName;
    }

    /**
     * 下发「测试数字员工」执行本次集成测试:
     * 解析测试员工 → 建独立会话 → 拼提示词(用例仓库克隆说明 + 被测系统地址 + 运行命令 + 结果回流约定)→ 事务外异步 chat。
     * run 保持 running 并冻结 sessionId/testerAgentId/testerAgentName;测试员工完成后由回收 poller 读会话打点与结果文件收尾。
     */
    private void dispatchTester(IntegrationRun run, IntegrationEnv env, IntegrationSuite suite,
                                String connSecret, long startMs) {
        DefaultAgent agent = defaultAgentService.resolveForProject(run.getProjectId());
        // DefaultAgent 的 testerAgentId 是字符串存储,下发/落库都要 Long;空或非法都按未配置处理。
        Long testerAgentId = parseAgentId(agent == null ? null : agent.getTesterAgentId());
        if (testerAgentId == null) {
            finishError(run, "未配置测试数字员工:请在项目「默认数字员工」中设置测试员工后重试", startMs);
            return;
        }
        LoginInfo loginInfo = loginApplicationService.getLoginInfo(run.getCreateBy());
        if (loginInfo == null) {
            finishError(run, "无法解析触发用户身份:请重新登录后重试", startMs);
            return;
        }

        // 用例代码从哪来:code=沿用开发已检出目录(免克隆);standalone=克隆指定的独立用例仓库。
        String caseSource = buildCaseSourceSection(run, env, suite);

        // 先用套件名建会话让会话名可读,建成拿到 sessionId 后再覆盖为完整提示词。
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setSessionId(null);
        chatDto.setAgentId(testerAgentId);
        chatDto.setProjectId(run.getProjectId());
        chatDto.setChatContent("集成测试 - " + StringUtils.defaultString(suite.getSuiteName()));
        chatDto.setAccessTerminal("DevLoop");
        chatDto.setClientRequestId(AssistantChatService.getClientRequestId());
        assistantChatService.createGroupChatSession(chatDto);
        Long sessionId = chatDto.getSessionId();

        // 用例在环境机上时员工必须能 ssh 登进去,而凭据不能进提示词(提示词落会话历史)。
        // 故把凭据写成沙箱会话目录下的文件,提示词只出现路径:路径不是秘密,凭据不留痕。
        boolean onEnv = SOURCE_ON_ENV.equalsIgnoreCase(StringUtils.defaultString(suite.getSourceType()));
        boolean keyAuth = !"password".equalsIgnoreCase(StringUtils.defaultString(env.getConnAuth()));
        if (onEnv && !writeTesterSshCredential(loginInfo.getUserCode(), sessionId, connSecret, keyAuth)) {
            finishError(run, "无法向沙箱下发环境机登录凭据:请重试,或改用后端直跑模式执行本套件", startMs);
            return;
        }
        chatDto.setChatContent(buildTesterPrompt(sessionId, env, suite, caseSource, keyAuth));

        run.setSessionId(sessionId);
        run.setTesterAgentId(testerAgentId);
        run.setTesterAgentName(agent.getTesterAgentName());
        integrationRunMapper.updateById(run);

        // 事务外异步触发 chat:createGroupChatSession 已提交会话,异步线程能读到;chat 全程流式,不阻塞集成执行线程池。
        Runnable chatTask = () -> {
            try {
                assistantChatService.chat(chatDto, new ByteArrayOutputStream(), loginInfo);
            } catch (Exception e) {
                log.error("[Integration] 下发测试员工 chat 失败, runId={}, sessionId={}", run.getRunId(), sessionId, e);
            }
        };
        TESTER_CHAT_EXECUTOR.execute(chatTask);
        log.info("Integration run dispatched to tester agent, runId={}, sessionId={}, testerAgentId={}",
            run.getRunId(), sessionId, testerAgentId);
    }

    /**
     * SSH 准备段:沙箱镜像默认不带 ssh 客户端,凭据也只落在文件里,两件事都得在提示词里讲清。
     * 私钥要 chmod 600(ssh 拒绝宽权限私钥);口令登录需 sshpass,两条路都给出安装命令。
     * StrictHostKeyChecking=no:沙箱每次是新容器,没有 known_hosts,不关掉会卡在交互确认。
     */
    private String buildSshPrepSection(Long sessionId, IntegrationEnv env, boolean keyAuth) {
        String target = StringUtils.defaultString(env.getConnUser()) + "@" + StringUtils.defaultString(env.getConnHost());
        String port = StringUtils.defaultIfBlank(env.getConnPort(), "22");
        String credPath = (keyAuth ? TESTER_SSH_KEY_PATH : TESTER_SSH_PASS_PATH).formatted(sessionId);
        StringBuilder sb = new StringBuilder("## 登录环境机的准备(必须先做)\n");
        sb.append("沙箱默认没有 ssh 客户端,登录凭据已由平台写入沙箱文件,按下面步骤操作:\n");
        sb.append("1) 装 ssh 客户端(已装则跳过):\n")
            .append("   `command -v ssh || (apt-get update && apt-get install -y openssh-client")
            .append(keyAuth ? "" : " sshpass").append(") || (apk add --no-cache openssh-client")
            .append(keyAuth ? "" : " sshpass").append(")`\n");
        if (keyAuth) {
            sb.append("2) 私钥已在:").append(credPath)
                .append("\n   先拷到本地盘再收紧权限(会话目录是网络挂载,chmod 可能无效,而 ssh 拒绝其他人可读的私钥):\n")
                .append("   `cp ").append(credPath).append(" ").append(TESTER_SSH_KEY_LOCAL)
                .append(" && chmod 600 ").append(TESTER_SSH_KEY_LOCAL).append("`\n")
                .append("3) 登录并执行(示例,把 <命令> 换成运行命令):\n")
                .append("   `ssh -i ").append(TESTER_SSH_KEY_LOCAL)
                .append(" -p ").append(port)
                .append(" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ")
                .append(target).append(" '<命令>'`\n");
        } else {
            sb.append("2) 登录口令已在:").append(credPath).append("\n")
                .append("3) 登录并执行(示例,把 <命令> 换成运行命令):\n")
                .append("   `sshpass -f ").append(credPath).append(" ssh -p ").append(port)
                .append(" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ")
                .append(target).append(" '<命令>'`\n");
        }
        sb.append("注意:凭据文件内容属机密,不要 cat 出来、不要写进回复或结果文件、不要提交到任何仓库。\n")
            .append("多条命令可以用 heredoc 一次性送上去,避免每条都重连。\n\n");
        return sb.toString();
    }

    /** 结果根目录:落在沙箱会话目录下,后端用 UserFS 直接读,无需为取报告再开远程读文件接口。 */
    private static final String E2E_RESULT_DIR = "/by/.sessions/%s/e2e-result";

    /** onEnv 时用例在环境机上跑,产物先落这里,再由员工拷回沙箱结果根目录。按会话隔离,避免并发覆盖。 */
    private static final String ENV_MACHINE_RESULT_DIR = "/tmp/byclaw-e2e-%s";

    /**
     * 结果回流契约段。目录结构与 status.json 字段对齐规范页 /spec/integrationTest
     * (前端 pages/spec/contracts.ts 是同一份契约的展示面),两处必须同步改。
     * 产物必须落沙箱而非环境机:后端只从沙箱读,留在环境机上等于没写。
     */
    private String buildResultContractSection(Long sessionId, IntegrationSuite suite, boolean onEnv) {
        String dir = E2E_RESULT_DIR.formatted(sessionId);
        String suiteId = String.valueOf(suite.getSuiteId());
        StringBuilder sb = new StringBuilder("## 结果回流(硬性契约,见规范页 /spec/integrationTest)\n");
        sb.append("本次运行的结果根目录:").append(dir).append("\n")
            .append("先建好目录:`mkdir -p ").append(dir).append("/reports ").append(dir).append("/logs ")
            .append(dir).append("/artifacts/").append(suiteId).append("`\n\n")
            .append("产物按下面结构落,平台按此约定读:\n")
            .append("- `status.json` 状态真相源(最后写,见下)\n")
            .append("- `reports/").append(suiteId).append(".xml` JUnit XML 报告(用运行命令的 junitxml 之类参数产出)\n")
            .append("- `logs/").append(suiteId).append(".log` 运行日志(标准输出重定向即可)\n")
            .append("- `artifacts/").append(suiteId).append("/<用例ID>.png` 失败证据截图,文件名用用例ID,平台按名挂到失败用例\n\n");
        if (onEnv) {
            // 用例在环境机上跑,产物也生成在那边;不拷回沙箱后端就读不到(后端只读沙箱)。
            String envDir = ENV_MACHINE_RESULT_DIR.formatted(sessionId);
            sb.append("用例在环境机上运行,产物先落环境机的 ").append(envDir)
                .append("(在 ssh 会话里 `mkdir -p ").append(envDir).append("/reports ").append(envDir)
                .append("/logs ").append(envDir).append("/artifacts/").append(suiteId).append("`),")
                .append("跑完必须拷回沙箱:\n")
                .append("`scp -r ...:").append(envDir).append("/* ").append(dir).append("/`")
                .append("(ssh 参数同上,私钥/口令一致)\n")
                .append("平台只读沙箱,产物留在环境机上等于没写。status.json 可以直接写在沙箱侧,拷完再写。\n\n");
        }
        sb.append("最后原子写 status.json(先写 .tmp 再 mv,避免平台读到半截 JSON):\n")
            .append("`... > ").append(dir).append("/status.json.tmp && mv ")
            .append(dir).append("/status.json.tmp ").append(dir).append("/status.json`\n\n")
            .append("内容(status 取 passed/failed/error 之一:用例有失败用 failed;没跑到用例的构建/环境错误用 error):\n")
            .append("```json\n")
            .append("{\"schemaVersion\":1,\"status\":\"passed\",\"startedAt\":\"2026-08-07T10:00:00+08:00\",")
            .append("\"finishedAt\":\"2026-08-07T10:05:00+08:00\",")
            .append("\"totals\":{\"total\":61,\"passed\":60,\"failed\":0,\"skipped\":1},")
            .append("\"suites\":[{\"id\":\"").append(suiteId).append("\",\"status\":\"passed\",")
            .append("\"report\":\"reports/").append(suiteId).append(".xml\",")
            .append("\"log\":\"logs/").append(suiteId).append(".log\",\"failedCases\":[]}],")
            .append("\"reason\":\"\"}\n")
            .append("```\n")
            // 实测员工把 pytest 尾行的 passed 数当成了 total,导致 total<passed+skipped 数据自相矛盾。
            .append("totals 必须算平:total = passed + failed + skipped。别把测试框架尾行里的 passed 数当 total。\n")
            .append("有失败用例时,suites[].failedCases 每项形如 ")
            .append("`{\"case\":\"test_login\",\"message\":\"断言失败摘要\",\"artifacts\":[\"artifacts/")
            .append(suiteId).append("/test_login.png\"]}`,artifacts 写相对结果根目录的路径。\n")
            .append("若用例集没产出 JUnit XML、或失败了却没有截图,照实跑完并在回复里点明该用例集不符合规范页要求,")
            .append("便于用例集作者补齐。\n\n");
        return sb.toString();
    }

    /** 沙箱内环境机凭据文件路径。私钥与口令分开命名,员工按文件名就知道该用哪种登录方式。 */
    // 带 /by 前缀:UserFS 路径与沙箱内员工看到的路径是同一口径(对齐 INTEGRATION_RESULT_PATH),
    // 少了前缀会写到别处,员工按提示词里的路径就找不到文件。
    private static final String TESTER_SSH_KEY_PATH = "/by/.sessions/%s/.env-ssh-key";
    private static final String TESTER_SSH_PASS_PATH = "/by/.sessions/%s/.env-ssh-pass";

    /** 私钥在沙箱本地盘的落点。ssh 要求私钥不可被他人读,而会话目录是网络挂载,chmod 未必生效。 */
    private static final String TESTER_SSH_KEY_LOCAL = "/tmp/.env-ssh-key";

    /**
     * 把环境机登录凭据写进沙箱会话目录。走文件而不是提示词:提示词会落进会话历史并长期可读,
     * 凭据一旦写进去就再也收不回;文件随会话目录生命周期走,且提示词里只需出现路径。
     * 返回 false 表示下发失败,调用方须让本次执行失败而不是让员工白跑一趟。
     */
    private boolean writeTesterSshCredential(String userCode, Long sessionId, String connSecret, boolean keyAuth) {
        // 私钥要求尾部换行,否则 ssh 会报 "invalid format";口令去掉首尾空白避免误带换行。
        String content = keyAuth
            ? StringUtils.appendIfMissing(connSecret, "\n") : StringUtils.trimToEmpty(connSecret);
        String path = (keyAuth ? TESTER_SSH_KEY_PATH : TESTER_SSH_PASS_PATH).formatted(sessionId);
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        try {
            return userContextRunner.callAsUser(userCode, () -> {
                // ByteArrayInputStream 无需 close,不用 try-with-resources:lambda 不允许抛受检异常。
                userFS.write(new ByteArrayInputStream(bytes), bytes.length, "text/plain", path);
                return true;
            });
        }
        catch (Exception e) {
            // 只记路径与异常类型,绝不记内容:这里手上就是凭据明文。
            log.error("[Integration] 下发环境机凭据到沙箱失败, sessionId={}, path={}", sessionId, path, e);
            return false;
        }
    }

    /**
     * 用例代码获取方式段:决定测试员工要不要克隆。
     * code=沿用开发已检出的代码:能定位到本需求该仓库的 coder 会话时,直接进那个目录跑命令,免克隆;
     * 定位不到(如人工触发无需求上下文)则退化为克隆同一仓库,行为等价只是多一次克隆。
     * standalone=用例在另一个仓库,必须先克隆它。
     */
    private String buildCaseSourceSection(IntegrationRun run, IntegrationEnv env, IntegrationSuite suite) {
        if (SOURCE_ON_ENV.equalsIgnoreCase(StringUtils.defaultString(suite.getSourceType()))) {
            // 用例在环境机上,沙箱本地没有这份代码;员工须按环境连接方式登上去执行,不要克隆任何仓库。
            return "用例已预置在集成测试环境机上,不要克隆任何仓库,也不要在沙箱本地找用例:\n"
                + "- 目标环境机:" + StringUtils.defaultString(env.getConnUser()) + "@"
                + StringUtils.defaultString(env.getConnHost()) + ":"
                + StringUtils.defaultIfBlank(env.getConnPort(), "22") + "\n"
                + "- 用例所在目录(环境机上的路径):" + StringUtils.defaultString(env.getConnWorkdir()) + "\n"
                + "- 请用 ssh 登录该环境机,cd 到上述目录后执行运行命令。";
        }
        if (SOURCE_STANDALONE.equalsIgnoreCase(suite.getSourceType())) {
            String repoUrl = StringUtils.defaultString(suite.getSource());
            // 独立用例仓库无平台/令牌上下文,直用填写地址;私有仓库令牌由测试员工环境自备。
            return "用例在独立仓库,需先克隆它:\n"
                + DevloopApplicationService.buildRepoCloneHint(null, repoUrl, "");
        }
        ProjectRepo repo = suite.getRepoId() == null ? null : projectRepoMapper.selectById(suite.getRepoId());
        String repoFullName = repo != null && repo.getRepoFullName() != null ? repo.getRepoFullName() : "";
        Long coderSessionId = findCoderSession(run, suite.getRepoId()).sessionId;
        if (coderSessionId != null) {
            return "用例与被测代码同仓,开发环节已把该仓库检出到本沙箱,不要重新克隆:\n"
                + "- 直接进入开发已检出的目录:/by/.sessions/" + coderSessionId + "/(仓库 " + repoFullName + " 的子目录)\n"
                + "- 若该目录确实不存在,再按下述方式克隆兜底:\n"
                + DevloopApplicationService.buildRepoCloneHint(
                    repo != null ? repo.getProvider() : null,
                    repo != null && repo.getRepoUrl() != null ? repo.getRepoUrl() : repoFullName, repoFullName);
        }
        String repoUrl = repo != null && repo.getRepoUrl() != null ? repo.getRepoUrl() : repoFullName;
        String provider = repo != null ? repo.getProvider() : null;
        // 无开发会话可沿用(人工触发/未起开发任务):按普通克隆处理。
        return "未找到可沿用的开发检出目录,请克隆该仓库后运行:\n"
            + DevloopApplicationService.buildRepoCloneHint(provider, repoUrl, repoFullName);
    }

    /**
     * 找本需求下该仓库的开发(coder)会话,用于沿用其已检出代码。
     * 只在需求级批量触发时有 requirementId;单仓库需求的子任务 repoId 可能为空,故 repoId 匹配不上时回退到唯一子任务。
     */
    private CoderSession findCoderSession(IntegrationRun run, Long suiteRepoId) {
        if (run.getRequirementId() == null) {
            return CoderSession.missing("本次执行未关联需求(手动触发),没有开发环节可沿用");
        }
        List<ScanItemTask> tasks = scanItemTaskService.listByRequirement(run.getRequirementId());
        if (tasks == null || tasks.isEmpty()) {
            return CoderSession.missing("需求下没有开发子任务");
        }
        List<ScanItemTask> started = new ArrayList<>();
        for (ScanItemTask task : tasks) {
            if (task.getSessionId() != null) {
                started.add(task);
            }
        }
        if (started.isEmpty()) {
            return CoderSession.missing("需求下的开发子任务都还没启动会话,尚无检出目录");
        }
        for (ScanItemTask task : started) {
            if (suiteRepoId != null && suiteRepoId.equals(task.getRepoId())) {
                return CoderSession.of(task.getSessionId());
            }
        }
        // 单仓库需求的子任务 repoId 常为空;只有一个开发会话时它就是目标,不做歧义猜测。
        if (started.size() == 1) {
            return CoderSession.of(started.get(0).getSessionId());
        }
        return CoderSession.missing("需求下有 " + started.size() + " 个开发会话,没有一个匹配套件配置的用例仓库,无法确定沿用哪个检出目录");
    }

    /**
     * 测试员工提示词:克隆用例 → 部署好的被测系统地址 → 运行命令 → 结果结构化回流约定。
     * 结果文件与 [PHASE] 打点由回收 poller 解析入库,故提示词强约束其格式,不可省略。
     */
    private String buildTesterPrompt(Long sessionId, IntegrationEnv env, IntegrationSuite suite, String caseSource,
                                     boolean keyAuth) {
        boolean onEnv = SOURCE_ON_ENV.equalsIgnoreCase(StringUtils.defaultString(suite.getSourceType()));
        String branch = StringUtils.defaultString(suite.getBranch());
        String runCommand = StringUtils.defaultString(suite.getRunCommand());
        String address = StringUtils.defaultString(env.getAddress());
        return "请执行以下集成/回归测试任务:\n"
            + "## 测试任务信息\n"
            + "- 测试用例集:" + StringUtils.defaultString(suite.getSuiteName()) + "\n"
            // 用例在环境机上时没有克隆动作,分支无意义。
            + (onEnv ? "" : "- 用例分支:" + branch + "\n")
            + "- 被测系统访问地址(环境已部署就绪,直接对其发起测试):" + address + "\n\n"
            + "## 用例代码从哪来\n" + caseSource + "\n\n"
            // onEnv 必须登环境机:沙箱默认没有 ssh 客户端,凭据也只在文件里,两者都要明确给出,
            // 否则员工只能报「无 ssh、无凭据」而无法执行(实测过)。
            + (onEnv ? buildSshPrepSection(sessionId, env, keyAuth) : "")
            // env 来源不落沙箱,提"克隆落地路径"只会误导员工在本地找用例。
            + (onEnv ? ""
                : "## 需要克隆时的落地路径\n"
                    + "克隆到 /by/.sessions/" + sessionId + "/ 下(按仓库名建子目录);沿用开发检出目录时无需克隆。\n\n")
            + "## 运行方式\n"
            + "在用例所在目录执行运行命令:" + runCommand + "\n"
            // 规范页约定编排脚本从 BYCLAW_E2E_RESULT_DIR 读结果根目录,按规范写的用例集/脚本
            // 依赖这个变量;不导出会让它们把产物落到默认位置,平台就读不到。
            + "执行前先导出结果根目录环境变量(按规范写的用例集脚本会读它):\n"
            // onEnv 时命令跑在环境机上,变量必须导在那一侧,指向环境机本地目录;跑完再拷回沙箱。
            + (onEnv
                ? "`export BYCLAW_E2E_RESULT_DIR=" + ENV_MACHINE_RESULT_DIR.formatted(sessionId)
                    + "`(在 ssh 会话里导出,即环境机上的目录)\n"
                : "`export BYCLAW_E2E_RESULT_DIR=" + E2E_RESULT_DIR.formatted(sessionId) + "`\n")
            + "\n"
            + buildResultContractSection(sessionId, suite, onEnv)
            + "## 强制要求\n"
            + "- acp 下发任务时必须调用 skill:self-developed-rules。\n"
            + "- 结果确定后在会话中打点:全部通过输出 `[PHASE] tester DONE`;存在失败输出 `[PHASE] tester REJECT->coder` "
            + "并简述失败原因,供研发闭环打回重工。打点必须在结果文件写完之后。";
    }

    // 高危命令拦截:不执行,落一条 error step(退出码 -1,logText 记原因),返回失败结论让编排层停下。
    private StepOutcome recordBlockedStep(IntegrationRun run, int seq, String stepType, String stepName, String reason) {
        log.warn("Integration step blocked by guard, runId={}, step={}, reason={}", run.getRunId(), stepName, reason);
        Date now = new Date();
        IntegrationRunStep step = new IntegrationRunStep();
        step.setStepId(sequenceService.nextVal());
        step.setRunId(run.getRunId());
        step.setSeq(seq);
        step.setStepType(stepType);
        step.setStepName(stepName);
        step.setExitCode(-1);
        step.setStatus(STATUS_ERROR);
        step.setDurationSec(0);
        step.setLogText(reason);
        step.setStartedAt(now);
        step.setFinishedAt(now);
        integrationRunStepMapper.insert(step);
        return new StepOutcome(STATUS_ERROR, stepName, reason);
    }

    /** 执行命令并落一条 run_step,返回步骤结论。 */
    private StepOutcome execAndRecord(IntegrationRun run, int seq, String stepType, String stepName,
                                      CommandExecSpec spec) throws Exception {
        Date startedAt = new Date();
        long t0 = System.currentTimeMillis();
        // 日志只打步骤元信息,不打命令正文/env——命令拼了注入的密码 export,打出来会泄露。
        log.info("Integration step start, runId={}, seq={}, type={}, name={}", run.getRunId(), seq, stepType, stepName);
        SshExecResult result = commandRunner.run(spec);
        int durationSec = (int) ((System.currentTimeMillis() - t0) / 1000);
        String status = stepStatus(result);
        log.info("Integration step done, runId={}, seq={}, name={}, status={}, exitCode={}, durationSec={}",
            run.getRunId(), seq, stepName, status, result.getExitCode(), durationSec);

        IntegrationRunStep step = new IntegrationRunStep();
        step.setStepId(sequenceService.nextVal());
        step.setRunId(run.getRunId());
        step.setSeq(seq);
        step.setStepType(stepType);
        step.setStepName(stepName);
        step.setExitCode(result.getExitCode());
        step.setStatus(status);
        step.setDurationSec(durationSec);
        step.setLogText(result.getOutput());
        step.setStartedAt(startedAt);
        step.setFinishedAt(new Date());
        integrationRunStepMapper.insert(step);

        return new StepOutcome(status, stepName, result.getOutput());
    }

    private CommandExecSpec baseSpec(IntegrationEnv env, String connSecret, Map<String, String> injectedEnv) {
        CommandExecSpec spec = new CommandExecSpec();
        spec.setConnProtocol(env.getConnProtocol());
        spec.setHost(env.getConnHost());
        spec.setPort(env.getConnPort());
        spec.setUser(env.getConnUser());
        spec.setAuthType(StringUtils.defaultIfBlank(env.getConnAuth(), "key"));
        spec.setSecret(connSecret);
        spec.setEnv(new LinkedHashMap<>(injectedEnv));
        return spec;
    }

    /** stage 命令:inline 用解释器执行脚本正文,path 执行脚本文件。 */
    private String buildStageCommand(StageDef stage) {
        String interpreter = StringUtils.defaultIfBlank(stage.interpreter, "bash");
        String runner = interpreterBinary(interpreter);
        if ("path".equalsIgnoreCase(stage.source)) {
            return runner + " " + shellQuote(StringUtils.defaultString(stage.script));
        }
        // inline:bash/sh 直接作为 shell 命令执行;python/node 走 -c/-e 传脚本正文。
        if ("python".equalsIgnoreCase(interpreter)) {
            return runner + " -c " + shellQuote(StringUtils.defaultString(stage.script));
        }
        if ("node".equalsIgnoreCase(interpreter)) {
            return runner + " -e " + shellQuote(StringUtils.defaultString(stage.script));
        }
        return StringUtils.defaultString(stage.script);
    }

    private String interpreterBinary(String interpreter) {
        if ("python".equalsIgnoreCase(interpreter)) {
            return "python3";
        }
        if ("node".equalsIgnoreCase(interpreter)) {
            return "node";
        }
        if ("sh".equalsIgnoreCase(interpreter)) {
            return "sh";
        }
        return "bash";
    }

    // SM4 密文 → 明文;空值或解密失败返回 null(调用方按缺失处理)。明文仅内存持有,不落库不打日志。
    private String decryptSecret(String cipher) {
        if (StringUtils.isBlank(cipher)) {
            return null;
        }
        try {
            return Sm4Util.decrypt(cipher);
        } catch (Exception e) {
            // 解密失败多为旧数据(改密文设计前存的明文 key,非合法 SM4 密文)。
            // 只记一行原因,不打完整栈、不打密文/明文值;调用方按缺失处理,提示用户重填即可。
            log.warn("Failed to decrypt integration credential (likely legacy plaintext ref), reason={}", e.getMessage());
            return null;
        }
    }

    /** 从 testAccounts JSON 解密每个账号密码(credentialRef 存 SM4 密文),组 <PREFIX>_USER / <PREFIX>_PASS。缺失/失败的账号跳过,不阻断执行。 */
    private Map<String, String> buildAccountEnv(String testAccountsJson) {
        Map<String, String> envMap = new LinkedHashMap<>();
        if (StringUtils.isBlank(testAccountsJson)) {
            return envMap;
        }
        JSONArray accounts = safeParseArray(testAccountsJson);
        if (accounts == null) {
            return envMap;
        }
        for (int i = 0; i < accounts.size(); i++) {
            JSONObject acc = accounts.getJSONObject(i);
            if (acc == null) {
                continue;
            }
            String prefix = acc.getString("envPrefix");
            if (StringUtils.isBlank(prefix)) {
                continue;
            }
            envMap.put(prefix + "_USER", StringUtils.defaultString(acc.getString("username")));
            String pwd = decryptSecret(acc.getString("credentialRef"));
            if (pwd != null) {
                envMap.put(prefix + "_PASS", pwd);
            }
        }
        return envMap;
    }

    private List<StageDef> parseStages(String stagesJson) {
        List<StageDef> list = new ArrayList<>();
        JSONArray arr = safeParseArray(stagesJson);
        if (arr == null) {
            return list;
        }
        for (int i = 0; i < arr.size(); i++) {
            JSONObject s = arr.getJSONObject(i);
            if (s == null) {
                continue;
            }
            StageDef def = new StageDef();
            def.name = StringUtils.defaultIfBlank(s.getString("name"), "stage-" + i);
            def.interpreter = s.getString("interpreter");
            def.source = s.getString("source");
            def.script = s.getString("script");
            def.workdir = s.getString("workdir");
            def.timeoutSec = s.getIntValue("timeoutSec");
            def.continueOnError = s.getBooleanValue("continueOnError");
            list.add(def);
        }
        return list;
    }

    // ---- 报告按需读取:前端点「查看报告」时才 SSH cat,原文不落库 ----

    /**
     * 按需读取套件报告原文。报告体积可观且只在人工查看时需要,所以不随 run 落库,
     * 每次查看重新 SSH cat;文件已被环境清掉时按明确错误返回,不伪造空内容。
     * 凭据只在本方法内解密并塞进 spec.secret,不进命令正文、不写日志。
     */
    public ReportContent readSuiteReport(IntegrationRun run, IntegrationEnv env, IntegrationSuite suite) {
        String reportPath = StringUtils.trimToNull(suite.getReportPath());
        if (reportPath == null) {
            return ReportContent.error("该测试用例集没有配置报告路径");
        }
        String connSecret = decryptSecret(env.getConnCredentialRef());
        if (StringUtils.isBlank(connSecret)) {
            return ReportContent.error("连接凭据缺失或解密失败:请在环境配置中重新填写 SSH 密码/私钥后重试");
        }
        CaseCheckout checkout = resolveCaseCheckout(run, env, suite);
        if (checkout.error != null) {
            return ReportContent.error(checkout.error);
        }
        try {
            CommandExecSpec spec = reportSpec(env, connSecret, Collections.emptyMap(),
                suite, resolveSuiteWorkdir(checkout, suite));
            SshExecResult result = commandRunner.run(spec);
            String error = reportReadError(reportPath, result);
            if (error != null) {
                return ReportContent.error(error);
            }
            return ReportContent.ok(reportPath, result.getOutput());
        } catch (Exception e) {
            log.warn("Failed to read suite report on demand, runId={}, suiteId={}",
                run.getRunId(), suite.getSuiteId(), e);
            return ReportContent.error("报告读取异常: " + rootMessage(e));
        }
    }

    /** 报告按需读取结果:成功带路径与原文,失败只带可回显的原因(不含任何凭据)。 */
    public static final class ReportContent {
        private final String path;
        private final String content;
        private final String error;

        private ReportContent(String path, String content, String error) {
            this.path = path;
            this.content = content;
            this.error = error;
        }

        static ReportContent ok(String path, String content) {
            return new ReportContent(path, content, null);
        }

        static ReportContent error(String error) {
            return new ReportContent(null, null, error);
        }

        public String getPath() {
            return path;
        }

        public String getContent() {
            return content;
        }

        public String getError() {
            return error;
        }
    }

    // ---- backend 直跑:JUnit 报告拉取与解析(仅 executorMode=backend 走) ----

    private JunitSummary parseJunitReport(IntegrationEnv env, String connSecret, Map<String, String> injectedEnv,
                                          IntegrationSuite suite, String workdir) {
        JunitSummary summary = new JunitSummary();
        if (StringUtils.isBlank(suite.getReportPath())) {
            return summary;
        }
        try {
            SshExecResult result = commandRunner.run(reportSpec(env, connSecret, injectedEnv, suite, workdir));
            summary.reportError = reportReadError(suite.getReportPath(), result);
            if (summary.reportError != null) {
                return summary;
            }
            parseJunitXml(result.getOutput(), suite, summary);
        } catch (Exception e) {
            // 解析失败的具体原因(prolog 位置、非法字符)只有异常里有,带回 run.reason 才能定位,
            // 否则前端只能看到一句「不可解析」,和「报告没生成」无法区分。
            summary.reportError = "报告解析失败:" + suite.getReportPath() + " (" + rootMessage(e) + ")";
            log.warn("Failed to fetch/parse JUnit report, suiteId={}, reportPath={}",
                suite.getSuiteId(), suite.getReportPath(), e);
        }
        return summary;
    }

    /**
     * 执行期解析与按需预览共用同一条取数规格,避免两边行为漂移(之前预览能读、执行期读不到就是这么来的)。
     * 报告路径是绝对路径时不设 workdir:cd 是多余的失败点,目录被清掉会让读取整体失败。
     */
    private CommandExecSpec reportSpec(IntegrationEnv env, String connSecret, Map<String, String> injectedEnv,
                                       IntegrationSuite suite, String workdir) {
        CommandExecSpec spec = baseSpec(env, connSecret, injectedEnv);
        String reportPath = suite.getReportPath().trim();
        if (!reportPath.startsWith("/")) {
            spec.setWorkdir(workdir);
        }
        spec.setCommand(catReportCommand(reportPath));
        spec.setTimeoutSec(VERIFY_TIMEOUT_SEC);
        // 报告要按原文取:默认的尾部截断会砍掉 XML 声明,合并的 stderr 会追在根标签之后,两者都让解析必败。
        spec.setRawOutput(true);
        return spec;
    }

    /** 报告读不到时的自描述标记。用 && 链会把「不存在/无权限/超限」压成同一个非零退出,无法定位。 */
    private static final String RPT_MISSING = "__RPT_MISSING__";
    private static final String RPT_DENIED = "__RPT_DENIED__";
    private static final String RPT_TOO_BIG = "__RPT_TOO_BIG__";

    /**
     * 先卡体积再 cat:报告可能被用例写成几十兆,整份读回会撑爆 JVM 堆与前端预览。
     * 每种失败回一个标记而不是靠退出码:合法报告必以 `<` 开头,标记不会和报告正文相撞。
     */
    private static String catReportCommand(String reportPath) {
        String p = shellQuote(reportPath);
        return "if [ ! -f " + p + " ]; then echo " + RPT_MISSING
            + "; elif [ ! -r " + p + " ]; then echo " + RPT_DENIED
            + "; else __sz=$(wc -c < " + p + "); if [ \"$__sz\" -gt " + REPORT_MAX_BYTES
            + " ]; then echo " + RPT_TOO_BIG + " $__sz; else cat " + p + "; fi; fi";
    }

    /** 把标记翻译成可回显的原因;非标记即读取成功。返回 null 表示内容可用。 */
    private static String reportReadError(String reportPath, SshExecResult result) {
        if (result.isTimedOut()) {
            return "报告读取超时:" + reportPath + " 所在环境机 " + VERIFY_TIMEOUT_SEC + "s 内无响应";
        }
        String out = StringUtils.trimToEmpty(result.getOutput());
        if (out.startsWith(RPT_MISSING)) {
            return "报告文件不存在:" + reportPath + "(套件命令没有生成报告,或生成到了别的路径)";
        }
        if (out.startsWith(RPT_DENIED)) {
            return "报告文件无读取权限:" + reportPath;
        }
        if (out.startsWith(RPT_TOO_BIG)) {
            return "报告体积超过 " + (REPORT_MAX_BYTES / 1024 / 1024) + "MB 上限:" + reportPath
                + "(实际 " + StringUtils.trimToEmpty(StringUtils.removeStart(out, RPT_TOO_BIG)) + " 字节)";
        }
        if (!result.isSuccess() || out.isEmpty()) {
            // 不带 stderr:注入的 export 里有测试账号口令,原文进 reason 会落库。排查看步骤日志。
            return "报告读取命令执行失败:" + reportPath + "(exitCode=" + result.getExitCode() + ")";
        }
        return null;
    }

    static void parseJunitXml(String xml, IntegrationSuite suite, JunitSummary summary) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        // 防 XXE:测试报告来自被测环境,按不可信输入处理。
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        Document doc = builder.parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));

        NodeList testsuites = doc.getElementsByTagName("testsuite");
        List<JSONObject> failedCases = new ArrayList<>();
        for (int i = 0; i < testsuites.getLength(); i++) {
            Element ts = (Element) testsuites.item(i);
            summary.total += intAttr(ts, "tests");
            int failures = intAttr(ts, "failures") + intAttr(ts, "errors");
            summary.failed += failures;
            summary.skipped += intAttr(ts, "skipped");
            summary.durationSec += (int) doubleAttr(ts, "time");
            collectFailedCases(ts, failedCases);
        }
        summary.passed = Math.max(0, summary.total - summary.failed - summary.skipped);
        summary.suiteStatus = summary.failed > 0 ? STATUS_FAILED : STATUS_PASSED;
        // 解析走到这里说明 XML 结构可读:置位后 finishSuccessOrFailure 才允许判 passed。
        summary.reportResolved = true;

        JSONObject suiteResult = new JSONObject(true);
        suiteResult.put("suiteId", String.valueOf(suite.getSuiteId()));
        suiteResult.put("name", suite.getSuiteName());
        suiteResult.put("status", summary.suiteStatus);
        suiteResult.put("total", summary.total);
        suiteResult.put("passed", summary.passed);
        suiteResult.put("failed", summary.failed);
        suiteResult.put("durationSec", summary.durationSec);
        suiteResult.put("reportPath", StringUtils.defaultString(suite.getReportPath()));
        suiteResult.put("logPath", "");
        suiteResult.put("failedCases", failedCases);

        JSONArray suites = new JSONArray();
        suites.add(suiteResult);
        summary.suitesJson = suites.toJSONString();
    }

    private static void collectFailedCases(Element testsuite, List<JSONObject> failedCases) {
        NodeList cases = testsuite.getElementsByTagName("testcase");
        for (int i = 0; i < cases.getLength(); i++) {
            Element tc = (Element) cases.item(i);
            Element failure = firstChildElement(tc, "failure");
            if (failure == null) {
                failure = firstChildElement(tc, "error");
            }
            if (failure == null) {
                continue;
            }
            String caseId = StringUtils.defaultString(tc.getAttribute("classname"));
            String name = StringUtils.defaultString(tc.getAttribute("name"));
            JSONObject fc = new JSONObject(true);
            fc.put("caseId", StringUtils.isBlank(caseId) ? name : caseId + "#" + name);
            fc.put("message", StringUtils.defaultIfBlank(failure.getAttribute("message"), truncateMessage(failure.getTextContent())));
            fc.put("artifacts", new JSONArray());
            failedCases.add(fc);
        }
    }

    private static Element firstChildElement(Element parent, String tag) {
        NodeList children = parent.getElementsByTagName(tag);
        for (int i = 0; i < children.getLength(); i++) {
            Node n = children.item(i);
            if (n.getNodeType() == Node.ELEMENT_NODE) {
                return (Element) n;
            }
        }
        return null;
    }

    // ---- 收尾:统一写回 byai_integration_run(环境阶段失败/下发异常走这里;backend 直跑另有 finishSuccessOrFailure) ----

    /** run 终态判定结果:passed 时 reason 为 null,其余带可回显的失败原因。 */
    record RunVerdict(String status, String reason) {
    }

    /**
     * 「成功」的判定标准集中在这里:套件命令退出码 0 + 报告可解析且有用例 + 无 failure/error。
     * 拆成静态方法是为了能直接测「命令成功但报告没取到」这一档,不用起 Spring 上下文。
     */
    static RunVerdict decideVerdict(IntegrationSuite suite, String suiteStatus, JunitSummary summary) {
        if (STATUS_TIMEOUT.equals(suiteStatus)) {
            return new RunVerdict(STATUS_TIMEOUT, "套件执行超时: " + suite.getSuiteName());
        }
        if (summary.failed > 0) {
            return new RunVerdict(STATUS_FAILED, "存在失败用例: failed=" + summary.failed);
        }
        // 配了报告路径就必须拿到可解析且有用例的报告:退出码 0 不代表用例真跑了,
        // 报告没取到时 total=0/failed=0 会和「全通过」撞成同一个 passed,必须判失败。
        if (StringUtils.isNotBlank(suite.getReportPath()) && (!summary.reportResolved || summary.total <= 0)) {
            String detail = StringUtils.defaultIfBlank(summary.reportError,
                "报告缺失或不可解析: " + suite.getReportPath());
            return new RunVerdict(STATUS_FAILED, detail + ",无法确认用例是否执行");
        }
        if (!STATUS_PASSED.equals(suiteStatus)) {
            // 命令非零退出但报告无失败用例(或没配报告):按失败处理,原因取命令结论。
            return new RunVerdict(STATUS_FAILED, "套件命令未成功: " + suite.getSuiteName());
        }
        return new RunVerdict(STATUS_PASSED, null);
    }

    /** backend 直跑收尾:据套件命令结论 + JUnit 汇总判定 run 终态,失败/超时记 coder 打回。 */
    private void finishSuccessOrFailure(IntegrationRun run, IntegrationSuite suite, StepOutcome suiteOutcome,
                                        JunitSummary summary, long startMs) {
        run.setTotal(summary.total);
        run.setPassed(summary.passed);
        run.setFailed(summary.failed);
        run.setSkipped(summary.skipped);
        run.setSuitesJson(summary.suitesJson);

        RunVerdict verdict = decideVerdict(suite, suiteOutcome.status, summary);
        if (!STATUS_PASSED.equals(verdict.status())) {
            run.setKickbackTo("coder");
            run.setReason(verdict.reason());
        }
        run.setStatus(verdict.status());
        finalizeRun(run, startMs);
    }

    private void finishByStepFailure(IntegrationRun run, StepOutcome outcome, String reason, long startMs) {
        String status = STATUS_TIMEOUT.equals(outcome.status) ? STATUS_TIMEOUT : STATUS_FAILED;
        run.setStatus(status);
        run.setKickbackTo("coder");
        run.setReason(reason);
        finalizeRun(run, startMs);
    }

    private void finishError(IntegrationRun run, String reason, long startMs) {
        run.setStatus(STATUS_ERROR);
        run.setKickbackTo("coder");
        run.setReason(reason);
        finalizeRun(run, startMs);
    }

    private void finalizeRun(IntegrationRun run, long startMs) {
        run.setFinishedAt(new Date());
        run.setDurationSec((int) ((System.currentTimeMillis() - startMs) / 1000));
        integrationRunMapper.updateById(run);
        // 终态日志:reason 不含凭据值(已在各 finish* 处收敛),可安全打印。
        log.info("Integration run finished, runId={}, status={}, durationSec={}, reason={}",
            run.getRunId(), run.getStatus(), run.getDurationSec(), StringUtils.defaultString(run.getReason()));
    }

    private String stepStatus(SshExecResult result) {
        if (result.isTimedOut()) {
            return STATUS_TIMEOUT;
        }
        return result.getExitCode() == 0 ? STATUS_PASSED : STATUS_FAILED;
    }

    private static int intAttr(Element el, String name) {
        String v = el.getAttribute(name);
        if (StringUtils.isBlank(v)) {
            return 0;
        }
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static double doubleAttr(Element el, String name) {
        String v = el.getAttribute(name);
        if (StringUtils.isBlank(v)) {
            return 0;
        }
        try {
            return Double.parseDouble(v.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String truncateMessage(String text) {
        return StringUtils.abbreviate(StringUtils.defaultString(text).trim(), 500);
    }

    private JSONArray safeParseArray(String json) {
        try {
            return JSON.parseArray(json);
        } catch (Exception e) {
            log.warn("Invalid JSON array, ignored: {}", StringUtils.abbreviate(json, 80));
            return null;
        }
    }

    /** DefaultAgent 里 agentId 以字符串存储;空/非数字返回 null,由调用方按未配置处理。 */
    private Long parseAgentId(String raw) {
        if (StringUtils.isBlank(raw)) {
            return null;
        }
        try {
            return Long.valueOf(raw.trim());
        } catch (NumberFormatException e) {
            log.warn("Invalid tester agentId, not a number: {}", StringUtils.abbreviate(raw, 40));
            return null;
        }
    }

    private String rootMessage(Throwable e) {
        Throwable cur = e;
        while (cur.getCause() != null && cur.getCause() != cur) {
            cur = cur.getCause();
        }
        return StringUtils.defaultIfBlank(cur.getMessage(), cur.getClass().getSimpleName());
    }

    /** 单引号包裹并转义内部单引号,防命令注入。 */
    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    /** 环境 stage 解析后的内存态。 */
    private static class StageDef {
        String name;
        String interpreter;
        String source;
        String script;
        String workdir;
        int timeoutSec;
        boolean continueOnError;
    }

    /**
     * backend 直跑的用例检出信息(仅内存态)。
     * token 是解密后的 PAT 明文,只允许经 env 注入交给 CommandRunner,不得拼进命令正文/落库/打日志。
     */
    private static class CaseCheckout {
        String repoUrl;
        String provider;
        String branch;
        String repoName;
        String parentDir;
        String caseDir;
        String token;
        String error;

        /** caseDir 所属的用户桶根,执行机上用它探 NFS 挂载;桶根缺失说明路径整体不成立。 */
        String bucketDir;

        /** 用例已在环境机上:不涉及仓库/用户桶/令牌,caseDir 就是环境的连接工作目录。 */
        boolean onEnv;

        /** caseDir 指向 coder 的会话检出目录:待测的就是开发留下的工作树,禁止清目录或重新克隆覆盖。 */
        boolean reuseCoderCheckout;
    }

    /** 开发会话查找结果:命中会话 id,或给出缺失原因(要直接回给用户,不能只是 null)。 */
    private static final class CoderSession {
        final Long sessionId;
        final String missReason;

        private CoderSession(Long sessionId, String missReason) {
            this.sessionId = sessionId;
            this.missReason = missReason;
        }

        static CoderSession of(Long sessionId) {
            return new CoderSession(sessionId, null);
        }

        static CoderSession missing(String reason) {
            return new CoderSession(null, reason);
        }
    }

    /** 单步执行结论,供收尾判定 run 状态。 */
    private static class StepOutcome {
        final String status;
        final String name;
        final String output;

        StepOutcome(String status, String name, String output) {
            this.status = status;
            this.name = name;
            this.output = output;
        }
    }

    /** JUnit 汇总结果 + 对齐前端契约的 suites JSON(仅 backend 直跑用)。 */
    static class JunitSummary {
        int total;
        int passed;
        int failed;
        int skipped;
        int durationSec;
        String suiteStatus = STATUS_SKIPPED;
        String suitesJson;
        /**
         * 报告是否真的取回并解析成功。缺这个标记时 total=0/failed=0 既可能是「全通过」也可能是
         * 「报告没取到」,两者会被判成同一个 passed;finishSuccessOrFailure 靠它把后者判失败。
         */
        boolean reportResolved;
        /**
         * 报告取不到/解析不了时的具体原因,回显进 run.reason。为空时才用「报告缺失」这类兜底话术:
         * 「文件不存在」和「XML 结构坏了」的排查方向完全不同,合并成一句话会把人引到错的方向。
         */
        String reportError;
    }
}
