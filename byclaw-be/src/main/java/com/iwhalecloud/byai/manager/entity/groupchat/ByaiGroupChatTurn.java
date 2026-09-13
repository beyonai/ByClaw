package com.iwhalecloud.byai.manager.entity.groupchat;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/** Durable scheduling envelope for one turn; inherited executionId identifies the turn, not the session anchor. */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("byai_group_chat_turn")
public class ByaiGroupChatTurn extends ByaiGroupChatExecution {
    private Long anchorExecutionId;
    private Long triggerMessageId;
    private Long inputMessageId;
    private Long parentTurnId;
    private String senderType;
    private Long senderId;
    private Integer hopCount;
    private String phase;
    private String inputContent;
    private String inputMetadata;
    private Long publicBoundaryMessageId;
}
