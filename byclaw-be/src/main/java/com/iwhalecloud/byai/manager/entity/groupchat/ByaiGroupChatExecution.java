package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/**
 * 群聊 Agent 执行记录，对应 byai_group_chat_execution。
 */
@Data
@TableName("byai_group_chat_execution")
public class ByaiGroupChatExecution {

    @TableId(value = "execution_id", type = IdType.INPUT)
    private Long executionId;

    private Long groupSessionId;

    private Long sourceMessageId;

    private Long replyToMessageId;

    private Long initiatorUserId;

    private Long targetAgentId;

    private Long candidateSessionId;

    private String status;

    private String disposition;

    private String taskName;

    private String ackText;

    private Date dispositionTime;

    private Long parentExecutionId;

    private Long rootMessageId;

    private String traceId;

    private String gatewaySessionId;

    private Long ackMessageId;

    private Long answerMessageId;

    private String errorCode;

    private String errorMessage;

    private Integer attempt;

    private Date createTime;

    private Date startTime;

    private Date finishTime;
}
