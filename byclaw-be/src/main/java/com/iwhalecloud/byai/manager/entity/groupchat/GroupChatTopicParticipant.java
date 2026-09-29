package com.iwhalecloud.byai.manager.entity.groupchat;

import lombok.Data;

/** 话题参与者投影，按首次发言顺序返回。 */
@Data
public class GroupChatTopicParticipant {
    private Long topicId;
    private String memberType;
    private Long memberId;
    private String displayName;
    private Long firstMessageId;
}
