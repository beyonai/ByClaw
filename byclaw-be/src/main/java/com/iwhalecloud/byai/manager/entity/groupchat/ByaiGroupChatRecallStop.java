package com.iwhalecloud.byai.manager.entity.groupchat;

import lombok.Data;

/** 持久化撤回屏障；DONE 仍保留，用于拒绝迟到发送及自动委派。 */
@Data
public class ByaiGroupChatRecallStop {
    private Long executionId;
    private Long sessionId;
    private Long initiatorUserId;
    private String traceId;
    private boolean taskOwned;
    private String status;
}
