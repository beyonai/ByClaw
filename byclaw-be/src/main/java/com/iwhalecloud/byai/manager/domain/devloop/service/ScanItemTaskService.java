package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.ScanItemTask;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanItemTaskMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.Date;
import java.util.List;

/**
 * 研发需求子任务领域服务。
 * 一条研发需求可拆到多个仓库各起一个会话;就绪聚合、批量集成、失败打回都按 (requirement_id, repo_id) 维度取子任务。
 */
@Slf4j
@Service
public class ScanItemTaskService {

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
            existing.setStatus("running");
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
        task.setStatus("running");
        task.setCreateBy(operatorId);
        task.setCreateTime(now);
        task.setDeleteFlag("0");
        scanItemTaskMapper.insert(task);
        return task;
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
