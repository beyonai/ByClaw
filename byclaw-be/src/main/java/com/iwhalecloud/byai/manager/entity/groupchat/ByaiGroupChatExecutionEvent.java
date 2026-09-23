package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;

import lombok.Data;

/** 群聊 execution 已消费事件，用于跨实例幂等。 */
@Data
public class ByaiGroupChatExecutionEvent {
    private Long executionId;
    private String eventId;
    private String eventType;
    private Date createTime;
}
