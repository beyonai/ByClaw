package com.iwhalecloud.byai.manager.entity.taskplan;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/** Agent 任务计划的追加式审计事件。 */
@Data
@TableName("byai_agent_task_event")
public class ByaiAgentTaskEvent {

    @TableId(value = "event_id", type = IdType.INPUT)
    private Long eventId;

    private Long planId;

    private Integer planVersion;

    private String eventType;

    private String actorType;

    private String actorId;

    private String idempotencyKey;

    private String payload;

    private Date createdAt;
}
