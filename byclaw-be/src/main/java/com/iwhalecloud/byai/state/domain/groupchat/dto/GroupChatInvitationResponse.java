package com.iwhalecloud.byai.state.domain.groupchat.dto;

import lombok.Data;

/** 登录用户可读取的邀请摘要，不包含消息或成员身份信息。 */
@Data
public class GroupChatInvitationResponse {
    private String groupNumber;
    private String groupName;
    private int memberCount;
    private boolean allowJoinByLink;
    private boolean alreadyMember;
}
