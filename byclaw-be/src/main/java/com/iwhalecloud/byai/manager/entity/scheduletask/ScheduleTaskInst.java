package com.iwhalecloud.byai.manager.entity.scheduletask;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 定时任务执行实例表实体
 *
 * @author he.duming 2025-11-21
 */
@Setter
@Getter
@TableName("byai_schedule_task_inst")
public class ScheduleTaskInst {

    /**
     * 任务执行实例id，主键
     */
    @TableId(value = "task_inst_id", type = IdType.INPUT)
    private Long taskInstId;

    /**
     * 任务id
     */
    private Long taskId;

    /**
     * 账期
     */
    private String cycleVal;

    /**
     * 启动时间
     */
    private Date startTime;

    /**
     * 结束时间
     */
    private Date endTime;

    /**
     * 执行请求内容
     */
    private String executionContent;

    /**
     * 执行响应结果
     */
    private String executionResult;

    /**
     * 执行异常信息
     */
    private String executionException;

    /**
     * 执行状态
     */
    private String statusCd;

    /**
     * 执行状态更新时间
     */
    private Date statusTime;
}
