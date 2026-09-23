package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

/** 群消息被@真人用户的确认状态。不是一条新的群消息。 */
@Getter
@Setter
@TableName("byai_group_chat_message_ack")
public class ByaiGroupChatMessageAck {
    private Long sessionId;
    private Long messageId;
    private Long userId;
    private String userName;
    private Date acknowledgedAt;
}
