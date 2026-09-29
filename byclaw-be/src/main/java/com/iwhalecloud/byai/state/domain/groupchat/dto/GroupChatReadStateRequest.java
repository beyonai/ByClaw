package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/** 群聊已读游标更新请求。 */
@Getter
@Setter
public class GroupChatReadStateRequest {
    @NotNull
    private Long lastReadMessageId;
}
