package com.iwhalecloud.byai.manager.mapper.scheduletask;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.scheduletask.ScheduleTask;
import com.iwhalecloud.byai.manager.vo.scheduletask.ScheduleTaskVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;


/**
 * 定时任务表Mapper
 *
 * @author zzh 2025-11-21
 */
@Mapper
public interface ScheduleTaskMapper extends BaseMapper<ScheduleTask> {

    /**
     * 根据主键查询定时任务详情（连表查询）
     *
     * @param taskId 任务ID
     * @return 定时任务视图对象
     */
    ScheduleTaskVo selectVoById(@Param("taskId") Long taskId);

}
