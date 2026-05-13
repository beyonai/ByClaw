package com.iwhalecloud.byai.manager.domain.scheduletask.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.entity.scheduletask.ScheduleTaskInst;
import com.iwhalecloud.byai.manager.mapper.scheduletask.ScheduleTaskInstMapper;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 定时任务执行实例服务
 *
 * @author he.duming 2025-11-21
 */
@Service
public class ScheduleTaskInstService {

    @Autowired
    private ScheduleTaskInstMapper scheduleTaskInstMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 保存执行实例
     * 
     * @param scheduleTaskInst 调任务执行实例
     */
    public void save(ScheduleTaskInst scheduleTaskInst) {
        scheduleTaskInst.setTaskInstId(SequenceService.nextVal());
        scheduleTaskInstMapper.insert(scheduleTaskInst);
    }

    /**
     * 根据执行周期来
     *
     * @param taskId 节点标识
     * @param cycleValue 账期
     */
    public void clearTaskInstByCycle(Long taskId, String cycleValue) {

        if (taskId == null || StringUtil.isEmpty(cycleValue)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("schedule.task.inst.task.id.or.cycle.not.null"));
        }

        LambdaQueryWrapper<ScheduleTaskInst> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(ScheduleTaskInst::getTaskId, taskId);
        deleteWrapper.eq(ScheduleTaskInst::getCycleVal, cycleValue);
        scheduleTaskInstMapper.delete(deleteWrapper);
    }

    /**
     * 根据执行周期来
     * 
     * @param taskId 任务标识
     * @param cycleValue 账期
     * @return ScheduleTaskInst
     */
    public ScheduleTaskInst findTaskInstByCycle(Long taskId, String cycleValue) {

        LambdaQueryWrapper<ScheduleTaskInst> queryWrapper = new LambdaQueryWrapper<>();

        queryWrapper.eq(ScheduleTaskInst::getTaskId, taskId);

        if (StringUtil.isNotEmpty(cycleValue)) {
            queryWrapper.eq(ScheduleTaskInst::getCycleVal, cycleValue);
        }

        return scheduleTaskInstMapper.selectOne(queryWrapper);
    }

    /**
     * 根据任务标识清除实例
     * 
     * @param taskId 任务标识
     */
    public void deleteScheduleTaskInstByTaskId(Long taskId) {
        if (taskId == null) {
            return;
        }

        LambdaQueryWrapper<ScheduleTaskInst> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(ScheduleTaskInst::getTaskId, taskId);
        scheduleTaskInstMapper.delete(deleteWrapper);
    }
}
