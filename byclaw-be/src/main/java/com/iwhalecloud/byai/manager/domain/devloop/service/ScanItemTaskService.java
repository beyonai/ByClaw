package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanItemTask;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanItemTaskMapper;
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
 * 研发需求子任务领域服务。
 * 一条研发需求可拆到多个仓库各起一个会话;就绪聚合、批量集成、失败打回都按 (requirement_id, repo_id) 维度取子任务。
 */
@Slf4j
@Service
public class ScanItemTaskService {

    /** 派发已建会话但等承接人接单;确认后转 STATUS_RUNNING。 */
    public static final String STATUS_PENDING_CONFIRM = "pending_confirm";

    /** 已开工(直接启动或确认放行后)。 */
    public static final String STATUS_RUNNING = "running";

    @Autowired
    private ScanItemTaskMapper scanItemTaskMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 某需求下全部有效子任务(升序创建时间,便于稳定展示)。 */
    public List<ScanItemTask> listByRequirement(Long requirementId) {
        if (requirementId == null) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<ScanItemTask> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanItemTask::getRequirementId, requirementId)
               .eq(ScanItemTask::getDeleteFlag, "0")
               .orderByAsc(ScanItemTask::getCreateTime);
        return scanItemTaskMapper.selectList(wrapper);
    }

    /** 某项目下全部有效子任务,批量聚合看板一次取尽,避免逐需求查询。 */
    public List<ScanItemTask> listByProject(Long projectId) {
        if (projectId == null) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<ScanItemTask> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanItemTask::getProjectId, projectId)
               .eq(ScanItemTask::getDeleteFlag, "0")
               .orderByAsc(ScanItemTask::getCreateTime);
        return scanItemTaskMapper.selectList(wrapper);
    }

    /**
     * 给定会话中属于研发子任务的那些 sessionId。任务列表按当页会话批量判类型,不能逐行 findBySession。
     * 不过滤 delete_flag:子任务软删不会带走会话,会话仍是研发任务,过滤会让它误判成普通会话。
     */
    public Set<Long> filterSubtaskSessionIds(Collection<Long> sessionIds) {
        if (sessionIds == null || sessionIds.isEmpty()) {
            return Collections.emptySet();
        }
        LambdaQueryWrapper<ScanItemTask> wrapper = new LambdaQueryWrapper<>();
        wrapper.select(ScanItemTask::getSessionId).in(ScanItemTask::getSessionId, sessionIds);
        return scanItemTaskMapper.selectList(wrapper).stream()
               .map(ScanItemTask::getSessionId)
               .filter(Objects::nonNull)
               .collect(Collectors.toSet());
    }

    /** 反查会话对应的子任务;打回引擎按失败 run 的会话定位责任子任务。 */
    public ScanItemTask findBySession(Long sessionId) {
        if (sessionId == null) {
            return null;
        }
        LambdaQueryWrapper<ScanItemTask> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanItemTask::getSessionId, sessionId)
               .eq(ScanItemTask::getDeleteFlag, "0")
               .last("LIMIT 1");
        return scanItemTaskMapper.selectOne(wrapper);
    }

    /**
     * 任务启动时登记子任务:同一 (requirement, repo) 已存在则补写会话并置 running,否则新建。
     * 保证需求→会话关系可查、可聚合,替代仅靠 ScanRequireItem.sessionId 的 1:1 绑定。
     */
    public ScanItemTask upsertOnStart(Long requirementId, Long projectId, Long repoId, Long sessionId, Long operatorId) {
        Date now = new Date();
        ScanItemTask existing = findByRequirementRepo(requirementId, repoId);
        if (existing != null) {
            existing.setSessionId(sessionId);
            existing.setStatus(STATUS_RUNNING);
            existing.setUpdateBy(operatorId);
            existing.setUpdateTime(now);
            scanItemTaskMapper.updateById(existing);
            return existing;
        }
        ScanItemTask task = new ScanItemTask();
        task.setTaskId(sequenceService.nextVal());
        task.setRequirementId(requirementId);
        task.setProjectId(projectId);
        task.setRepoId(repoId);
        task.setSessionId(sessionId);
        task.setStatus(STATUS_RUNNING);
        task.setCreateBy(operatorId);
        task.setCreateTime(now);
        task.setDeleteFlag("0");
        scanItemTaskMapper.insert(task);
        return task;
    }

    /**
     * 拆分建子任务:用预分配的 taskId 直接建一条 running 子任务并写依赖。
     * 拆分需先给全部子任务分配 taskId 以翻译 dependsOn(rowId→taskId),故 taskId 由调用方传入,不在此内生成。
     * dependsOn 为已翻译好的上游 taskId 逗号串;无上游传 null。
     */
    public void insertSubtaskWithDeps(Long taskId, Long requirementId, Long projectId, Long repoId, Long sessionId,
        String dependsOn, Long operatorId) {
        Date now = new Date();
        ScanItemTask task = new ScanItemTask();
        task.setTaskId(taskId);
        task.setRequirementId(requirementId);
        task.setProjectId(projectId);
        task.setRepoId(repoId);
        task.setSessionId(sessionId);
        task.setStatus(STATUS_RUNNING);
        task.setDependsOn(dependsOn);
        task.setCreateBy(operatorId);
        task.setCreateTime(now);
        task.setDeleteFlag("0");
        scanItemTaskMapper.insert(task);
    }

    /**
     * 派发待确认登记:会话已建但未下发提示词,承接人回确认词后才真正开工。
     * status=pending_confirm 是「会话在等接单」的唯一标记,确认放行(markRunning)后转 running;
     * 不存提示词,确认时按 requirement/repo/sessionId 原样重算,见 DevloopApplicationService#resolvePendingTaskPrompt。
     */
    public ScanItemTask upsertPendingConfirm(Long requirementId, Long projectId, Long repoId, Long sessionId,
        Long operatorId) {
        Date now = new Date();
        ScanItemTask existing = findByRequirementRepo(requirementId, repoId);
        if (existing != null) {
            existing.setSessionId(sessionId);
            existing.setStatus(STATUS_PENDING_CONFIRM);
            existing.setUpdateBy(operatorId);
            existing.setUpdateTime(now);
            scanItemTaskMapper.updateById(existing);
            return existing;
        }
        ScanItemTask task = new ScanItemTask();
        task.setTaskId(sequenceService.nextVal());
        task.setRequirementId(requirementId);
        task.setProjectId(projectId);
        task.setRepoId(repoId);
        task.setSessionId(sessionId);
        task.setStatus(STATUS_PENDING_CONFIRM);
        task.setCreateBy(operatorId);
        task.setCreateTime(now);
        task.setDeleteFlag("0");
        scanItemTaskMapper.insert(task);
        return task;
    }

    /** 待确认会话:承接人确认后置 running,幂等重复确认由调用方按 status 闸门拦住。 */
    public void markRunning(Long taskId, Long operatorId) {
        if (taskId == null) {
            return;
        }
        ScanItemTask update = new ScanItemTask();
        update.setTaskId(taskId);
        update.setStatus(STATUS_RUNNING);
        update.setUpdateBy(operatorId);
        update.setUpdateTime(new Date());
        scanItemTaskMapper.updateById(update);
    }

    /**
     * 会话对应的待确认子任务;没有则返回 null。
     * 聊天主链路每条消息都会问一次,故只按已建索引的 session_id 单行命中,不做额外聚合。
     */
    public ScanItemTask findPendingConfirmBySession(Long sessionId) {
        ScanItemTask task = findBySession(sessionId);
        return task != null && STATUS_PENDING_CONFIRM.equals(task.getStatus()) ? task : null;
    }

    /** 唯一索引 (requirement_id, repo_id) 上的定位;repoId 可空(单仓库需求)。 */
    private ScanItemTask findByRequirementRepo(Long requirementId, Long repoId) {
        LambdaQueryWrapper<ScanItemTask> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ScanItemTask::getRequirementId, requirementId)
               .eq(ScanItemTask::getDeleteFlag, "0");
        if (repoId == null) {
            wrapper.isNull(ScanItemTask::getRepoId);
        } else {
            wrapper.eq(ScanItemTask::getRepoId, repoId);
        }
        wrapper.last("LIMIT 1");
        return scanItemTaskMapper.selectOne(wrapper);
    }
}
