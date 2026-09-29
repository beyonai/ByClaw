package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** 从群聊进入指定 Agent 单聊的请求。 */
@Data
public class DirectSessionCreateRequest {
    @NotNull
    private Long agentId;
}
