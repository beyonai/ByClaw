package com.iwhalecloud.byai.state.domain.message.model;

import lombok.Data;

@Data
public class GroupChatResponse {
    private Long sessionId;
    private Long messageId;
}
