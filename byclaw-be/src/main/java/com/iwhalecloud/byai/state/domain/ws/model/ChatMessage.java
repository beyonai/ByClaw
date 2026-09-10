package com.iwhalecloud.byai.state.domain.ws.model;

import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;

import java.util.List;

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

    private String language;

    /** 群聊引用消息 ID；普通聊天不使用。 */
    private Long replyToMessageId;

    /** 群聊目标成员 ID，具体类型由 mentions 中的对象说明。 */
    private List<GroupChatMentionDto> mentions;

    @Getter
    @Setter
    public static class GroupChatMentionDto {
        private String type;
        private Long id;
    }

}
