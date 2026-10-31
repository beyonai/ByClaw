package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.List;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;

import lombok.Data;

/** 群聊详情。 */
@Data
public class GroupChatDetailResponse {
    private ByaiSession session;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;
    private GroupChatSettingsResponse settings;
    private List<ByaiSessionMember> members;
    private String coordinatorAgentId;
}
