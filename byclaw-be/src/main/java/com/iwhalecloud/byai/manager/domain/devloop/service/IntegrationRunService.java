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

import java.util.Date;
import java.util.List;

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

    /** 人工单套件执行:无需求维度,requirementId 为空。 */
    public IntegrationRun startRun(Long suiteId, Long envId, Long currentUserId) {
        return startRun(suiteId, envId, currentUserId, null);
    }

    /**
     * 触发一次执行:校验 → 建 running 主记录 → 异步执行 → 返回 run(含 runId)。
     * requirementId 非空表示需求级批量集成触发,run 挂到该需求,供聚合看板与失败打回按需求反查。
     */
    public IntegrationRun startRun(Long suiteId, Long envId, Long currentUserId, Long requirementId) {
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

        // 后台执行:createBy 已带在 run 上,executor 用它解密该用户的凭据。
        integrationRunExecutor.executeRun(run, env, suite);
        return run;
    }

    /** 查询单次执行主记录。 */
    public IntegrationRun getRun(Long runId) {
        return integrationRunMapper.selectById(runId);
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
