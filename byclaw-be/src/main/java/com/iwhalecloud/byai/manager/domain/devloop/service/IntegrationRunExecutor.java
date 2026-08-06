package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.manager.application.service.devloop.IntegrationRunAsyncConfig;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.exec.CommandExecSpec;
import com.iwhalecloud.byai.manager.domain.devloop.exec.CommandRunner;
import com.iwhalecloud.byai.manager.domain.devloop.exec.SshExecResult;
import com.iwhalecloud.byai.manager.entity.devloop.DefaultAgent;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationEnv;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRun;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRunStep;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationSuite;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
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
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

/**
 * 集成测试执行的异步执行体。放在独立 service 里,让 @Async 通过 Spring 代理生效(自调用不走代理)。
 * 全流程:解密连接凭据/测试账号 → 按 seq 跑环境 stages 把被测系统部署起来 → 拼提示词调起「测试数字员工」跑用例。
 * 用例的克隆与执行交给测试员工(后端不再 SSH 跑命令、不再解析 JUnit),run 保持 running,结果由回收 poller 从会话回流。
 * 环境阶段异常收敛为 run=error/failed 并记 reason;私钥/密码解密后仅内存持有,不落库不打日志。
 */
@Slf4j
@Service
public class IntegrationRunExecutor {

    private static final String STATUS_PASSED = "passed";
    private static final String STATUS_FAILED = "failed";
    private static final String STATUS_ERROR = "error";
    private static final String STATUS_TIMEOUT = "timeout";

    private static final String STEP_STAGE = "stage";

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

    @Async(IntegrationRunAsyncConfig.INTEGRATION_RUN_EXECUTOR)
    public void executeRun(IntegrationRun run, IntegrationEnv env, IntegrationSuite suite) {
        long startMs = System.currentTimeMillis();
        int seq = 0;
        log.info("Integration run start, runId={}, envId={}, suiteId={}, host={}",
            run.getRunId(), env.getEnvId(), suite.getSuiteId(), env.getConnHost());
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

            // 2) 环境已就绪:把用例克隆与执行交给「测试数字员工」。后端不再 SSH 跑命令、不再解析 JUnit。
            //    拼提示词(带用例仓库克隆说明 + 被测系统地址 + 运行命令)→ 建会话 → 异步下发 chat;
            //    run 保持 running,sessionId/testerAgentId/testerAgentName 落库,结果由回收 poller 从会话回流。
            dispatchTester(run, env, suite, startMs);
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
     * 下发「测试数字员工」执行本次集成测试:
     * 解析测试员工 → 建独立会话 → 拼提示词(用例仓库克隆说明 + 被测系统地址 + 运行命令 + 结果回流约定)→ 事务外异步 chat。
     * run 保持 running 并冻结 sessionId/testerAgentId/testerAgentName;测试员工完成后由回收 poller 读会话打点与结果文件收尾。
     */
    private void dispatchTester(IntegrationRun run, IntegrationEnv env, IntegrationSuite suite, long startMs) {
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

        // 用例所在仓库:code=随代码仓库(按 repoId 取带令牌 clone 说明);standalone=独立用例仓库(直用 source 地址)。
        String cloneHint = buildCaseCloneHint(suite);

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
        chatDto.setChatContent(buildTesterPrompt(sessionId, env, suite, cloneHint));

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

    /** 用例仓库克隆说明:code 复用代码仓库带令牌 clone 说明;standalone 直用独立仓库地址。 */
    private String buildCaseCloneHint(IntegrationSuite suite) {
        boolean standalone = "standalone".equalsIgnoreCase(suite.getSourceType());
        if (standalone) {
            String repoUrl = StringUtils.defaultString(suite.getSource());
            // 独立用例仓库无平台/令牌上下文,直用填写地址;私有仓库令牌由测试员工环境自备。
            return DevloopApplicationService.buildRepoCloneHint(null, repoUrl, "");
        }
        ProjectRepo repo = suite.getRepoId() == null ? null : projectRepoMapper.selectById(suite.getRepoId());
        String repoFullName = repo != null && repo.getRepoFullName() != null ? repo.getRepoFullName() : "";
        String repoUrl = repo != null && repo.getRepoUrl() != null ? repo.getRepoUrl() : repoFullName;
        String provider = repo != null ? repo.getProvider() : null;
        return DevloopApplicationService.buildRepoCloneHint(provider, repoUrl, repoFullName);
    }

    /**
     * 测试员工提示词:克隆用例 → 部署好的被测系统地址 → 运行命令 → 结果结构化回流约定。
     * 结果文件与 [PHASE] 打点由回收 poller 解析入库,故提示词强约束其格式,不可省略。
     */
    private String buildTesterPrompt(Long sessionId, IntegrationEnv env, IntegrationSuite suite, String cloneHint) {
        String branch = StringUtils.defaultString(suite.getBranch());
        String runCommand = StringUtils.defaultString(suite.getRunCommand());
        String address = StringUtils.defaultString(env.getAddress());
        String resultPath = "/by/.sessions/" + sessionId + "/integration-result.json";
        return "请执行以下集成/回归测试任务:\n"
            + "## 测试任务信息\n"
            + "- 测试用例集:" + StringUtils.defaultString(suite.getSuiteName()) + "\n"
            + "- 用例分支:" + branch + "\n"
            + "- 被测系统访问地址(环境已部署就绪,直接对其发起测试):" + address + "\n\n"
            + "## 用例仓库访问说明\n" + cloneHint + "\n\n"
            + "## 用例代码克隆路径\n"
            + "用例仓库克隆到 /by/.sessions/" + sessionId + "/ 下(按仓库名建子目录)。\n\n"
            + "## 运行方式\n"
            + "克隆用例后,在用例目录执行运行命令:" + runCommand + "\n\n"
            + "## 强制要求\n"
            + "- acp 下发任务时必须调用 skill:self-developed-rules。\n"
            + "- 测试完成后,必须把结构化结果写入 " + resultPath + ",JSON 字段:total(用例总数)、passed(通过数)、"
            + "failed(失败数)、skipped(跳过数)、failedCases(失败用例名数组,可空)。\n"
            + "- 结果确定后在会话中打点:全部通过输出 `[PHASE] tester DONE`;存在失败输出 `[PHASE] tester REJECT->coder` "
            + "并简述失败原因,供研发闭环打回重工。";
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

    // ---- 收尾:统一写回 byai_integration_run(仅环境阶段失败/下发异常走这里;测试结果由回收 poller 收尾) ----

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
}
