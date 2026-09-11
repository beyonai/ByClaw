package com.iwhalecloud.byai.state.domain.groupchat.dto;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

/** 推进群聊已读游标后的权威 mention 状态。 */
@Getter
@Setter
public class GroupChatReadStateResponse {
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long lastReadMessageId;

    private long unreadMentionCount;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestMentionMessageId;

    public boolean isHasUnreadMention() {
        return unreadMentionCount > 0;
    }
}
