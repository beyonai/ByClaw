package com.iwhalecloud.byai.manager.entity.taskplan;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/** Agent 任务计划中的一个有序步骤。 */
@Data
@TableName("byai_agent_task_item")
public class ByaiAgentTaskItem {

    @TableId(value = "task_id", type = IdType.INPUT)
    private Long taskId;

    private Long planId;

    private Integer position;

    private String title;

    private String description;

    private String status;

    private String statusReasonCode;

    private String statusReasonMessage;

    private Date createdAt;

    private Date updatedAt;

    private Date startedAt;

    private Date completedAt;
}
