package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.Setter;

/** 使用撤回响应中的毫秒时间匹配本次撤回，避免旧请求撤销后续操作。 */
@Getter
@Setter
public class GroupChatRecallUndoRequest {
    @NotNull
    @Positive
    private Long recalledAt;
}
