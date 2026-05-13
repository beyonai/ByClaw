package com.iwhalecloud.byai.state.domain.chat.model;

import lombok.Data;

@Data
public class ChatInitializationDto {
    /**
     * 大模型的消息ID
     */
    private Long messageId;
    /**
     * 用户问题的消息ID
     */
    private Long queryMessageId;

    /**
     * 放置matadate信息
     */
    private String metadata;

    /**
     * 会话ID
     */
    private Long sessionId;
}
