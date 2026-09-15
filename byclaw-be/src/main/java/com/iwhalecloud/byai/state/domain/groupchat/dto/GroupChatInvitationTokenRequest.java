package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

/** 不生成 toString，避免邀请凭证进入日志。 */
@Getter
@Setter
public class GroupChatInvitationTokenRequest {
    @NotBlank
    @Pattern(regexp = "[A-Za-z0-9_-]{43}")
    private String token;
}
