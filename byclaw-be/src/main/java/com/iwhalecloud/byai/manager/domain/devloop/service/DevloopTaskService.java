package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.Task;
import com.iwhalecloud.byai.manager.mapper.devloop.TaskMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/** 研发任务领域服务 */
@Slf4j
@Service
public class DevloopTaskService {

    @Autowired
    private TaskMapper taskMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 创建任务 */
    public Task create(Task task) {
        task.setTaskId(sequenceService.nextVal());
        task.setCreateTime(new Date());
        task.setDeleteFlag("0");
        if (task.getStatus() == null) task.setStatus("待开始");
        if (task.getPhase() == null) task.setPhase("分诊");
        if (task.getCurrentRound() == null) task.setCurrentRound(0);
        if (task.getTotalRounds() == null) task.setTotalRounds(0);
        if (task.getScore() == null) task.setScore(0);
        if (task.getAgentName() == null) task.setAgentName("Code Agent");
        taskMapper.insert(task);
        return task;
    }

    /** 查询项目下未删除的任务列表 */
    public List<Task> listByProjectId(Long projectId) {
        LambdaQueryWrapper<Task> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Task::getProjectId, projectId)
               .eq(Task::getDeleteFlag, "0")
               .orderByDesc(Task::getCreateTime);
        return taskMapper.selectList(wrapper);
    }

    /** 更新任务字段 */
    public void update(Task task) {
        task.setUpdateTime(new Date());
        taskMapper.updateById(task);
    }

    /** 根据ID查询 */
    public Task getById(Long taskId) {
        return taskMapper.selectById(taskId);
    }

    /** 查询某需求是否有未完成的任务（状态非"完成"） */
    public Task findActiveBySourceItemId(Long sourceItemId) {
        LambdaQueryWrapper<Task> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Task::getSourceItemId, sourceItemId)
               .eq(Task::getDeleteFlag, "0")
               .ne(Task::getStatus, "完成")
               .last("LIMIT 1");
        return taskMapper.selectOne(wrapper);
    }
}
