package com.iwhalecloud.byai.state.domain.groupchat.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

/** 部分更新群设置；未传字段保留原值。 */
@Data
public class GroupChatSettingsRequest {
    @Size(max = 100)
    private String sessionName;
    private Boolean allowJoinByNumber;
    private Boolean allowJoinByLink;
}
