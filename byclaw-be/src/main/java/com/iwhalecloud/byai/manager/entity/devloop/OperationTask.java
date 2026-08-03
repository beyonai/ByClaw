package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 运营任务实体。
 * 一条运营需求可拆分为多个运营任务，任务执行状态与需求状态分开维护。
 */
@Getter
@Setter
@TableName("byai_operation_task")
public class OperationTask {

    @TableId(value = "task_id", type = IdType.INPUT)
    private Long taskId;

    private Long requirementId;

    private Long projectId;

    private String title;

    private String description;

    private String operationType;

    private String status;

    private Long assignee;

    private Date dueTime;

    private Integer progress;

    /** 继承自运营需求的类型配置 JSON。 */
    private String config;

    /** 执行时确认的数字员工 ID 列表 JSON。 */
    private String agentSelection;

    /** 运营工作流步骤及进度 JSON。 */
    private String workflow;

    /** 执行后创建的主会话 ID。 */
    private Long sessionId;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
