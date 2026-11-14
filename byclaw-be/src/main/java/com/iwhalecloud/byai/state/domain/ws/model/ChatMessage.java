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

    private String language;

    /** Enterprise selected for this frame. Empty only when switching back to personal context. */
    private String enterpriseId;

    /** Selected external child whose full projection this WebSocket wants to receive. */
    private String scopedSessionId;

    /** 群聊引用消息 ID；普通聊天不使用。 */
    private Long replyToMessageId;

    /** 从真人待办进入群执行时携带；不同于员工任务会话 ID。 */
    private Long humanTaskId;

    /** Notify all current human group members; never dispatch digital employees. */
    private Boolean mentionAllUsers;

    /** Local Desktop turns persist their projection without dispatching another runtime. */
    private String executionBackend;
    private String role;
    private Long sourceMessageId;
    private Long creatorId;
    private String creatorName;
    private Long targetAgentId;

}
