package com.iwhalecloud.byai.state.domain.groupchat.dto;

import lombok.Data;

/** 工作组聊天记录检索条件。 */
@Data
public class GroupChatMessageSearchRequest {
    private String keyword;
    private String scope;
    private String senderType;
    private Long startTime;
    private Long endTime;
    private String beforeMessageId;
    private Integer limit;
}
