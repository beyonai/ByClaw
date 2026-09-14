package com.iwhalecloud.byai.state.domain.groupchat.dto;

import lombok.Data;

/** 会话扩展表中每位申请人的最近一次入群申请。ID 使用字符串避免前端精度损失。 */
@Data
public class GroupChatJoinApplication {
    private String requestId;
    private String sessionId;
    private String userId;
    private String userName;
    /** PENDING / APPROVED / REJECTED / CANCELLED / JOINED。 */
    private String status;
    private Long requestedAt;
    private String reviewerId;
    private Long reviewedAt;
}
