package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;
import java.util.Map;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

/** 群聊任务或成员私聊，正式任务按任务完成，私聊按确认的草稿发布。 */
@Data
@TableName("byai_group_chat_task")
public class ByaiGroupChatTask {
    /** Identifies which runtime owns task execution; legacy persisted tasks are remote. */
    @com.baomidou.mybatisplus.annotation.TableField(exist = false)
    private String executionBackend = "REMOTE";
    @com.baomidou.mybatisplus.annotation.TableField(exist = false)
    private Map<String, Object> groupCoordination;
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
    /** 本轮启动占位标识，防止启动失败的迟到回调释放后续轮次。 */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long currentTurnId;
    /** 实际下发的本轮 trace；后台运行态的主 trace 不代表任务当前轮次。 */
    private String currentTurnTraceId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long publishMessageId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long publishBy;
    private Date createTime;
    private Date updateTime;
}
