package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

/** 可多轮处理并由发起人一次性发布的群聊任务。 */
@Data
@TableName("byai_group_chat_task")
public class ByaiGroupChatTask {
    @TableId(value = "task_session_id", type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskSessionId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long groupSessionId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sourceMessageId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long dispatchId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long initiatorUserId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long targetAgentId;
    private String taskName;
    private String status;
    private String turnStatus;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long publishMessageId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long publishBy;
    private Date createTime;
    private Date updateTime;
}
