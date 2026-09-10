package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.List;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** 群聊预创建请求。 */
@Data
public class GroupChatCreateRequest {
    @NotNull
    private Long projectId;
    @NotBlank
    private String name;
    @NotNull
    private Long ownerUserId;
    private List<Long> adminUserIds;
    private List<Long> userIds;
    private List<Long> agentIds;
}
