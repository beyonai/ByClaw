package com.iwhalecloud.byai.manager.entity.scheduletask;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 定时任务元数据表实体
 *
 * @author zzh 2025-11-21
 */
@Setter
@Getter
@TableName("byai_schedule_task")
public class ScheduleTask {

    /**
     * 任务ID，主键
     */
    @TableId(value = "task_id", type = IdType.INPUT)
    @NotNull(groups = Mod.class, message = "定时任务ID不能为空")
    private Long taskId;

    /**
     * 调度任务ID，由ETL服务返回
     */
    private Long scheduleTaskId;

    /**
     * 任务节点标识
     */
    private Long scheduleDnId;

    /**
     * 任务名称，由内容总结生成
     */
    @Size(groups = {
        Add.class, Mod.class
    }, max = 50, message = "任务名称长度不能超过50字符")
    private String taskName;

    /**
     * 任务类型，与ss_resource表中resource_biz_type一致
     */
    private String taskType;

    /**
     * 任务状态：00A、00X
     */
    @Pattern(regexp = "00A|00X", message = "任务状态不合法，仅支持00A或00X")
    private String statusCd;

    /**
     * 关联资源id，数字员工id或者智能体id
     */
    private Long resourceId;

    /**
     * 执行用户id，前台默认是当前用户
     */
    private Long executorId;

    /**
     * 执行周期：MONTH、WEEK、DAY、CUSTOM
     */
    private String executionCycle;

    /**
     * 执行频率：每周几或者每月几号，选每日和固定时间是为空
     */
    private String executionFrequency;

    /**
     * 执行时间，HH:mm:ss
     */
    private String executionTime;

    /**
     * 执行任务内容，调用参数
     */
    @Size(groups = {
        Add.class, Mod.class
    }, max = 50, message = "执行任务内容超过1000字符")
    private String executionContent;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新人
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    private Date updateTime;
}
