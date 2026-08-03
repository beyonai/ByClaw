package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.application.service.devloop.IntegrationRunAsyncConfig;
import com.iwhalecloud.byai.manager.domain.devloop.exec.CommandExecSpec;
import com.iwhalecloud.byai.manager.domain.devloop.exec.CommandRunner;
import com.iwhalecloud.byai.manager.domain.devloop.exec.SshExecResult;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationEnv;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRun;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRunStep;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationSuite;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationRunMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationRunStepMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 集成测试执行的异步执行体。放在独立 service 里,让 @Async 通过 Spring 代理生效(自调用不走代理)。
 * 全流程:解密连接凭据/测试账号 → 按 seq 跑环境 stages → 跑选中套件 runCommand → 拉取并解析 JUnit → 汇总落库。
 * 任何异常都收敛为 run=error 并记 reason,保证不留 running 僵尸;私钥/密码解密后仅内存持有,不落库不打日志。
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

    /** 套件命令默认超时,stage 用各自 timeoutSec。 */
    private static final int DEFAULT_SUITE_TIMEOUT_SEC = 1800;

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

            // 2) 跑选中套件的 runCommand(workdir 优先套件自身,否则用环境工作目录)。
            String suiteWorkdir = StringUtils.defaultIfBlank(suite.getWorkdir(), env.getConnWorkdir());
            StepOutcome suiteOutcome = runSuiteCommand(run, env, connSecret, injectedEnv, suite, suiteWorkdir, seq++);

            // 3) 拉取并解析 JUnit 报告,拼 suites 结果与 totals。
            JunitSummary summary = parseJunitReport(env, connSecret, injectedEnv, suite, suiteWorkdir);

            finishSuccessOrFailure(run, suite, suiteOutcome, summary, startMs);
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

    /** cat 远程/本机的 JUnit XML 并 DOM 解析;报告缺失或解析失败返回空汇总(不阻断)。 */
    private JunitSummary parseJunitReport(IntegrationEnv env, String connSecret, Map<String, String> injectedEnv,
                                          IntegrationSuite suite, String workdir) {
        JunitSummary summary = new JunitSummary();
        if (StringUtils.isBlank(suite.getReportPath())) {
            return summary;
        }
        try {
            CommandExecSpec spec = baseSpec(env, connSecret, injectedEnv);
            spec.setWorkdir(workdir);
            spec.setCommand("cat " + shellQuote(suite.getReportPath()));
            spec.setTimeoutSec(60);
            SshExecResult result = commandRunner.run(spec);
            if (!result.isSuccess() || StringUtils.isBlank(result.getOutput())) {
                return summary;
            }
            parseJunitXml(result.getOutput(), suite, summary);
        } catch (Exception e) {
            log.warn("Failed to fetch/parse JUnit report, suiteId={}, reportPath={}",
                suite.getSuiteId(), suite.getReportPath(), e);
        }
        return summary;
    }

    private void parseJunitXml(String xml, IntegrationSuite suite, JunitSummary summary) throws Exception {
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

    private void collectFailedCases(Element testsuite, List<JSONObject> failedCases) {
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

    private Element firstChildElement(Element parent, String tag) {
        NodeList children = parent.getElementsByTagName(tag);
        for (int i = 0; i < children.getLength(); i++) {
            Node n = children.item(i);
            if (n.getNodeType() == Node.ELEMENT_NODE) {
                return (Element) n;
            }
        }
        return null;
    }

    // ---- 收尾:统一写回 byai_integration_run ----

    private void finishSuccessOrFailure(IntegrationRun run, IntegrationSuite suite, StepOutcome suiteOutcome,
                                        JunitSummary summary, long startMs) {
        run.setTotal(summary.total);
        run.setPassed(summary.passed);
        run.setFailed(summary.failed);
        run.setSkipped(summary.skipped);
        run.setSuitesJson(summary.suitesJson);

        String status;
        String reason = null;
        if (STATUS_TIMEOUT.equals(suiteOutcome.status)) {
            status = STATUS_TIMEOUT;
            reason = "套件执行超时: " + suite.getSuiteName();
        } else if (summary.failed > 0) {
            status = STATUS_FAILED;
            reason = "存在失败用例: failed=" + summary.failed;
        } else if (!STATUS_PASSED.equals(suiteOutcome.status)) {
            // 命令非零退出但报告无失败用例(或无报告):按失败处理,原因取命令结论。
            status = STATUS_FAILED;
            reason = "套件命令未成功: " + suite.getSuiteName();
        } else {
            status = STATUS_PASSED;
        }

        if (!STATUS_PASSED.equals(status)) {
            // 失败/超时记录打回目标环节(自动回灌 dev-loop 留 V2,这里只记录)。
            run.setKickbackTo("coder");
            run.setReason(reason);
        }
        run.setStatus(status);
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

    private JSONArray safeParseArray(String json) {
        try {
            return JSON.parseArray(json);
        } catch (Exception e) {
            log.warn("Invalid JSON array, ignored: {}", StringUtils.abbreviate(json, 80));
            return null;
        }
    }

    private int intAttr(Element el, String name) {
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

    private double doubleAttr(Element el, String name) {
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

    private String truncateMessage(String text) {
        return StringUtils.abbreviate(StringUtils.defaultString(text).trim(), 500);
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

    /** JUnit 汇总结果 + 对齐前端契约的 suites JSON。 */
    private static class JunitSummary {
        int total;
        int passed;
        int failed;
        int skipped;
        int durationSec;
        String suiteStatus = STATUS_SKIPPED;
        String suitesJson;
    }
}
