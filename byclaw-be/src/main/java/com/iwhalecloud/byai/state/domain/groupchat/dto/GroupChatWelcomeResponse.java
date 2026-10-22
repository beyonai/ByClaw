package com.iwhalecloud.byai.state.domain.groupchat.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 当前成员的个人欢迎卡申请结果；时间表示资格已处理，不代表实际曝光。
 *
 * @author Codex
 * @since 2026-10-22
 */
@Getter
@Setter
public class GroupChatWelcomeResponse {
    private String sessionId;
    private String memberId;
    private boolean granted;
    private Long handledAt;
}
