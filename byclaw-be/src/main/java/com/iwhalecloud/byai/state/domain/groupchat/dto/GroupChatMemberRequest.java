package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** 群聊成员变更请求。 */
@Data
public class GroupChatMemberRequest {
    @NotNull
    private String type;
    @NotNull
    private Long id;
}
