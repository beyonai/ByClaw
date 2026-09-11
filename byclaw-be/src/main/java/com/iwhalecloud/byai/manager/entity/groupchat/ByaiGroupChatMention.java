package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

/** 群消息中真人用户 mention 的规范化检索记录。 */
@Getter
@Setter
@TableName("byai_group_chat_mention")
public class ByaiGroupChatMention {
    private Long messageId;
    private Long groupSessionId;
    private Long mentionedUserId;
    private Long creatorId;
    private Date createTime;
}
