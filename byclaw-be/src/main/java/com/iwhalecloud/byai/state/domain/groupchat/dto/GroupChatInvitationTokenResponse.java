package com.iwhalecloud.byai.state.domain.groupchat.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class GroupChatInvitationTokenResponse {
    private String token;
    private long expiresAt;
}
