package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.devloop.OperationTask;
import com.iwhalecloud.byai.manager.mapper.devloop.OperationTaskMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.Locale;

/** 运营任务领域服务，负责需求拆解后的任务记录查询与状态更新。 */
@Service
public class OperationTaskService {

    @Autowired
    private OperationTaskMapper operationTaskMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 创建运营任务并写入通用审计字段。 */
    public OperationTask create(OperationTask task) {
        task.setTaskId(sequenceService.nextVal());
        task.setCreateTime(new Date());
        task.setDeleteFlag("0");
        operationTaskMapper.insert(task);
        return task;
    }

    /** 查询有效运营任务。 */
    public OperationTask findById(Long taskId) {
        OperationTask task = operationTaskMapper.selectById(taskId);
        return task != null && "0".equals(task.getDeleteFlag()) ? task : null;
    }

    /** 更新任务的非空字段。 */
    public void update(OperationTask task) {
        task.setUpdateTime(new Date());
        operationTaskMapper.updateById(task);
    }

    /** 项目任务分页查询，可按负责人、名称、创建时间和状态过滤。 */
    public Page<OperationTask> pageByProjectId(Long projectId, Long assignee, String keyword, Date createTimeStart,
        Date createTimeEnd, String status, int pageNum, int pageSize) {
        LambdaQueryWrapper<OperationTask> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(OperationTask::getProjectId, projectId).eq(OperationTask::getDeleteFlag, "0");
        if (assignee != null) {
            wrapper.eq(OperationTask::getAssignee, assignee);
        }
        if (createTimeStart != null) {
            wrapper.ge(OperationTask::getCreateTime, createTimeStart);
        }
        if (createTimeEnd != null) {
            wrapper.le(OperationTask::getCreateTime, createTimeEnd);
        }
        if (StringUtils.isNotBlank(status)) {
            wrapper.eq(OperationTask::getStatus, status);
        }
        String normalizedKeyword = StringUtils.trimToNull(keyword);
        if (normalizedKeyword != null) {
            // PostgreSQL 模糊匹配默认区分大小写，运营任务与其他项目列表保持忽略大小写的搜索口径。
            wrapper.apply("LOWER(title) LIKE {0}", "%" + normalizedKeyword.toLowerCase(Locale.ROOT) + "%");
        }
        wrapper.orderByDesc(OperationTask::getCreateTime).orderByDesc(OperationTask::getTaskId);
        return operationTaskMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);
    }
}
