package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** 管理员直接添加群成员请求。 */
@Data
public class GroupChatMemberRequest {
    @NotNull
    private String type;
    @NotNull
    private Long id;
}
