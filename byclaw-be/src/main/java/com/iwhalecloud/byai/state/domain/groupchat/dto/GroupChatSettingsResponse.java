package com.iwhalecloud.byai.state.domain.groupchat.dto;

import lombok.Data;

@Data
public class GroupChatSettingsResponse {
    private String groupNumber;
    private boolean allowJoinByNumber;
    private boolean allowJoinByLink;
    private boolean numberJoinRequiresApproval = true;
}
