package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

/** 当前用户的群聊列表项及未读 mention 投影。 */
@Getter
@Setter
public class GroupChatListItemResponse {
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sessionId;

    private String name;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long projectId;

    private String role;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestMessageId;

    private String latestMessageContent;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date latestMessageTime;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestMessageCreatorId;

    private String latestMessageCreatorName;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long lastReadMessageId;

    private long unreadMentionCount;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestMentionMessageId;

    public boolean isHasUnreadMention() {
        return unreadMentionCount > 0;
    }
}
