package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;

import lombok.Data;

/** 仅在首次公开引用回复时创建的群话题索引。 */
@Data
public class ByaiGroupChatTopic {
    private Long topicId;
    private Long groupSessionId;
    private Long rootMessageId;
    private Long lastMessageId;
    private Date lastActivityAt;
    private Date createTime;
}
