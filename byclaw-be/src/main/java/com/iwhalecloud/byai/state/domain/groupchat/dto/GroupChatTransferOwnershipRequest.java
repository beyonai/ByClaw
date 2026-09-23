package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** 群主转让请求，避免将 language 等附加字段按用户 ID 类型解析。 */
@Data
public class GroupChatTransferOwnershipRequest {
    @NotNull
    private Long userId;
}
