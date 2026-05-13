package com.iwhalecloud.byai.manager.mapper.men;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.men.MenTaskStatusLog;
import org.apache.ibatis.annotations.Param;

/**
 * 待办任务状态变更表Mapper
 * 
 * @author system
 * @since 2024
 */

public interface MenTaskStatusLogMapper extends BaseMapper<MenTaskStatusLog> {

    /**
     * 根据任务ID删除状态日志
     * 
     * @param taskId 任务ID
     * @return 影响行数
     */
    int deleteByTaskId(@Param("taskId") Long taskId);
}