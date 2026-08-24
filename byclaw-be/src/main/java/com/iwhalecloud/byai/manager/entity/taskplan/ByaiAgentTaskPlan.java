package com.iwhalecloud.byai.manager.entity.taskplan;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/** Agent 任务计划当前快照。 */
@Data
@TableName("byai_agent_task_plan")
public class ByaiAgentTaskPlan {

    @TableId(value = "plan_id", type = IdType.INPUT)
    private Long planId;

    private Long userId;

    private String userCode;

    private Long sessionId;

    private Long messageId;

    private String turnId;

    private String laneId;

    private String traceId;

    private String sourceRuntime;

    private String sourceRunId;

    private String createRequestId;

    private String title;

    private String lastExplanation;

    private String status;

    private String statusReasonCode;

    private String statusReasonMessage;

    private Integer version;

    private Date createdAt;

    private Date updatedAt;

    private Date completedAt;
}
