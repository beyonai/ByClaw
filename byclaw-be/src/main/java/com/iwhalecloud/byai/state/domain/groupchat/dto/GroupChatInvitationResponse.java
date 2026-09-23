package com.iwhalecloud.byai.state.domain.groupchat.dto;

import lombok.Data;

/** 持有效凭证可读取的邀请摘要，不包含消息或完整成员列表。 */
@Data
public class GroupChatInvitationResponse {
    private String groupNumber;
    private String groupName;
    private String inviterName;
    private String enterpriseName;
    private long expiresAt;
    /** 最多四位成员的展示摘要，不包含成员 ID、角色或联系方式。 */
    private java.util.List<MemberPreview> memberPreviews = java.util.List.of();
    private int memberCount;
    private boolean allowJoinByLink;
    private boolean alreadyMember;
    @Data
    public static class MemberPreview {
        private String displayName;
        private String type;
        private String avatar;
    }
}
