package com.iwhalecloud.byai.state.domain.ws.model;

import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ChatMessage extends AssistantChatDto {

    /**
     * 发信人
     */
    private String senderName;

    // 发送者用户名(发信人)
    private Long senderId;

    // 消息类型
    private MessageType type;

    private Long messageId;

}