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
}
