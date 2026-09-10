package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.List;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;

import lombok.Data;

/** 群聊详情。 */
@Data
public class GroupChatDetailResponse {
    private ByaiSession session;
    private List<ByaiSessionMember> members;
}
