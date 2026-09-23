package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Data;

/**
 * Super 回源读取群聊历史的定位和有界窗口。
 */
@Data
public class GroupChatContextRequest {

    private String conversationKey;

    private String beforeMessageId;

    private Integer maxMessages;

    private Integer maxCharacters;

    /** 后端签发的群聊上下文凭证，供 Agent 回源读取历史。 */
    private String contextToken;

    private Long childSessionId;

    private Long initiatorUserId;

    private Long targetAgentId;
}
