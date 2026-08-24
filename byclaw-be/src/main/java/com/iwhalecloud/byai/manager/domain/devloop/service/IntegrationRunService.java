package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationEnv;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRun;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationRunStep;
import com.iwhalecloud.byai.manager.entity.devloop.IntegrationSuite;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationRunMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.IntegrationRunStepMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 集成测试执行编排领域服务(同步入口 + 查询)。
 * startRun 校验 suite/env、建 running 主记录、秒回 runId,再把耗时执行交给 IntegrationRunExecutor 的 @Async 方法后台跑。
 * 前端拿 runId 后轮询 getRun / listSteps 看进度与最终结果。
 */
@Slf4j
@Service
public class IntegrationRunService {

    @Autowired
    private IntegrationRunMapper integrationRunMapper;

    @Autowired
    private IntegrationRunStepMapper integrationRunStepMapper;

    @Autowired
    private IntegrationSuiteService integrationSuiteService;

    @Autowired
    private IntegrationEnvService integrationEnvService;

    @Autowired
    private IntegrationRunExecutor integrationRunExecutor;

    @Autowired
    private SequenceService sequenceService;

    /** 人工单套件执行:无需求维度,requirementId 为空;执行方式走全局配置。 */
    public IntegrationRun startRun(Long suiteId, Long envId, Long currentUserId) {
        return startRun(suiteId, envId, currentUserId, null, null);
    }

    public IntegrationRun startRun(Long suiteId, Long envId, Long currentUserId, Long requirementId) {
        return startRun(suiteId, envId, currentUserId, requirementId, null);
    }

    /**
     * 触发一次执行:校验 → 建 running 主记录 → 异步执行 → 返回 run(含 runId)。
     * requirementId 非空表示需求级批量集成触发,run 挂到该需求,供聚合看板与失败打回按需求反查。
     *
     * @param executorModeOverride 按次指定执行方式(backend/tester);null 走全局配置(正式形态 tester)。
     *                             前端「执行测试」弹框借它做单次后端直跑调试,定时批量传 null。
     */
    public IntegrationRun startRun(Long suiteId, Long envId, Long currentUserId, Long requirementId,
                                   String executorModeOverride) {
        IntegrationSuite suite = integrationSuiteService.findById(suiteId);
        if (suite == null || "1".equals(suite.getDeleteFlag())) {
            throw new IllegalArgumentException("测试用例集不存在: " + suiteId);
        }
        IntegrationEnv env = integrationEnvService.findById(envId);
        if (env == null || "1".equals(env.getDeleteFlag())) {
            throw new IllegalArgumentException("集成测试环境不存在: " + envId);
        }

        IntegrationRun run = new IntegrationRun();
        run.setRunId(sequenceService.nextVal());
        run.setProjectId(suite.getProjectId());
        run.setSuiteId(suiteId);
        run.setEnvId(envId);
        run.setRequirementId(requirementId);
        run.setStatus("running");
        run.setBranch(suite.getBranch());
        run.setTotal(0);
        run.setPassed(0);
        run.setFailed(0);
        run.setSkipped(0);
        run.setResultDir(env.getConnWorkdir());
        run.setStartedAt(new Date());
        run.setDurationSec(0);
        run.setCreateBy(currentUserId);
        run.setCreateTime(new Date());
        run.setDeleteFlag("0");
        integrationRunMapper.insert(run);

        // tester 模式先同步把员工会话建出来:执行体是 @Async 且要先跑完环境 stages,
        // 等它建会话调用方早就返回了,前端「启动即跳会话」就拿不到 sessionId。
        integrationRunExecutor.prepareTesterSession(run, suite, executorModeOverride);

        // 后台执行:createBy 已带在 run 上,executor 用它解密该用户的凭据。
        integrationRunExecutor.executeRun(run, env, suite, executorModeOverride);
        return run;
    }

    /**
     * 给定会话中由测试员工承接的那些 sessionId。任务列表按当页会话批量判类型,不能逐行反查。
     * 不过滤 delete_flag:执行记录软删不会带走会话,会话仍是测试任务,过滤会让它误判成普通会话。
     */
    public Set<Long> filterTesterSessionIds(Collection<Long> sessionIds) {
        if (sessionIds == null || sessionIds.isEmpty()) {
            return Collections.emptySet();
        }
        LambdaQueryWrapper<IntegrationRun> wrapper = new LambdaQueryWrapper<>();
        wrapper.select(IntegrationRun::getSessionId).in(IntegrationRun::getSessionId, sessionIds);
        return integrationRunMapper.selectList(wrapper).stream()
               .map(IntegrationRun::getSessionId)
               .filter(Objects::nonNull)
               .collect(Collectors.toSet());
    }

    /** 查询单次执行主记录。 */
    public IntegrationRun getRun(Long runId) {
        return integrationRunMapper.selectById(runId);
    }

    /**
     * 按需读取该次执行的报告原文。方法名以 get 开头是硬要求:TransactionAdviceConfig 靠名字前缀
     * 把它归到只读/不参与事务的通知上,否则这次 SSH 往返会一直占着数据库连接。
     */
    public IntegrationRunExecutor.ReportContent getRunReport(Long runId) {
        IntegrationRun run = integrationRunMapper.selectById(runId);
        if (run == null || "1".equals(run.getDeleteFlag())) {
            return IntegrationRunExecutor.ReportContent.error("执行记录不存在: " + runId);
        }
        IntegrationSuite suite = integrationSuiteService.findById(run.getSuiteId());
        if (suite == null) {
            return IntegrationRunExecutor.ReportContent.error("测试用例集已删除,无法定位报告路径");
        }
        IntegrationEnv env = integrationEnvService.findById(run.getEnvId());
        if (env == null) {
            return IntegrationRunExecutor.ReportContent.error("集成测试环境已删除,无法连接环境机读取报告");
        }
        return integrationRunExecutor.readSuiteReport(run, env, suite);
    }

    /** 查询一次执行的步骤明细,按 seq 升序。 */
    public List<IntegrationRunStep> listSteps(Long runId) {
        LambdaQueryWrapper<IntegrationRunStep> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationRunStep::getRunId, runId)
               .orderByAsc(IntegrationRunStep::getSeq);
        return integrationRunStepMapper.selectList(wrapper);
    }

    /** 查询某套件的历史执行列表,最新在前。 */
    public List<IntegrationRun> listBySuiteId(Long suiteId) {
        LambdaQueryWrapper<IntegrationRun> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationRun::getSuiteId, suiteId)
               .eq(IntegrationRun::getDeleteFlag, "0")
               .orderByDesc(IntegrationRun::getCreateTime);
        return integrationRunMapper.selectList(wrapper);
    }

    /** 查询某环境的历史执行列表,最新在前。 */
    public List<IntegrationRun> listByEnvId(Long envId) {
        LambdaQueryWrapper<IntegrationRun> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationRun::getEnvId, envId)
               .eq(IntegrationRun::getDeleteFlag, "0")
               .orderByDesc(IntegrationRun::getCreateTime);
        return integrationRunMapper.selectList(wrapper);
    }

    /**
     * 待打回处理的执行:挂需求、已终态失败(failed/error/timeout)、尚未被打回引擎处理过。
     * kickbackAt 为空是幂等闸门,保证每次失败只驱动一次重工/建一次缺陷。最新在前。
     */
    public List<IntegrationRun> listPendingKickback() {
        LambdaQueryWrapper<IntegrationRun> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationRun::getDeleteFlag, "0")
               .isNotNull(IntegrationRun::getRequirementId)
               .isNull(IntegrationRun::getKickbackAt)
               .in(IntegrationRun::getStatus, "failed", "error", "timeout")
               .orderByDesc(IntegrationRun::getCreateTime);
        return integrationRunMapper.selectList(wrapper);
    }

    /**
     * 已下发测试员工、仍在跑的执行:status=running 且已冻结 sessionId。
     * 结果回收 poller 按此捞取,从会话打点与结构化结果文件回流后收尾。最新在前。
     */
    public List<IntegrationRun> listRunningWithSession() {
        LambdaQueryWrapper<IntegrationRun> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationRun::getDeleteFlag, "0")
               .eq(IntegrationRun::getStatus, "running")
               .isNotNull(IntegrationRun::getSessionId)
               .orderByDesc(IntegrationRun::getCreateTime);
        return integrationRunMapper.selectList(wrapper);
    }

    /** 回收 poller 收尾:整条 run 已在内存设好终态字段,统一落库。 */
    public void update(IntegrationRun run) {
        integrationRunMapper.updateById(run);
    }

    /** 标记一次失败执行已被打回引擎处理(写 kickbackAt + 最终归因环节),闭合幂等闸门。 */
    public void markKickbackHandled(Long runId, String kickbackTo) {
        IntegrationRun update = new IntegrationRun();
        update.setRunId(runId);
        update.setKickbackTo(kickbackTo);
        update.setKickbackAt(new Date());
        integrationRunMapper.updateById(update);
    }

    /** 某项目下所有挂了需求维度的执行,最新在前;聚合看板一次取尽后按需求分组,避免逐需求查询。 */
    public List<IntegrationRun> listWithRequirementByProject(Long projectId) {
        LambdaQueryWrapper<IntegrationRun> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(IntegrationRun::getProjectId, projectId)
               .eq(IntegrationRun::getDeleteFlag, "0")
               .isNotNull(IntegrationRun::getRequirementId)
               .orderByDesc(IntegrationRun::getCreateTime);
        return integrationRunMapper.selectList(wrapper);
    }
}
