package com.iwhalecloud.byai.manager.domain.scheduletask.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.scheduletask.ScheduleTask;
import com.iwhalecloud.byai.manager.mapper.scheduletask.ScheduleTaskMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.vo.scheduletask.ScheduleTaskVo;
import lombok.extern.slf4j.Slf4j;

/**
 * 定时任务服务
 * <p>
 * 负责定时任务的增删改查操作，所有写操作均开启事务，确保数据一致性。
 * </p>
 *
 * @author zzh 2025-11-21
 */
@Slf4j
@Service
public class ScheduleTaskService {

    @Autowired
    private ScheduleTaskMapper scheduleTaskMapper;

    /**
     * 保存定时任务
     *
     * @param scheduleTask 定时任务
     */
    public void save(ScheduleTask scheduleTask) {
        scheduleTaskMapper.insert(scheduleTask);
    }

    /**
     * 更新定时任务
     *
     * @param scheduleTask 更新对象
     */
    public void update(ScheduleTask scheduleTask) {
        scheduleTaskMapper.updateById(scheduleTask);
    }

    /**
     * 主键查询定时任务
     *
     * @param taskId 主键
     */
    public ScheduleTask findById(Long taskId) {
        return scheduleTaskMapper.selectById(taskId);
    }

    /**
     * 根据主键删除定时任务
     *
     * @param taskId 主键
     * @return 是否删除成功
     */
    public boolean deleteScheduleTask(Long taskId) {

        int count = scheduleTaskMapper.deleteById(taskId);

        return count > 0;
    }

    /**
     * 根据主键查询定时任务详情（包含关联信息）
     *
     * @param taskId 主键
     * @return 定时任务视图对象
     */
    public ScheduleTaskVo getScheduleTaskById(Long taskId) {

        Objects.requireNonNull(taskId, "定时任务主键不能为空");

        ScheduleTaskVo scheduleTaskVo = scheduleTaskMapper.selectVoById(taskId);
        if (scheduleTaskVo == null) {
            return null;
        }

        // 设置分隔符返回
        scheduleTaskVo.setExecutionFrequencys(StringUtil.splitStr(scheduleTaskVo.getExecutionFrequency(), ","));

        return scheduleTaskVo;
    }

    /**
     * 根据条件查询定时任务列表
     *
     * @param resourceId 查询参数
     * @return 定时任务列表
     */
    public List<ScheduleTaskVo> queryScheduleTaskList(Long resourceId) {

        LambdaQueryWrapper<ScheduleTask> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ScheduleTask::getResourceId, resourceId);
        queryWrapper.eq(ScheduleTask::getExecutorId, CurrentUserHolder.getCurrentUserId());
        List<ScheduleTask> scheduleTasks = scheduleTaskMapper.selectList(queryWrapper);

        List<ScheduleTaskVo> resultList = new ArrayList<>(scheduleTasks.size());
        for (ScheduleTask scheduleTask : scheduleTasks) {
            ScheduleTaskVo scheduleTaskVo = new ScheduleTaskVo();
            BeanUtils.copyProperties(scheduleTask, scheduleTaskVo);
            // 设置分隔符返回
            scheduleTaskVo.setExecutionFrequencys(StringUtil.splitStr(scheduleTaskVo.getExecutionFrequency(), ","));
            resultList.add(scheduleTaskVo);
        }

        return resultList;
    }

    /**
     * 根据节点查询调度任务标识
     *
     * @param scheduleDnId 节点标识
     * @return ScheduleTask
     */
    public ScheduleTask findByScheduleDnId(Long scheduleDnId) {
        LambdaQueryWrapper<ScheduleTask> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ScheduleTask::getScheduleDnId, scheduleDnId);
        return scheduleTaskMapper.selectOne(queryWrapper);
    }

}